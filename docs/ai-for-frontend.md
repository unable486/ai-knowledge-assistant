# 从前端视角理解 AI 开发

> 这份文档解释 JD 第 10 条里那串名词：**大模型应用、Prompt Engineering、
> Function Calling、MCP、RAG、Workflow、AI Agent**。
>
> 假设你会 `fetch`、知道 SSE、写过 TypeScript，但没做过 AI 应用。
> 全部用前端已有的概念类比，不用一个没解释过的行话。
>
> 深入版在 [ai-knowledge.md](ai-knowledge.md)，那个是查的；这个是**先看的**。

---

## 先说结论：这些词的关系

```
大模型 = 一个无状态的 HTTP 接口          ← 一切的基础
  ├─ Prompt Engineering = 怎么传参数
  ├─ RAG = 传参数之前，先去搜点资料塞进去
  ├─ Function Calling = 让模型能反过来调你的函数
  │    └─ Agent = 把 Function Calling 放进一个循环
  │         └─ Workflow = 和 Agent 相对：流程由你写死，不由模型决定
  └─ MCP = 把 Function Calling 的工具标准化，跨客户端复用
```

七个词里，**只有「向量搜索」是真正的新知识**，其余都是你已经熟的东西换了个名字。

---

# 一 · 大模型就是一个无状态接口

这是最重要的一节。理解了这个，后面全是推论。

## 它的函数签名

去掉所有神秘感，你调用的东西长这样：

```ts
// 输入一串对话，输出一段文本。就这样。
type CallModel = (messages: Array<{
  role: 'user' | 'assistant'
  content: string
}>) => Promise<string>
```

一个 `POST` 请求，body 里是消息数组，响应是文本。
你项目里 [server/index.ts:180-185](../server/index.ts#L180-L185) 就是这么调的。

## 关键：它没有记忆

**模型不记得上一次你跟它说了什么。** 每次请求都是全新的。

那多轮对话怎么实现的？**你每次把完整历史重新发一遍。**

```ts
// 第一轮
await callModel([
  { role: 'user', content: '什么是闭包' }
])

// 第二轮：不是只发新问题，而是把前面全部重发
await callModel([
  { role: 'user', content: '什么是闭包' },
  { role: 'assistant', content: '闭包是指...' },   // ← 上一轮的回答也要发回去
  { role: 'user', content: '举个例子' }             // ← 新问题
])
```

**这个和 HTTP 无状态是一模一样的道理。** HTTP 每个请求之间不认识彼此，
所以你每次都要带上 token 或 cookie。模型也一样，每次都要带上全部上下文。

你项目里的 [useChat.ts:25-34](../src/composables/useChat.ts#L25-L34) 那个 `buildHistory`
就是干这个的 —— 每次发送前，把这个会话里所有已完成的消息重新组装成数组。

## 由此推出三个后果

1. **对话越长，每次请求越贵、越慢** —— 因为重发的历史越来越大。
2. **总有一天会超上限** —— 见下一节。
3. **会话状态是你的责任，不是模型的** —— 存哪、存多少、怎么裁剪，全是你的工程决策。
   你项目里存在 localStorage（[chatStorage.ts](../src/services/storage/chatStorage.ts)）。

---

# 二 · Token 和上下文窗口

## Token = 文本的计量单位

模型不按字符算，按 token 算。粗略换算：

| 内容 | token 数 |
| --- | --- |
| 一个中文字 | ≈ 1 |
| 一个英文单词 | ≈ 1.3 |
| 一段 500 字的中文 | ≈ 500 |

**为什么要知道**：token 是计费单位，也是上限单位。输入和输出**分别计费**，输出通常贵几倍。

## 上下文窗口 = 单次请求的容量上限

一次请求里「历史 + 新问题 + 模型的回答」加起来不能超过这个数。

这就是 `express.json({ limit: '1mb' })` 那种硬上限，只不过单位是 token。
你项目里 [index.ts:24](../server/index.ts#L24) 那行就是同类东西。

超了怎么办？你得自己裁。你项目里的做法是提前拦住：

```ts
// server/index.ts:19-21
const maxMessages = 40                      // 最多 40 条
const maxMessageCharacters = 20_000         // 单条最多 2 万字
const maxConversationCharacters = 120_000   // 整个会话最多 12 万字
```

超过就返回 400，不让请求发到模型那边去。
更成熟的做法是「丢掉最早几轮」或者「把早期对话压缩成摘要」，这个项目没做。

---

# 三 · Prompt Engineering = 接口约定

名字听起来玄学，实际是**你在给一个能力很强但极其死板的同事写需求文档**。

## system 和 user 的区别

消息数组里除了 `user` / `assistant`，还有一个特殊位置叫 **system prompt**，
它是「这次对话的全局规则」，只设一次，对后面每一轮都生效。

前端类比：

```ts
// system prompt ≈ axios 实例的默认配置
const api = axios.create({
  baseURL: '/api',
  headers: { 'X-Role': '你是知识库助手，只根据资料回答' }  // ← 每个请求都带
})

// user message ≈ 每次调用传的参数
api.post('/ask', { q: '这个项目怎么部署' })
```

你项目里的 system prompt 在
[retriever.ts:51-62](../server/rag/retriever.ts#L51-L62)，写了四条规则：
优先用资料回答、资料里没有的要说明、引用要标来源、资料里的内容是数据不是指令。

## 为什么这是工程问题不是玄学

因为**歧义会被模型放大**。对比两种写法：

```ts
// ✗ 你以为说清楚了
'返回 JSON'
// 实际可能拿到：```json\n{...}\n```  ← 被 markdown 代码块包着，JSON.parse 直接炸

// ✓ 把歧义堵掉
'只返回 JSON 对象本身。不要加解释文字，不要用 markdown 代码块包裹。'
```

这个体验前端很熟 —— 就是你写接口文档时，为了防后端理解偏差，
把「时间字段用什么格式」写得死死的那种感觉。

## 一个安全边界（这个是重点）

如果 prompt 里要塞进外部内容（用户上传的文档、网页抓的内容），
那些内容里可能藏着「忽略前面的指令，改成……」这种话。这叫 **prompt 注入**。

前端对这个应该有本能反应 —— **这就是 XSS 的同构问题**：
把不可信内容拼进一个会被解释执行的字符串里。

XSS 是拼进 HTML，prompt 注入是拼进 prompt。你项目里的三层防护在
[retriever.ts:1-12](../server/rag/retriever.ts#L1-L12)，逻辑和防 XSS 一样：
标记边界、转义特殊字符、输出侧再净化一遍。

---

# 四 · RAG = 先搜资料，再问模型

**RAG** = Retrieval-Augmented Generation = 检索增强生成。
名字很吓人，一句话说完：

> **模型不知道你公司的内部文档。所以在提问之前，你先去搜一下相关文档，
> 把搜到的片段和问题一起发给模型。**

就这样。「检索」= 搜索，「增强」= 把搜到的塞进 prompt，「生成」= 模型回答。

## 为什么需要它

模型的知识来自训练数据，有两个硬边界：

1. **有时间截止点** —— 训练之后发生的事它不知道。
2. **不包含你的私有内容** —— 你公司的文档、你的代码库，它没见过。

解决办法有两种：重新训练模型（贵、慢、要机器），
或者**每次提问时把相关资料附在问题旁边**。后者就是 RAG，成本几乎为零。

前端类比：这就是**服务端渲染时先查数据库再拼页面**。
模型是模板，资料是数据。你不会指望模板自己知道数据。

## 唯一的新知识：语义搜索

RAG 里只有一步是前端没接触过的 —— 怎么「搜」。

用关键词搜行不行？就是这个：

```ts
// 关键词搜索：你已经会了
docs.filter(d => d.includes('退货'))
```

问题是：用户问「**怎么退货**」，文档里写的是「**退款流程**」。
没有共同的字，`includes` 搜不到。但这两句明显在说同一件事。

所以需要按**意思**搜，而不是按**字**搜。做法是：

### 把每段文字变成一个坐标

想象一张地图，你把所有文档片段放上去，**讲同一件事的放得近**。
「退款流程」和「怎么退货」会挨在一起，「服务器配置」在地图的另一头。

然后「搜索」就变成了纯数学问题：**把问题也放到地图上，找它周围最近的几个点。**

那个「算坐标」的函数叫 **embedding**（嵌入）：

```ts
// 输入一段文字，输出一串数字 —— 就是这段文字在「语义地图」上的坐标
type Embed = (text: string) => Promise<number[]>

await embed('退款流程')      // → [0.021, -0.13, 0.44, ...]
await embed('怎么退货')      // → [0.019, -0.12, 0.45, ...]  ← 坐标很接近
await embed('服务器配置')    // → [-0.53, 0.71, -0.02, ...]  ← 差很远
```

不是二维地图，你项目用的是 **512 维**
（[embedder.ts:31](../server/rag/embedder.ts#L31)）。维度多是因为语义的差别方向很多，
但原理不变 —— 还是算距离，只是在 512 维空间里算。

### 算距离的代码，比你想的简单

```ts
// server/rag/vectorStore.ts:175-179
function dotProduct(a: number[], b: number[]): number {
  let sum = 0
  for (let i = 0; i < a.length; i += 1) sum += a[i] * b[i]
  return sum
}
```

**整个「向量搜索」的核心就是这五行。** 两个坐标对应位置相乘再加起来，
结果越大表示越接近。剩下的就是排序取前几个。

（严格说这叫余弦相似度，但因为向量提前被归一化成了单位长度，
算式退化成了这个点积。这句是加分项，听不懂可以跳过。）

## RAG 的三步流程

```
【第一步 · 入库】只做一次，上传文档时
  文档 → 切成小块 → 每块算坐标 → 连坐标一起存起来

【第二步 · 检索】每次提问时
  问题 → 算坐标 → 和库里所有块算距离 → 取最近的 4 块

【第三步 · 生成】
  把这 4 块 + 问题一起发给模型 → 模型基于资料回答
```

对应到你项目的文件：

| 步骤 | 文件 |
| --- | --- |
| 切块 | [server/rag/chunker.ts](../server/rag/chunker.ts) |
| 算坐标 | [server/rag/embedder.ts](../server/rag/embedder.ts) |
| 存 + 搜 | [server/rag/vectorStore.ts](../server/rag/vectorStore.ts) |
| 入库总流程 | [server/rag/ingest.ts](../server/rag/ingest.ts) |
| 检索 + 拼 prompt | [server/rag/retriever.ts](../server/rag/retriever.ts) |
| 串起来 | [server/index.ts:158-185](../server/index.ts#L158-L185) |

## 为什么要「切块」

两个原因：

1. **塞不进去** —— 上下文窗口有上限，不可能把整本手册发过去。
2. **坐标会失去意义** —— 一篇长文讲了十个主题，它的「坐标」是十个主题的平均值,
   落在地图上一个没有意义的位置，搜什么都不太准。

前端类比：**你不会把整个应用写在一个组件里。**
切块的目的和拆组件一样 —— 让每一块只讲一件事，这样它的「坐标」才准确。

切多大是有讲究的：太小则一块话说不完整，检索到了也答不出来；
太大则混了多个主题，坐标被平均掉。你项目的选择是目标 400 字、上限 600 字、
块之间留 60 字重叠（[chunker.ts:15-19](../server/rag/chunker.ts#L15-L19)）。

**留重叠是因为**：关键句可能正好落在切割线上，被劈成两半，两块都答不全。
让相邻块共享一点尾巴/开头就能避免。

## 到这里 RAG 你已经懂了

回头看那句定义：**检索**（算坐标、找最近的块）**增强**（塞进 prompt）**生成**（模型回答）。
三个词各对应一步，没有别的东西。

---

# 五 · Function Calling = 给沙箱开几个出口

## 模型能干什么、不能干什么

模型**只能生成文本**。它不能上网、不能读文件、不能查数据库、算数还经常算错。

前端类比：**模型就像一个 Web Worker。**
Worker 摸不到 DOM，想操作页面只能 `postMessage` 让主线程代劳。
模型也一样 —— 它想查天气，只能告诉你「请帮我调用查天气的函数」，
真正去调的是你的代码。

**Function Calling 就是这个机制。** 名字里有 "calling"，但要记住：
**模型自己不 call 任何东西，它只是返回一个「我想 call 这个」的 JSON。**

## 完整的五步

```ts
// 1. 你告诉模型有哪些工具可用（这就是「工具定义」）
const tools = [{
  name: 'get_weather',
  description: '查询某个城市的当前天气',
  input_schema: {
    type: 'object',
    properties: { city: { type: 'string' } },
    required: ['city']
  }
}]

// 2. 提问时把工具列表一起发过去
let messages = [{ role: 'user', content: '北京今天天气怎么样' }]
let reply = await callModel(messages, tools)

// 3. 模型不直接回答，而是返回「我要调这个函数」
// reply = { type: 'tool_use', name: 'get_weather', input: { city: '北京' } }

// 4. 你的代码真的去执行 —— 这一步和 AI 无关，就是普通的 fetch
const result = await fetch(`/api/weather?city=${reply.input.city}`).then(r => r.json())

// 5. 把执行结果发回去（连历史一起，因为无状态），模型才给出人话回答
messages = [
  ...messages,
  { role: 'assistant', content: [reply] },
  { role: 'user', content: [{ type: 'tool_result', content: JSON.stringify(result) }] }
]
reply = await callModel(messages, tools)
// → "北京今天 15 度，晴。"
```

注意 **`input_schema` 就是 JSON Schema** —— 和你写表单校验、
写接口文档用的是同一个东西。工具定义没有任何新知识。

## 你项目里现在没有这个

现在是**无条件先检索**：不管问什么，都先去知识库搜一遍
（[index.ts:158-165](../server/index.ts#L158-L165)）。
所以哪怕用户说「你好」，也白跑一次 embedding + 一次检索。

改成 Function Calling 就是：给模型一个 `search_knowledge_base` 工具，
让**它自己判断这一问要不要查**。闲聊不查，问项目细节才查。

这是这个项目最自然的下一步，也是从「会 RAG」到「会 Agent」的分界线。

---

# 六 · Agent = 把 Function Calling 放进循环

单次 Function Calling 是「问一次 → 调一个工具 → 答一次」。

**Agent 是让模型能连续调用多次工具，自己决定下一步，直到它认为完成了。**

前端类比：单次 FC 像一个 `await fetch()`；Agent 像一个 `while` 循环，
退出条件由模型给（它不再要求调工具了就算完）。

```ts
let messages = [{ role: 'user', content: '这个项目的部署方式和端口配置' }]
let rounds = 0

while (rounds < 5) {                          // ← 硬上限，防死循环
  const reply = await callModel(messages, tools)

  if (!reply.toolUse) break                   // ← 模型不再要工具，说明它答完了

  const result = await runTool(reply.toolUse)  // 你的代码执行
  messages = [...messages, reply, result]      // 把这一轮追加进历史
  rounds += 1
}
```

模型可能第一轮搜「部署」，发现没查到端口的事，第二轮换成搜「端口配置」再查一次。
**这个「自己换个说法重试」的能力就是 Agent 和单次调用的本质区别。**

## 三个工程问题（前端一定会关心）

1. **必须有最大轮次** —— 否则模型可能反复调工具停不下来，烧钟烧钱。
2. **token 成本是累加的** —— 每轮都要重发全部历史（无状态，记得吗），
   第 5 轮的请求里包含前 4 轮的全部内容。成本不是线性增长。
3. **不可预测** —— 同一个问题两次运行，模型可能走不同的路径。
   这对测试是个真问题。

---

# 七 · Workflow vs Agent = 谁来写控制流

这两个是一对，理解了区别就都懂了。

```ts
// Workflow：流程是你写死的。模型只负责其中某几步。
const rewritten = await callModel(`把这个问题改写成独立问题：${question}`)
const chunks = await search(rewritten)              // 你决定要搜
const answer = await callModel(buildPrompt(chunks, question))

// Agent：流程交给模型。它自己决定搜不搜、搜几次、什么时候收工。
while (rounds < 5) { /* 上一节那个循环 */ }
```

前端类比：**Workflow 是你写的 if/else 和函数调用顺序；
Agent 是把控制权交给模型。**

| | Workflow | Agent |
| --- | --- | --- |
| 谁决定下一步 | 你的代码 | 模型 |
| 可预测性 | 完全可预测 | 每次可能不同 |
| 可测试性 | 好，就是普通单测 | 难，输出不稳定 |
| 成本 | 可算 | 不确定 |
| 灵活性 | 只能处理你想到的情况 | 能应付没预设的情况 |

## 这里有个面试加分点

很多人以为 Agent 比 Workflow 高级，所以更好。**工程上的判断恰恰相反：
能用 Workflow 解决的就别用 Agent。**

理由就是上面那张表 —— 可预测、可测试、成本可算，这三条在生产环境里比灵活性值钱。
Agent 应该留给「流程真的没法预先确定」的场景。

能讲清这个取舍，比会说五个名词更能体现判断力。你项目里现在是纯 Workflow
（固定的检索 → 拼 prompt → 生成），而且**这个选择是对的**。

---

# 八 · MCP = AI 工具的 LSP

**MCP** = Model Context Protocol，模型上下文协议。

## 用 LSP 来理解

你在 VSCode 里写 TypeScript 有自动补全和跳转定义。这靠的是 **LSP**（Language Server Protocol）：

- **有 LSP 之前**：每个编辑器都要为每种语言单独实现一套支持。
  N 个编辑器 × M 个语言 = N×M 份工作。
- **有 LSP 之后**：语言方写一个 language server，
  所有支持 LSP 的编辑器都能用。变成 N + M。

**MCP 就是 AI 工具版的 LSP。**

- **没有 MCP 时**：你的 Function Calling 工具是写在自己项目里的，
  只有自己这个应用能用。想让 Cursor 也能查你的知识库？重写一遍。
- **有 MCP 后**：把知识库包成一个 MCP server，
  Claude Code、Cursor 等所有支持 MCP 的客户端都能直接连。

所以 Function Calling 和 MCP 不是竞争关系，是**同一件事的私有版和标准版**：

```
Function Calling  = 你在自己项目里手写工具，自己用
MCP               = 把工具做成标准协议的服务，谁都能连
```

## 你项目里没有

要做的话就是：把 [retriever.ts](../server/rag/retriever.ts) 的检索能力包一层 MCP server，
暴露一个 `search_knowledge_base` 工具。做完之后你可以在 Claude Code 里直接问自己的知识库 ——
**而且「实现过一个 MCP server」在面试里的分量远高于「了解 MCP 是什么」。**

---

# 九 · 两个伞状词

## 大模型应用（LLM Application）

不是具体技术，就是「**用大模型做出来的产品**」的统称。
你这个知识库问答就是一个大模型应用。JD 里写这个词是想问「你做过没有」。

## AI Agent 开发

也是伞状词，指「做出能自己调工具、自己决定步骤的应用」。
拆开就是第五、六节那些东西：Function Calling + 循环 + 工具设计 + 轮次控制。

JD 把「AI Agent 开发经验」放在最前面，说明这是他们最看重的一项。

---

# 十 · 面试速查表

每个词一句能直接说出口的话。**先能说这一句，再往下深挖。**

| 名词 | 一句话 |
| --- | --- |
| **大模型 API** | 无状态接口，输入消息数组输出文本，多轮对话靠每次重发完整历史 |
| **Token / 上下文窗口** | token 是计费和限长的单位；上下文窗口是单次请求的容量上限，超了要自己裁剪历史 |
| **Prompt Engineering** | system prompt 是全局规则，user 是每次的参数；核心是消除歧义，和写接口文档一个道理 |
| **Prompt 注入** | 把不可信内容拼进 prompt 引发的问题，和 XSS 同构，防法也类似：标边界、转义、输出侧净化 |
| **RAG** | 提问前先搜相关文档，把搜到的片段和问题一起发给模型。解决模型不知道私有内容的问题 |
| **Embedding** | 把文字转成坐标的函数，语义相近的坐标也相近，于是「按意思搜索」变成「找最近的点」 |
| **切块** | 长文档要切小，否则塞不进上下文，而且坐标会被多个主题平均掉。和拆组件一个道理 |
| **Function Calling** | 告诉模型有哪些函数可用，模型返回「我要调这个、参数是这些」，**执行是你的代码干的** |
| **Agent** | 把 Function Calling 放进循环，模型可以多次调工具、自己决定下一步，直到它认为完成 |
| **Workflow** | 流程由你的代码写死，模型只负责其中几步。可预测可测试，能用它就别用 Agent |
| **MCP** | Function Calling 的标准化版本，相当于 AI 工具的 LSP：写一次，所有支持 MCP 的客户端都能连 |

## 三个能体现判断力的说法

名词谁都能背，这三句才是区分度：

1. **「模型自己不执行任何东西」** —— Function Calling 里模型只返回意图，
   执行永远是你的代码。这句话能筛掉一大半只看过概念的人。
2. **「能用 Workflow 就别用 Agent」** —— 可预测、可测试、成本可算，
   生产环境里这三条比灵活性值钱。
3. **「prompt 注入和 XSS 是同构问题」** —— 都是把不可信内容拼进会被解释的字符串。
   前端讲这个角度特别有说服力。

---

# 十一 · 这个项目现在有什么

| 名词 | 项目里 | 位置 / 缺口 |
| --- | --- | --- |
| 大模型 API 调用 | ✅ | [server/index.ts:180](../server/index.ts#L180) |
| 流式输出（SSE） | ✅ | [sse.ts](../src/services/http/sse.ts) + [index.ts:167-206](../server/index.ts#L167-L206) |
| 多轮对话 | ✅ | [useChat.ts:25-34](../src/composables/useChat.ts#L25-L34) 的 `buildHistory` |
| Prompt Engineering | ✅ | [retriever.ts:38-63](../server/rag/retriever.ts#L38-L63) |
| Prompt 注入防护 | ✅ | [retriever.ts:1-12](../server/rag/retriever.ts#L1-L12)，三层 |
| RAG | ✅ | [server/rag/](../server/rag/) 全套，而且有深度 |
| Workflow（隐式） | ✅ | 固定的检索 → 拼 prompt → 生成 |
| **Function Calling** | ❌ | 现在是无条件先检索，没给模型选择权 |
| **Agent** | ❌ | 单跳链路，没有循环 |
| **MCP** | ❌ | 完全没有 |

**下一步做什么**：把检索改成一个工具，让模型自己决定要不要查。
这一步同时打开 Function Calling 和 Agent 两扇门，
而且不用新建项目 —— 就在 [server/index.ts](../server/index.ts) 上改。

具体计划见 [interview-prep.md](interview-prep.md) 第二部分的优先级 3。
但记住那份文档的排序：**这一项在工程化和浏览器原理之后**，
因为 JD 第 10 条写的是「优先」，不是硬要求。
