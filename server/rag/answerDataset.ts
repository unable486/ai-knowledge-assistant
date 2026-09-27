import { evalDocuments, type EvalDocument } from './evalDataset.ts'

export interface AnswerEvalCase {
  id: string
  question: string
  history?: { role: 'user' | 'assistant'; content: string }[]
  category: 'answerable' | 'unanswerable' | 'followup' | 'version'
  split: 'calibration' | 'validation'
  expectedAnswer: string
  evidence: { documentTitle: string; quote: string }[]
}

/**
 * 固定、虚构的测试语料，不是实际用户文档或本项目功能承诺。
 * 复用旧检索基准但不改写它；附加两版规则专门检查版本区分和冲突澄清。
 */
export const answerDocuments: EvalDocument[] = [
  ...evalDocuments,
  {
    title: '演练资料归档规则 v1.0（虚构测试语料）',
    text: `# 演练资料归档规则 v1.0（虚构测试语料）

本文是专用于自动评估的虚构资料，不描述本项目实现，也不是真实用户数据。
规则仅适用于演练项目“北斗档案”的 v1.0 流程；资料未说明实际启用哪个版本。

## 保留期限

v1.0 归档包保留 7 天，到期删除。

## 审批人员

v1.0 归档申请须由项目负责人审核后才能提交。

## 提交窗口

v1.0 归档申请只能在每周一 09:00 至 12:00 提交。

## 文件命名

v1.0 归档包文件名采用“日期-项目名.zip”。

## 口令交付

v1.0 归档包口令写在归档工单中交付给接收人。
`
  },
  {
    title: '演练资料归档规则 v2.0（虚构测试语料）',
    text: `# 演练资料归档规则 v2.0（虚构测试语料）

本文是专用于自动评估的虚构资料，不描述本项目实现，也不是真实用户数据。
规则仅适用于演练项目“北斗档案”的 v2.0 流程；资料未说明实际启用哪个版本。

## 保留期限

v2.0 归档包保留 30 天，到期删除。

## 审批人员

v2.0 归档申请须由资料管理员审核后才能提交。

## 提交窗口

v2.0 归档申请只能在每周三 14:00 至 17:00 提交。

## 文件命名

v2.0 归档包文件名采用“项目名-v2-日期.zip”。

## 口令交付

v2.0 归档包口令必须通过电话口头告知接收人，不得写入工单。
`
  }
]

/**
 * 28 个固定场景：普通可答 10、无答案 8、多轮 5、版本/冲突 5。
 * calibration 13 / validation 15，固定分配且不以同题改写跨集合复用事实。
 * evidence 是正文逐字摘录；同文档的其他章节不能代替这些目标证据。
 * 无答案包括完全无关主题与主题相关但缺少关键事实，均要求资料不足时拒绝编造。
 */
export const answerCases: AnswerEvalCase[] = [
  {
    id: 'answerable-01',
    question: '我们准备换一个输出维度不同的 embedding 模型，旧向量索引能直接沿用吗？为什么？',
    category: 'answerable',
    split: 'calibration',
    expectedAnswer: '不能直接沿用。换用维度不同的模型时必须整体重建旧索引，因为不同维度的向量没有可比性。',
    evidence: [{ documentTitle: '向量与相似度', quote: '换用维度不同的模型时，旧的索引数据必须整体重建，\n因为不同维度的向量之间没有可比性。' }]
  },
  {
    id: 'answerable-02',
    question: '一篇文档不停重复同一个关键词，BM25 会因此一直给它加分吗？',
    category: 'answerable',
    split: 'calibration',
    expectedAnswer: '不会持续加分。BM25 的词频饱和机制会限制重复堆砌关键词带来的收益。',
    evidence: [{ documentTitle: '混合检索原理', quote: '词频饱和让重复堆砌关键词无法持续加分。' }]
  },
  {
    id: 'answerable-03',
    question: '向量分数和关键词分数看起来都是数字，为什么资料里的融合方案不直接加权求和？它改用什么？',
    category: 'answerable',
    split: 'calibration',
    expectedAnswer: '两路分数的量纲不同，不能直接加权求和。资料采用倒数排名融合（RRF），只使用名次以绕开量纲问题。',
    evidence: [{ documentTitle: '混合检索原理', quote: '两路的分数量纲不同，不能直接加权求和。\n倒数排名融合只用名次，彻底绕开量纲问题。' }]
  },
  {
    id: 'answerable-04',
    question: '流式响应的一个网络分片只收到了半个消息帧，客户端应该马上解析还是怎样处理？',
    category: 'answerable',
    split: 'calibration',
    expectedAnswer: '保留不完整的尾部，等下一个网络分片到来后再拼接。网络分片边界与消息帧边界无关，不能假设一个分片就是完整一帧。',
    evidence: [{ documentTitle: '流式传输机制', quote: '网络分片和消息帧边界无关，一个分片可能只包含半个帧，\n所以要把不完整的尾部留到下一个分片再拼。' }]
  },
  {
    id: 'answerable-05',
    question: '聊天记录是应用自己写进浏览器本地存储的，重新读取时为什么还要逐字段校验？',
    category: 'answerable',
    split: 'calibration',
    expectedAnswer: '本地存储仍是不可信输入：用户可以手动修改，旧版本也可能留下结构不同的数据。因此读取时需要逐字段校验，必要时丢弃坏消息。',
    evidence: [{ documentTitle: '持久化策略', quote: '本地存储的内容是不可信输入，用户能手改，旧版本也会留下结构不同的数据。\n所以读取时逐字段校验，宁可丢掉一条坏消息。' }]
  },
  {
    id: 'answerable-06',
    question: '把 bge 的 pooling 从 cls 改成 mean 后没有报错，是否说明这个配置没问题？资料推荐哪一个？',
    category: 'answerable',
    split: 'validation',
    expectedAnswer: '没有报错不代表配置正确。bge 用 CLS token 做句向量，pooling 应设为 cls；改成 mean 可能不报错，但向量空间对不上，会降低检索质量。',
    evidence: [{ documentTitle: 'embedding 模型选择', quote: 'bge 用 CLS token 做句向量，所以 pooling 必须设成 cls 而不是 mean。\n设错同样不报错，向量空间对不上，检索结果明显变差但没有任何提示。' }]
  },
  {
    id: 'answerable-07',
    question: '为了减少切块边界丢信息，我想把 chunk_overlap 调大。重叠能解决什么问题，又会付出什么代价？',
    category: 'answerable',
    split: 'validation',
    expectedAnswer: '重叠能避免关键句刚好落在切块边界，导致相邻两块各自只得到半句。调大重叠会重复存储更多文本，从而增加索引体积。',
    evidence: [{ documentTitle: '切块参数说明', quote: '留重叠是为了避免一句关键的话正好被切在边界上，两块都只拿到半句。\n调大重叠会增加索引体积，因为同一段文字被存了两遍。' }]
  },
  {
    id: 'answerable-08',
    question: '知识库经常需要搜具体错误码和型号，已经有向量检索了，为什么还需要关键词检索？',
    category: 'answerable',
    split: 'validation',
    expectedAnswer: '向量检索擅长语义但可能丢失字面精确性，关键词检索能够进行字面匹配。错误码、型号等内容需要这种精确匹配，所以两路互补。',
    evidence: [{ documentTitle: '混合检索原理', quote: '向量检索懂语义但丢字面精确性，关键词检索认字面但完全不懂语义。\n专有名词、型号、错误码、代码标识符这类内容在语义空间里没有邻居，\n只能靠字面匹配捞出来。所以两者是互补关系，不是替代关系。' }]
  },
  {
    id: 'answerable-09',
    question: '用户在回答生成到一半时关闭页面，服务端还需要对模型请求做什么？不处理会有什么后果？',
    category: 'answerable',
    split: 'validation',
    expectedAnswer: '浏览器断开连接时，服务端应主动中止上游模型请求；否则上游会继续生成并继续计费。',
    evidence: [{ documentTitle: '中止与重试', quote: '浏览器断开连接时，服务端要主动中止对上游模型的请求。\n不做这一步的话，用户关掉页面后上游还在继续生成，费用照算。' }]
  },
  {
    id: 'answerable-10',
    question: '一次检索评测召回率拿到了满分，能据此认定结果排序也很好吗？资料举的反例是什么？',
    category: 'answerable',
    split: 'validation',
    expectedAnswer: '不能。正确结果即使全部被召回，也可能挤在第三、第四位；资料指出这种情况下倒数排名只有三分之一，字符预算更紧时会出问题。',
    evidence: [{ documentTitle: '检索质量评估', quote: '召回率满分也可能排序很差：正确结果全挤在第三第四位时，\n倒数排名只有三分之一，换个字符预算更紧的场景就会崩。' }]
  },
  {
    id: 'unanswerable-01',
    question: '请根据知识库告诉我上海明天每小时的降雨概率，我好安排出门时间。',
    category: 'unanswerable',
    split: 'calibration',
    expectedAnswer: '现有资料没有上海天气预报，无法据此提供明天逐小时的降雨概率，不能编造天气数据。',
    evidence: []
  },
  {
    id: 'unanswerable-02',
    question: '我要烤一个十二英寸的披萨，按资料应该把烤箱设成多少度、烤几分钟？',
    category: 'unanswerable',
    split: 'calibration',
    expectedAnswer: '现有资料没有披萨配方或烘烤说明，无法确定烤箱温度和时长，不能编造参数。',
    evidence: []
  },
  {
    id: 'unanswerable-03',
    question: '资料里提到要下载 embedding 权重，这个权重文件的 SHA-256 校验值具体是什么？',
    category: 'unanswerable',
    split: 'calibration',
    expectedAnswer: '资料提到了权重文件，但没有提供 SHA-256 校验值，无法给出具体哈希，不能编造。',
    evidence: []
  },
  {
    id: 'unanswerable-04',
    question: '收到 ERR_UPLOAD_PARSE 后，我该按资料运行哪条完整命令把 GBK 文件转成 UTF-8？',
    category: 'unanswerable',
    split: 'calibration',
    expectedAnswer: '资料提到文件编码无法识别可能导致 ERR_UPLOAD_PARSE，但未提供 GBK 转 UTF-8 的工具或命令，无法给出资料规定的完整命令。',
    evidence: []
  },
  {
    id: 'unanswerable-05',
    question: '知识库里有没有巴黎卢浮宫周二的开放时间和成人门票价格？请给出具体时间和金额。',
    category: 'unanswerable',
    split: 'validation',
    expectedAnswer: '现有资料没有卢浮宫开放时间或票价，无法提供具体时间和金额，不能用外部常识补成资料中的答案。',
    evidence: []
  },
  {
    id: 'unanswerable-06',
    question: '按这些资料，木星已经确认有多少颗卫星，统计截至哪一天？',
    category: 'unanswerable',
    split: 'validation',
    expectedAnswer: '现有资料没有木星卫星数量及统计日期，无法回答这两个事实，不能编造数字或日期。',
    evidence: []
  },
  {
    id: 'unanswerable-07',
    question: '本地存储写入用了防抖和兜底计时器，它们分别配置了多少毫秒？需要资料里的精确值。',
    category: 'unanswerable',
    split: 'validation',
    expectedAnswer: '资料说明了防抖与兜底计时器的作用，但没有写出各自的毫秒数，无法提供精确配置值，不能猜测。',
    evidence: []
  },
  {
    id: 'unanswerable-08',
    question: '混合检索在生产环境有十万篇文档时的 P95 查询耗时是多少毫秒？请引用实际压测结果。',
    category: 'unanswerable',
    split: 'validation',
    expectedAnswer: '资料没有十万篇文档下混合检索的生产压测记录或 P95 查询耗时，不能把向量扫描的估算当作这一指标，也不能编造毫秒数。',
    evidence: []
  },
  {
    id: 'followup-01',
    history: [
      { role: 'user', content: '文本块的向量入库前会先做什么处理？' },
      { role: 'assistant', content: '资料说向量入库时已经做过归一化。' }
    ],
    question: '这么做后，查询时能省掉哪一步计算？',
    category: 'followup',
    split: 'calibration',
    expectedAnswer: '向量归一化后长度为 1，余弦相似度可直接用点积计算，省掉每次查询计算模长的开销，排序结果不变。',
    evidence: [{ documentTitle: '向量与相似度', quote: '入库时向量已经做过归一化，长度为 1。\n归一化之后余弦相似度就退化成点积，省掉每次查询时算模长的开销。\n这是个纯粹的性能优化，不影响排序结果。' }]
  },
  {
    id: 'followup-02',
    history: [
      { role: 'user', content: '模型回复流式返回时，资料介绍的是哪种通信机制？' },
      { role: 'assistant', content: '资料介绍的是服务器推送事件。' }
    ],
    question: '这里为什么没有选双向通道？',
    category: 'followup',
    split: 'calibration',
    expectedAnswer: '这里的回复只需要服务端单向推给浏览器，不需要双向通信。服务器推送事件使用普通 HTTP，无需额外协议或连接升级；双向通道更适合两端都主动发消息的场景。',
    evidence: [{ documentTitle: '流式传输机制', quote: '回复是单向的，服务端往浏览器推，不需要双向通道。\n它走普通 HTTP，不用另开协议，也不用处理连接升级。\n双向通道适合聊天室这种两边都要主动发消息的场景，这里用不上。' }]
  },
  {
    id: 'followup-03',
    history: [
      { role: 'user', content: '切块后很短的片段会单独存一个块吗？' },
      { role: 'assistant', content: '资料说很短的块会合并到前一块。' }
    ],
    question: '那跨章节也会这么处理吗？',
    category: 'followup',
    split: 'validation',
    expectedAnswer: '不会。短块只会与标题路径相同的相邻块合并，跨章节不合并。',
    evidence: [{ documentTitle: '切块参数说明', quote: '合并只在标题路径相同的相邻块之间进行，跨章节不合并。' }]
  },
  {
    id: 'followup-04',
    history: [
      { role: 'user', content: '一条回复失败后，我打算重试。' },
      { role: 'assistant', content: '资料说重试失败的回复时会复用原来的消息。' }
    ],
    question: '那它之前挂着的引用还应该留着吗？',
    category: 'followup',
    split: 'validation',
    expectedAnswer: '不应该保留旧引用。重试会重新检索，要清掉旧的引用来源，避免来源与新答案不一致。',
    evidence: [{ documentTitle: '中止与重试', quote: '避免界面里堆积失败残影。重试会重新检索，所以旧的引用来源要清掉，\n否则来源和新答案对不上。' }]
  },
  {
    id: 'followup-05',
    history: [
      { role: 'user', content: '浏览器本地存储的配额已经用满了。' },
      { role: 'assistant', content: '资料提到配额写满可能抛出配额异常。' }
    ],
    question: '这种情况下是不是就一条都不存了？',
    category: 'followup',
    split: 'validation',
    expectedAnswer: '不是。资料说明会逐步减少保留的会话数后重试，尽量保存最近的对话。',
    evidence: [{ documentTitle: '持久化策略', quote: '配额满时不是放弃，而是逐步减少保留的会话数再试——\n存下最近的对话比一条都不存有用。' }]
  },
  {
    id: 'version-01',
    question: '演练项目的归档包从 v1.0 切到 v2.0 后，保留期限从几天变成几天？到期会怎样？',
    category: 'version',
    split: 'calibration',
    expectedAnswer: '虚构演练规则中，v1.0 保留 7 天，v2.0 保留 30 天，两版都是到期删除。应清楚区分两个版本。',
    evidence: [
      { documentTitle: '演练资料归档规则 v1.0（虚构测试语料）', quote: 'v1.0 归档包保留 7 天，到期删除。' },
      { documentTitle: '演练资料归档规则 v2.0（虚构测试语料）', quote: 'v2.0 归档包保留 30 天，到期删除。' }
    ]
  },
  {
    id: 'version-02',
    question: '演练项目现在的归档申请到底该找谁审核？我手上两份规则写的人不一样。',
    category: 'version',
    split: 'calibration',
    expectedAnswer: '两份虚构规则适用版本不同：v1.0 要由项目负责人审核，v2.0 要由资料管理员审核。资料没有说明实际启用哪个版本，不能断言当前审核人，应先确认采用的版本。',
    evidence: [
      { documentTitle: '演练资料归档规则 v1.0（虚构测试语料）', quote: 'v1.0 归档申请须由项目负责人审核后才能提交。' },
      { documentTitle: '演练资料归档规则 v2.0（虚构测试语料）', quote: 'v2.0 归档申请须由资料管理员审核后才能提交。' }
    ]
  },
  {
    id: 'version-03',
    question: '我在演练项目采用 v2.0 流程，还能照 v1.0 的时间在周一上午提交归档申请吗？请列出两版窗口。',
    category: 'version',
    split: 'validation',
    expectedAnswer: '不能沿用 v1.0 的窗口。虚构规则规定 v1.0 是每周一 09:00 至 12:00；v2.0 是每周三 14:00 至 17:00，采用 v2.0 时应按后一窗口提交。',
    evidence: [
      { documentTitle: '演练资料归档规则 v1.0（虚构测试语料）', quote: 'v1.0 归档申请只能在每周一 09:00 至 12:00 提交。' },
      { documentTitle: '演练资料归档规则 v2.0（虚构测试语料）', quote: 'v2.0 归档申请只能在每周三 14:00 至 17:00 提交。' }
    ]
  },
  {
    id: 'version-04',
    question: '演练项目准备发一个归档包，两份资料的文件名格式不一样。现在究竟应该用哪个格式？',
    category: 'version',
    split: 'validation',
    expectedAnswer: '虚构规则中 v1.0 使用“日期-项目名.zip”，v2.0 使用“项目名-v2-日期.zip”。资料未说明现在启用哪个版本，无法唯一确定，应先确认流程版本，不能仅凭版本号较大就认定当前必须用 v2.0。',
    evidence: [
      { documentTitle: '演练资料归档规则 v1.0（虚构测试语料）', quote: 'v1.0 归档包文件名采用“日期-项目名.zip”。' },
      { documentTitle: '演练资料归档规则 v2.0（虚构测试语料）', quote: 'v2.0 归档包文件名采用“项目名-v2-日期.zip”。' }
    ]
  },
  {
    id: 'version-05',
    question: '演练归档流程由 v1.0 改为 v2.0 后，口令交付方式有什么变化？还能继续把口令贴进工单吗？',
    category: 'version',
    split: 'validation',
    expectedAnswer: '虚构规则中，v1.0 把归档包口令写在归档工单中；v2.0 改为通过电话口头告知接收人，并明确不得写入工单。因此采用 v2.0 时不能继续贴在工单里。',
    evidence: [
      { documentTitle: '演练资料归档规则 v1.0（虚构测试语料）', quote: 'v1.0 归档包口令写在归档工单中交付给接收人。' },
      { documentTitle: '演练资料归档规则 v2.0（虚构测试语料）', quote: 'v2.0 归档包口令必须通过电话口头告知接收人，不得写入工单。' }
    ]
  }
]
