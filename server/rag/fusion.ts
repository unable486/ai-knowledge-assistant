/**
 * RRF(Reciprocal Rank Fusion):把向量检索和 BM25 的结果合成一个榜。
 *
 * 核心问题是**两路的分数不可比**:
 * - 余弦相似度在 [-1, 1],中文 bge 上相关的块通常落在 0.5~0.75 这个窄带里
 * - BM25 无上界,取决于 IDF 和文档长度,可能是 0.8 也可能是 15
 *
 * 所以不能加权求和。归一化(min-max)也不行:它依赖当次结果集的极值,
 * 一个离群高分就会把其余全压到接近 0,而且候选集变一下排名就跟着变。
 *
 * RRF 只用**名次**,彻底绕开量纲问题:
 *
 *   score(d) = Σ over rankers  weight / (k + rank(d))
 *
 * rank 从 1 开始。k 是平滑常数,作用是压制头部:k=60 时第 1 名得
 * 1/61 ≈ 0.0164,第 2 名 1/62 ≈ 0.0161,差 2%。如果 k=1,第 1 名 0.5、
 * 第 2 名 0.33,差 34% —— 那就变成"谁的第一名说话最响",单路失误
 * 会直接决定结果。k 大 = 更看重"两路都投了它",这正是混合检索想要的。
 *
 * k=60 是 RRF 原论文(Cormack et al. 2009)的取值,也是 Elasticsearch
 * 和 Weaviate 的默认值。这个数不敏感,20~100 效果接近。
 *
 * 副作用要知道:RRF 丢掉了分数的绝对信息。一个余弦 0.9 的强命中和
 * 0.5 的弱命中,只要都排第一,贡献一样。所以 RRF 适合"提召回",
 * 不适合当置信度用——阈值过滤要在融合之前对原始分数做。
 */

const smoothingConstant = 60

export interface RankedList {
  /** 按相关性降序排好的 id 列表 */
  ids: string[]
  /** 该路的权重,默认 1 */
  weight?: number
}

export interface FusedHit {
  id: string
  score: number
  /** 在各路里的名次(1 起),没进该路的榜则缺席。用于调试面板展示。 */
  ranks: Record<string, number>
}

/**
 * 融合多路排序结果。
 *
 * @param lists 路名 -> 该路的排序结果。路名会出现在 FusedHit.ranks 里。
 */
export function reciprocalRankFusion(lists: Record<string, RankedList>): FusedHit[] {
  const scores = new Map<string, number>()
  const ranks = new Map<string, Record<string, number>>()

  for (const [name, list] of Object.entries(lists)) {
    const weight = list.weight ?? 1

    list.ids.forEach((id, index) => {
      const rank = index + 1
      scores.set(id, (scores.get(id) ?? 0) + weight / (smoothingConstant + rank))

      const existing = ranks.get(id) ?? {}
      existing[name] = rank
      ranks.set(id, existing)
    })
  }

  return [...scores.entries()]
    .map(([id, score]) => ({ id, score, ranks: ranks.get(id) ?? {} }))
    .sort((a, b) => b.score - a.score)
}
