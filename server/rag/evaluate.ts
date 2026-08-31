/**
 * 检索质量评估。
 *
 * ## 为什么必须有这个
 *
 * 在有评估集之前,RAG 的所有参数调整都是靠感觉:改了 topK、换了切块大小、
 * 调了 BM25 的 k1,到底变好还是变坏,只能"问几个问题看着像不像"。
 * 这种判断方式的问题不是不准,是**没有方向**——改坏了也不知道,
 * 而 RAG 最常见的失效模式恰好是静默降质(见 embedder.ts 的 pooling/前缀两个坑)。
 *
 * 所以这里的产出不是"分数高不高",是"改动之后分数动了没有、往哪动"。
 *
 * ## 指标怎么选
 *
 * 三个指标各回答一个不同的问题,单看任何一个都会误判:
 *
 * - **Recall@K**:该找到的块,有几成进了前 K?回答"够不够全"。
 *   这是 RAG 的下限——没召回的块,后面再怎么排都没用,模型根本看不到。
 *
 * - **MRR**(平均倒数排名):第一个正确块排第几?回答"够不够靠前"。
 *   为什么重要:prompt 有字符预算(maxContextCharacters),排第 9 的块
 *   即使召回了也可能被截掉。而且靠前的块在长上下文里更受重视。
 *
 * - **nDCG@K**:同时考虑"找到几个"和"排在多前",并对靠后的位置打折
 *   (log2 衰减)。回答"整体排序质量"。它是三者里最接近人类感受的。
 *
 * 一个具体的误判例子:Recall@4 = 1.0 看起来完美,但如果正确块全排在
 * 3、4 位,MRR 只有 0.33,说明两个不相关的块占了前两位——换个字符
 * 预算更紧的场景就会崩。
 *
 * ## 这个评估集的局限(面试会问,先写在这)
 *
 * 1. **规模太小**。十几条问题的统计效力很弱,单条问题的好坏就能让
 *    指标晃几个百分点。工业做法是几百到几千条,并且分层抽样。
 * 2. **标注是人工的,也就是我自己**。会不自觉地按"我知道文档里有什么"
 *    去写问题,而真实用户不知道,他们的问法会更模糊、更口语。
 * 3. **只评检索,不评生成**。检索对了但模型答错、或者模型无视资料
 *    自己编,这里都测不出来。那需要另一套(答案忠实度 / 引用准确率),
 *    通常要 LLM-as-judge。
 * 4. **相关性是二元的**。真实情况有"高度相关/部分相关/无关"三档,
 *    nDCG 本来支持分级增益,这里简化成 0/1 了。
 */

import { retrieve, type RetrievalMode } from './retriever.ts'

export interface EvalCase {
  /** 用户会怎么问 */
  question: string
  /**
   * 期望命中的文档标题(而不是 chunk id)。
   *
   * 用标题而不是 chunk id 是刻意的:chunk id 是 randomUUID,每次重新入库
   * 都会变,标注就作废了。标题稳定,而且"检索到了正确的文档"本身就是
   * 大部分场景真正关心的粒度。
   *
   * 代价是粒度粗——一篇文档里检索到了错误的章节,这里算命中。
   * 想更严就该标 heading,但那样标注成本和维护成本都上一个台阶。
   */
  expectedDocuments: string[]
  /** 这条 case 想测什么能力,报告里分组用 */
  tag: 'semantic' | 'keyword' | 'mixed'
  /** 为什么加这条,方便以后回看 */
  note?: string
}

export interface CaseResult {
  question: string
  tag: EvalCase['tag']
  expectedDocuments: string[]
  /** 融合后 topK 里实际命中的文档标题,按名次排列 */
  retrievedDocuments: string[]
  recall: number
  /** 第一个正确结果的倒数排名;一个都没命中则为 0 */
  reciprocalRank: number
  ndcg: number
  /**
   * 第一个命中的块在两路候选榜里各自排第几(1 起,没进该路则为 null)。
   *
   * 这个字段替换掉了早先的 firstHitLane('vector' | 'keyword' | 'both'),
   * 因为那个设计是错的:候选池有 12 个位置,"块进了两路的榜"和"块进了
   * 最终 top4"是两件事。24 条 case 全报 both,却仍有 2 条纯向量没命中 ——
   * 说明 both 完全没有解释力。
   *
   * 真正的因果是名次:向量榜排第 9 的块进不了 top4,但它在 BM25 榜排第 1,
   * RRF 把两个名次加权后就推进了 top4。所以要看数字,不是看"进没进榜"。
   */
  firstHitRanks: { vector: number | null; keyword: number | null } | null
  totalMs: number
}

export interface EvalReport {
  mode: RetrievalMode
  cases: CaseResult[]
  overall: {
    recall: number
    mrr: number
    ndcg: number
    /** 完全没命中的 case 数——这个数比平均分更值得盯 */
    misses: number
    averageMs: number
  }
  /** 按 tag 分组的平均值,用来看混合检索是否真的补上了关键词短板 */
  byTag: Record<string, { count: number; recall: number; mrr: number; ndcg: number }>
}

/** 评估用的 topK。和 retriever 里的 topK 保持一致,否则评的不是线上行为。 */
const evalTopK = 4

/**
 * DCG:每个命中按位置打折累加,log2(rank+1) 是标准折扣。
 * 二元相关性下增益是 1,所以直接累加折扣的倒数。
 */
function discountedCumulativeGain(relevances: number[]): number {
  return relevances.reduce(
    (sum, relevance, index) => sum + relevance / Math.log2(index + 2),
    0
  )
}

/**
 * nDCG = DCG / IDCG,值域 [0, 1]。
 *
 * IDCG 是"理想排序"的 DCG:所有相关项都排在最前面。除以它才能让不同
 * 相关项数量的 case 之间可比——期望 1 篇和期望 3 篇的 case,
 * 裸 DCG 不在同一量纲上。
 *
 * 这里踩过一个坑,值得记下来:第一版的 relevances 是**块级**的(topK 个块),
 * 而 relevantTotal 传的是**文档数**。同一篇文档的 3 个块都命中时,
 * DCG 累加了三项,IDCG 只按 1 篇算,算出 nDCG = 1.6 —— 超出定义域了。
 * nDCG 大于 1 一定是 IDCG 算错,因为它的定义就是"实际排序 / 最好的可能排序"。
 *
 * 修法不是给 IDCG 补项,而是**统一粒度**:标注是文档级的,评估就在文档级做,
 * 见 evaluateOne 里的去重。
 */
function normalizedDcg(relevances: number[], relevantTotal: number): number {
  if (relevantTotal === 0) return 0
  const ideal = Array.from({ length: Math.min(relevantTotal, relevances.length) }, () => 1)
  const idcg = discountedCumulativeGain(ideal)
  return idcg === 0 ? 0 : discountedCumulativeGain(relevances) / idcg
}

/**
 * 把 topK 个块折叠成去重后的文档序列,保留首次出现的名次。
 *
 * 为什么要折叠:标注的粒度是文档标题(理由见 EvalCase.expectedDocuments),
 * 三个指标就都必须在同一粒度上算,否则 IDCG 和 DCG 不同量纲。
 *
 * 代价是丢掉了"后 3 个位置被同一篇文档占满"这个信息 —— 那种情况其实是
 * 多样性问题(检索退化成只看一篇),这份评估测不出来。要测得加
 * 一个"命中文档种类数"之类的指标,现在没有。
 */
function toDocumentRanking(retrievedChunkDocuments: string[]): string[] {
  const seen = new Set<string>()
  const ordered: string[] = []
  for (const title of retrievedChunkDocuments) {
    if (seen.has(title)) continue
    seen.add(title)
    ordered.push(title)
  }
  return ordered
}

function evaluateOne(testCase: EvalCase, retrievedChunkDocuments: string[]): {
  recall: number
  reciprocalRank: number
  ndcg: number
  documentRanking: string[]
} {
  const expected = new Set(testCase.expectedDocuments)
  const documentRanking = toDocumentRanking(retrievedChunkDocuments)

  // 二元相关性向量:去重后第 i 篇文档是不是期望文档
  const relevances: number[] = documentRanking.map((title) => (expected.has(title) ? 1 : 0))

  const foundCount = relevances.reduce((sum, relevance) => sum + relevance, 0)
  const recall = expected.size === 0 ? 0 : foundCount / expected.size

  const firstHitIndex = relevances.indexOf(1)
  const reciprocalRank = firstHitIndex === -1 ? 0 : 1 / (firstHitIndex + 1)

  return {
    recall,
    reciprocalRank,
    ndcg: normalizedDcg(relevances, expected.size),
    documentRanking
  }
}

function average(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length
}

/**
 * 跑一遍评估集。
 *
 * 串行而不是并发:embedding 跑在同一个 ONNX session 上,并发只会互相排队,
 * 还会让 timings 里的耗时数据失真。评估集只有十几条,串行也就几秒。
 */
export async function runEvaluation(
  cases: EvalCase[],
  mode: RetrievalMode = 'hybrid'
): Promise<EvalReport> {
  const results: CaseResult[] = []

  for (const testCase of cases) {
    const retrieval = await retrieve(testCase.question, mode)

    if (!retrieval) {
      results.push({
        question: testCase.question,
        tag: testCase.tag,
        expectedDocuments: testCase.expectedDocuments,
        retrievedDocuments: [],
        recall: 0,
        reciprocalRank: 0,
        ndcg: 0,
        firstHitRanks: null,
        totalMs: 0
      })
      continue
    }

    // 只看真正进了 prompt 的块(used),不是全部候选——评估必须和线上
    // 行为一致,候选里排第 10 的块模型是看不到的
    const usedCandidates = retrieval.trace.candidates
      .filter((candidate) => candidate.used)
      .slice(0, evalTopK)

    const { documentRanking, ...metrics } = evaluateOne(
      testCase,
      usedCandidates.map((candidate) => candidate.documentTitle)
    )

    // 记下第一个命中的块在两路候选榜里各自的名次。
    // 看数字而不是看"进没进榜":向量榜第 9 名进不了 top4,
    // 但它在 BM25 榜第 1,RRF 加权后就推进去了 —— 名次才有解释力。
    const expected = new Set(testCase.expectedDocuments)
    const firstHit = usedCandidates.find((candidate) => expected.has(candidate.documentTitle))
    const firstHitRanks: CaseResult['firstHitRanks'] = firstHit
      ? { vector: firstHit.vectorRank, keyword: firstHit.keywordRank }
      : null

    results.push({
      question: testCase.question,
      tag: testCase.tag,
      expectedDocuments: testCase.expectedDocuments,
      retrievedDocuments: documentRanking,
      ...metrics,
      firstHitRanks,
      totalMs: retrieval.trace.timings.total
    })
  }

  const byTag: EvalReport['byTag'] = {}
  for (const tag of new Set(results.map((result) => result.tag))) {
    const group = results.filter((result) => result.tag === tag)
    byTag[tag] = {
      count: group.length,
      recall: average(group.map((result) => result.recall)),
      mrr: average(group.map((result) => result.reciprocalRank)),
      ndcg: average(group.map((result) => result.ndcg))
    }
  }

  return {
    mode,
    cases: results,
    overall: {
      recall: average(results.map((result) => result.recall)),
      mrr: average(results.map((result) => result.reciprocalRank)),
      ndcg: average(results.map((result) => result.ndcg)),
      misses: results.filter((result) => result.recall === 0).length,
      averageMs: average(results.map((result) => result.totalMs))
    },
    byTag
  }
}
