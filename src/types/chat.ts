/**
 * 会话领域模型。
 *
 * 设计要点:把"消息状态"独立成字面量联合类型,而不是散落的布尔字段
 * (isLoading / isError / isDone)。布尔字段可以组合出非法状态
 * (既 loading 又 error),联合类型从类型层面就排除了这种可能。
 */

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
