# 面试 05 · 系统设计 + 手写题 > 说明

系统设计 + 手写题

答案默认折叠。先自己答一遍，再点开核对。每题末尾的**追问**是面试官顺着你的答案往下挖的那一层 —— 只答得出主问题、答不出追问，通常判定为「背过，没做过」。

- 🔴 必答 — 答不出直接掉档

- 🟡 加分 — 能拉开差距

- ⚪ 可以坦白不会 — 说清边界比硬编好

# 面试 05 · 系统设计 + 手写题 > 设计一个企业知识库问答系统（RAG 全链路：接入、切分、索引、检索、重排、生成、引用）

开口先问四件事，问不出来就自己假设并说出来——面试官要看的是你知道哪些参数会改变架构：

 

1. **语料规模与增速**：假设 50 万篇文档、平均 3000 字、每天新增/变更 1 万篇。这个数字决定索引是单机还是分片、增量还是全量
2. **权限模型**：全员可见，还是按部门/项目隔离？有权限就意味着检索必须带过滤，而带过滤的向量检索会掉召回（`03-sql.md` 第 14 题）
3. **时效要求**：文档改完多久要能被检索到？5 分钟和 24 小时是两套设计
4. **答错的代价**：内部知识问答容忍一点误差；如果下游是客服话术或合同条款，就必须能拒答

 

容量估算按上面的假设算：50 万篇 × 3000 字 ÷ 400 字每块 ≈ 375 万个 chunk。1024 维 float32 向量是 4KB，原始向量约 15GB，HNSW 图结构再加 1.5~2 倍，内存量级 30~45GB——**这个数已经超过单机塞内存的舒适区**，要么降维/量化，要么分片。QPS 假设峰值 20，每次检索 top50 + rerank 50 条 + 生成 800 token，那么瓶颈在生成而不是检索。

 

组件清单（自上而下，每层的职责和失败表现分开写）：

 

| 层 | 组件 | 职责 | 挂掉的表现 |
| --- | --- | --- | --- |
| 接入 | 连接器（Confluence/SharePoint/S3/DB） | 拉取原文 + 元数据 + ACL | 增量停摆，用户查到的都是旧政策 |
| 接入 | 解析器（PDF/Office/HTML） | 转结构化文本，保留标题层级和表格 | PDF 表格被拉平成一行数字，答案里金额对不上 |
| 索引 | 切分 + embedding + 写入 | 生成 chunk 与向量 | 队列积压，新文档几小时不可见 |
| 存储 | 向量索引 + 全文索引 + 元数据库 | 检索与过滤 | 元数据和向量不一致，检索到已删除文档 |
| 检索 | 混合检索 + 融合 + rerank | 召回与排序 | 召回够但排序差，答案引用的是不相关段落 |
| 生成 | prompt 组装 + 模型调用 + 引用抽取 | 出答案与出处 | 引用编号指向不存在的片段 |
| 服务 | 网关 + 缓存 + 限流 + 审计 | 稳定性与合规 | 单个大查询把后端打满 |
| 离线 | eval 集 + 抽样标注 + 看板 | 知道改好了没有 | 改了 prompt 没人知道是涨还是跌 |

 

**关键数据流（写路径）**：连接器按 `updated_at` 拉增量 → 内容哈希对比，未变的直接跳过（省 embedding 钱）→ 解析成带标题路径的段落 → 按标题层级切块，块大小 300~500 字、重叠 10~15% → chunk ID 由「文档 ID + 块序号 + 内容哈希」派生 → 批量 embedding（并发和重试见第 6 题）→ 写向量库 + 全文索引 + 元数据。**先写新块、再删同文档的旧块**，顺序反了会出现一个用户什么都查不到的窗口（`04-ai.md` 第 12 题）。

 

**关键数据流（读路径）**：请求带用户身份 → query 改写（补代词、拆多意图）→ 并行发向量检索 top50 和 BM25 top50，两路都带 ACL 过滤 → RRF 融合去重（第 9 题的代码就是这一步）→ rerank 取 top5~8 → 组装 prompt，每段标上 `[1] [2]` 编号和文档 ID → 流式生成 → 从输出里抽引用编号，映射回真实文档并校验编号存在 → 落审计日志（query、命中的 chunk ID、模型版本、prompt 版本、token 数）。

 

**失败与降级**，按从外到内：

 

- **embedding 服务挂**：写路径进队列等，读路径退化为纯 BM25。检索质量下降但仍能用，比整个功能 500 好
- **rerank 挂**：直接用融合后的顺序，把 top 数从 5 调到 3（因为排序变差了，多喂反而更容易误导模型）
- **向量库挂**：只走全文检索；全文也挂就明确回「知识库暂时不可用」，**不要让模型凭参数记忆硬答**——这是最坏情况，用户拿到一个自信的错答案，还带着看起来正常的界面
- **生成模型挂**：把检索结果直接展示成「相关文档片段」列表。前端出身在这里有话讲：降级不是显示错误页，是换一种信息呈现
- **检索为空或最高分低于阈值**：走拒答路径，回「没有找到依据」。宁可少答

 

**可观测指标**（分三组，缺任何一组都会被追）：

 

- 质量：Recall@k 与 MRR（要有标注集）、引用可点开率、拒答率、👎 率、人工抽样的答案正确率
- 性能：TTFT p50/p95、端到端 p95、检索耗时、rerank 耗时、生成耗时（分段才能定位）、索引延迟（文档改完到可检索的时间）
- 成本：每次问答的 embedding + 检索 + rerank + 生成 token 数与金额，按部门归集

 

排查时要能按 trace ID 把「这次问答召回了哪些 chunk、rerank 后留了哪几条、最终 prompt 长什么样」全部捞出来。**没有这个能力，RAG 答错就只能靠改 prompt 试**，这正是面试官用来区分做过和没做过的地方。

 

**追问「知识库每天新增一万篇文档，你的索引怎么增量更新而不重建」**：日常增量靠三件事——内容哈希做变更检测（哈希没变直接跳过，一万篇里通常真正变了的只有几百篇）、chunk ID 由内容哈希派生（能精确算出哪些块要写、哪些要删）、删除走真删而不是标记（漏删的表现是用户查到上个季度已废止的政策，而且日志里毫无异常）。一万篇 × 7.5 块 ≈ 7.5 万次 embedding，按批量 64 条一次、并发 8，是分钟级的活儿，不需要重建。真正需要全量重建的只有两种情况：**换 embedding 模型或改切分策略**——此时向量空间变了，新旧向量不可比，必须新建一份索引灰度对比后切别名，原地改会出现同一个索引里两种向量共存，表现为召回莫名其妙地忽好忽坏。别名切换的代价是双倍存储，这个成本要提前说。

# 面试 05 · 系统设计 + 手写题 > 设计一个支持流式输出的对话服务（SSE 与 WebSocket 取舍、断连恢复、多端同步、取消）

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/05-design-coding.html#q2

先钉边界：单会话单活跃生成（同一会话不允许两个生成同时跑）、单次生成最长 5 分钟、峰值并发在飞流 2000 条、同一账号可能在手机和电脑同时打开同一会话。**并发在飞流数是这道题的核心容量数**，因为每条流在服务端占一个连接和一份缓冲，Node 单进程撑不到 2000 条稳定，要按 4~8 个实例横向拆，换成你自己项目里的实测数。

# 面试 05 · 系统设计 + 手写题 > 设计一个支持流式输出的对话服务（SSE 与 WebSocket 取舍、断连恢复、多端同步、取消）

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/05-design-coding.html#q2

传输层取舍，直接给结论再给理由：

# 面试 05 · 系统设计 + 手写题 > 设计一个支持流式输出的对话服务（SSE 与 WebSocket 取舍、断连恢复、多端同步、取消）

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/05-design-coding.html#q2

前文：传输层取舍，直接给结论再给理由：

| 方案 | 适合 | 代价 |
| --- | --- | --- |
| SSE（`text/event-stream`） | 单向服务端推，也就是绝大多数对话场景 | 单向；HTTP/1.1 下受浏览器每域名 6 连接限制，多标签页会互相饿死；`EventSource` 不能带自定义头 |
| fetch + ReadableStream | 要带 Authorization 头、要精细控制取消 | 要自己写解析（第 7 题）和重连 |
| WebSocket | 双向高频（语音、协同编辑、边说边打断） | 自己维护心跳与重连、代理和网关配置更麻烦、无状态横向扩展要额外做会话路由 |

# 面试 05 · 系统设计 + 手写题 > 设计一个支持流式输出的对话服务（SSE 与 WebSocket 取舍、断连恢复、多端同步、取消）

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/05-design-coding.html#q2

选 SSE + fetch 流：对话是服务端单向推 token，客户端只在开始和取消时说话，一个 POST 起流 + 一个 DELETE 取消就够，不需要为了 5% 的双向需求把整套连接管理复杂度背上。HTTP/2 下 SSE 走多路复用，6 连接限制自然消失。**代理层要显式关掉响应缓冲**（Nginx 的 `proxy_buffering off`、`X-Accel-Buffering: no`），否则表现是本地开发流得很顺、上了预发环境变成等十几秒一次性吐完，而代码一行没改——这个坑几乎每个团队都踩过一次。

# 面试 05 · 系统设计 + 手写题 > 设计一个支持流式输出的对话服务（SSE 与 WebSocket 取舍、断连恢复、多端同步、取消）

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/05-design-coding.html#q2

组件清单：

# 面试 05 · 系统设计 + 手写题 > 设计一个支持流式输出的对话服务（SSE 与 WebSocket 取舍、断连恢复、多端同步、取消）

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/05-design-coding.html#q2

前文：组件清单：

| 组件 | 职责 | 挂掉的表现 |
| --- | --- | --- |
| 接入层（网关/LB） | 保持长连接、关缓冲、超时放宽到大于最长生成时间 | 流被 60 秒空闲超时掐断，用户看到答案在半句话处停住 |
| 会话服务 | 建会话、鉴权、单活跃生成互斥 | 双击发送产生两条并行生成，token 双倍计费且两份输出交错入库 |
| 生成 worker | 调模型、把 delta 写进流、同时写增量到存储 | 只写了流没写存储，刷新页面答案全丢 |
| 事件存储（Redis Stream / DB append） | 按 `seq` 持久化每个 delta，供续传与多端 | 无法续传，断线只能重生成，成本翻倍 |
| 广播（Pub/Sub） | 把 delta 分发到同会话的所有连接 | 手机端看不到电脑端正在生成的内容 |
| 取消通道 | 把用户取消传给正在跑的 worker | 用户点了停止，后台还在烧 token |

# 面试 05 · 系统设计 + 手写题 > 设计一个支持流式输出的对话服务（SSE 与 WebSocket 取舍、断连恢复、多端同步、取消）

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/05-design-coding.html#q2

**关键数据流**：客户端 POST `/messages` → 服务端生成 `message_id`，落一条 `status=streaming` 的记录，立刻返回 → 客户端 GET/POST 起流并带 `message_id` → worker 调模型，每收到一个 delta 就做两件事：`append(message_id, seq, text)` 写存储、`publish(session_id, delta)` 广播 → 各连接从广播读并按 SSE 帧下发，帧里带 `id: <seq>` → 结束时发一个终止事件并把记录标成 `done`，写入 token 用量。

# 面试 05 · 系统设计 + 手写题 > 设计一个支持流式输出的对话服务（SSE 与 WebSocket 取舍、断连恢复、多端同步、取消）

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/05-design-coding.html#q2

**先写存储再广播，不能反**。反了的现象很具体：用户刚看到最后一句话，网络抖一下重连，续传从存储里读，那句话不在，答案凭空少一段。

# 面试 05 · 系统设计 + 手写题 > 设计一个支持流式输出的对话服务（SSE 与 WebSocket 取舍、断连恢复、多端同步、取消）

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/05-design-coding.html#q2

**断连恢复**：SSE 每帧带 `id: <seq>`，`EventSource` 重连会自动带 `Last-Event-ID` 请求头；用 fetch 流就自己记 `lastSeq` 并在重连的 URL 上带 `?after_seq=`。服务端拿到 seq 后从事件存储回放 `seq > after_seq` 的部分，再接上实时流。**恢复的语义是「补齐缺口」，不是「重新生成」**——重新生成会让用户看到和刚才不一样的答案，比丢字更让人不信任。如果那条消息已经 `done`，直接返回完整文本，不要起新的生成。

# 面试 05 · 系统设计 + 手写题 > 设计一个支持流式输出的对话服务（SSE 与 WebSocket 取舍、断连恢复、多端同步、取消）

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/05-design-coding.html#q2

**多端同步**：以 `session_id` 为广播 key，所有端订阅同一条流。第二个端中途接入时，先读存储里已有的部分补齐历史，再进实时流——顺序是「先补历史，再订阅」，反了会丢中间那几帧。同一账号在两个端同时点发送，靠会话级互斥拦住第二个（返回 409 + 当前正在生成的 `message_id`，让它去订阅而不是新起一条）。

# 面试 05 · 系统设计 + 手写题 > 设计一个支持流式输出的对话服务（SSE 与 WebSocket 取舍、断连恢复、多端同步、取消）

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/05-design-coding.html#q2

**取消**：三层都要断。前端 `AbortController` 断掉自己的读；服务端收到断连或显式 DELETE，把取消标记写进共享存储；worker 在每次写 delta 前检查标记，命中就 abort 对上游模型的请求。**只做前端 abort 是最常见的假取消**——用户看不到字了，但上游还在生成，账单照走。取消后要把已生成的部分标成 `status=cancelled` 并保留，别清空：用户点停止通常是「够了」，不是「我不要了」。

# 面试 05 · 系统设计 + 手写题 > 设计一个支持流式输出的对话服务（SSE 与 WebSocket 取舍、断连恢复、多端同步、取消）

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/05-design-coding.html#q2

**可观测指标**：TTFT p50/p95（这是流式体验的第一指标）、token 间最大间隔（卡顿是间隔而不是均值决定的）、流完成率、断连率与断连时的平均 seq、续传成功率、取消率与取消发生的秒数、每条流的 token 用量。前端还要采流式期间的 INP 和长任务数（`01-frontend.md` 第 14 题）。

# 面试 05 · 系统设计 + 手写题 > 设计一个支持流式输出的对话服务（SSE 与 WebSocket 取舍、断连恢复、多端同步、取消）

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/05-design-coding.html#q2

**追问「流式响应中途模型报错，已经吐给用户的半句话怎么处理」**：不能删，也不能装作没事。做法是保留已生成内容，追加一个 `event: error` 的帧，前端把已出的文本置为「已中断」样式（灰化 + 明确文案），并给「继续」和「重试」两个按钮：继续是把已生成部分作为 assistant 前缀再发一次请求让模型接着写，重试是丢弃重来。存储里那条记录标 `status=failed` 但保留 `partial_text` 和失败时的 seq，否则事后无法复现。计费按实际产生的 token 算，不能因为失败就免单，但要在日志里标记 `failed` 以便对账。**最糟的实现是把已出的字清空并弹一个 502**——用户刚读到一半的内容消失，会认为整个系统不可靠，而这是一个纯前端决策，正是你的强项该说出来的地方。

# 面试 05 · 系统设计 + 手写题 > 设计一个 Agent 任务编排系统（长耗时、可中断续跑、状态持久化、幂等重试）

边界假设：单任务 10 步到 200 步，跨度几分钟到几小时；步骤里既有纯模型调用，也有会改外部状态的写操作（发邮件、建工单、扣库存）；进程随时可能被重启（部署、OOM、抢占实例）。**「随时可能被重启」是这道题唯一重要的前提**，它直接否掉了「在内存里跑一个 while 循环」这个默认写法。

 

内存循环的失败现象很具体：一次部署，所有正在跑的 Agent 全部消失，用户那边是任务卡在「进行中」永远不动，日志里只有进程退出，没有任何一条业务错误。这就是为什么要把执行状态搬到存储里。

 

组件清单：

 

| 组件 | 职责 | 挂掉的表现 |
| --- | --- | --- |
| 任务表（run） | 任务级状态机 `pending / running / paused / awaiting_approval / done / failed / cancelled` | 状态只有「跑没跑完」，无法区分等审批和挂了 |
| 步骤表（step） | 每步的输入、输出、工具名、幂等键、尝试次数、耗时、token | 无法续跑，只能整任务重来 |
| 调度器 | 从队列取待执行步骤，加租约（lease）防重复执行 | 两个 worker 同时跑一步，工具被调两次 |
| worker 池 | 执行单步：调模型或调工具，写回结果 | 单步卡死拖住整个池子 |
| 工具注册表 | schema、是否幂等、是否高影响、超时与重试策略 | 对不可重试的写操作做了重试，重复发邮件 |
| 事件日志（append-only） | 每次状态变迁一条，可回放 | 事后无法解释 Agent 为什么走了这条路 |
| 审批队列 | 高影响操作的人工确认点 | Agent 自动执行了不可逆操作 |

 

**核心数据流**：一次「推进」是一个纯函数式的小事务——取出 run 的当前状态 → 组装上下文（第 8 题的裁剪就用在这里）→ 调模型拿到下一步动作 → 把动作作为一条 `step(status=pending, idempotency_key)` 落库 → 提交 → 执行工具 → 把结果写回 step 并置 `succeeded` → 触发下一次推进。**决策先落库再执行**，顺序反了就会出现「工具执行了但没人知道」，重启后重复执行。

 

**可中断续跑**：续跑的入口是「读 run + 读已完成的 step 列表 → 重建上下文 → 从第一个未完成的 step 继续」。这要求两件事：上下文必须能从存储重建（不能依赖内存里的对象），以及每一步的输出必须结构化落库（不能只存模型的自然语言输出）。中断分两类：用户主动暂停（置 `paused`，worker 看到就停在步边界，不打断正在跑的那一步）和进程意外死亡（靠租约超时回收——`lease_until` 到期未续约的 running step 被重新入队）。

 

**幂等重试**（这题的重点，追问必然落在这里）：

 

- 每个 step 生成 `idempotency_key = hash(run_id + step_index + 工具名 + 规范化参数)`，透传给下游。下游支持幂等键的（多数支付、工单系统都支持）直接靠它去重
- 工具按「是否幂等」分三类：**只读**（检索、查询）随便重试；**幂等写**（按键 upsert、设置状态为 X）可重试；**非幂等写**（发邮件、扣款、创建工单）只能靠幂等键或「先查后写」，**不能盲目重试**
- 非幂等写的正确姿势是两阶段：先写一条 `intent` 记录（带幂等键）并提交，再执行；重启后看到 `intent` 存在但无结果，先去下游用幂等键查一次「这个操作是否已经发生」，查不到才重发
- 重试要有上限和退避（第 6 题的代码），并且**同一步的重试次数要落库**，否则重启后计数归零，一个必然失败的步骤会被无限重试烧钱

 

`02-node-java.md` 第 13 题讲的幂等设计是这里的基础，区别在于 Agent 的重试是自动发生的、次数不可预测，所以幂等要求比普通接口更严格。

 

**失败与降级**：单步失败按类型分流——参数错回传给模型让它自己改（`04-ai.md` 第 15 题）、瞬时错代码层退避重试、永久错标记此路不通让模型换方案。整任务层面要有三个硬闸：最大步数、最大 token 预算、最长墙钟时间，任一触发就停在 `failed` 并保留全部中间产物。**没有预算闸的 Agent 会在同一个错误上转圈，直到有人看账单才发现**（`04-ai.md` 第 16 题）。高影响操作走 `awaiting_approval`，任务挂起等人点确认，超时未确认就取消而不是默认执行。

 

**可观测指标**：任务成功率、平均步数与步数分布（长尾就是在转圈的那些）、单任务 token 与金额（p50/p95）、每种工具的失败率与重试率、重复执行检出数（幂等失效的直接证据）、租约回收次数（等于隐性崩溃次数）、审批等待时长、从中断到续跑成功的比例。每个 run 要能一键回放整条决策链。

 

**追问「同一个步骤被两个 worker 同时取到，工具执行了两次，怎么防」**：先承认这在分布式下必然发生，分布式锁只能降低概率不能消除（`02-node-java.md` 第 15 题）。所以防线放在两层：调度层用「乐观锁 + 租约」——`UPDATE step SET worker_id=?, lease_until=now()+30s WHERE id=? AND status='pending'`，靠受影响行数是否为 1 决定这个 worker 能不能执行，一个数据库层面的原子操作比锁服务可靠；执行层再用幂等键兜底，因为租约会因为 GC 停顿、网络分区而失效——**worker A 认为自己还持有租约、实际已经过期并被 B 接手，这是最经典的场景**。两层都做完，重复执行会退化成「下游看到同一个幂等键，返回第一次的结果」，业务上无害。最后要加一条监控：统计同一 `idempotency_key` 被调用超过一次的次数，这个数长期为 0 才说明设计是对的，不监控就等于不知道。

# 面试 05 · 系统设计 + 手写题 > 设计 LLM 网关（多供应商路由、限流、超时降级、成本核算与配额）

网关存在的理由只有一个：**业务代码不应该知道自己在调哪家模型**。没有网关时，供应商限流、模型下线、价格调整这三件事每次都要改一遍所有业务代码；有网关时改一处配置。

 

边界假设：接入 3~5 家供应商、10 个左右业务方、峰值 200 QPS 且其中 80% 是流式、需要按部门出月度账单。这些数字换成你自己项目里的。

 

组件清单：

 

| 组件 | 职责 | 挂掉/配错的表现 |
| --- | --- | --- |
| 统一协议层 | 把各家 API 归一成一套请求/响应/流式帧 | 换供应商要改业务代码 |
| 路由器 | 按模型别名 + 健康度 + 成本 + 配额选实际后端 | 全部流量压在一家，它限流就整体不可用 |
| 限流器 | 双维度：QPS 和 TPM（token per minute） | 只限 QPS，长上下文请求把 TPM 打爆，供应商侧 429 |
| 熔断与健康探测 | 连续失败就摘掉后端，定期半开试探 | 对已经挂掉的后端持续重试，延迟被拖到超时上限 |
| 重试与降级 | 分类重试、跨供应商切换、降级模型 | 对不可重试错误重试，放大故障 |
| 用量记账 | 按 key/部门/模型累计 token 和金额 | 月底对不上账，无法归因 |
| 配额 | 按部门的日/月上限，软硬阈值 | 一个业务方跑批把整月预算烧完 |
| 缓存 | 精确 key 缓存 + 可选语义缓存 | 命中脏数据（`04-ai.md` 第 25 题） |
| 审计 | 请求/响应留存、脱敏、可复现字段 | 出事无法复现 |

 

**关键数据流**：业务方带 API key 请求「模型别名 + messages」→ 鉴权，取出该 key 的配额和可用后端集合 → 限流（QPS 令牌桶 + TPM 桶，TPM 桶按「输入 token 实数 + 输出 token 预估」预扣，返回后按实际用量补差）→ 路由选后端 → 协议转换 → 发请求，流式则边转发边计数 → 落用量记录（`request_id`、模型、输入/输出 token、耗时、TTFT、状态、是否重试、成本）→ 返回。

 

**双限流是这道题的分水岭**。只限 QPS 的后果很具体：10 个 QPS 的短请求和 10 个 QPS 的 128K 长上下文请求，对供应商的压力差两个数量级，后者会在你的限流器完全空闲的情况下收到供应商的 429。所以必须按 token 限（`02-node-java.md` 第 14 题），而且要预扣—补差，因为请求发出前不知道输出多长。

 

**超时与降级**：

 

- 超时分两个：非流式看总时长（比如 60 秒），流式看 **TTFT**（比如 10 秒）加 token 间最大间隔（比如 20 秒）。只设总时长的话，一条卡在第一个 token 上的流会占满 60 秒才失败，用户早就走了
- 重试只对 429、5xx、连接类错误做，且换一个后端重试而不是原地重试——原地重试同一个正在限流的后端只会加重它的负担
- 跨供应商降级要提前处理能力差异：结构化输出、function calling、上下文长度、多模态各家不一致，**同一个别名下的后端必须能力对齐**，否则降级后表现为「主链路正常，降级时 JSON 解析失败」，而且只在故障时才暴露
- 最后一档降级是明确失败，返回结构化错误让业务方决定，不要偷偷换一个能力差很多的模型然后假装成功

 

**成本核算**：价格表要带生效时间做版本管理（供应商调价是常事，按当前价重算历史账单必然对不上）。每条用量记录要能归因到 `部门 / 业务 / 用户 / 会话 / 请求`，缓存命中的请求也要记录但成本记 0，否则看起来像流量凭空消失。配额做两档：软阈值（到 80% 告警）和硬阈值（到 100% 拒绝新请求但不打断在飞的流）。**硬阈值直接掐流的实现会让用户看到答案在半句话处断掉**，这是很糟的体验。

 

**可观测指标**：按后端分的成功率、p50/p95 延迟与 TTFT、429 率、熔断次数、重试率与重试后成功率、跨供应商降级次数、缓存命中率、每千次请求成本、各部门配额使用率。加一条容易漏的：**同一别名在不同后端上的输出质量差异**，靠定期跑 eval 集对比（第 5 题），否则降级会静默地把质量拉低而没有任何报警。

 

**追问「主力供应商开始返回 429，你的网关会不会把故障放大」**：会，而且这是最典型的自伤。放大路径是：429 触发重试 → 重试打在同一个后端 → 它更忙 → 更多 429 → 队列堆积 → 上游超时 → 上游也重试。四个措施：一是重试必须换后端并携带退避与抖动（`Retry-After` 头要读，供应商给了就用它，别用自己算的），二是熔断器在连续失败达到阈值后直接摘掉该后端，不再产生流量，三是重试预算——限制「重试请求数占总请求数的比例」不超过 10%，超了就宁可失败，四是负载脱落（load shedding）：队列深度超阈值时直接拒绝低优先级流量，保住交互式请求。**只做退避不做重试预算，是压不住这类雪崩的**，因为退避只拉长单个请求的间隔，并发数一样大。

# 面试 05 · 系统设计 + 手写题 > 设计评估流水线（离线 eval 集、线上抽样、回归防护、指标看板）

这道题真正在问的是：**你怎么知道改好了**。没有评估流水线的团队，改 prompt 靠试几条、上线靠感觉、回滚靠用户投诉——面试官问这题就是在找这个。

 

边界假设：一个 RAG 问答产品，离线集 300~1000 条，线上日请求 5 万条，每周改 2~3 次 prompt 或检索参数。这几个数换成你自己项目里的。

 

组件清单：

 

| 组件 | 职责 | 缺了的表现 |
| --- | --- | --- |
| 数据集仓库 | 版本化的 eval 集（问题、参考答案、必须命中的文档、标签） | 集合悄悄变了，两次分数不可比 |
| 运行器 | 固定采样参数批量跑，输出可复现的 run 记录 | 同一份集合两次跑分数不同，无法判断是改动还是噪声 |
| 评分器 | 分层：确定性规则 + 检索指标 + LLM-as-judge + 人工 | 只有总分，涨跌无法归因 |
| 线上抽样 | 按分层抽样落盘，脱敏后进标注队列 | eval 集越来越偏离真实分布 |
| 标注工具 | 人工打标、仲裁分歧、回流成新用例 | 标注在表格里传，无法追溯 |
| 回归门禁 | CI 里跑核心子集，不达标阻断合并 | 上线后才发现回退 |
| 看板 | 按版本、按标签、按分层看趋势 | 只知道总分动了，不知道哪类问题坏了 |

 

**分层评分是关键**，因为 RAG 是流水线，总分下降必须能定位到段：

 

1. **检索层**：Recall@k、MRR、命中必须文档的比例。这层是确定性的、便宜的，每次改切分或检索参数都该跑
2. **生成层的确定性检查**：JSON 是否合法、引用编号是否都存在、是否出现禁用词、拒答该拒的有没有拒。这些是规则，不需要模型
3. **生成层的语义评分**：忠实度（答案是否只用了给定上下文）、相关性、完整性。用 LLM-as-judge，但要认它的局限（`04-ai.md` 第 21 题）——judge 有位置偏好和长度偏好，要做位置轮换，并且用一小批人工标注定期校准 judge 与人的一致率
4. **人工**：只投在 judge 和人分歧大的、以及新出现的失败类型上

 

**离线 + 线上双轨**：离线集保证「已知问题不退化」，线上抽样保证「集合还代表真实用户」。抽样不能纯随机，要分层：按业务模块、按是否拒答、按用户反馈（👎 优先全采）、按检索得分低分段。**纯随机抽样的问题是低频但严重的失败类型永远抽不到**，比如权限越权只占 0.1%，随机抽 200 条一条都碰不上。

 

**回归防护**（面试官最想听的部分）：

 

- 每次改动（prompt、模型、检索参数、切分策略）都是一个可命名的版本，跑同一份集合，产出对比报告：总分、分层分、**以及逐条 diff**
- 门禁看两个东西：核心子集的绝对分数不低于基线，以及**「原来对现在错」的条数**。平均分持平但换了一批错题，是最容易被漏掉的回归——总分看不出来，用户能看出来
- 分类型设阈值：安全类用例必须 100% 通过（一条都不能退），质量类允许小幅波动
- 灰度上线配合线上指标：新版本先接 5% 流量，比对 👎 率、拒答率、复制率、TTFT 和成本，指标没劣化才放量（`04-ai.md` 第 23 题）

 

**成本与耗时**要主动说：1000 条 × 每条 1 次生成 + 1 次 judge，大约 2000 次调用，几分钟到几十分钟、几美元到几十美元。所以 CI 门禁只跑 100~200 条的核心子集，全量集合按天跑或在 release 前跑。**把全量集合放进每个 PR 的 CI，结果是大家嫌慢开始跳过它**，门禁形同虚设。

 

**可观测指标**（看板要按版本切）：分层分数趋势、原对现错/原错现对的条数、judge 与人工一致率、线上 👎 率与拒答率、抽样中新失败类型的出现频率、每次评估的成本与耗时、eval 集覆盖度（每个业务模块有多少条用例）。

 

前端出身在这题上有个具体的加分点：**评估平台的界面和标注工具通常是 AI 团队最缺人做、做得最难看的部分**。逐条 diff 视图、批量标注快捷键、分歧仲裁流程、失败样例聚类展示——这些做好了能把标注效率提升几倍，而且是你能独立交付的（README 里说的差异化优势就是这个）。

 

**追问「eval 集跑出来分数涨了 3 个点，你敢不敢上线」**：不敢，先看三件事。一是**这 3 个点在噪声范围内吗**——同一版本跑两次的分差是多少？temperature 不为 0、judge 本身有随机性，1000 条集合上 2~3 分的波动很常见，要先测出噪声底噪（同版本跑 3 次取方差），涨幅不显著就等于没涨。二是**逐条 diff 里有没有原来对现在错的**，尤其安全和拒答类；总分涨 3 分但新错了 5 条越权用例，这个改动必须打回。三是**集合还代表现在的用户吗**——如果最近两周线上多了一类新问法而集合里没有，那分数涨在了旧分布上。三条都过了才灰度，灰度期间再看线上指标。能把「统计显著性 + 逐条 diff + 分布漂移」这三层说全，基本就把这道题答满了。

 

---

 

## 手写题（第 6-9 题）

 

四题统一用 TypeScript。理由是这四题考的都是异步控制流——并发、取消、背压、跨 chunk 缓冲——而这些正好是你日常在浏览器里手工处理过的东西，写的时候能顺带把事件循环和取消语义讲清楚。Python 的 `asyncio.Semaphore` 和 `httpx` 能把第 6、7 题写得更短，但短掉的恰好是面试官要看的手工控制部分。下面的代码都在 Node 22 上跑过（48 条断言全绿），不是伪代码。

# 面试 05 · 系统设计 + 手写题 > 手写带并发上限、超时和指数退避重试的批量 LLM 调用

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/05-design-coding.html#q6

先说为什么不用 `Promise.all` 分批。分批的写法是把 100 条切成 25 组每组 4 条，一组跑完再跑下一组——**每一组都会被组内最慢的那一个拖住**。LLM 调用的耗时长尾极重，同样的 prompt 有时 800ms 有时 12 秒，所以分批的实际吞吐接近「批数 × 最慢耗时」。100 条 4 并发，理论上 25 轮，实际经常跑成 25 × 12 秒 = 5 分钟，而信号量式的 worker 池只要 100 × 平均耗时 ÷ 4。

# 面试 05 · 系统设计 + 手写题 > 手写带并发上限、超时和指数退避重试的批量 LLM 调用

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/05-design-coding.html#q6

现象上怎么发现：给每条打日志看开始时间，分批的写法能看到明显的「一批全部在同一时刻开始」的台阶状分布，台阶之间有大段空窗——那段空窗就是三个 worker 在等第四个。

# 面试 05 · 系统设计 + 手写题 > 手写带并发上限、超时和指数退避重试的批量 LLM 调用

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/05-design-coding.html#q6

正确写法是固定数量的 worker 从共享游标上取任务，谁空出来谁取下一条，没有批次栅栏：

# 面试 05 · 系统设计 + 手写题 > 手写带并发上限、超时和指数退避重试的批量 LLM 调用

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/05-design-coding.html#q6（连续片段 1/4；代码需合并后阅读，不能单独运行）

前文：正确写法是固定数量的 worker 从共享游标上取任务，谁空出来谁取下一条，没有批次栅栏：

```ts
export type CallResult<T> =
  | { ok: true; index: number; value: T; attempts: number }
  | { ok: false; index: number; error: Error; attempts: number };

export interface BatchOptions {
  concurrency?: number;   // 同时在飞的请求数
  timeoutMs?: number;     // 单次尝试的超时，不是整批的
  maxAttempts?: number;   // 含首次，3 表示最多重试 2 次
  baseDelayMs?: number;
  maxDelayMs?: number;
  isRetryable?: (err: unknown) => boolean;
  signal?: AbortSignal;   // 调用方取消（用户关页面 / 上游超时）
  onProgress?: (done: number, total: number) => void;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('aborted'));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => { clearTimeout(t); reject(new Error('aborted')); },
      { once: true },
    );
  });
}

export function defaultIsRetryable(err: unknown): boolean {
  const e = err as { status?: number; name?: string; code?: string };
  if (e?.name === 'AbortError') return false;   // 主动取消不重试
  if (e?.name === 'TimeoutError') return true;
  if (typeof e?.status === 'number') {

```

# 面试 05 · 系统设计 + 手写题 > 手写带并发上限、超时和指数退避重试的批量 LLM 调用

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/05-design-coding.html#q6（连续片段 2/4；代码需合并后阅读，不能单独运行）

前文：正确写法是固定数量的 worker 从共享游标上取任务，谁空出来谁取下一条，没有批次栅栏：

```ts
    return e.status === 408 || e.status === 409 || e.status === 429 || e.status >= 500;
  }
  return e?.code === 'ECONNRESET' || e?.code === 'ETIMEDOUT' || e?.code === 'EAI_AGAIN';
}

export async function batchCall<I, O>(
  items: I[],
  fn: (item: I, ctx: { signal: AbortSignal; attempt: number }) => Promise<O>,
  opts: BatchOptions = {},
): Promise<CallResult<O>[]> {
  const {
    concurrency = 4, timeoutMs = 30_000, maxAttempts = 3,
    baseDelayMs = 500, maxDelayMs = 8_000,
    isRetryable = defaultIsRetryable, signal, onProgress,
  } = opts;

  const results = new Array<CallResult<O>>(items.length);
  let cursor = 0;
  let finished = 0;

  async function runOne(index: number): Promise<CallResult<O>> {
    let lastErr: unknown = new Error('never ran');
    let attempt = 0;
    while (attempt < maxAttempts) {
      // 先查再发：已取消就不要再进 fn。少了这一句，取消后排队的条目仍会发出请求，
      // 而且监听一个「已经 abort」的 signal 的回调永远不会触发 —— 表现为整批挂死
      if (signal?.aborted) {
        return { ok: false, index, attempts: attempt, error: new Error('aborted') };
      }
      attempt += 1;

```

# 面试 05 · 系统设计 + 手写题 > 手写带并发上限、超时和指数退避重试的批量 LLM 调用

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/05-design-coding.html#q6（连续片段 3/4；代码需合并后阅读，不能单独运行）

前文：正确写法是固定数量的 worker 从共享游标上取任务，谁空出来谁取下一条，没有批次栅栏：

```ts
      // 每次尝试新建超时信号：重试的钟从这次开始走，不继承上一次已耗掉的时间
      const timeout = AbortSignal.timeout(timeoutMs);
      const merged = signal ? AbortSignal.any([signal, timeout]) : timeout;
      try {
        const value = await fn(items[index], { signal: merged, attempt });
        return { ok: true, index, value, attempts: attempt };
      } catch (err) {
        lastErr = err;
        if (signal?.aborted) break;                        // 整批被取消
        if (attempt >= maxAttempts || !isRetryable(err)) break;
        const exp = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
        try {
          await sleep(Math.random() * exp, signal);        // full jitter
        } catch {
          break;   // 退避等待期间被取消：走失败返回，不要让异常冒到 Promise.all
        }
      }
    }
    return {
      ok: false, index, attempts: attempt,
      error: lastErr instanceof Error ? lastErr : new Error(String(lastErr)),
    };
  }

  // 信号量式 worker 池：谁先空出来谁取下一条，没有批次栅栏
  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, items.length)) },
    async () => {
      for (;;) {
        const index = cursor++;
        if (index >= items.length) return;

```

# 面试 05 · 系统设计 + 手写题 > 手写带并发上限、超时和指数退避重试的批量 LLM 调用

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/05-design-coding.html#q6（连续片段 4/4；代码需合并后阅读，不能单独运行）

前文：正确写法是固定数量的 worker 从共享游标上取任务，谁空出来谁取下一条，没有批次栅栏：

```ts
        results[index] = await runOne(index);
        onProgress?.(++finished, items.length);
      }
    },
  );
  await Promise.all(workers);   // worker 自己吞掉了异常，这里不会因单条失败整批 reject
  return results;
}

```

# 面试 05 · 系统设计 + 手写题 > 手写带并发上限、超时和指数退避重试的批量 LLM 调用

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/05-design-coding.html#q6

调用方长这样，注意超时信号必须透传进 `fetch`，否则超时只是让你的 Promise 提前 reject，请求本身还在跑、还在计费：

# 面试 05 · 系统设计 + 手写题 > 手写带并发上限、超时和指数退避重试的批量 LLM 调用

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/05-design-coding.html#q6

前文：调用方长这样，注意超时信号必须透传进 `fetch`，否则超时只是让你的 Promise 提前 reject，请求本身还在跑、还在计费：

```ts
const results = await batchCall(prompts, async (prompt, { signal }) => {
  const res = await fetch('https://gateway.internal/v1/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'chat-default', messages: [{ role: 'user', content: prompt }] }),
    signal,                                  // 关键：让超时真的掐掉连接
  });
  if (!res.ok) throw Object.assign(new Error(await res.text()), { status: res.status });
  return (await res.json()) as { text: string };
}, { concurrency: 4, timeoutMs: 20_000, maxAttempts: 3 });

const failed = results.filter((r) => !r.ok);

```

# 面试 05 · 系统设计 + 手写题 > 手写带并发上限、超时和指数退避重试的批量 LLM 调用

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/05-design-coding.html#q6

设计要点，每条都对应一个能观察到的故障：

# 面试 05 · 系统设计 + 手写题 > 手写带并发上限、超时和指数退避重试的批量 LLM 调用

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/05-design-coding.html#q6

前文：设计要点，每条都对应一个能观察到的故障：

- **返回 `CallResult[]` 而不是 throw**：批量任务里一条失败不该毁掉另外 99 条的结果。用 `Promise.all` 直接 await 一批 promise，第一个 reject 就丢掉全部已完成的成功结果——现象是「99 条成功的活白干了，日志里只有一条错误」
- **超时是每次尝试的，不是整批的**：`AbortSignal.timeout` 每次重试重新创建。用同一个超时信号跑三次重试，第二次开始就必然立刻超时
- **`isRetryable` 白名单式判断**：400 参数错重试三次只是把同一个错误发三遍，还浪费三倍配额；429 和 5xx 才值得重
- **full jitter**（`Math.random() * exp` 而不是固定 `exp`）：所有失败的请求同时退避同样的时间，会在同一毫秒一起重发，等于自己造了一次尖峰。生产上这表现为 429 一波接一波、间隔正好等于退避时间
- **进度回调**：批量任务跑几分钟没有任何输出，人会以为它挂了

# 面试 05 · 系统设计 + 手写题 > 手写带并发上限、超时和指数退避重试的批量 LLM 调用

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/05-design-coding.html#q6

`AbortSignal.timeout()` 和 `AbortSignal.any()` 都已是稳定 API（Node 从 20.3 / 18.17 起、浏览器侧 `any()` 自 2024-03 起在各主流浏览器可用；2026-09 核实）。两个使用上的坑：Node 曾有一个 `AbortSignal.any([AbortSignal.timeout(x)])` 概率性不触发超时的 bug，2025-04 修掉了，老版本上如果发现超时偶发不生效，先升 Node 再怀疑自己的代码；另外 `AbortSignal.timeout` 的定时器是 unref 的，纯内存的单元测试里如果事件循环没有别的任务，进程会在超时触发前直接退出——真实场景有 `fetch` 撑着不会遇到，写测试时要自己加一个 keepalive。

# 面试 05 · 系统设计 + 手写题 > 手写带并发上限、超时和指数退避重试的批量 LLM 调用

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/05-design-coding.html#q6

**追问「一百条里有三条永久失败，你把它们怎么办」**：不能吞掉，也不能整批失败。分三步：一是把失败条目连同 `index`、`attempts`、最后一个错误一起返回，调用方能精确知道是哪三条——这就是为什么返回值里带 `index` 而不是只返回成功列表；二是分类处理，参数类错误（400、schema 不合法）进人工队列，因为重试再多次也不会变好；配额类错误（429 耗尽、余额不足）整批暂停并告警，继续跑只会全挂；三是**失败条目要落库成可重放的任务**，带原始输入和幂等键（第 3 题），而不是只写一行日志——不然「哪三条失败了」这个信息在进程退出后就没了。另外补一条监控：批量任务要上报「成功数 / 失败数 / 平均尝试次数」，平均尝试次数从 1.05 涨到 2.3 是上游开始不稳的最早信号，比 5xx 报警更提前。

# 面试 05 · 系统设计 + 手写题 > 手写 SSE 流式响应解析器（处理分片、跨 chunk 的半行、[DONE] 终止、错误帧）

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/05-design-coding.html#q7

这题的核心是一句话：**一个 SSE data 行可能被 TCP 分片切成两半，必须用缓冲区跨 chunk 拼接**。

# 面试 05 · 系统设计 + 手写题 > 手写 SSE 流式响应解析器（处理分片、跨 chunk 的半行、[DONE] 终止、错误帧）

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/05-design-coding.html#q7

翻车的写法长这样，几乎每个人第一版都是它：

# 面试 05 · 系统设计 + 手写题 > 手写 SSE 流式响应解析器（处理分片、跨 chunk 的半行、[DONE] 终止、错误帧）

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/05-design-coding.html#q7

前文：翻车的写法长这样，几乎每个人第一版都是它：

```ts
// 错误示范
for await (const chunk of stream) {
  for (const line of new TextDecoder().decode(chunk).split('\n')) {
    if (line.startsWith('data: ')) handle(JSON.parse(line.slice(6)));
  }
}

```

# 面试 05 · 系统设计 + 手写题 > 手写 SSE 流式响应解析器（处理分片、跨 chunk 的半行、[DONE] 终止、错误帧）

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/05-design-coding.html#q7

它在本地必错、但错得很隐蔽：网络把 `data: {"delta":"你好"}\n\n` 切成 `data: {"delta":"你` 和 `好"}\n\n` 两个 chunk，第一半 `JSON.parse` 抛异常、第二半连 `data:` 前缀都没有被整条丢掉。**现象是：内网/本地开发一切正常（chunk 大、一次到齐），上了生产偶发丢字或者控制台一堆 JSON 解析错误，而且越长的回答越容易出现**——因为 chunk 越多、被切中的概率越高。

# 面试 05 · 系统设计 + 手写题 > 手写 SSE 流式响应解析器（处理分片、跨 chunk 的半行、[DONE] 终止、错误帧）

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/05-design-coding.html#q7

第二个坑更隐蔽：`new TextDecoder().decode(chunk)` 不带 `{ stream: true }`，一个 UTF-8 中文字占 3 字节，被切在字节边界上会解出 `�`（U+FFFD），而且**这个损坏是不可逆的**，后面再拼也救不回来。表现是中文回答里随机出现替换字符，英文回答完全正常，所以很容易被误判成「模型输出问题」。

# 面试 05 · 系统设计 + 手写题 > 手写 SSE 流式响应解析器（处理分片、跨 chunk 的半行、[DONE] 终止、错误帧）

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/05-design-coding.html#q7

正确实现：解码器保留半个字符，行缓冲区保留半行，两级缓冲都要有。

# 面试 05 · 系统设计 + 手写题 > 手写 SSE 流式响应解析器（处理分片、跨 chunk 的半行、[DONE] 终止、错误帧）

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/05-design-coding.html#q7（连续片段 1/4；代码需合并后阅读，不能单独运行）

前文：正确实现：解码器保留半个字符，行缓冲区保留半行，两级缓冲都要有。

```ts
export interface SSEEvent {
  event: string;      // 没有 event: 字段时按规范默认 'message'
  data: string;       // 多个 data: 行用 \n 连接
  id?: string;
  retry?: number;
}

export class SSEDecoder {
  private buf = '';
  // stream: true 让解码器保留不完整的 UTF-8 尾字节，
  // 否则一个中文字被 TCP 切成两半会解出 U+FFFD
  private readonly decoder = new TextDecoder('utf-8');
  private data: string[] = [];
  private eventName = '';
  private lastId: string | undefined;
  private retry: number | undefined;

  /** 喂一个网络 chunk，返回这批数据里已经完整的事件 */
  push(chunk: Uint8Array | string): SSEEvent[] {
    this.buf += typeof chunk === 'string'
      ? chunk
      : this.decoder.decode(chunk, { stream: true });
    return this.drain();
  }

  /** 流结束时调用：处理最后一行没有换行符收尾的情况 */
  flush(): SSEEvent[] {
    this.buf += this.decoder.decode();
    const out = this.drain();
    if (this.buf.length > 0) {
      const tail = this.buf;
      this.buf = '';
      out.push(...this.consumeLine(tail));
    }
    const last = this.dispatch();
    if (last) out.push(last);
    return out;
  }


```

# 面试 05 · 系统设计 + 手写题 > 手写 SSE 流式响应解析器（处理分片、跨 chunk 的半行、[DONE] 终止、错误帧）

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/05-design-coding.html#q7（连续片段 2/4；代码需合并后阅读，不能单独运行）

前文：正确实现：解码器保留半个字符，行缓冲区保留半行，两级缓冲都要有。

```ts
  private drain(): SSEEvent[] {
    const out: SSEEvent[] = [];
    // 只处理已经看到换行的部分；剩下的半行留在 buf 里等下一个 chunk
    for (;;) {
      const nl = this.buf.search(/\r\n|\r|\n/);
      if (nl === -1) break;
      const line = this.buf.slice(0, nl);
      const sepLen = this.buf.startsWith('\r\n', nl) ? 2 : 1;
      this.buf = this.buf.slice(nl + sepLen);
      out.push(...this.consumeLine(line));
    }
    return out;
  }

  private consumeLine(line: string): SSEEvent[] {
    if (line === '') {                       // 空行 = 一个事件结束
      const ev = this.dispatch();
      return ev ? [ev] : [];
    }
    if (line.startsWith(':')) return [];     // 注释 / 心跳，丢掉但别当错误

    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);   // 规范只吃一个空格

    switch (field) {
      case 'event': this.eventName = value; break;
      case 'data': this.data.push(value); break;

```

# 面试 05 · 系统设计 + 手写题 > 手写 SSE 流式响应解析器（处理分片、跨 chunk 的半行、[DONE] 终止、错误帧）

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/05-design-coding.html#q7（连续片段 3/4；代码需合并后阅读，不能单独运行）

前文：正确实现：解码器保留半个字符，行缓冲区保留半行，两级缓冲都要有。

```ts
      case 'id': if (!value.includes('\0')) this.lastId = value; break;
      case 'retry': if (/^\d+$/.test(value)) this.retry = Number(value); break;
      default: break;                        // 未知字段按规范忽略
    }
    return [];
  }

  private dispatch(): SSEEvent | null {
    if (this.data.length === 0 && this.eventName === '') return null;
    const ev: SSEEvent = {
      event: this.eventName || 'message',
      data: this.data.join('\n'),
      id: this.lastId,
      retry: this.retry,
    };
    this.data = [];
    this.eventName = '';
    return ev;
  }

  /** 断连重连时带上，服务端用它续传（第 2 题） */
  get lastEventId(): string | undefined { return this.lastId; }
}

export class SSEStreamError extends Error {
  constructor(message: string, readonly frame?: SSEEvent) {
    super(message);
    this.name = 'SSEStreamError';
  }
}

/** 把 fetch 的 body 变成事件流；遇到 [DONE] 正常结束，遇到错误帧抛出 */
export async function* parseSSE(
  body: ReadableStream<Uint8Array>,
  opts: { doneToken?: string } = {},
): AsyncGenerator<SSEEvent, void, void> {
  const doneToken = opts.doneToken ?? '[DONE]';
  const decoder = new SSEDecoder();
  const reader = body.getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();

```

# 面试 05 · 系统设计 + 手写题 > 手写 SSE 流式响应解析器（处理分片、跨 chunk 的半行、[DONE] 终止、错误帧）

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/05-design-coding.html#q7（连续片段 4/4；代码需合并后阅读，不能单独运行）

前文：正确实现：解码器保留半个字符，行缓冲区保留半行，两级缓冲都要有。

```ts
      const events = done ? decoder.flush() : decoder.push(value!);
      for (const ev of events) {
        if (ev.data === doneToken) return;              // 终止哨兵，不是数据
        if (ev.event === 'error') {
          throw new SSEStreamError(ev.data || 'upstream error', ev);
        }
        // 有些网关在 200 的流里塞 {"error": {...}} 当数据帧
        if (ev.data.startsWith('{')) {
          try {
            const j = JSON.parse(ev.data) as { error?: { message?: string } };
            if (j.error) throw new SSEStreamError(j.error.message ?? 'upstream error', ev);
          } catch (e) {
            if (e instanceof SSEStreamError) throw e;   // 解析失败就当普通数据放行
          }
        }
        yield ev;
      }
      if (done) return;
    }
  } finally {
    reader.releaseLock();
  }
}

```

# 面试 05 · 系统设计 + 手写题 > 手写 SSE 流式响应解析器（处理分片、跨 chunk 的半行、[DONE] 终止、错误帧）

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/05-design-coding.html#q7

用法（浏览器和 Node 22 都能跑，`response.body` 的异步迭代在 Safari 直到 26.4 才支持，所以这里统一用 `getReader()` 而不是 `for await (const c of body)`——2026-09 核实）：

# 面试 05 · 系统设计 + 手写题 > 手写 SSE 流式响应解析器（处理分片、跨 chunk 的半行、[DONE] 终止、错误帧）

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/05-design-coding.html#q7

前文：用法（浏览器和 Node 22 都能跑，`response.body` 的异步迭代在 Safari 直到 26.4 才支持，所以这里统一用 `getReader()` 而不是 `for await (const c of body)`——2026-09 核实）：

```ts
const res = await fetch('/api/chat', { method: 'POST', body, signal: ac.signal });
if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
let text = '';
for await (const ev of parseSSE(res.body)) {
  const delta = JSON.parse(ev.data) as { delta?: string };
  text += delta.delta ?? '';
  render(text);                       // 渲染要节流，见下方说明
}

```

# 面试 05 · 系统设计 + 手写题 > 手写 SSE 流式响应解析器（处理分片、跨 chunk 的半行、[DONE] 终止、错误帧）

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/05-design-coding.html#q7

流式渲染的节流和 Markdown 闪烁问题见 `01-frontend.md` 第 14 题，这里只管解析。

# 面试 05 · 系统设计 + 手写题 > 手写 SSE 流式响应解析器（处理分片、跨 chunk 的半行、[DONE] 终止、错误帧）

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/05-design-coding.html#q7

其余五个边界，每个都有对应的线上现象：

# 面试 05 · 系统设计 + 手写题 > 手写 SSE 流式响应解析器（处理分片、跨 chunk 的半行、[DONE] 终止、错误帧）

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/05-design-coding.html#q7

前文：其余五个边界，每个都有对应的线上现象：

- **`[DONE]` 是哨兵不是数据**：不拦掉的话界面上会多出一行字面的 `[DONE]`
- **注释行（以 `:` 开头）**：很多网关每 15 秒发一个 `: keep-alive` 防中间层断连，当成数据会 JSON 解析失败
- **`event: error` 帧**：HTTP 状态码已经是 200 了，错误只能从流里来。不处理的表现是流静默结束、答案缺一截、前端毫无报错
- **多个 `data:` 行属于同一个事件**：按规范用 `\n` 连接，各自解析会把一个 JSON 拆成两个残片
- **流结束时最后一帧没有空行收尾**：必须 `flush()`，否则最后一个事件永远不吐——现象是每次回答都恰好少最后一小段

# 面试 05 · 系统设计 + 手写题 > 手写 SSE 流式响应解析器（处理分片、跨 chunk 的半行、[DONE] 终止、错误帧）

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/05-design-coding.html#q7

**追问「怎么验证你的解析器真的处理了分片，而不是恰好没被切到」**：不能靠打开线上页面看，那是概率问题。要主动构造：把一段完整的 SSE 响应编成字节数组，然后**逐字节**喂进 `SSEDecoder`（`for (let i = 0; i < bytes.length; i++) d.push(bytes.slice(i, i + 1))`），结果必须和一次性喂完全相同——这是最强的分片测试，一字节一喂能覆盖所有可能的切点。再单独构造一个中文字被切在第 2 个字节的用例，断言输出里不含 `\uFFFD`。上面这份实现就是这么测的：48 条断言里专门有「半行拼接」、「多字节字符被切开」、「逐字节喂 = 一次性喂」、「`\r\n` 分隔」、「结尾无空行」五组。补一条生产侧的验证：统计「解析失败的帧数 / 总帧数」并打点，这个数长期为 0 才说明解析器是对的；只看用户没投诉不算验证，丢一两个字用户通常不会报。

# 面试 05 · 系统设计 + 手写题 > 手写上下文裁剪：给定 token 预算，保留 system 与最近 N 轮，中间做摘要占位

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/05-design-coding.html#q8

裁剪的顺序决定了对话质量。优先级从高到低：**system \> 当前这一轮 \> 最近 N 轮 \> 摘要占位 \> 更早的完整历史**。三个必须先说清的判断：

# 面试 05 · 系统设计 + 手写题 > 手写上下文裁剪：给定 token 预算，保留 system 与最近 N 轮，中间做摘要占位

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/05-design-coding.html#q8

前文：裁剪的顺序决定了对话质量。优先级从高到低：**system \> 当前这一轮 \> 最近 N 轮 \> 摘要占位 \> 更早的完整历史**。三个必须先说清的判断：

- **system 只能截断，不能丢**。丢了 system 的现象非常具体：同一个问题模型突然改用英文回答、拒答规则失效、自称是另一个身份，而日志里没有任何报错——因为请求是成功的
- **当前这一轮的最后一条 user 消息永远不能丢**，否则模型在回答上一个问题
- **不能按字符数比例砍**。中文 1 字约 1 token、英文约 4 字符 1 token，同一个比例在纯中文文本上会算出 2 倍的预算，砍完仍然超，然后你会看到「明明裁剪过了还是 400 context length exceeded」

# 面试 05 · 系统设计 + 手写题 > 手写上下文裁剪：给定 token 预算，保留 system 与最近 N 轮，中间做摘要占位

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/05-design-coding.html#q8（连续片段 1/6；代码需合并后阅读，不能单独运行）

前文：裁剪的顺序决定了对话质量。优先级从高到低：**system \> 当前这一轮 \> 最近 N 轮 \> 摘要占位 \> 更早的完整历史**。三个必须先说清的判断：

```ts
export type Role = 'system' | 'user' | 'assistant' | 'tool';
export interface Msg { role: Role; content: string; name?: string }

export interface TrimOptions {
  budget: number;                       // 留给输入的 token 数，已扣掉输出预留
  keepRecentTurns?: number;             // 一轮 = 一条 user 到下一条 user 之前的全部消息
  countTokens?: (m: Msg) => number;
  summarize?: (dropped: Msg[]) => string;
  perMessageOverhead?: number;          // 每条消息的固定包装开销
  minTailChars?: number;                // 当前问题至少保留多少字符，宁可超预算也不截空
}

export interface TrimResult {
  messages: Msg[];
  tokens: number;
  droppedTurns: number;
  summaryInserted: boolean;
  systemTruncated: boolean;
  budgetExceeded: boolean;              // true = 装不下，调用方必须降级而不是硬发
}

/** 粗估，别用它计费。上线换 tokenizer：JS 侧 js-tiktoken / gpt-tokenizer，Python 侧 tiktoken */
export function roughTokens(m: Msg): number {
  let ascii = 0, wide = 0;
  for (const ch of m.content) (ch.codePointAt(0)! > 0x2e80 ? wide++ : ascii++);
  return Math.ceil(ascii / 4) + wide;   // CJK 约 1 字 1 token，英文约 4 字符 1 token
}


```

# 面试 05 · 系统设计 + 手写题 > 手写上下文裁剪：给定 token 预算，保留 system 与最近 N 轮，中间做摘要占位

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/05-design-coding.html#q8（连续片段 2/6；代码需合并后阅读，不能单独运行）

前文：裁剪的顺序决定了对话质量。优先级从高到低：**system \> 当前这一轮 \> 最近 N 轮 \> 摘要占位 \> 更早的完整历史**。三个必须先说清的判断：

```ts
/** 按 user 消息切分轮次；system 单独拎出来 */
export function splitTurns(msgs: Msg[]): { system: Msg[]; turns: Msg[][] } {
  const system = msgs.filter((m) => m.role === 'system');
  const rest = msgs.filter((m) => m.role !== 'system');
  const turns: Msg[][] = [];
  for (const m of rest) {
    if (m.role === 'user' || turns.length === 0) turns.push([m]);
    else turns[turns.length - 1].push(m);
  }
  return { system, turns };
}

/** 二分查找能塞进 maxTokens 的最长前缀，避免按字符比例误算 */
export function truncateToTokens(
  m: Msg, maxTokens: number,
  countTokens: (m: Msg) => number = roughTokens,
  minChars = 0,
): Msg {
  if (maxTokens <= 0) return { ...m, content: m.content.slice(0, minChars) };
  if (countTokens(m) <= maxTokens) return m;
  let lo = 0, hi = m.content.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (countTokens({ ...m, content: m.content.slice(0, mid) }) <= maxTokens) lo = mid;

```

# 面试 05 · 系统设计 + 手写题 > 手写上下文裁剪：给定 token 预算，保留 system 与最近 N 轮，中间做摘要占位

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/05-design-coding.html#q8（连续片段 3/6；代码需合并后阅读，不能单独运行）

前文：裁剪的顺序决定了对话质量。优先级从高到低：**system \> 当前这一轮 \> 最近 N 轮 \> 摘要占位 \> 更早的完整历史**。三个必须先说清的判断：

```ts
    else hi = mid - 1;
  }
  const keep = Math.max(lo, Math.min(m.content.length, minChars));
  return { ...m, content: m.content.slice(0, keep) + (keep < m.content.length ? '…' : '') };
}

export function trimContext(msgs: Msg[], opts: TrimOptions): TrimResult {
  const {
    budget,
    keepRecentTurns = 3,
    countTokens = roughTokens,
    perMessageOverhead = 4,
    minTailChars = 200,
    summarize = (d) => `[早期对话摘要占位：省略 ${d.length} 条消息]`,
  } = opts;

  const cost = (m: Msg) => countTokens(m) + perMessageOverhead;
  const sum = (ms: Msg[]) => ms.reduce((a, m) => a + cost(m), 0);

  const { system, turns } = splitTurns(msgs);

  // 全都装得下就原样返回。少这一步会给未超预算的会话也插一条摘要占位，
  // 现象是短对话里模型莫名回复「根据之前的摘要」
  if (sum(msgs) <= budget) {
    return { messages: msgs, tokens: sum(msgs), droppedTurns: 0,
      summaryInserted: false, systemTruncated: false, budgetExceeded: false };
  }

  let sys = system;
  let systemTruncated = false;
  if (sum(sys) > budget) {

```

# 面试 05 · 系统设计 + 手写题 > 手写上下文裁剪：给定 token 预算，保留 system 与最近 N 轮，中间做摘要占位

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/05-design-coding.html#q8（连续片段 4/6；代码需合并后阅读，不能单独运行）

前文：裁剪的顺序决定了对话质量。优先级从高到低：**system \> 当前这一轮 \> 最近 N 轮 \> 摘要占位 \> 更早的完整历史**。三个必须先说清的判断：

```ts
    const cap = Math.max(1, Math.floor(budget * 0.6));
    const per = Math.max(1, Math.floor(cap / sys.length)) - perMessageOverhead;
    sys = sys.map((s) => truncateToTokens(s, per, countTokens));
    systemTruncated = true;
  }
  const systemCost = sum(sys);

  const recent = turns.slice(Math.max(0, turns.length - keepRecentTurns)).map((t) => [...t]);
  const older = turns.slice(0, Math.max(0, turns.length - keepRecentTurns));

  // 最近几轮自己就超预算：从最老的一轮开始丢，当前这一轮永不丢
  const kept = recent;
  let droppedTurns = 0;
  let used = systemCost + sum(kept.flat());
  while (used > budget && kept.length > 1) {
    used -= sum(kept.shift()!);
    droppedTurns += 1;
  }

  // 只剩一轮还超：截这一轮里最长的那条，但给当前问题留 minTailChars 的底
  if (used > budget && kept.length === 1) {
    const turn = kept[0];
    let idx = 0;

```

# 面试 05 · 系统设计 + 手写题 > 手写上下文裁剪：给定 token 预算，保留 system 与最近 N 轮，中间做摘要占位

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/05-design-coding.html#q8（连续片段 5/6；代码需合并后阅读，不能单独运行）

前文：裁剪的顺序决定了对话质量。优先级从高到低：**system \> 当前这一轮 \> 最近 N 轮 \> 摘要占位 \> 更早的完整历史**。三个必须先说清的判断：

```ts
    for (let i = 1; i < turn.length; i++) if (cost(turn[i]) > cost(turn[idx])) idx = i;
    const others = used - cost(turn[idx]);
    turn[idx] = truncateToTokens(
      turn[idx], budget - others - perMessageOverhead, countTokens, minTailChars,
    );
    used = systemCost + sum(kept.flat());
  }

  // 剩余额度：先放摘要占位，再从新到旧回填完整的老轮次
  let summaryInserted = false;
  const backfilled: Msg[][] = [];
  if (older.length > 0) {
    const summaryMsg: Msg = {
      role: 'system', name: 'history_summary', content: summarize(older.flat()),
    };
    if (used + cost(summaryMsg) <= budget) {
      used += cost(summaryMsg);
      summaryInserted = true;
      for (let i = older.length - 1; i >= 0; i--) {
        if (used + sum(older[i]) > budget) break;
        used += sum(older[i]);
        backfilled.unshift(older[i]);
      }
      sys = [...sys, summaryMsg];
    }
    droppedTurns += older.length - backfilled.length;
  }


```

# 面试 05 · 系统设计 + 手写题 > 手写上下文裁剪：给定 token 预算，保留 system 与最近 N 轮，中间做摘要占位

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/05-design-coding.html#q8（连续片段 6/6；代码需合并后阅读，不能单独运行）

前文：裁剪的顺序决定了对话质量。优先级从高到低：**system \> 当前这一轮 \> 最近 N 轮 \> 摘要占位 \> 更早的完整历史**。三个必须先说清的判断：

```ts
  const messages = [...sys, ...backfilled.flat(), ...kept.flat()];
  return {
    messages, tokens: sum(messages), droppedTurns, summaryInserted, systemTruncated,
    budgetExceeded: sum(messages) > budget,
  };
}

```

# 面试 05 · 系统设计 + 手写题 > 手写上下文裁剪：给定 token 预算，保留 system 与最近 N 轮，中间做摘要占位

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/05-design-coding.html#q8

摘要要调模型，所以真实用法是把摘要生成挪到外面并缓存，否则每一轮都重新摘要一次，成本比不裁剪还高：

# 面试 05 · 系统设计 + 手写题 > 手写上下文裁剪：给定 token 预算，保留 system 与最近 N 轮，中间做摘要占位

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/05-design-coding.html#q8

前文：摘要要调模型，所以真实用法是把摘要生成挪到外面并缓存，否则每一轮都重新摘要一次，成本比不裁剪还高：

```ts
export async function trimContextAsync(
  msgs: Msg[],
  opts: Omit<TrimOptions, 'summarize'> & {
    summarizeAsync: (dropped: Msg[]) => Promise<string>;
    cache?: Map<string, string>;          // 挂在会话上，按被摘的轮数做 key
  },
): Promise<TrimResult> {
  const { turns } = splitTurns(msgs);
  const older = turns.slice(0, Math.max(0, turns.length - (opts.keepRecentTurns ?? 3))).flat();
  let text = '';
  if (older.length > 0) {
    const key = `${older.length}:${older[older.length - 1]!.content.slice(0, 32)}`;
    text = opts.cache?.get(key) ?? await opts.summarizeAsync(older);
    opts.cache?.set(key, text);
  }
  return trimContext(msgs, { ...opts, summarize: () => text });
}

```

# 面试 05 · 系统设计 + 手写题 > 手写上下文裁剪：给定 token 预算，保留 system 与最近 N 轮，中间做摘要占位

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/05-design-coding.html#q8

几个容易漏的点，都对应具体故障：

# 面试 05 · 系统设计 + 手写题 > 手写上下文裁剪：给定 token 预算，保留 system 与最近 N 轮，中间做摘要占位

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/05-design-coding.html#q8

前文：几个容易漏的点，都对应具体故障：

- **`budget` 是输入预算，不是上下文窗口**。要先扣掉 `max_tokens` 的输出预留和检索结果占的位置。直接拿窗口大小当预算，表现是短问题都正常、长回答的请求偶发 400，因为输入加输出超了窗口
- **`perMessageOverhead`**：每条消息在 chat 模板里有角色标记等固定开销，几十条消息累起来上百 token。不算它的话估算会系统性偏低，卡在预算边缘时必然超
- **返回 `budgetExceeded`**：装不下时调用方要能知道，然后走降级（减少检索条数、换长上下文模型、提示用户开新会话），而不是硬发出去等 400
- **摘要占位放在 system 之后、历史之前**，并带 `name` 标记来源，让模型知道这是压缩过的历史而不是用户说的话

# 面试 05 · 系统设计 + 手写题 > 手写上下文裁剪：给定 token 预算，保留 system 与最近 N 轮，中间做摘要占位

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/05-design-coding.html#q8

**追问「摘要本身也会丢信息，用户问『我刚才第一个问题问的什么』你怎么答」**：直说这个方案答不了，然后给补救。摘要是有损的，指代类问题（第一个问题、刚才那个数字、上面那段代码）恰好依赖被摘掉的原文。两个手段：一是**摘要时保留结构性锚点**——每轮的首句和实体名（人名、订单号、文件名）原样抄进摘要，只压缩解释性内容，因为指代问题问的几乎都是这些锚点；二是**把完整历史留在存储里，给模型一个 `search_history` 工具**，被问到时按需检索回来，而不是全塞进上下文——这本质上是把会话历史也 RAG 化，是长会话的正确解法。另外一个工程上的兜底：摘要占位里明确写「早期 N 轮已压缩，需要原文请调用 search\_history」，这样模型不会硬编，而是会去查或者告诉用户它看不到了。**能说出「有损是设计选择、代价是指代失败、补救是工具而不是更大的窗口」这条链，比背裁剪算法有价值得多。**

# 面试 05 · 系统设计 + 手写题 > 手写多路检索结果的 RRF 融合与去重

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/05-design-coding.html#q9

RRF（Reciprocal Rank Fusion）只用名次不用分数，这是它比加权求和好用的唯一理由：向量检索的余弦相似度在 0.7~0.9 之间挤成一团，BM25 的分数是 0 到几十的开区间，两者**量纲不同、分布不同**，直接加权相加等于让 BM25 一个人说话。归一化也不靠谱，因为每次查询的分数范围都不一样——现象是同一套权重在一批查询上很好、换一批就明显偏向某一路。

# 面试 05 · 系统设计 + 手写题 > 手写多路检索结果的 RRF 融合与去重

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/05-design-coding.html#q9

公式：`score(d) = Σ_i w_i / (k + rank_i(d))`，`k` 取 60（原论文值），作用是压制头部名次的差距，让「两路都排中间」胜过「一路第一、另一路没有」。

# 面试 05 · 系统设计 + 手写题 > 手写多路检索结果的 RRF 融合与去重

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/05-design-coding.html#q9（连续片段 1/4；代码需合并后阅读，不能单独运行）

前文：公式：`score(d) = Σ_i w_i / (k + rank_i(d))`，`k` 取 60（原论文值），作用是压制头部名次的差距，让「两路都排中间」胜过「一路第一、另一路没有」。

```ts
export interface Hit {
  id: string;             // 稳定的 chunk id
  text: string;
  score?: number;         // 各路的原始分，量纲不同，RRF 只用名次
  docId?: string;
  source?: string;
}

export interface RRFOptions {
  k?: number;             // 平滑常数，原论文 60
  weights?: number[];     // 每一路的权重，长度与 lists 对齐
  topK?: number;
  dedupeKey?: (h: Hit) => string;
  perDocLimit?: number;   // 同一文档最多进多少个 chunk
  nearDupThreshold?: number;  // 文本 3-gram Jaccard 阈值，0 关闭
}

export interface FusedHit extends Hit {
  rrf: number;
  ranks: (number | null)[];   // 每一路里的名次（1-based），未命中为 null
  listsHit: number;
}

const norm = (s: string) =>
  s.replace(/\s+/g, ' ').replace(/[，。、；：！？,.;:!?"'`]/g, '').trim().toLowerCase();

export function trigrams(s: string): Set<string> {
  const t = norm(s);
  const out = new Set<string>();
  for (let i = 0; i + 3 <= t.length; i++) out.add(t.slice(i, i + 3));
  return out;
}


```

# 面试 05 · 系统设计 + 手写题 > 手写多路检索结果的 RRF 融合与去重

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/05-design-coding.html#q9（连续片段 2/4；代码需合并后阅读，不能单独运行）

前文：公式：`score(d) = Σ_i w_i / (k + rank_i(d))`，`k` 取 60（原论文值），作用是压制头部名次的差距，让「两路都排中间」胜过「一路第一、另一路没有」。

```ts
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  for (const g of small) if (big.has(g)) inter++;
  return inter / (a.size + b.size - inter);
}

export function rrfFuse(lists: Hit[][], opts: RRFOptions = {}): FusedHit[] {
  const {
    k = 60, topK = 20, weights = lists.map(() => 1),
    dedupeKey = (h) => h.id,
    perDocLimit = Infinity, nearDupThreshold = 0,
  } = opts;

  const acc = new Map<string, FusedHit>();
  lists.forEach((list, li) => {
    const w = weights[li] ?? 1;
    const seenInList = new Set<string>();
    list.forEach((hit, i) => {
      const key = dedupeKey(hit);
      // 同一路里重复出现只算最好的名次，否则一路内的重复会把它推到榜首
      if (seenInList.has(key)) return;
      seenInList.add(key);
      const rank = i + 1;
      let cur = acc.get(key);
      if (!cur) {
        cur = { ...hit, rrf: 0, ranks: lists.map(() => null), listsHit: 0 };

```

# 面试 05 · 系统设计 + 手写题 > 手写多路检索结果的 RRF 融合与去重

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/05-design-coding.html#q9（连续片段 3/4；代码需合并后阅读，不能单独运行）

前文：公式：`score(d) = Σ_i w_i / (k + rank_i(d))`，`k` 取 60（原论文值），作用是压制头部名次的差距，让「两路都排中间」胜过「一路第一、另一路没有」。

```ts
        acc.set(key, cur);
      }
      // 同一 chunk 在不同路里字段可能不全，合并补齐
      cur.text = cur.text || hit.text;
      cur.docId = cur.docId ?? hit.docId;
      cur.source = cur.source ?? hit.source;
      cur.ranks[li] = rank;
      cur.listsHit += 1;
      cur.rrf += w / (k + rank);
    });
  });

  const ranked = [...acc.values()].sort(
    (a, b) => b.rrf - a.rrf || b.listsHit - a.listsHit || a.id.localeCompare(b.id),
  );

  const out: FusedHit[] = [];
  const perDoc = new Map<string, number>();
  const grams: Set<string>[] = [];
  for (const h of ranked) {
    if (out.length >= topK) break;
    const doc = h.docId ?? h.id;
    if ((perDoc.get(doc) ?? 0) >= perDocLimit) continue;
    if (nearDupThreshold > 0) {
      const g = trigrams(h.text);
      // 高排名的先进，后来的近似重复被丢 —— 相邻 chunk 的重叠窗口就是这么来的
      if (grams.some((prev) => jaccard(prev, g) >= nearDupThreshold)) continue;
      grams.push(g);
    }

```

# 面试 05 · 系统设计 + 手写题 > 手写多路检索结果的 RRF 融合与去重

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/05-design-coding.html#q9（连续片段 4/4；代码需合并后阅读，不能单独运行）

前文：公式：`score(d) = Σ_i w_i / (k + rank_i(d))`，`k` 取 60（原论文值），作用是压制头部名次的差距，让「两路都排中间」胜过「一路第一、另一路没有」。

```ts
    perDoc.set(doc, (perDoc.get(doc) ?? 0) + 1);
    out.push(h);
  }
  return out;
}

```

# 面试 05 · 系统设计 + 手写题 > 手写多路检索结果的 RRF 融合与去重

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/05-design-coding.html#q9

用法接在混合检索后面（第 1 题读路径的第四步）：

# 面试 05 · 系统设计 + 手写题 > 手写多路检索结果的 RRF 融合与去重

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/05-design-coding.html#q9

前文：用法接在混合检索后面（第 1 题读路径的第四步）：

```ts
const [vec, bm25] = await Promise.all([vectorSearch(q, 50), keywordSearch(q, 50)]);
const fused = rrfFuse([vec, bm25], {
  weights: [1, 1], topK: 20, perDocLimit: 3, nearDupThreshold: 0.85,
});
const finalHits = await rerank(q, fused);   // 交给 rerank 精排 top5~8

```

# 面试 05 · 系统设计 + 手写题 > 手写多路检索结果的 RRF 融合与去重

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/05-design-coding.html#q9

去重是这题真正的分水岭，要分三层，每层对应一种现象：

# 面试 05 · 系统设计 + 手写题 > 手写多路检索结果的 RRF 融合与去重

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/05-design-coding.html#q9

前文：去重是这题真正的分水岭，要分三层，每层对应一种现象：

1. **同 ID 去重**：同一个 chunk 在多路里都出现，不合并就在 prompt 里重复喂给模型。现象是答案里同一句话说两遍，或者模型对重复出现的信息过度自信
2. **一路内部去重**：某一路自己返回了重复 ID（多字段召回、多向量索引 union 后常见），不去重会让它累加两次 RRF 分数，凭一路之力冲到榜首
3. **近似重复**：切分时的重叠窗口（第 1 题里的 10~15%）会让相邻 chunk 有大段相同文本，ID 不同、内容几乎一样。**这是最耗上下文的一类重复**——top10 里有 4 条是同一段话的不同窗口，等于白花了 40% 的 token。用 3-gram Jaccard 在 0.8~0.9 阈值上过滤，保留排名高的那个

# 面试 05 · 系统设计 + 手写题 > 手写多路检索结果的 RRF 融合与去重

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/05-design-coding.html#q9

另外两个实践点：`perDocLimit` 防止单个长文档霸占整个 top10（同一篇文档连出 8 个 chunk，多样性归零，问题只要涉及两篇文档就必答错一半）；排序的 tie-break 要确定（这里是 `listsHit` 然后 `id`），否则同分项的顺序随 Map 迭代顺序变化，同一个查询两次跑出不同的 top10，评估结果无法复现。

# 面试 05 · 系统设计 + 手写题 > 手写多路检索结果的 RRF 融合与去重

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/05-design-coding.html#q9

**追问「两路里有一路明显更准，你还用 RRF 吗，权重怎么定」**：先看差距有多大。如果一路的 Recall@50 是 0.85、另一路只有 0.35，那第二路的边际收益主要是补长尾——继续融合但把权重压到 0.3~0.5，而不是踢掉，因为向量和 BM25 的失败模式是互补的：向量搜不到精确的编号、型号、人名（语义相近但字面不同），BM25 搜不到换了说法的同义表达。**踢掉弱的那一路，表现是「大部分查询变好了、但产品编号和缩写类查询全崩」**，而这类查询在企业知识库里占比不低。权重怎么定：不要拍，用离线 eval 集网格搜——权重取 `[1, 0.2/0.4/0.6/0.8/1]`、`k` 取 `[10, 30, 60]`，按 Recall@20 和 MRR 挑，一共十几组跑一遍就够（第 5 题的流水线正好干这个）。定完要记住它绑在当前的语料和查询分布上，语料换了要重跑。还有一个更省事的替代方案要能说出来：**融合权重调不动的时候，加 rerank 比调权重收益大得多**，因为 RRF 只是把两路的名次拼起来，rerank 是真正读了 query 和文本做交叉打分。

# 面试 05 · 系统设计 + 手写题 > 设计一个低代码搭建产物转 React/Vue 代码的「出码」方案

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/05-design-coding.html#q10

**先问清背景再答，这题的第一分在这里。** 低代码出码有两种截然不同的诉求，方案完全不同：

# 面试 05 · 系统设计 + 手写题 > 设计一个低代码搭建产物转 React/Vue 代码的「出码」方案

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/05-design-coding.html#q10

前文：**先问清背景再答，这题的第一分在这里。** 低代码出码有两种截然不同的诉求，方案完全不同：

- **一次性逃逸**（团队要弃用低代码平台，把已有页面搬成正常工程代码）：目标是可读性和可维护性，产物之后由人接手，不再回到低代码。
- **持续并行开发**（低代码继续做主，但同一个页面要多人同时改）：产物要能被反复重新生成，就必须解决「人改过的代码下次出码会不会被冲掉」。

# 面试 05 · 系统设计 + 手写题 > 设计一个低代码搭建产物转 React/Vue 代码的「出码」方案

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/05-design-coding.html#q10

第二种是真正的难题，也是这题在实际项目里的来源：**低代码对同一页面的并行开发不友好**——schema 是一整块 JSON，两个人同时改就是整文件冲突，Git 层面没法合。把它转成组件文件，冲突粒度才降到函数级。

# 面试 05 · 系统设计 + 手写题 > 设计一个低代码搭建产物转 React/Vue 代码的「出码」方案

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/05-design-coding.html#q10

**分层设计**

# 面试 05 · 系统设计 + 手写题 > 设计一个低代码搭建产物转 React/Vue 代码的「出码」方案

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/05-design-coding.html#q10

前文：**分层设计**

1. **Schema 规范化层**。平台导出的 JSON 先转成一份自己定义的中间表示（IR）：组件树、props、绑定表达式、事件、数据源、条件与循环。不要直接在平台 schema 上生成代码——平台每次升级都会改字段，IR 是唯一让你只改一处适配层的位置。
2. **代码生成层**。组件树 → JSX/模板；props → 属性；表达式绑定 → `{}` 插值；平台的动作/方法 → 组件内的函数。这一层要输出的不只是页面文件，还有类型定义、请求层、路由注册、样式文件。
3. **能力映射表**。平台组件 ↔ 目标组件库的一一映射，包含 props 改名、枚举值转换、缺失能力的降级策略。**这张表就是这个方案的全部工作量所在**，也是唯一无法自动推导的部分。
4. **格式化与静态检查**。产物过 prettier + eslint + `tsc --noEmit`，不通过就让出码失败。生成的代码没跑过检查等于没生成。

# 面试 05 · 系统设计 + 手写题 > 设计一个低代码搭建产物转 React/Vue 代码的「出码」方案

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/05-design-coding.html#q10

**四个必须点到的难点**（只讲流水线不讲难点会被判「没做过」）

# 面试 05 · 系统设计 + 手写题 > 设计一个低代码搭建产物转 React/Vue 代码的「出码」方案

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/05-design-coding.html#q10（连续片段 1/2，需结合相邻段阅读）

前文：**四个必须点到的难点**（只讲流水线不讲难点会被判「没做过」）

- **表达式与生命周期**。低代码里的绑定表达式往往是运行时 `eval` 的字符串，转成静态代码要做 AST 解析和作用域重写；平台的「页面加载时执行」映射到 `useEffect` / `onMounted` 时还要处理依赖和清理。
- **状态模型不一致**。平台通常是一个全局可变 store，随便读写；React 要求不可变更新（`08-react.md` 第 20 题）。直接直译会生成一堆原地 mutation 的代码，跑起来界面不更新。
- **回写与保护区**。持续并行的场景必须支持「人改过的地方不被覆盖」：常见做法是产物里划出受保护的区块（标记注释包裹的自定义代码段），重新生成时只替换生成区、保留保护区；更彻底的做法是把自定义逻辑强制外置成 hooks 文件，生成的页面只允许引用不允许被手改。**两种都要说：前者体验好但合并逻辑脆，后者约束强但可长期维护。**

# 面试 05 · 系统设计 + 手写题 > 设计一个低代码搭建产物转 React/Vue 代码的「出码」方案

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/05-design-coding.html#q10（连续片段 2/2，需结合相邻段阅读）

前文：**四个必须点到的难点**（只讲流水线不讲难点会被判「没做过」）

- **单向还是双向**。代码改完能不能反向回到低代码编辑器？只要允许自由手改，答案基本是不能——所以要在方案里明确「出码即单向」，或者定义一个受限子集（只有 IR 能表达的写法才允许），并在 CI 里校验。含糊过去的方案，上线半年后会同时烂在两头。

# 面试 05 · 系统设计 + 手写题 > 设计一个低代码搭建产物转 React/Vue 代码的「出码」方案

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/05-design-coding.html#q10

**怎么证明它有效**：不是「能生成代码」，而是三条可测的。**产物一致性**——同一份 schema 生成的页面和低代码渲染的页面跑一遍视觉与交互回归，逐页比对。**可读性**——随机抽 10 个页面让没参与的人接手改一个需求，记录耗时；生成的代码没人愿意接手就等于失败。**回归安全**——保护区机制要有专门的测试：手改一段、重新出码、断言手改内容还在且生成区已更新。

# 面试 05 · 系统设计 + 手写题 > 设计一个低代码搭建产物转 React/Vue 代码的「出码」方案

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/05-design-coding.html#q10

**追问「转出来的代码没人敢改，最后还是回去用低代码了，你怎么避免」**：这是这类项目最常见的失败结局，原因基本不是技术而是产物质量。三个具体做法：**生成的代码必须长得像人写的**——组件按语义命名（不是 `Div1`、`Comp_23`）、样式不要全量内联、事件处理抽成命名函数，命名信息只能来自搭建时就让用户填的语义字段，所以这件事要往前推到平台侧。**先只出码一部分**——数据请求和业务逻辑先出码（人最需要改的地方），布局和样式继续由平台运行时渲染，跑顺了再扩大范围；一次性全量出码几乎必然产出没人敢碰的代码。**给出码产物配一条 CI**——类型检查、eslint、单测、视觉回归，让「改了出码产物」这件事本身是安全的。反过来说一句诚实的判断：**如果团队的真实诉求只是「多人并行改一个页面」，那把页面拆成多个低代码片段、或者把 schema 存成多文件，成本比做出码低一个数量级**——能说出这句话，说明你评估过方案边界，而不是拿到需求就开始造工具。
