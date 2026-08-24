import { httpClient } from './http/client'
import { readSseFrames } from './http/sse'

export interface ChatRequestMessage {
  role: 'user' | 'assistant'
  content: string
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
): AsyncGenerator<string, void, void> {
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
      if (text !== null) yield text
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
