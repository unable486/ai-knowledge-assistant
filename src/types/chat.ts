/**
 * 会话领域模型。
 *
 * 设计要点:把"消息状态"独立成字面量联合类型,而不是散落的布尔字段
 * (isLoading / isError / isDone)。布尔字段可以组合出非法状态
 * (既 loading 又 error),联合类型从类型层面就排除了这种可能。
 */

import type { SkillSelection, SkillTrace } from '../../shared/skills'

export type MessageRole = 'user' | 'assistant'

/**
 * pending   已入队但还没收到第一个字符
 * streaming 正在逐字接收
 * done      正常收完
 * aborted   用户主动中止
 * error     请求失败
 */
export type MessageStatus = 'pending' | 'streaming' | 'done' | 'aborted' | 'error'

/** 一条回复引用了知识库里的哪一块 */
export interface MessageSource {
  documentTitle: string
  heading: string
  score: number
  /** 新引用携带快照；旧会话可能只有标题、章节和检索分数。 */
  citationId?: string
  documentId?: string
  chunkId?: string
  /** 本次实际提供给模型的原始片段，按纯文本显示，不能再查当前文档来替换。 */
  excerpt?: string
}

/** SSE 与历史快照使用同一边界校验；不截断原文，以免把改写后的文本当作证据。 */
export function readMessageSources(value: unknown): MessageSource[] {
  if (!Array.isArray(value)) return []

  return value.slice(0, 20).flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const raw = item as Record<string, unknown>
    if (typeof raw.documentTitle !== 'string' || raw.documentTitle.length > 500) return []

    const source: MessageSource = {
      documentTitle: raw.documentTitle,
      heading: typeof raw.heading === 'string' && raw.heading.length <= 1_000 ? raw.heading : '',
      score: typeof raw.score === 'number' && Number.isFinite(raw.score) ? raw.score : 0
    }
    if (typeof raw.citationId === 'string' && /^S[1-9]\d{0,2}$/.test(raw.citationId)) {
      source.citationId = raw.citationId
    }
    for (const key of ['documentId', 'chunkId'] as const) {
      const id = raw[key]
      if (typeof id === 'string' && id.length > 0 && id.length <= 200 && !/\s|[\u0000-\u001f\u007f]/.test(id)) {
        source[key] = id
      }
    }
    if (typeof raw.excerpt === 'string' && raw.excerpt.length > 0 && raw.excerpt.length <= 6_000) {
      source.excerpt = raw.excerpt
    }
    return [source]
  })
}

/**
 * 一个候选块在检索全过程里的轨迹。
 *
 * 两路的名次和分数都留着,而且分开存 —— 因为它们**不可比**:
 * vectorScore 是 [-1,1] 的余弦,keywordScore 是无上界的 BM25 分。
 * 面板里必须分两列展示,合成一个数就把这个信息毁了。
 */
export interface RetrievalCandidate {
  chunkId: string
  documentTitle: string
  heading: string
  preview: string
  vectorRank: number | null
  vectorScore: number | null
  keywordRank: number | null
  keywordScore: number | null
  fusedScore: number
  fusedRank: number
  /** 是否真的进了 prompt。融合排进 topK 但被字符预算截掉的块,这里是 false */
  used: boolean
}

/**
 * 一次检索的完整过程记录。
 *
 * 刻意**不落 localStorage**:一条 trace 大约 3KB(12 个候选 × 240 字预览),
 * 按单会话 200 条消息算就是 600KB,几个会话就撑爆 5MB 配额,把真正该留的
 * 对话内容挤掉。trace 的价值是"当场看这次检索为什么这样",不是历史归档。
 * 见 services/storage/chatStorage.ts 的 reviveMessage —— 它不读这个字段。
 */
export interface RetrievalTrace {
  question: string
  query?: string
  status?: 'matched' | 'insufficient'
  timings: {
    embed: number
    vector: number
    keyword: number
    fuse: number
    total: number
  }
  counts: {
    vector: number
    keyword: number
    fused: number
  }
  candidates: RetrievalCandidate[]
}

export interface ChatMessage {
  id: string
  role: MessageRole
  /** 已接收到的原始 Markdown 文本,流式过程中会不断追加 */
  content: string
  status: MessageStatus
  /** 失败时的用户可读原因,status !== 'error' 时为 undefined */
  error?: string
  /** 本次回复参考的知识库片段,没检索到时为 undefined */
  sources?: MessageSource[]
  /**
   * 本次检索的过程记录,仅当前会话内存里有,不持久化(理由见 RetrievalTrace)。
   * 刷新后为 undefined —— 面板会消失,但 sources 还在。
   */
  retrievalTrace?: RetrievalTrace
  /** 发送时的技能选择快照；重试复用，旧会话缺省为 auto。 */
  skillSelection?: SkillSelection
  /** 本次技能使用过程，仅在内存保留，与知识库事实引用分开。 */
  skillTrace?: SkillTrace
  createdAt: number
}

export interface Conversation {
  id: string
  title: string
  messages: ChatMessage[]
  createdAt: number
  updatedAt: number
}

/** 与旧 Mock 兼容的流片段类型,真实流由 services/chatApi.ts 消费 */
export interface StreamChunk {
  delta: string
}
