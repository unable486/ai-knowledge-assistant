import Anthropic from '@anthropic-ai/sdk'
import 'dotenv/config'
import express, { type Request, type Response } from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const app = express()
const port = Number(process.env.PORT ?? 8787)
const maxMessages = 40
const maxMessageCharacters = 20_000
const maxConversationCharacters = 120_000

app.use(express.json({ limit: '256kb' }))

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

function publicErrorMessage(error: unknown): string {
  const status = errorStatus(error)
  if (status === 401) return 'Anthropic API Key 无效，请检查服务端 .env 配置。'
  if (status === 429) return '请求过于频繁，请稍后再试。'
  if (status !== undefined && status >= 500) return 'Claude 服务暂时不可用，请稍后重试。'
  return error instanceof Error ? error.message : '对话服务暂时不可用，请稍后重试。'
}

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

  res.status(200)
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  const baseURL = process.env.ANTHROPIC_BASE_URL?.trim()
  const client = new Anthropic(baseURL ? { apiKey, baseURL } : { apiKey })
  const stream = client.messages.stream({
    model: process.env.ANTHROPIC_MODEL?.trim() || 'claude-opus-5',
    max_tokens: 16_000,
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

    await stream.finalMessage()
    if (!disconnected) {
      sendSse(res, 'done', {})
      res.end()
    }
  } catch (error) {
    if (!disconnected) {
      sendSse(res, 'error', { message: publicErrorMessage(error) })
      res.end()
    }
  } finally {
    res.off('close', onClose)
  }
})

const currentFile = fileURLToPath(import.meta.url)
const currentDirectory = path.dirname(currentFile)
const projectRoot = path.resolve(currentDirectory, '..')
const distDirectory = path.join(projectRoot, 'dist')

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(distDirectory))
  app.get(/^(?!\/api(?:\/|$)).*/, (_req, res) => {
    res.sendFile(path.join(distDirectory, 'index.html'))
  })
}

app.listen(port, () => {
  console.log(`API server listening on http://localhost:${port}`)
})
