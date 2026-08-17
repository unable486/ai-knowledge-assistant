export interface ChatRequestMessage {
  role: 'user' | 'assistant'
  content: string
}

interface StreamEvent {
  event: string
  data: string
}

function parseSseFrames(buffer: string): { frames: StreamEvent[]; remainder: string } {
  const frames: StreamEvent[] = []
  const normalized = buffer.replace(/\r\n/g, '\n')
  const parts = normalized.split('\n\n')
  const remainder = parts.pop() ?? ''

  for (const part of parts) {
    const lines = part.split('\n')
    const event = lines.find((line) => line.startsWith('event:'))?.slice(6).trim() ?? 'message'
    const data = lines
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n')

    if (data) frames.push({ event, data })
  }

  return { frames, remainder }
}

function errorFromResponse(status: number, body: unknown): Error {
  if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') {
    return new Error(body.error)
  }

  return new Error(`对话请求失败（HTTP ${status}）。`)
}

/**
 * 提交完整会话历史并消费后端转发的 SSE 文本流。
 * API Key 只存在服务端；浏览器仅请求项目自己的 /api/chat。
 */
export async function* streamChatReply(
  messages: ChatRequestMessage[],
  signal: AbortSignal
): AsyncGenerator<string, void, void> {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages }),
    signal
  })

  if (!response.ok) {
    let body: unknown = null
    try {
      body = await response.json()
    } catch {
      // 非 JSON 错误仍使用通用状态提示。
    }
    throw errorFromResponse(response.status, body)
  }

  if (!response.body) {
    throw new Error('对话服务没有返回可读取的响应流。')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      buffer += decoder.decode(value, { stream: !done })

      const parsed = parseSseFrames(buffer)
      buffer = parsed.remainder

      for (const frame of parsed.frames) {
        let payload: unknown
        try {
          payload = JSON.parse(frame.data)
        } catch {
          throw new Error('对话服务返回了无法解析的流数据。')
        }

        if (frame.event === 'delta') {
          if (payload && typeof payload === 'object' && 'text' in payload && typeof payload.text === 'string') {
            yield payload.text
          }
          continue
        }

        if (frame.event === 'error') {
          const message =
            payload && typeof payload === 'object' && 'message' in payload && typeof payload.message === 'string'
              ? payload.message
              : '对话服务生成回复时发生错误。'
          throw new Error(message)
        }
      }

      if (done) break
    }
  } finally {
    reader.releaseLock()
  }
}
