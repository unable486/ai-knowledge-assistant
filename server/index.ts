import Anthropic from '@anthropic-ai/sdk'
import dotenv from 'dotenv'
import express, { type Request, type Response } from 'express'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { warmUpEmbedder } from './rag/embedder.ts'
import { ingestDocument } from './rag/ingest.ts'
import { retrieve } from './rag/retriever.ts'
import { listDocuments, loadIndex, removeDocument } from './rag/vectorStore.ts'

const currentFile = fileURLToPath(import.meta.url)
const currentDirectory = path.dirname(currentFile)
const projectRoot = path.resolve(currentDirectory, '..')
dotenv.config({ path: path.join(projectRoot, '.env') })

const app = express()
const port = Number(process.env.PORT ?? 8787)
// 默认只绑本机:公网部署时 API 不带认证,绑 0.0.0.0 等于把 API Key 额度开放给全网。
// 需要跨机访问就走 nginx 反代或 SSH 隧道;确实要监听公网时显式设 HOST=0.0.0.0。
const host = process.env.HOST?.trim() || '127.0.0.1'
const maxMessages = 40
const maxMessageCharacters = 20_000
const maxConversationCharacters = 120_000

// 1MB 是为文档上传留的余量;对话本身远用不到这么多。
app.use(express.json({ limit: '1mb' }))

interface ChatRequestMessage {
  role: 'user' | 'assistant'
  content: string
}

function isChatRequestMessage(value: unknown): value is ChatRequestMessage {
  if (!value || typeof value !== 'object') return false
  const message = value as Record<string, unknown>
  return (
    (message.role === 'user' || message.role === 'assistant') &&
    typeof message.content === 'string'
  )
}

function readMessages(body: unknown): ChatRequestMessage[] | null {
  if (!body || typeof body !== 'object') return null
  const messages = (body as Record<string, unknown>).messages
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > maxMessages) {
    return null
  }

  const normalized = messages.map((message) => {
    if (!isChatRequestMessage(message)) return null
    const content = message.content.trim()
    return content ? { role: message.role, content } : null
  })

  if (normalized.some((message) => message === null)) return null

  const validMessages = normalized as ChatRequestMessage[]
  const totalCharacters = validMessages.reduce((total, message) => total + message.content.length, 0)
  if (totalCharacters > maxConversationCharacters) return null
  if (validMessages.some((message) => message.content.length > maxMessageCharacters)) return null

  return validMessages
}

function sendJsonError(res: Response, status: number, message: string) {
  res.status(status).json({ error: message })
}

function sendSse(res: Response, event: string, data: unknown) {
  if (res.writableEnded) return
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

function errorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined
  const status = (error as { status?: unknown }).status
  return typeof status === 'number' ? status : undefined
}

/** 非正常结束时给前端一句可直接展示的说明；正常结束返回 null。 */
function incompleteNotice(stopReason: string | null): string | null {
  if (stopReason === 'max_tokens') return '回复因达到长度上限被截断。'
  if (stopReason === 'refusal') return '模型拒绝了本次请求。'
  if (stopReason === 'model_context_window_exceeded') return '对话过长，已超出模型上下文窗口。'
  if (stopReason === null || stopReason === 'end_turn' || stopReason === 'stop_sequence') return null
  return `回复未正常结束（${stopReason}）。`
}

function publicErrorMessage(error: unknown): string {
  const status = errorStatus(error)
  if (status === 401) return 'Anthropic API Key 无效，请检查服务端 .env 配置。'
  if (status === 429) return '请求过于频繁，请稍后再试。'
  if (status !== undefined && status >= 500) return 'Claude 服务暂时不可用，请稍后重试。'
  return error instanceof Error ? error.message : '对话服务暂时不可用，请稍后重试。'
}

const maxDocumentCharacters = 200_000

app.get('/api/documents', (_req: Request, res: Response) => {
  res.json({ documents: listDocuments() })
})

app.post('/api/documents', async (req: Request, res: Response) => {
  const body: unknown = req.body
  const title = typeof (body as { title?: unknown })?.title === 'string'
    ? ((body as { title: string }).title).trim()
    : ''
  const text = typeof (body as { text?: unknown })?.text === 'string'
    ? (body as { text: string }).text
    : ''

  if (!text.trim()) {
    sendJsonError(res, 400, '文档内容不能为空。')
    return
  }
  if (text.length > maxDocumentCharacters) {
    sendJsonError(res, 413, `文档过长，上限 ${maxDocumentCharacters} 字符。`)
    return
  }

  try {
    const result = await ingestDocument(title || '未命名文档', text)
    res.status(201).json({ document: result.document })
  } catch (error) {
    sendJsonError(res, 500, error instanceof Error ? error.message : '文档入库失败。')
  }
})

app.delete('/api/documents/:id', async (req: Request, res: Response) => {
  // Express 5 把 params 值类型放宽成 string | string[],取第一个即可
  const rawId = req.params.id
  const id = Array.isArray(rawId) ? rawId[0] : rawId
  const removed = await removeDocument(id)
  if (!removed) {
    sendJsonError(res, 404, '文档不存在。')
    return
  }
  res.status(204).end()
})

app.post('/api/chat', async (req: Request, res: Response) => {
  const messages = readMessages(req.body)
  if (!messages) {
    sendJsonError(res, 400, '请求消息格式无效或内容过长。')
    return
  }

  const apiKey = process.env.ANTHROPIC_API_KEY?.trim()
  if (!apiKey) {
    sendJsonError(res, 503, '服务端尚未配置 ANTHROPIC_API_KEY。')
    return
  }

  // 检索必须在发响应头之前:一旦 flushHeaders(),状态码就定死 200,
  // 后面失败只能在流里发 error 事件。检索失败属于"还没开始对话就出问题",
  // 应该用正常的 HTTP 错误码返回。
  //
  // 只用最后一条用户消息做检索,不拼整个历史——早几轮的话题会稀释
  // 当前问题的语义。
  const question = [...messages].reverse().find((m) => m.role === 'user')?.content ?? ''
  let retrieval: Awaited<ReturnType<typeof retrieve>> = null
  try {
    retrieval = question ? await retrieve(question) : null
  } catch (error) {
    sendJsonError(res, 500, error instanceof Error ? error.message : '知识库检索失败。')
    return
  }

  res.status(200)
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  // 先把引用来源发给前端,让它在回答生成前就能显示"参考了哪些文档"
  //
  // trace 和 sources 一起发,不做成"面板打开时按需拉取"的单独接口。
  // 按需拉取有两条路,都比现在差:重跑一次检索要多花几十毫秒 embedding,
  // 而且重跑的结果未必和这次回答用的一致(索引可能已经变了),那 trace 就
  // 失去了解释力;缓存 trace 则多出一份要考虑过期和清理的状态。
  // 代价是每次回答多传几 KB —— 相比流式文本本身的量,这个开销可以忽略。
  if (retrieval) {
    sendSse(res, 'sources', { sources: retrieval.sources })
    sendSse(res, 'trace', { trace: retrieval.trace })
  }

  const baseURL = process.env.ANTHROPIC_BASE_URL?.trim()
  const client = new Anthropic(baseURL ? { apiKey, baseURL } : { apiKey })
  const stream = client.messages.stream({
    model: process.env.ANTHROPIC_MODEL?.trim() || 'claude-opus-5',
    max_tokens: 16_000,
    ...(retrieval ? { system: retrieval.systemPrompt } : {}),
    messages
  })

  let disconnected = false
  const onClose = () => {
    disconnected = true
    stream.abort()
  }
  res.on('close', onClose)

  try {
    stream.on('text', (text) => {
      if (!disconnected) sendSse(res, 'delta', { text })
    })

    const finalMessage = await stream.finalMessage()
    if (!disconnected) {
      // 只有 end_turn 才是真正的正常收尾；截断和拒绝都要让前端可区分。
      sendSse(res, 'done', {
        stopReason: finalMessage.stop_reason,
        notice: incompleteNotice(finalMessage.stop_reason)
      })
      res.end()
    }
  } catch (error) {
    // 服务端记完整原因,发给前端的仍是脱敏文案
    console.error('[chat] 上游调用失败:', error)
    if (!disconnected) {
      sendSse(res, 'error', { message: publicErrorMessage(error) })
      res.end()
    }
  } finally {
    res.off('close', onClose)
  }
})

const distDirectory = path.join(projectRoot, 'dist')

if (process.env.NODE_ENV === 'production') {
  // 生产模式忘了先 build 的话，这里直接说清楚，不然只会看到一堆 404
  if (!existsSync(path.join(distDirectory, 'index.html'))) {
    console.warn(`[server] 未找到 ${distDirectory}/index.html，请先执行 npm run build`)
  }
  app.use(express.static(distDirectory))
  app.get(/^(?!\/api(?:\/|$)).*/, (_req, res) => {
    res.sendFile(path.join(distDirectory, 'index.html'))
  })
}

app.listen(port, host, async () => {
  console.log(`API server listening on http://${host}:${port}`)
  // 打出实际生效的模型名:环境变量会覆盖 .env,排查上游 4xx/5xx 时第一个要确认的就是这个
  console.log(`[chat] 使用模型: ${process.env.ANTHROPIC_MODEL?.trim() || 'claude-opus-5'}`)

  await loadIndex()

  // 预热把 24MB 权重的加载成本从首个请求挪到启动阶段。
  // 失败不影响普通对话——只是知识库功能不可用,所以只警告不退出。
  try {
    const started = Date.now()
    await warmUpEmbedder()
    console.log(`[rag] embedding 模型就绪（${Date.now() - started}ms）`)
  } catch (error) {
    console.warn('[rag] embedding 模型加载失败，知识库功能不可用:', error)
  }
})
