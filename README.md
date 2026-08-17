# AI 知识库助手

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
npm run typecheck  # 前端 + 服务端 TypeScript 检查
npm run build      # 类型检查 + 前端生产构建
npm run start       # 生产模式启动 API，并托管 dist/
```

## 现在可以做什么

- 发送真实问题，Claude 通过 SSE 流式返回文本。
- 在同一会话中连续追问，服务端会收到完整的用户/assistant 历史。
- 生成中点击“停止”，已收到的内容会保留并标记为已停止。
- 服务失败时显示错误并支持重试，重试复用原 assistant 消息。
- 切换、新建或删除会话时会取消旧请求，避免响应写入错误会话。
- Markdown 输出仍会经过 Markdown 渲染和 DOMPurify 净化。

## 目录结构

```
src/
├─ services/chatApi.ts    浏览器端 fetch + SSE 流适配
├─ types/chat.ts          会话与消息领域模型
├─ stores/chat.ts         Pinia：只管数据
├─ composables/useChat.ts 请求编排：历史 → 占位 → 消费流 → 收尾
├─ components/            会话列表、消息区、输入框和消息气泡
└─ utils/                 Markdown 安全渲染与 ID 工具
server/
└─ index.ts               Express API、Claude SDK 调用和 SSE 转发
```

## 安全边界

- 真实 Anthropic 请求只在 `server/index.ts` 执行。
- 浏览器只请求项目自己的 `/api/chat`，不会接触 `ANTHROPIC_API_KEY`。
- `.env` 和 `.env.*` 已加入 `.gitignore`，只提交 `.env.example`。
- API 会校验消息角色、数量和长度，避免无界请求转发到上游。

## 后续方向

- 会话持久化（localStorage / IndexedDB）
- 文档上传与向量检索（RAG）
- 长列表虚拟滚动
