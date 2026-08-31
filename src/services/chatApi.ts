import { httpClient } from './http/client'
import { readSseFrames } from './http/sse'

import type { MessageSource, RetrievalCandidate, RetrievalTrace } from '../types/chat'

export interface ChatRequestMessage {
  role: 'user' | 'assistant'
  content: string
}

/**
 * 流里现在有三种东西:文本增量、引用来源、检索过程记录。
 * 用可辨识联合而不是三个回调,调用方一个 for-await 就能全处理,
 * 顺序也天然保持和服务端一致。
 *
 * 加 trace 这一种时只动了这个联合和一个 case,调用方的 for-await 结构没变 ——
 * 这是可辨识联合比回调好的地方:新增事件类型是加一个分支,不是加一个参数。
 */
export type ChatStreamEvent =
  | { kind: 'delta'; text: string }
  | { kind: 'sources'; sources: MessageSource[] }
  | { kind: 'trace'; trace: RetrievalTrace }

function readSources(payload: unknown): MessageSource[] {
  if (!payload || typeof payload !== 'object' || !('sources' in payload)) return []
  const raw = (payload as { sources: unknown }).sources
  if (!Array.isArray(raw)) return []

  return raw.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const { documentTitle, heading, score } = item as Record<string, unknown>
    if (typeof documentTitle !== 'string') return []
    return [{
      documentTitle,
      heading: typeof heading === 'string' ? heading : '',
      score: typeof score === 'number' ? score : 0
    }]
  })
}

/** null 和数字都要保留:null 表示"没进这一路的榜",和 0 分是完全不同的意思。 */
function readNullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function readCandidate(value: unknown): RetrievalCandidate | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (typeof raw.chunkId !== 'string') return null

  return {
    chunkId: raw.chunkId,
    documentTitle: typeof raw.documentTitle === 'string' ? raw.documentTitle : '未命名文档',
    heading: typeof raw.heading === 'string' ? raw.heading : '',
    preview: typeof raw.preview === 'string' ? raw.preview : '',
    vectorRank: readNullableNumber(raw.vectorRank),
    vectorScore: readNullableNumber(raw.vectorScore),
    keywordRank: readNullableNumber(raw.keywordRank),
    keywordScore: readNullableNumber(raw.keywordScore),
    fusedScore: readNumber(raw.fusedScore),
    fusedRank: readNumber(raw.fusedRank),
    used: raw.used === true
  }
}

/**
 * 解析检索过程记录。
 *
 * 这条数据虽然来自我们自己的服务端,仍然按不可信输入校验 —— 理由和
 * localStorage 一样:边界就是边界。中间代理改写、服务端版本不一致、
 * 部署时前后端不同步,都会让结构对不上。坏了就整个丢掉返回 null,
 * 面板不显示,但对话继续 —— 它是诊断信息,缺了不影响主流程。
 */
function readTrace(payload: unknown): RetrievalTrace | null {
  if (!payload || typeof payload !== 'object') return null
  const raw = (payload as { trace?: unknown }).trace
  if (!raw || typeof raw !== 'object') return null

  const record = raw as Record<string, unknown>
  const timings = (record.timings ?? {}) as Record<string, unknown>
  const counts = (record.counts ?? {}) as Record<string, unknown>

  const candidates = Array.isArray(record.candidates)
    ? record.candidates.flatMap((item) => {
        const candidate = readCandidate(item)
        return candidate ? [candidate] : []
      })
    : []

  // 一个候选都没解析出来的 trace 没有展示价值
  if (candidates.length === 0) return null

  return {
    question: typeof record.question === 'string' ? record.question : '',
    timings: {
      embed: readNumber(timings.embed),
      vector: readNumber(timings.vector),
      keyword: readNumber(timings.keyword),
      fuse: readNumber(timings.fuse),
      total: readNumber(timings.total)
    },
    counts: {
      vector: readNumber(counts.vector),
      keyword: readNumber(counts.keyword),
      fused: readNumber(counts.fused)
    },
    candidates
  }
}

function readText(payload: unknown): string | null {
  if (payload && typeof payload === 'object' && 'text' in payload && typeof payload.text === 'string') {
    return payload.text
  }
  return null
}

function readErrorMessage(payload: unknown): string {
  if (payload && typeof payload === 'object' && 'message' in payload && typeof payload.message === 'string') {
    return payload.message
  }
  return '对话服务生成回复时发生错误。'
}

/** done 事件里的非正常结束说明（截断、拒绝等），正常结束为 null。 */
function readNotice(payload: unknown): string | null {
  if (payload && typeof payload === 'object' && 'notice' in payload && typeof payload.notice === 'string') {
    return payload.notice
  }
  return null
}

/**
 * 提交完整会话历史并消费后端转发的 SSE 文本流。
 * HTTP 错误与网络异常由 httpClient 的拦截器统一处理；
 * API Key 只存在服务端，浏览器仅请求项目自己的 /api/chat。
 */
export async function* streamChatReply(
  messages: ChatRequestMessage[],
  signal: AbortSignal
): AsyncGenerator<ChatStreamEvent, void, void> {
  const response = await httpClient.postJson('/api/chat', { messages }, signal)

  let completed = false
  let notice: string | null = null

  for await (const frame of readSseFrames(response)) {
    let payload: unknown
    try {
      payload = JSON.parse(frame.data)
    } catch {
      throw new Error('对话服务返回了无法解析的流数据。')
    }

    if (frame.event === 'delta') {
      const text = readText(payload)
      if (text !== null) yield { kind: 'delta', text }
      continue
    }

    if (frame.event === 'sources') {
      yield { kind: 'sources', sources: readSources(payload) }
      continue
    }

    // trace 解析失败返回 null,这时静默跳过而不是抛错:它只是调试面板的
    // 数据,坏了就不显示面板,不该让整次对话失败。
    if (frame.event === 'trace') {
      const trace = readTrace(payload)
      if (trace) yield { kind: 'trace', trace }
      continue
    }

    if (frame.event === 'error') {
      throw new Error(readErrorMessage(payload))
    }

    if (frame.event === 'done') {
      completed = true
      notice = readNotice(payload)
    }
  }

  // 已产出的文本保留在界面上，但结束状态必须如实反映：
  // 没收到 done 说明流被意外中断，收到 notice 说明回复未正常结束。
  if (!completed) {
    throw new Error('响应流意外中断，回复可能不完整。')
  }
  if (notice) {
    throw new Error(notice)
  }
}
