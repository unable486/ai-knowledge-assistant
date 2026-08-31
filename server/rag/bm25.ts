/**
 * BM25 关键词检索。
 *
 * 为什么向量检索不够:embedding 把文本压成 512 个浮点数,这个压缩是有损的,
 * 丢掉的正好是"字面精确性"。专有名词、型号、错误码、代码标识符在语义空间里
 * 没有邻居——"ERR_CONN_REFUSED" 和 "连接被拒绝" 语义接近,但用户搜前者时
 * 要的是那篇写了这个错误码的文档,不是所有讲连接失败的文档。
 *
 * BM25 是反过来的:只认字面命中,完全不懂语义。所以两者是互补而非替代,
 * 用 RRF 融合(见 fusion.ts)。
 *
 * 公式(每个查询词累加):
 *
 *   score += IDF(term) * (tf * (k1+1)) / (tf + k1 * (1 - b + b * dl/avgdl))
 *   IDF(term) = ln(1 + (N - df + 0.5) / (df + 0.5))
 *
 * 三个部分各自解决一个问题:
 * - IDF:词越罕见权重越高。"的"在每篇都出现,df≈N,IDF≈0,自动被压到没用。
 * - tf 饱和:分母带 tf,所以词频从 1→2 涨分多,从 20→21 几乎不涨。
 *   朴素 TF-IDF 是线性的,一篇堆 100 次关键词的垃圾文档能压过正常文档。
 * - 长度归一化 dl/avgdl:长文档天然更容易命中,除掉这个偏差。
 */

/** tf 饱和速度。1.2~2.0 是通用取值,越小饱和越快。 */
const k1 = 1.5
/** 长度归一化强度。0 = 不归一化,1 = 完全归一化。 */
const b = 0.75

export interface Bm25Document {
  id: string
  text: string
}

export interface Bm25Hit {
  id: string
  score: number
}

interface IndexedDocument {
  id: string
  length: number
  /** 词 -> 该词在本文档出现次数 */
  frequencies: Map<string, number>
}

/**
 * 分词。
 *
 * 中文没有空格,正经做法是用分词器(jieba / nodejieba)。这里用 bigram
 * 代替:把"报销流程"切成"报销"/"销流"/"程"——不是词,但检索只需要
 * 查询和文档用同一种切法就能对上。
 *
 * 代价是索引大约 2 倍于按词切分,并且会有"销流"这样的伪词产生噪声。
 * 收益是零依赖、无词典、对新词(型号、缩写)天然免疫。
 * 几百块文档的规模下这个取舍是划算的;真上规模应该换 jieba。
 *
 * 英文和数字按空白和标点切,保持整词——它们本来就有边界,再切 bigram
 * 只会把 "config" 和 "configure" 混成一堆噪声。
 */
export function tokenize(text: string): string[] {
  const tokens: string[] = []
  const normalized = text.toLowerCase()

  // 先摘出连续的拉丁字母/数字段,作为整词
  for (const match of normalized.matchAll(/[a-z0-9_.-]+/g)) {
    const word = match[0].replace(/^[.-]+|[.-]+$/g, '')
    if (word.length >= 2) tokens.push(word)
  }

  // 再把 CJK 字符切 bigram
  const cjk = normalized.match(/[一-鿿]+/g) ?? []
  for (const run of cjk) {
    if (run.length === 1) {
      tokens.push(run)
      continue
    }
    for (let i = 0; i < run.length - 1; i += 1) {
      tokens.push(run.slice(i, i + 2))
    }
  }

  return tokens
}

/**
 * BM25 索引。
 *
 * 每次知识库变更后整体重建,不做增量更新:几百块的规模下重建是毫秒级,
 * 而增量维护 df 表要处理删除时的引用计数,复杂度不值得。
 */
export class Bm25Index {
  private documents: IndexedDocument[] = []
  /** 词 -> 包含该词的文档数(document frequency) */
  private documentFrequencies = new Map<string, number>()
  private averageLength = 0

  constructor(documents: Bm25Document[] = []) {
    this.build(documents)
  }

  build(documents: Bm25Document[]): void {
    this.documents = []
    this.documentFrequencies = new Map()

    let totalLength = 0

    for (const document of documents) {
      const tokens = tokenize(document.text)
      const frequencies = new Map<string, number>()
      for (const token of tokens) {
        frequencies.set(token, (frequencies.get(token) ?? 0) + 1)
      }

      // df 是"出现过的文档数",不是总次数,所以按 unique 词加一次
      for (const token of frequencies.keys()) {
        this.documentFrequencies.set(token, (this.documentFrequencies.get(token) ?? 0) + 1)
      }

      this.documents.push({ id: document.id, length: tokens.length, frequencies })
      totalLength += tokens.length
    }

    this.averageLength = documents.length > 0 ? totalLength / documents.length : 0
  }

  get size(): number {
    return this.documents.length
  }

  private inverseDocumentFrequency(term: string): number {
    const total = this.documents.length
    const frequency = this.documentFrequencies.get(term) ?? 0
    // +0.5 平滑项:df 接近 N 时避免 IDF 变成负数或零除
    return Math.log(1 + (total - frequency + 0.5) / (frequency + 0.5))
  }

  search(query: string, topK: number): Bm25Hit[] {
    if (this.documents.length === 0) return []

    const queryTokens = tokenize(query)
    if (queryTokens.length === 0) return []

    // 查询里重复的词只算一次权重,否则"报销报销"会把该词的分数翻倍
    const uniqueTokens = [...new Set(queryTokens)]
    const idfCache = new Map(uniqueTokens.map((token) => [token, this.inverseDocumentFrequency(token)]))

    const hits: Bm25Hit[] = []

    for (const document of this.documents) {
      let score = 0

      for (const token of uniqueTokens) {
        const termFrequency = document.frequencies.get(token)
        if (!termFrequency) continue

        const normalization = 1 - b + b * (document.length / (this.averageLength || 1))
        score += (idfCache.get(token) ?? 0) * (termFrequency * (k1 + 1)) / (termFrequency + k1 * normalization)
      }

      if (score > 0) hits.push({ id: document.id, score })
    }

    return hits.sort((a, b2) => b2.score - a.score).slice(0, topK)
  }
}
