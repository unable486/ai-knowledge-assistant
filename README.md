# AI 知识答疑

Vue 3 + TypeScript + Vite + Pinia 的 Claude 实时对话界面。前端负责聊天交互，Node 服务端负责安全地调用 Anthropic API；API Key 不会进入浏览器或 Vite 构建产物。

## 快速开始

```bash
npm install
copy .env.example .env
```

编辑 `.env`，填入密钥；如果使用中转站，同时填写中转站地址：

```dotenv
ANTHROPIC_API_KEY=你的中转站 Key
ANTHROPIC_BASE_URL=https://your-relay.example.com
# 可选：中转站若使用不同模型名，在这里填写
# ANTHROPIC_MODEL=claude-opus-5
# 可选：PORT=8787
```

`ANTHROPIC_BASE_URL` 不要带末尾 `/v1`；官方直连时可以留空。

启动开发环境：

```bash
npm run dev
# 前端：http://localhost:5173
# API：http://localhost:8787
```

常用命令：

```bash
npm run typecheck       # 前端 + 服务端 TypeScript 检查
npm run build           # 类型检查 + 前端生产构建
npm run start           # 生产模式启动 API，并托管 dist/
npm run eval:retrieval  # 跑检索质量评估，对比向量 / BM25 / 混合三种模式
```

## 现在可以做什么

- 上传文档建知识库，提问时自动检索相关片段并标注引用来源。embedding 在本地跑，
  首次运行需下载权重，见 [docs/rag.md](docs/rag.md)。
- **混合检索**：向量检索和 BM25 关键词检索并行，结果用 RRF 融合。纯向量在错误码、
  版本号这类精确标识符上会失手，实测评估集里这类问题的召回率从 71.4% 提到 100%。
- **检索质量评估**：`npm run eval:retrieval` 跑一套带标注的语料，输出 Recall / MRR /
  nDCG，并对比三种检索模式。参数调整从此有指标可依，不靠手感。
- **检索过程可视化**：每条回答下方可展开，看到每个候选块在两路里各自的名次、
  哪些真的进了 prompt、各阶段耗时。
- 发送真实问题，Claude 通过 SSE 流式返回文本。
- 在同一会话中连续追问，服务端会收到完整的用户/assistant 历史。
- 生成中点击“停止”，已收到的内容会保留并标记为已停止。
- 服务失败时显示错误并支持重试，重试复用原 assistant 消息。
- 切换、新建或删除会话时会取消旧请求，避免响应写入错误会话。
- 对话存在 localStorage，刷新页面不丢。
- Markdown 输出仍会经过 Markdown 渲染和 DOMPurify 净化。

## 目录结构

```
src/
├─ services/chatApi.ts       浏览器端 fetch + SSE 流适配
├─ services/knowledgeApi.ts  知识库文档增删查
├─ services/storage/         会话持久化的读写层
├─ types/chat.ts             会话与消息领域模型
├─ stores/chat.ts            Pinia：只管数据
├─ stores/knowledge.ts       文档列表状态
├─ composables/useChat.ts    请求编排：历史 → 占位 → 消费流 → 收尾
├─ components/               会话列表、知识库面板、消息区、输入框
│  └─ RetrievalTracePanel.vue  检索过程可视化
└─ utils/                    Markdown 安全渲染与 ID 工具
server/
├─ index.ts                  Express API、Claude SDK 调用和 SSE 转发
└─ rag/
   ├─ chunker.ts             按标题和句子边界切块
   ├─ embedder.ts            本地 ONNX 推理，文本 → 向量
   ├─ bm25.ts                BM25 关键词检索，中文 bigram 分词
   ├─ fusion.ts              RRF：把两路排序结果合成一个榜
   ├─ vectorStore.ts         内存数组 + JSON 落盘，两路检索
   ├─ retriever.ts           混合检索 + 拼 system 提示 + 注入防护
   ├─ evaluate.ts            检索质量指标（Recall / MRR / nDCG）
   └─ evalDataset.ts         评估语料和标注
scripts/
├─ evaluate-retrieval.ts     评估 CLI，对比三种检索模式
└─ injection-test.ts         注入防护实验
```

## 安全边界

- 真实 Anthropic 请求只在 `server/index.ts` 执行。
- 浏览器只请求项目自己的 `/api/chat`，不会接触 `ANTHROPIC_API_KEY`。
- `.env` 和 `.env.*` 已加入 `.gitignore`，只提交 `.env.example`。
- API 会校验消息角色、数量和长度，避免无界请求转发到上游。
- 知识库检索到的内容按不可信数据处理，见 [docs/rag.md](docs/rag.md) 的注入防护一节。

**尚未做**：`/api/chat` 和 `/api/documents` 都没有鉴权和限流，部署到公网前必须补上。

## 文档

- [docs/rag.md](docs/rag.md) — RAG 的权重下载、设计决定和排查
- [docs/ai-knowledge.md](docs/ai-knowledge.md) — 项目技术决策、LLM 基础、模型对比

## 后续方向

- 查询改写（解决多轮对话里的指代问题）
- cross-encoder 重排（混合检索召回之后的第二段，精度上限所在）
- `chunker` / `bm25` / `fusion` 三个纯函数模块的单测
- 长列表虚拟滚动
