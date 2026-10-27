# RAG 最小学习版

先学这一条线：**输入问题 → 后端接收 → 查资料 → 拼提示词 → 模型回答 → 页面展示**。

这一版使用三段内置资料和关键词检索；每次只处理当前问题，用普通 JSON 返回完整结果。
原来的聊天页面、文档和向量索引仍在原处，学习版独立运行。

## 启动

在 VS Code 中打开整个 `ai-knowledge-assistant` 项目，在项目根目录终端运行：

```bash
npm run dev:learn
```

打开 <http://localhost:5174>。学习版后端监听 `127.0.0.1:8788`。

先选一个示例，点击 **只看检索**。这一步无需密钥，也不会请求模型。
再点 **查资料并回答**，就会把检索到的原文发给 Claude。
生成回答复用项目根目录 `.env` 的 `ANTHROPIC_API_KEY`、`ANTHROPIC_BASE_URL`、`ANTHROPIC_MODEL`。

## 先读这三个文件

| 顺序 | 文件 | 看什么 |
|---|---|---|
| 1 | [App.vue](App.vue) | 按钮如何调用 `send()`，`fetch()` 发了什么，响应如何显示 |
| 2 | [server/index.ts](server/index.ts) | `/api/chat` 按顺序调用检索、拼提示词、调用模型 |
| 3 | [server/knowledge.ts](server/knowledge.ts) | 三段资料，以及 `retrieve()` 如何按关键词找到资料 |

其他文件负责页面挂载、开发服务器、类型检查或测试，第一遍可以先跳过。

## 跟着一次请求看

以“computed 和 watch 有什么区别？”为例：

1. `App.vue` 的按钮调用 `send(false)` 或 `send(true)`。
2. `fetch('/api/chat')` 发出 `{ question, generate }`。`generate` 为布尔值，控制是否调用模型。
3. `server/index.ts` 的 `app.post('/api/chat', ...)` 收到请求。
4. `const sources = retrieve(question)` 进入 `knowledge.ts`，按命中的关键词数量排序，最多取两段。
5. 只看检索时直接返回资料；生成回答时，将原文拼成 `systemPrompt`，调用 `client.messages.create()`。
6. 后端返回 `{ answer, sources }`；前端更新两个 `ref`，页面自动更新。

这里真正的“检索增强”发生在第 5 步：模型收到的不仅有问题，还有第 4 步找到的原文。
来源按顺序编号为 `[S1]`、`[S2]`，可以对照回答查看原文。编号存在并不保证模型引用准确。

## 在 VS Code 打后端断点

如果正在运行 `npm run dev:learn`，先在那个终端按 `Ctrl + C` 停止它，避免后端端口重复占用。

1. 终端只运行前端：`npm run dev:learn:client`。
2. 打开“运行和调试”，选择 **学习版：后端**，按 **F5**。
3. 在 `learning/server/index.ts` 的 `const sources = retrieve(question)` 上打断点。
4. 网页选择 computed/watch 示例，点 **只看检索**。VS Code 会停在该行。
5. 按 **F11** 进入 `retrieve()`，查看 `query`、命中的关键词和返回的资料。
6. 按 **F5** 继续，网页显示资料。再试“查资料并回答”，在 `const response = await client.messages.create(...)` 打断点，就能看 `systemPrompt`。

要看浏览器中的 `fetch()`，使用另一个配置 **学习版：前端**，并在它启动的 Chrome 中操作。
前后端各有自己的调试会话；两者之间通过 HTTP 传数据。
后端调试配置不带文件监视，修改后端代码后重启该调试会话。

## 这一版的范围

- 资料写在 `knowledge.ts`，不用原版 `data/rag-index.json`。要练习可以直接改这三段文字。
- 检索只看关键词；同义词、纯数字“1”、依赖上文的追问不一定命中。下一步可只替换 `retrieve()` 为向量检索。
- 找不到资料时显示本地提示，跳过模型；“只看检索”也始终跳过模型。
- 单轮问答、完整 JSON、纯文本展示。刷新后不保存结果。

## 检查

```bash
npm run test:learn       # 关键词命中、无结果、排序、大小写
npm run build:learn      # 前后端类型检查与学习版页面构建
```

构建产物在 `learning/dist/`，与完整版的 `dist/` 分开。
