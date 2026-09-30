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
npm test                # 聊天、持久化、证据、切块和技能回归（不调用生成 API）
npm run start           # 生产模式启动 API，并托管 dist/
npm run eval:skills     # 技能自动路由与按需参考资料检查（本地 embedding）
npm run eval:retrieval  # 跑检索质量评估，对比向量 / BM25 / 混合三种模式
npm run eval:answers    # 28 题离线证据评估，不调用生成模型
```

## 现在可以做什么

- 上传文档建知识库，提问时自动检索相关片段并标注引用来源。embedding 在本地跑，
  首次运行需下载权重，见 [docs/rag.md](docs/rag.md)。
- **按需使用技能**：输入框可选自动、手动多选或关闭，提供前端排错与 RAG 评估方法。
  技能核心完整加载，参考资料只选取相关片段；使用方式和边界见 [项目技能](docs/skills.md)。
- **引用原文可核查**：回答用 `[S1]` 等编号对应下方可展开的原文片段；原文随聊天保存，
  刷新页面或后来删除文档，不会替换当时的证据。旧会话的标题引用仍能展示。
- **资料不足时明确说明**：没有选用技能时，非空知识库中明显不相关的问题直接返回提示，
  不调用生成模型。选用技能后可分析用户提供的信息或给出标明来源的通用建议，
  仍不能冒充知识库事实或伪造引用；主题相关但缺具体事实时也须说明无法确认。空库支持普通对话。
- **混合检索**：向量检索和 BM25 关键词检索并行，结果用 RRF 融合。纯向量在错误码、
  版本号这类精确标识符上会失手，实测评估集里这类问题的召回率从 71.4% 提到 100%。
- **检索质量评估**：`npm run eval:retrieval` 跑一套带标注的语料，输出 Recall / MRR /
  nDCG，并对比三种检索模式。参数调整从此有指标可依，不靠手感。
- **证据与回答评估**：新增 28 道手写场景题，覆盖可答、无答案、多轮和版本冲突。
  离线评估核对实际引用片段；可选的小批量真实生成需要人工核查，
  证据召回率不代表答案准确率。命令与结果见 [评测基线](docs/answer-evaluation.md)。
- **检索过程可视化**：每条回答下方可展开，看到每个候选块在两路里各自的名次、
  哪些真的进了 prompt、各阶段耗时。
- 发送真实问题，Claude 通过 SSE 流式返回文本。
- 流式输出按约 30ms 合并增量更新，并按浏览器帧率自动滚动，减少高频 token 带来的界面卡顿。
- 在同一会话中连续追问；发送和重试共用上下文裁剪，按 40 条消息、单条 20,000 字符、
  合计 120,000 字符的上限保留最近的完整轮次和当前问题，不会在第 21 次提问时因历史条数超限失败。
  界面的聊天记录不受请求裁剪影响。当前问题超限会明确报错，不会截断问题。
  这是字符预算下的滚动窗口，不是精确 token 计数或自动摘要；较早的信息需要重新补充。
- 含“它”“这样”等明确指代的追问，检索时会补上最近一个用户问题；复杂指代仍需补充上下文。
- 生成中点击“停止”，已收到的内容会保留并标记为已停止。
- 服务失败时显示错误并支持重试，重试复用原 assistant 消息。
- 切换、新建或删除会话时会取消旧请求，避免响应写入错误会话。
- 对话存在 localStorage，刷新页面不丢。
- Markdown 输出仍会经过 Markdown 渲染和 DOMPurify 净化。
- 知识库上传和删除在写盘成功后才更新内存与检索索引；失败会返回错误，后续操作仍可重试。

## 使用技能

输入框默认选择“自动”，按问题匹配技能；也可以在问题里写 `$frontend-debugging` 或
`$rag-evaluation` 显式点名。“手动”可勾选多个技能，只使用勾选项；“关闭”不加载技能。
`$id` 点名只在自动模式生效，手动模式未勾选任何技能时按普通问答发送。

更改选择从下一次发送生效，重试沿用该条消息发送时的选择。回答下方的“本次技能”面板
显示选择原因、内容版本、实际加入的参考原文和警告；该过程记录不持久化，刷新后消失。
自动加载失败且问题没有 `$` 时会提示并继续原有问答流程；手动选择或显式点名失败会明确报错。
技能自动匹配使用启发式规则，需要准确控制时可手动选择，详见 [docs/skills.md](docs/skills.md)。

## 流式输出性能

前端收到 SSE 增量后不会逐 token 修改消息，而是将短时间内到达的内容合并后再更新 Vue 状态；自动滚动最多每个浏览器帧执行一次。这样可以减少响应式更新和布局计算，长回复也不会因为重复处理而越来越卡。

会话持久化使用变更版本监听，并继续通过防抖和最长等待时间合并 `localStorage` 写入，避免流式过程中深度遍历整个会话树。

服务端为 SSE 响应设置了 `X-Accel-Buffering: no`。如果前面使用 Nginx 或其他反向代理，还需要确保代理不会缓存或缓冲 `/api/chat` 的 `text/event-stream` 响应，否则浏览器会一次收到一批 token，表现为输出停顿后跳跃。

## 目录结构

```
src/
├─ services/chatApi.ts       浏览器端 fetch + SSE 流适配
├─ services/knowledgeApi.ts  知识库文档增删查
├─ services/storage/         会话持久化的读写层
├─ types/chat.ts             会话与消息领域模型
├─ stores/chat.ts            Pinia：只管数据
├─ stores/knowledge.ts       文档列表状态
├─ stores/skills.ts          技能目录与本次选择
├─ composables/useChat.ts    请求编排：历史 → 占位 → 消费流 → 收尾
├─ components/               会话列表、知识库面板、消息区、输入框
│  └─ RetrievalTracePanel.vue  检索过程可视化
└─ utils/                    Markdown 安全渲染与 ID 工具
server/
├─ index.ts                  Express API、Claude SDK 调用和 SSE 转发
├─ chatPolicy.ts             技能方法与知识库证据的回答边界
├─ skills/index.ts           技能发现、选择、完整核心与按需参考资料
└─ rag/
   ├─ chunker.ts             Markdown 结构切块、原文定位与 token 上限
   ├─ embedder.ts            本地 ONNX 推理，文本 → 向量
   ├─ bm25.ts                BM25 关键词检索，中文 bigram 分词
   ├─ fusion.ts              RRF：把两路排序结果合成一个榜
   ├─ vectorStore.ts         内存数组 + JSON 落盘，两路检索
   ├─ retriever.ts           混合检索 + 拼 system 提示 + 注入防护
   ├─ grounding.ts           简单追问扩展、资料不足文案和引用编号检查
   ├─ evaluate.ts            检索指标与原文证据召回
   ├─ evalDataset.ts         单轮检索评估语料和标注
   └─ answerDataset.ts       28 道场景题、预期回答和证据
skills/                      项目维护者管理的 SKILL.md 与 references/
shared/skills.ts             技能请求与过程记录的边界校验
scripts/
├─ evaluate-skills.ts        技能路由与参考资料选择检查
├─ evaluate-retrieval.ts     评估 CLI，对比三种检索模式
├─ evaluate-answers.ts       离线证据评估 / 可选真实生成抽检
├─ test-*.ts                 Node 原生测试回归
└─ injection-test.ts         注入防护实验
```

## 安全边界

- 应用的真实 Anthropic 请求只在服务端执行；评估脚本仅加 `--live` 时调用生成 API。
- 浏览器只请求项目自己的 `/api/chat`，不会接触 `ANTHROPIC_API_KEY`。
- `.env` 和 `.env.*` 已加入 `.gitignore`，只提交 `.env.example`。
- API 会校验消息角色、数量和长度，避免无界请求转发到上游。
- 知识库检索到的内容按不可信数据处理，见 [docs/rag.md](docs/rag.md) 的注入防护一节。
- `skills/` 是项目维护者提供的受信指令目录，技能及参考资料不作为知识库事实来源，也不授予工具能力。

**尚未做**：`/api/chat` 和 `/api/documents` 都没有鉴权和限流，部署到公网前必须补上。

## 文档

- [fqx 网站知识资料](docs/knowledge/fqx/README.md) — 五类知识地图、266 道面试题的原文快照、导入方法与检索抽查
- [docs/rag.md](docs/rag.md) — RAG 的权重下载、设计决定和排查
- [docs/skills.md](docs/skills.md) — 技能选择、文件结构、加载预算与验证边界
- [docs/answer-evaluation.md](docs/answer-evaluation.md) — 引用与拒答评测、实测基线及人工核查方法
- [docs/ai-knowledge.md](docs/ai-knowledge.md) — 项目技术决策、LLM 基础、模型对比

## 后续方向

- 用真实失败问题扩充评测集，完成回答忠实度与引用准确性的人工抽检
- 更完整的查询改写（当前仅支持简单指代追问）
- cross-encoder 重排（混合检索召回之后的第二段，精度上限所在）
- `bm25` / `fusion` 两个纯函数模块的独立单测
- 长列表虚拟滚动
