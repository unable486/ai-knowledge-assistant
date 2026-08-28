# 面试准备：资深前端 JD 逐条评估

> **这份文档的前提**：本项目的代码是 AI 写的。所以它不是「你已有的资产清单」，
> 而是**学习计划 + 缺口地图** —— 这个仓库里有哪些东西值得学、按什么顺序学、
> 学到什么程度算能上面试。凡是写「要能讲什么」的地方都是**目标**，不是现状。
>
> 面试深挖项目细节是常态。简历上写了却讲不出来，面试官的结论不是「这块不熟」，
> 是「这人的东西不可信」—— 比没这个项目更糟。所以第二部分（把代码变成真的会）
> 是所有其他事情的前置条件。

对着「资深前端开发」JD 的十条要求逐条核对。每条分三段：
**要能讲什么**（仓库里有、值得学的）、**会被深挖什么**（答不上来的风险点）、**缺口**（仓库里也没有的）。

依据是仓库全部源码（`src/` 21 个文件、`server/` 6 个文件）、
[docs/ai-knowledge.md](ai-knowledge.md) 的 26 节技术决策，以及 git 历史（12 个 commit，全在 master）。

---

## 结论摘要

「仓库里有」= 代码/文档里存在，可以学；「你会不会」= 现在能不能被深挖。

| JD | 要求 | 仓库里有 | 你会不会 | 优先级 |
| --- | --- | --- | --- | --- |
| 1 | 5 年经验 / 团队管理 | — | 是事实，不修饰 | — |
| 2 | 产品意识（**硬**） | 大量实例 | 待确认 | 中 |
| 3 | JS/TS/DOM/浏览器原理/HTTP/安全（**硬**） | TS/DOM/安全强；浏览器原理和 HTTP 无 | 待确认 | **高** |
| 4 | Vue + 组件化/架构（**硬**） | 分层设计是亮点；无路由无性能优化 | 待确认 | **高** |
| 5 | 代码质量 / Code Review（**硬**） | 代码质量高；Review 零痕迹 | 待确认 | 中 |
| 6 | 工程化 Vite/Webpack/ESLint/CI（**硬**） | **几乎零** | 零 | **最高** |
| 7 | Node.js / 服务端 | 完整 Express 5 + TS 服务端 | 零 | 中 |
| 8 | 大前端（仅"优先"） | 无 | 零 | 低 |
| 9 | AI 工具使用 | 笔记里有成型的说法 | **部分真实经验** | 中 |
| 10 | Agent/FC/MCP/RAG/Workflow（仅"优先"） | RAG 有深度；FC/MCP/Workflow 全空 | 零 | 中 |

**优先级的依据**：JD 第 9、10 条写的是"优先"，第 2 到 6 条是硬要求。
AI 那两条不会，损失的是加分项；工程化不会，是硬伤。
所以顺序是：**先把现有代码变成真的会（第二部分）→ 补工程化 → 补浏览器原理和 HTTP → 最后才是 Agent**。

---

# 第一部分 逐条评估

## JD 1 · 5 年以上经验，团队管理或技术负责人优先

这条没法靠写代码补。年限是事实，不要修饰。

**能替代的部分**：技术负责人的核心能力是"做取舍并留下依据"，
[docs/ai-knowledge.md](ai-knowledge.md) 的 26 节就是这个能力的直接证据 ——
每节都是"面临什么问题 / 有哪些选项 / 为什么选这个 / 代价是什么"。
第 26 节主动列 8 条已知短板，这个习惯在面试里比多讲一个技术点值钱。

**可以主动说的**："没带过团队，但我习惯把技术决策的理由写下来，
这份文档就是给未来接手的人看的。"把弱项转成工程习惯的展示。

---

## JD 2 · 产品意识，站在用户和业务角度思考

代码里有很多产品判断，但你写的时候是当技术细节写的，需要重新组织成产品语言。

**能讲什么**（都有代码）：

- **先占位再请求** —— [useChat.ts:78-85](../src/composables/useChat.ts#L78-L85)。
  发送后立刻插一条空的 assistant 消息显示"正在思考"，不等首字节。
  这是感知延迟优化，用户体验上首字延迟从几百毫秒降到 0。
- **停止后保留已收到的内容** —— [useChat.ts:56-57](../src/composables/useChat.ts#L56-L57)。
  用户点停止，已经看着长出来的文字凭空消失比留着更奇怪，所以标 `aborted` 而不是清空。
- **重试复用同一条消息** —— [chat.ts:139-149](../src/stores/chat.ts#L139-L149)。
  不新增气泡，避免界面里堆失败残影。
- **删会话落到相邻一条** —— [chat.ts:69-72](../src/stores/chat.ts#L69-L72)，不直接清空，减少跳变感。
- **配额满了不放弃** —— [chatStorage.ts:219-233](../src/services/storage/chatStorage.ts#L219-L233)。
  localStorage 写满时逐步减半保留的会话数再试，"存最近的比一条都不存有用"。
- **中文输入法组字时 Enter 不发送** —— [MessageInput.vue:24-31](../src/components/MessageInput.vue#L24-L31)。
  这条最能说明产品意识：只有真的用中文打过字的人会想到。
- **引用来源先于回答发出** —— [index.ts:173-176](../../server/index.ts#L173-L176)。
  检索完就发 `sources` 事件，用户在答案生成前就知道"参考了哪些文档"，建立信任感。

**会被深挖什么**：
"你怎么衡量这些改动有效？"—— 这里没有埋点、没有 A/B、没有用户反馈渠道。
如实说：个人项目，靠自己用的感受判断，没有数据支撑。

**缺口**：JD 说的"推动产品持续优化"隐含数据驱动。
准备一个**过往工作里**用数据驱动决策的例子（转化率、性能指标、错误率任一个都行）。

---

## JD 3 · JS(ES6+)、TS、HTML、CSS、DOM、浏览器原理、HTTP 协议、Web 安全

这条最长，拆开看差别很大。

### TypeScript —— 强项

- 前后端两份独立 tsconfig，`strict` + `noUnusedLocals` + `noUnusedParameters` 全开，
  `npm run typecheck` 同时跑 `vue-tsc` 和 `tsc -p tsconfig.server.json`。
- **可辨识联合** —— [chatApi.ts:16-18](../src/services/chatApi.ts#L16-L18)。
  流里有 delta 和 sources 两种事件，用 `kind` 字段辨识，
  调用方一个 `for-await` 全处理完，顺序天然和服务端一致。比两个回调好在哪要能说清。
- **类型守卫 / 类型谓词** —— [index.ts:31-38](../../server/index.ts#L31-L38) 的 `isChatRequestMessage`、
  [vectorStore.ts:56](../../server/rag/vectorStore.ts#L56) 的 `reviveChunk`。
  边界上把 `unknown` 收窄成领域类型，不用 `as` 硬转。

### JS(ES6+) / DOM —— 强项

- **异步生成器** —— [sse.ts:30](../src/services/http/sse.ts#L30) 的 `async function*`，
  把 `ReadableStream` 包成可 `for-await` 的帧序列。
- **AbortController 的三处竞态** —— [useChat.ts](../src/composables/useChat.ts)，
  见 [ai-knowledge.md](ai-knowledge.md) 第 6 节。最关键的是
  [useChat.ts:62-67](../src/composables/useChat.ts#L62-L67)：清理时校验 `controller.value === ac`，
  否则快速连发时会清掉后一次请求的 controller。这是能讲 3 分钟的细节。
- **TextDecoder 流式解码** —— [sse.ts:42](../src/services/http/sse.ts#L42) 的
  `decoder.decode(value, { stream: !done })`。不加 `stream: true`，
  一个中文字的 3 个字节被切在两个 chunk 里就会解码成乱码。
- **pagehide 比 beforeunload 可靠** —— [useChatPersistence.ts:79-87](../src/composables/useChatPersistence.ts#L79-L87)。
  移动端 Safari 切后台不触发 `beforeunload`，再用 `visibilitychange` 兜一层。

### Web 安全 —— 强项

- **XSS 净化顺序不能反** —— [markdown.ts:54-60](../src/utils/markdown.ts#L54-L60)。
  先 `md.render` 再 `DOMPurify.sanitize`。反过来的话 markdown-it 会把净化后的文本
  重新组装出新 HTML，净化白做。这是个很好的考点，因为直觉上"先净化"感觉更安全。
- **reverse tabnabbing** —— [markdown.ts:47-52](../src/utils/markdown.ts#L47-L52)，
  `afterSanitizeAttributes` 钩子给所有外链补 `rel="noopener noreferrer"`。
- **间接 prompt 注入三层防护** —— [retriever.ts:1-12](../../server/rag/retriever.ts#L1-L12)。
  标签包裹 + 声明"标签内是数据不是指令"、转义尖括号防伪造闭合标签逃逸、
  输出侧 DOMPurify 兜底。关键论点是**第三层为什么必须存在**：
  system 的优先级是训练出来的倾向，不是硬性机制，前两层都可能被绕过。
- **localStorage 是不可信输入** —— [chatStorage.ts:1-13](../src/services/storage/chatStorage.ts#L1-L13)。
  用户能手改，旧版本会留下异构数据，所以逐字段校验。
- **API Key 只在服务端** —— 这是整个项目分服务端的首要原因。

### 浏览器原理 —— **缺口**

代码里唯一沾到的是"localStorage 是同步 API，会卡渲染"
（[useChatPersistence.ts:11-19](../src/composables/useChatPersistence.ts#L11-L19)），
说明你知道主线程是共享的，但没有系统知识。要补：

- 事件循环：宏任务 / 微任务、`requestAnimationFrame` 和 `requestIdleCallback` 的时机
- 渲染流水线：解析 → 样式计算 → 布局 → 绘制 → 合成
- 重排 / 重绘的触发条件，哪些 CSS 属性能只走合成（`transform` / `opacity`）
- 合成层、`will-change` 的正确用法和滥用代价
- 垃圾回收、内存泄漏的常见来源（未清理的监听器、闭包持有 DOM）

**能和项目挂上的钩子**：双层节流那一节可以延伸到"为什么同步 API 会卡渲染"，
从主线程讲到事件循环。打字动画那三个点可以延伸到"为什么用 `transform` 而不是 `top`"。

### HTTP 协议 —— **部分缺口**

代码里有实践，但只覆盖了 SSE 相关的一小块：

- SSE 响应头三件套 —— [index.ts:168-171](../../server/index.ts#L168-L171)：
  `text/event-stream`、`no-cache, no-transform`（`no-transform` 是防中间代理压缩/缓冲）、`keep-alive`
- `flushHeaders()` 之后状态码定死 200 —— [index.ts:152-165](../../server/index.ts#L152-L165)。
  所以检索必须在发头之前做，否则失败只能在流里发 error 事件。这是很好的 HTTP 生命周期理解。
- 状态码用得准：400 校验失败、413 过长、503 未配置、500 上游失败、201 创建、204 删除无内容

**要补的**（都没证据）：
强缓存 vs 协商缓存（`Cache-Control` / `ETag` / `Last-Modified`）、
HTTP/1.1 队头阻塞 → HTTP/2 多路复用 → HTTP/3 QUIC、
CORS 预检的触发条件和 `Access-Control-*` 全套、
Cookie 的 `SameSite` / `HttpOnly` / `Secure`、TLS 握手、
以及 SSE vs WebSocket vs 长轮询的完整对比（[ai-knowledge.md](ai-knowledge.md) 第 2 节有一半）。

### CSS —— **薄弱**

全部是 scoped 样式手写，[global.css](../src/styles/global.css) 只有 78 行，
整个项目 **2 个 media query、0 个 CSS 变量**。
Flex/Grid 基础用法有（`display: grid; place-items: center`），但没有：
响应式布局体系、CSS 变量做主题、暗色模式、逻辑属性、容器查询、`:has()`。
移动端基本不可用。

**顺带一个真问题**：流式内容没有 `aria-live`。
屏幕阅读器读不到正在生成的回答 —— [MessageBubble.vue:30](../src/components/MessageBubble.vue#L30) 的
`v-html` 容器上应该加 `aria-live="polite"`。
现在整个项目只有零散的 `aria-hidden` 和两个 `aria-label`。
JD 没提无障碍，但资深前端被问到"你怎么保证可访问性"是常见的。

---

## JD 4 · Vue 框架 + 组件化设计、工程化、架构设计

### 能讲什么 —— 分层是真正的强项

四层职责划得很干净，而且**理由是可测性**，这个论证很有说服力：

```
stores/       只描述数据怎么变，不碰网络（单测不用 mock 网络层）
composables/  管一次操作的完整生命周期（占位 → 消费流 → 写回 → 收尾）
services/     I/O 边界：http 客户端 + 拦截器链 + SSE 解析 + localStorage 读写
utils/        纯函数（markdown 渲染、id 生成）
```

- **store 只管数据** —— [chat.ts:6-11](../src/stores/chat.ts#L6-L11) 的注释直接写了这个理由。
- **两个 store 分层不一样** —— [ai-knowledge.md](ai-knowledge.md) 第 24 节。
  `chat` store 纯数据、请求编排在 composable；`knowledge` store 自己管请求。
  为什么不统一？因为知识库只有简单 CRUD，没有流式和竞态，
  强行套一层 composable 是过度设计。**能说清"为什么不统一"比统一了更能体现判断力。**
- **状态机而不是布尔标志** —— [types/chat.ts](../src/types/chat.ts) 的
  `MessageStatus: pending | streaming | done | aborted | error`。
  用 `isLoading` + `hasError` 两个布尔会出现非法组合。
- **手写拦截器链** —— [client.ts](../src/services/http/client.ts)，request/response/error 三段。
  关键取舍：**返回原始 `Response` 而不是解析后的数据**，否则 SSE 流没法按流处理。
- **`onScopeDispose` 而不是 `onUnmounted`** —— [useChat.ts:100](../src/composables/useChat.ts#L100)。
  composable 可能在组件外的 effect scope 里用。

### 会被深挖什么 —— 性能

三个能被问住的点，最好主动说：

1. **消息列表没有虚拟滚动**。单会话保留 200 条上限
   （[chatStorage.ts:23](../src/services/storage/chatStorage.ts#L23)），到上限时是 200 个组件实例。
2. **流式期间每个 delta 都重算整条 markdown**。
   [MessageBubble.vue:13](../src/components/MessageBubble.vue#L13) 的 `renderedContent` 是 computed，
   依赖 `message.content`，每个 token 到达都会重跑 `md.render` + `DOMPurify.sanitize` 全文。
   一条 2000 字的回复要跑几百次全量渲染。现在感知不到是因为文本短，
   但这是**明确的性能债**，正确做法是流式期间渲染纯文本、`done` 之后再渲染 markdown。
3. **持久化的 `deep: true` watch** —— [useChatPersistence.ts:73-77](../src/composables/useChatPersistence.ts#L73-L77)。
   每次变更遍历整棵会话树，靠双层节流压频率。注释里写了这个代价，可以主动讲。

### 缺口

- **无路由**。单页面无 `vue-router`，路由懒加载、导航守卫、
  `keep-alive` 缓存策略这些都没实践过。资深岗大概率会问。
- **无代码分割**。整个应用一个 bundle，没有 `defineAsyncComponent`、没有动态 `import()`。
  `highlight.js/lib/common` 和 markdown-it 都是可以按需加载的重依赖。
- **无 SSR / SSG 概念实践**。

---

## JD 5 · 代码质量意识、可维护可扩展、Code Review 能力

### 能讲什么

代码质量本身是这个项目最能打的部分：
注释解释"为什么"而不是"是什么"、函数短、命名一致（`revive*` / `read*` / `schedule*` 成体系）、
边界上做类型收窄、失败路径都想过降级方案。

**可扩展性有实证**：
[vectorStore.ts:1-11](../../server/rag/vectorStore.ts#L1-L11) 明确写了
"等到十万块量级再换带 HNSW/IVF 索引的实现，这个文件的对外接口不用变" ——
这是接口设计意识，不是事后找的说法。

### 缺口 —— Code Review 零证据

12 个 commit **全部直接提交到 master**，没有分支、没有 PR、没有 review 记录。
JD 明确要求"良好的 Code Review 能力"，这里完全没有东西可指。

**补法**（成本很低，见第二部分）：
后续开发走 feature 分支 + PR，PR 描述里写清改了什么、为什么、怎么验证。
哪怕是自己 review 自己的 PR，也留下了流程痕迹。

**面试可以讲的替代品**：
[ai-knowledge.md](ai-knowledge.md) 第 26 节"已知短板"本质上是自我 review 的产物。
能主动列出自己代码的 8 个问题，比说"我 review 很仔细"有说服力。

---

## JD 6 · 前端工程化：Vite、Webpack、ESLint、CI/CD、自动化构建

**这是最大的缺口，也是 JD 里的硬要求。**

现状盘点：

| 项 | 现状 |
| --- | --- |
| Vite | [vite.config.ts](../vite.config.ts) 只有 plugin + dev proxy，**14 行**。无构建优化、无环境变量处理、无产物分析 |
| Webpack | 完全没有 |
| ESLint | **没有**。代码风格一致靠手写自觉，没有工具约束 |
| Prettier / 格式化 | 没有 |
| 测试 | **没有**（你自己在第 26 节列了） |
| CI/CD | **没有**，无 `.github/` 目录 |
| Git hooks | 没有 |

唯一能讲的是 `package.json` 的脚本组织：`build` 前置 `typecheck`、
`concurrently` 并行跑前后端 dev、两份 tsconfig 分治前后端。这远不够。

**这块的好消息是补起来最快，而且能顺带消掉"没有自动化测试"这个自陈短板。**
你的分层本来就是为可测性设计的 —— chunker 是纯函数、
storage 只要一个 Storage 替身、store 不依赖网络和 Vue。详见第二部分。

---

## JD 7 · Node.js 或至少一种服务端语言，全栈能力优先

**这条你已经满足了，但你自己没意识到。**这是本次评估最重要的一条纠正。

[server/](../../server/) 是完整的 Express 5 + TypeScript 服务端，不是玩具：

- **输入校验** —— [index.ts:40-61](../../server/index.ts#L40-L61)：
  条数上限、单条字符上限、总字符上限、role 白名单，逐层拦。
- **流式代理 + 中止传播** —— [index.ts:187-192](../../server/index.ts#L187-L192)：
  浏览器断开 → `res.on('close')` → `stream.abort()` 中止对上游的请求。
  不做这个，用户关页面后 Anthropic 那边还在生成，token 照计费。
- **错误脱敏** —— [index.ts:87-93](../../server/index.ts#L87-L93)：
  服务端 `console.error` 记完整原因，发给前端的是分状态码的友好文案。
- **原子写文件** —— [vectorStore.ts:134-137](../../server/rag/vectorStore.ts#L134-L137)：
  先写 `.tmp` 再 `rename`。崩在写一半不会留下坏索引。
- **写盘串行化** —— [vectorStore.ts:49-50](../../server/rag/vectorStore.ts#L49-L50)：
  用 promise 链把并发写排队，多个 ingest 同时写会写坏文件。
- **启动预热** —— [index.ts:242-248](../../server/index.ts#L242-L248)：
  把 24MB 权重加载从首个请求挪到启动阶段，失败只警告不退出（降级：知识库不可用但对话正常）。
- **生产模式静态托管** —— [index.ts:222-231](../../server/index.ts#L222-L231)，
  含 `/api` 前缀负向断言的 SPA fallback，和忘记 build 时的显式提示。

**主动说的短板**（你第 26 节已列）：`/api/chat` 和 `/api/documents` 无鉴权无限流。
部署到公网就是敞开的 Claude 代理。这是刻意取舍（只在本地跑），但要说清"上线必须先加"。

**缺口**：数据库（只有 JSON 文件）、鉴权体系（JWT/session）、
Docker / 部署、日志和监控。如果面试官深挖服务端，这几项会露。

---

## JD 8 · 大前端：小程序 / Flutter / React Native / Electron

无。

只是"优先"条件，投入产出比最低，除非目标公司主营这块，否则放到最后。
如果一定要补，Electron 对现有项目最自然（本地跑的 Node + 前端，直接能包成桌面应用）。

---

## JD 9 · AI 工具使用经验，深度应用于研发流程

**这条是你唯一有真实经验的 AI 项**，而且经验的分量比你以为的重 ——
你用 AI 从零做出了一个能跑的全栈 RAG 应用。JD 要求的就是"能将 AI 深度应用于日常研发流程"，
这件事你实际做到了。

关键是**怎么说**。有两种说法，差别很大：

- ✗ "我做了个 RAG 项目" —— 后面一深挖就崩。
- ✓ "我用 Claude Code 做了个 RAG 应用，代码主要是 AI 写的。
  做完我花时间把每个技术决策都验证了一遍 —— 比如 pooling 从 cls 改成 mean
  看检索质量怎么变、把 SSE 的流式解码关掉看中文怎么乱码。
  现在这些取舍我能解释，也知道它的短板在哪。"

第二种说法**同时**证明了三件事：会用 AI、知道 AI 生成的代码必须验证、以及具体的技术理解。
比声称手写强 —— 而且真实。前提是第二部分的功课真做了。

[ai-knowledge.md](ai-knowledge.md) 第四部分第 8 节（第 1147 行起）那套说法可以直接用，
核心几点：

- AI 生成的代码要读懂才提交 —— 评审自己提交的代码是基本责任，不因为是 AI 写的就免除
- 擅长样板代码 / 格式转换 / 写测试 / 解释不熟的库；不擅长需要完整业务上下文的判断和高代价的"错了但看起来对"
- **验证成本要算进去** —— 判断标准是"我能多快确认它对不对"
- 对新东西不可靠 —— 训练数据有截止时间，最新 API 会被自信地编出来

**这套说法的可信度来自具体例子**，仓库里有两个现成的：

1. 持久化那块，AI 能很快写出 localStorage 读写，
   但"流式过程中不能每个 token 都写盘"这个约束，
   要理解 localStorage 是同步 API 才想得到 —— 不主动说，生成的代码就会卡渲染。
2. [embedder.ts:12-13](../../server/rag/embedder.ts#L12-L13)：
   中转站只代理 Claude 生成端点，试过三个 embedding 模型全返回 503。
   这类环境约束 AI 完全不知道，只能自己试出来。

**用第 2 个例子，因为那件事你在场。** 换 embedding 方案是被环境逼出来的，
你看着它一个个报 503，这个过程你有真实记忆。第 1 个例子是我在注释里写的推理，
你要讲得先真懂同步 API 为什么卡渲染（见第三部分的实验 4）。
**挑你真经历过的讲**，这是这份文档里最重要的一条策略。

**缺口**（资深岗会问团队层面）：
把 AI 落进**团队**研发流程的经验 —— CI 里跑 AI review、
团队共享的 prompt 规范、`CLAUDE.md` 之类的项目约定文件（本项目也没有）。
现在的经验是"个人怎么用"，JD 想听的可能是"怎么让团队用好"。

---

## JD 10 · AI Agent 开发、大模型应用、Prompt Engineering、Function Calling、MCP、RAG、Workflow

这条 JD 写的是"**优先**"，不是硬要求。而且从零到能被深挖不是一周的事。
所以策略是：**先把仓库里已有的 RAG 部分学透（投入小、深度够），FC/MCP/Workflow 放到工程化之后。**
学透 RAG 一条就够撑一轮 AI 相关的深挖了，不需要覆盖全部五个词。

### RAG —— 仓库里有明显深度，是最值得学的一块

不是"用了个向量库"的水平。下面这几个点学会了能直接把面试官问住，
而且都能用第三部分的实验亲手验证（这是它们比其他 AI 话题更值得投入的原因）：

- **bge 是非对称检索** —— [embedder.ts:37](../../server/rag/embedder.ts#L37)。
  查询侧要加指令前缀 `为这个句子生成表示以用于检索相关文章：`，文档侧不加。
  **加错不会报错，只会让检索质量悄悄变差。**"静默失败"这个视角很值钱。
- **pooling 必须是 cls 不是 mean** —— [embedder.ts:52-55](../../server/rag/embedder.ts#L52-L55)。
  bge 用 `[CLS]` token 做句向量，用错了向量空间对不上，同样不报错。
- **切块要带标题路径** —— [chunker.ts:140](../../server/rag/chunker.ts#L140)。
  标题拼进文本一起 embedding：标题里的词参与向量化提升命中率，
  也让模型只看到孤立一块时知道上下文。切块策略比换模型影响大。
- **normalize 后余弦退化成点积** —— [vectorStore.ts:174-179](../../server/rag/vectorStore.ts#L174-L179)。
- **为什么没用向量数据库** —— [vectorStore.ts:1-11](../../server/rag/vectorStore.ts#L1-L11)。
  几百块规模下 512 维扫 1000 块是 50 万次乘加，亚毫秒级。
  引入依赖换不来可感知收益。**能说清"什么时候该换"才是判断力。**
- **换模型会静默降质** —— 维度校验拦得住换维度，
  但同维度换模型拦不住（[vectorStore.ts:117-122](../../server/rag/vectorStore.ts#L117-L122)）。
  你自己列在短板里，主动说。

### Prompt Engineering —— 有实践

[retriever.ts:38-63](../../server/rag/retriever.ts#L38-L63) 的 `buildSystemPrompt`：
资料用 `<reference>` 标签包裹、显式声明数据/指令边界、
规则里要求"资料里没有的要明说，再补充并标注是补充"（防幻觉）、要求标注来源。
`topK = 4` 和 6000 字符上限的取舍："少而准比多而杂好，塞太多会淹没关键信息。"

### Function Calling —— **只有概念，无实现**

[ai-knowledge.md](ai-knowledge.md) 第 883 行写了工具调用的概念，代码里没有。
这是最该补的一块，而且**你现有项目正好有两个需要它的真实场景**（见第二部分）。

### MCP —— **完全没有**

概念和实现都空。

### Workflow / Agent —— **完全没有**

现在的流程是固定的"检索 → 拼 prompt → 生成"单跳链路，
没有多步编排、没有让模型自己决定下一步、没有工具循环。

### 已知短板（你自己列的，都和 Agent 相关）

- **没有查询改写** —— 多轮对话里"它的性能怎么样"这种指代解决不了。
  这**正好是 Function Calling / Agent 的典型场景**。
- **没有混合检索** —— 纯向量。专有名词、型号、代码标识需要 BM25 精确匹配，
  工业做法是向量 + 关键词 + 重排。
- **没有效果评估集** —— 对 RAG 项目这是最该补的。
  切块参数、topK、前缀写法的任何改动，现在只能靠手感判断好坏。

---

# 第二部分 补齐计划

**优先级 0 是前置条件**，没做完，后面几项做了也撑不住深挖 —— 因为面试官会先问项目。

## 优先级 0 · 把现有代码变成真的会（投入 3-5 天）

方法在第三部分。核心原则：**别先读笔记，先去拆坏它。**

笔记是答案。先看答案会产生"我懂了"的幻觉 —— 读到"pooling 必须是 cls"会觉得记住了，
面试官追问"用 mean 会怎样、为什么"就露了。亲手改成 `mean`、看检索结果变差，
这个记忆抹不掉，而且讲出来是"我验证过"而不是"我看过"。

判断标准：**能不能对着空白编辑器讲清"如果不这么做会发生什么"**。
讲不出失败后果，就是还没懂。

## 优先级 1 · 工程化（JD 6，投入 1-2 天）

全部在现有仓库里做，不新建项目。

**这项有个额外好处：配置 ESLint、写测试、搭 CI 这些活儿，你是主导者。**
写测试的过程会逼你搞清被测代码的行为 —— 这是"把代码变成真的会"最有效的路径之一，
和优先级 0 是同一件事的两面。测试用例也是面试时能直接给人看的东西。

1. **ESLint + Prettier**：`eslint-plugin-vue` + `@typescript-eslint` + `eslint-config-prettier`。
   跑一遍看它报什么 —— 报出来的问题本身就是面试素材。
2. **Vitest 单测**，挑可测性最好的四个模块，正好覆盖四类测试对象
   （**先自己写断言再跑**，写不出预期说明还不懂这个模块的行为）：
   - [chunker.ts](../../server/rag/chunker.ts) —— 纯函数，输入输出直接断言（标题路径、重叠、短块合并）
   - [sse.ts](../src/services/http/sse.ts) 的 `parseSseFrames` —— 纯函数，
     重点测**帧被切断**的 case（这是你笔记里的"坑一"）
   - [chatStorage.ts](../src/services/storage/chatStorage.ts) —— 只需一个 Storage 替身，
     测非法输入被丢掉、`pending` 恢复成 `aborted`、配额满降级
   - [chat.ts](../src/stores/chat.ts) store —— `createTestingPinia`，不用 mock 网络
3. **GitHub Actions CI**：push 触发 `typecheck` + `lint` + `test` + `build`。
4. **Husky + lint-staged**：提交前跑 lint。

做完的收益：JD 6 从零变成有；顺带消掉自陈短板"没有自动化测试"；
CI 徽章和测试用例是面试时能直接给人看的东西。

## 优先级 2 · 浏览器原理 + HTTP（JD 3，投入 2-3 天）

见下面「优先级 3」的清单 —— 内容不变，但**顺序提到 Agent 之前**，
因为 JD 3 是硬要求而 JD 10 只是"优先"。

## 优先级 3 · Function Calling → Agent → Workflow（JD 10，投入 3-5 天）

**这一项要自己写，不要让 AI 代劳。** 这是全篇唯一一个"从零构建"的机会 ——
现有代码是 AI 写的，这部分如果也是，那 JD 10 就永远只是文档上的一行字。
可以让 AI 解释概念、review 你的代码、帮你调 bug，但主要逻辑自己敲。
写得慢、写得糙都没关系，能讲清楚才是目的。

**不要新建项目**，就在这个 RAG 上加，因为仓库里已列的两个短板正好是它的用例：

1. **把检索改成工具**。现在是无条件先检索
   （[index.ts:158-165](../../server/index.ts#L158-L165)），改成给模型一个
   `search_knowledge_base` 工具，让它自己判断这一问要不要查。
   闲聊不查，省一次 embedding + 一次检索。这就是 Function Calling 的最小闭环。
2. **查询改写**：多轮时先让模型把"它的性能怎么样"改写成独立问题再检索。
   顺手消掉一个短板。
3. **工具循环**：模型可以多次调用检索（第一次没查到就换个说法再查），
   这就从单跳变成 Agent 了。要处理最大轮次限制和死循环。
4. **混合检索**：加个 BM25 实现，和向量结果做 RRF 融合。
   这条同时补 JD 10 的深度和"没有混合检索"这个短板。
5. **MCP**：把知识库包成一个 MCP server，让 Claude Code 之类的客户端能直接连。
   这一步做完，MCP 就从"听说过"变成"实现过"。

顺序有讲究：1 是基础，2 依赖 1，3 依赖 2，4 和 5 独立。做到 3 就够撑一轮深挖了。
时间不够就只做 1 —— 一个能讲清的 Function Calling 闭环，胜过五个说不清的名词。

## 附：浏览器原理 + HTTP 的清单（对应上面的优先级 2）

这块补不出代码，只能读 + 记笔记。**笔记自己写**，
理由和上面一样：写的过程才是学的过程，让 AI 生成一份等于什么都没发生。
按 [ai-knowledge.md](ai-knowledge.md) 的风格写成 `docs/browser-and-http.md`，
要求每条都能挂到项目里的一个真实例子上 —— 挂不上的说明没真懂。

- 事件循环 / 宏微任务 / rAF / rIC → 挂：双层节流为什么能避免卡渲染
- 渲染流水线 / 重排重绘 / 合成层 → 挂：打字动画为什么用 `transform`
- 强缓存 vs 协商缓存 → 挂：SSE 为什么必须 `no-cache, no-transform`
- HTTP/1.1 → 2 → 3 → 挂：SSE 在 HTTP/1.1 下的连接数限制（6 个），HTTP/2 下没这问题
- CORS 预检 → 挂：dev proxy 为什么能绕过跨域
- Cookie 安全属性 → 挂：为什么这个项目用不上（无鉴权），加鉴权时该怎么设

## 优先级 4 · Code Review 痕迹（JD 5，顺带做）

从现在起所有改动走 feature 分支 + PR，PR 描述写"改了什么 / 为什么 / 怎么验证"。
补上面三项时自然就积累了 5-8 个 PR。成本接近零。

## 不建议现在做

- **大前端（JD 8）**：只是"优先"，投入大。
- **CSS 深度和响应式**：JD 没强调，且面试很少深挖个人项目的 CSS。
  但 `aria-live` 那个 5 分钟就能加，顺手补掉。
- **换向量数据库 / 加鉴权**：你现在"知道为什么没做"比"做了"更能体现判断力，
  做了反而丢掉一个能讲取舍的点。

---

# 第三部分 把代码变成真的会

**这是优先级 0 的执行方法。** 原则：先拆坏，再读笔记，最后复述。

## 为什么是这个顺序

读笔记 → 觉得懂了 → 被追问一层就崩。因为笔记给的是**结论**，
面试官问的是**如果不这么做会怎样**。

拆坏 → 亲眼看到失败 → 再读笔记时是"原来这就是为了防这个" → 讲出来是"我验证过"。

## 五个实验（按投入产出排序）

每个都是：改一行代码 → 复现故障 → 改回去 → 用一句话说清因果。
**做完立刻写下来**，写不出因果说明还没懂。

### 实验 1 · pooling 改成 mean（15 分钟，收益最高）

[embedder.ts:55](../../server/rag/embedder.ts#L55) 把 `pooling: 'cls'` 改成 `'mean'`，
删掉 `data/rag-index.json` 重新入库一篇文档，问同样的问题，对比检索到的块。

看到什么：**不报错**，但检索结果明显变差。
学到什么：静默失败 —— 向量空间对不上不会抛异常，只会让质量悄悄下降。
这是 RAG 最阴的一类 bug，也是面试时最能体现深度的点。

### 实验 2 · 去掉查询前缀（10 分钟）

[embedder.ts:66](../../server/rag/embedder.ts#L66) 把 `${queryInstruction}${text}` 改成 `text`。
同样重建索引再问。

学到什么：bge 是非对称检索，查询侧和文档侧的处理方式不同。同样是静默失败。

### 实验 3 · 关掉 SSE 流式解码（10 分钟）

[sse.ts:42](../src/services/http/sse.ts#L42) 把 `decoder.decode(value, { stream: !done })`
改成 `decoder.decode(value)`，问一个会返回长中文回答的问题。

看到什么：中文出现乱码（`�`）。
学到什么：一个 UTF-8 中文字符是 3 个字节，网络 chunk 的边界不管字符边界。
`stream: true` 让 decoder 把不完整的字节留到下一次。

顺便试 [sse.ts:43-45](../src/services/http/sse.ts#L43-L45)：
把 `buffer = parsed.remainder` 改成 `buffer = ''`，会丢帧 —— 这是笔记里的"坑一"。

### 实验 4 · 去掉持久化节流（20 分钟）

[useChatPersistence.ts:51-58](../src/composables/useChatPersistence.ts#L51-L58) 的
`schedule()` 直接改成调 `flush()`，然后开 DevTools 的 Performance 录一段流式回复。

看到什么：主线程被 `setItem` 和 `JSON.stringify` 占满，掉帧。
学到什么：localStorage 是**同步** API，和渲染抢同一个主线程。
这个实验是通往 JD 3「浏览器原理」的入口 —— 顺着"为什么同步 API 会卡渲染"
就能问到事件循环和渲染流水线。

### 实验 5 · XSS 顺序反过来（20 分钟）

[markdown.ts:54-60](../src/utils/markdown.ts#L54-L60) 改成先 `sanitize` 再 `render`，
然后往对话里发一段能触发的 markdown（比如让模型原样输出
`<img src=x onerror="alert(1)">` 的代码块）。

学到什么：净化后的文本被 markdown-it 重新组装成新 HTML，净化白做。
"直觉上先净化更安全，实际是反的"—— 这是很好的开场素材。

## 拆完之后

1. **读笔记对答案** —— 这时候 [ai-knowledge.md](ai-knowledge.md) 才有用。
   看你的解释和它的解释差在哪。
2. **口头复述** —— 对着空白编辑器讲，讲不顺的地方就是没懂的地方。
   录一遍自己听，会发现很多"其实我在背"的段落。
3. **补测试** —— 优先级 1 的 Vitest，先自己写预期断言再跑。
   断言写不出来 = 不懂这个模块的行为。

## 剩下的部分怎么办

五个实验覆盖 RAG、SSE、性能、安全。剩下的（AbortController 竞态、分层设计、
拦截器链、状态机）拆不出明显故障，改成**问自己"为什么不用更简单的写法"**：

- `useChat.ts:64` 为什么要判断 `controller.value === ac`？去掉会怎样？
  （提示：快速点两次发送）
- 为什么用 `MessageStatus` 五态而不是 `isLoading` + `hasError` 两个布尔？
  （提示：`isLoading = true` 且 `hasError = true` 是什么状态）
- 两个 store 为什么不统一？（这题的答案是"不该统一"，能讲清就是判断力）

---

# 第四部分 项目自述

同一个项目准备三个长度，看面试官给多少时间。

## 关于"这是 AI 写的"要不要说

**要说，而且主动说。** 三个理由：

1. **JD 第 9 条要的就是这个。**"能将 AI 深度应用于日常研发流程"——
   你用 Claude Code 做出了一个能跑的全栈 RAG 应用，这是正面证据，不是污点。
2. **风险不对等。** 声称手写、被追问到崩，损失的是全部可信度。
   坦白说是 AI 写的、然后把每个取舍讲清楚，反而证明了"AI 生成的代码要读懂才提交"这条职业判断。
3. **说法可以很硬。** 见下面的模板。

前提是第三部分的功课真做了 —— 坦白 + 讲不清，就只剩坦白了。

## 30 秒版

> 一个带知识库的 AI 问答应用。Vue 3 + TypeScript 前端，Node + Express 服务端，
> RAG 从切块、本地 embedding 到向量检索和引用来源都是自己实现的，没用现成框架。
> 代码主要是我用 Claude Code 生成的，但做完我逐个验证了里面的技术决策 ——
> 比如把 pooling 从 cls 改成 mean 看检索质量怎么降、关掉流式解码看中文怎么乱码。
> 取舍和短板都记在仓库的 docs 里。

最后一句是钩子，面试官大概率会接"那你说说短板"—— 这正是你准备最充分的地方。

## 2 分钟版

在 30 秒版基础上补三条主线，每条一句：

1. **为什么要服务端** —— API Key 不能进浏览器。顺带让服务端能做输入校验和错误脱敏。
2. **流式怎么做** —— SSE 而不是 WebSocket（单向够用、走 HTTP 不用另开协议）。
   踩了两个坑：一个 chunk 不等于一个完整帧、UTF-8 多字节被切断。
3. **RAG 怎么做** —— embedding 只能放本地（中转站不代理 embedding 端点）。
   两个静默失败点：非对称检索的前缀、pooling 必须用 cls。

收尾主动给一个短板：没有效果评估集，所以切块参数的调整只能靠手感。

**这三条主线要挑你真能往下讲两层的说。** 讲不到第二层的别主动提 ——
主动提等于邀请对方深挖。

## 深挖版 —— 准备好被问的五个方向

**这张表是第三部分的验收清单**：每行都要能讲到"如果不这么做会发生什么"，
才算这一项过了。做完对应实验再回来打勾。

| 方向 | 主线 | 依据 | 怎么练会 |
| --- | --- | --- | --- |
| RAG | 静默失败的两个点 + 为什么不用向量库 | [embedder.ts](../../server/rag/embedder.ts)、[vectorStore.ts](../../server/rag/vectorStore.ts)、笔记第 17/22 节 | 实验 1、2 |
| 安全 | XSS 顺序 + prompt 注入三层，第三层为什么必须有 | [markdown.ts](../src/utils/markdown.ts)、[retriever.ts](../../server/rag/retriever.ts)、笔记第 12/20 节 | 实验 5 |
| 性能 | 双层节流的两个计时器为什么不能都重置 | [useChatPersistence.ts:50-59](../src/composables/useChatPersistence.ts#L50-L59)、笔记第 14 节 | 实验 4 |
| 竞态 | AbortController 三处竞态，最关键是清理时校验身份 | [useChat.ts:62-67](../src/composables/useChat.ts#L62-L67)、笔记第 6 节 | 自问自答（快速点两次发送） |
| 分层 | 两个 store 为什么故意不统一 | [chat.ts](../src/stores/chat.ts) vs [knowledge.ts](../src/stores/knowledge.ts)、笔记第 24 节 | 自问自答 |

**通用策略**：每个方向都以"这里有个反直觉的地方"开场。
比如"净化和渲染的顺序，直觉上先净化更安全，其实是反的" ——
比平铺直叙更容易让人记住，也自然把话题引到你熟的地方。

**主动认短板的清单**（[ai-knowledge.md](ai-knowledge.md) 第 26 节，加上本文档发现的）：
无鉴权限流、无查询改写、无混合检索、换模型静默降质、无自动化测试、无效果评估集、
流式期间重复全量渲染 markdown、消息列表无虚拟滚动、无路由和代码分割、流式内容缺 `aria-live`。

被问出来比主动说出来差很多。

---

# 最后：如果时间只够做一件事

按这个顺序砍：

1. **第三部分的五个实验**（1 天）—— 不做这个，项目是负资产。
2. **优先级 1 的 ESLint + 四个测试文件**（1 天）—— JD 硬要求里唯一能一天内从零到有的。
3. **浏览器原理和 HTTP 的笔记**（2 天）—— 硬要求，且是纯学习没有捷径。

三件做完大概 4 天，JD 前六条（真正的硬要求）就都有东西可讲了。
Agent / MCP / 大前端全部放弃也没关系 —— 那两条写的是"优先"。

**别做的事**：为了简历再起一个新项目。
把这一个讲透，比三个讲不清的项目强。
