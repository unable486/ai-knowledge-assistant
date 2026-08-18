/** SSE 帧解析与读取，独立于具体业务接口。 */

export interface SseFrame {
  event: string
  data: string
}

/** 按空行切分 SSE 帧；不完整的尾部作为 remainder 留到下一个 chunk。 */
export function parseSseFrames(buffer: string): { frames: SseFrame[]; remainder: string } {
  const frames: SseFrame[] = []
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

/** 把响应体读成 SSE 帧序列。 */
export async function* readSseFrames(response: Response): AsyncGenerator<SseFrame, void, void> {
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
        yield frame
      }

      if (done) break
    }
  } finally {
    reader.releaseLock()
  }
}
