/**
 * 会话持久化的读写层。
 *
 * 只负责「快照 <-> localStorage」这一件事，不认识 Pinia，也不做防抖调度，
 * 这样它可以脱离 Vue 单测（只需要一个 Storage 替身）。
 *
 * 两条边界值得注意：
 * 1. localStorage 里的内容是**不可信输入**——用户可以手改，旧版本也可能留下
 *    结构不同的数据。所以读取时逐字段校验，宁可丢掉一条坏消息，也不能让
 *    非法状态进到 store 里（比如 status 是个没定义过的字符串）。
 * 2. 写入随时可能失败：无痕模式下 setItem 直接抛错，配额写满抛
 *    QuotaExceededError。失败不能影响正在进行的对话，所以一律降级成「不存」。
 */

import type { ChatMessage, Conversation, MessageStatus } from '../../types/chat'

const storageKey = 'ai-knowledge-assistant:chat'
const schemaVersion = 1

/** 超出后按 updatedAt 丢最旧的会话，避免无限增长撑爆 5MB 配额 */
const maxConversations = 50
/** 单会话保留的消息条数，只留最近的 */
const maxMessagesPerConversation = 200

export interface ChatSnapshot {
  conversations: Conversation[]
  activeId: string
}

interface StoredEnvelope {
  version: number
  activeId: string
  conversations: Conversation[]
}

/**
 * 能落盘的状态只有终态。
 * pending / streaming 是「请求在飞」的运行时状态，刷新后那个请求已经不存在了，
 * 不能原样恢复——否则界面会永远停在「正在生成」。
 */
const terminalStatuses: readonly MessageStatus[] = ['done', 'aborted', 'error']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function readTimestamp(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * 校验并规整一条消息，无法修复时返回 null 由调用方丢弃。
 *
 * 中断态的处理是这里的关键：刷新时正在流式接收的消息，已收到的文本要保留
 * （用户看着它长出来的，凭空消失更奇怪），但状态必须改成 aborted 如实反映
 * 「这条没说完」。内容为空的占位消息没有保留价值，直接丢。
 */
function reviveMessage(value: unknown): ChatMessage | null {
  if (!isRecord(value)) return null

  const id = readString(value.id)
  const content = readString(value.content)
  const createdAt = readTimestamp(value.createdAt)
  if (id === null || content === null || createdAt === null) return null

  const role = value.role === 'user' || value.role === 'assistant' ? value.role : null
  if (role === null) return null

  const rawStatus = readString(value.status)
  let status: MessageStatus
  if (rawStatus !== null && terminalStatuses.includes(rawStatus as MessageStatus)) {
    status = rawStatus as MessageStatus
  } else if (rawStatus === 'pending' || rawStatus === 'streaming') {
    if (!content) return null
    status = 'aborted'
  } else {
    // 认不出的状态：有内容当已完成，没内容直接丢
    if (!content) return null
    status = 'done'
  }

  const error = status === 'error' ? (readString(value.error) ?? '请求失败。') : undefined

  return { id, role, content, status, error, createdAt }
}

function reviveConversation(value: unknown): Conversation | null {
  if (!isRecord(value)) return null

  const id = readString(value.id)
  const createdAt = readTimestamp(value.createdAt)
  if (id === null || createdAt === null) return null

  if (!Array.isArray(value.messages)) return null
  const messages = value.messages
    .map(reviveMessage)
    .filter((message): message is ChatMessage => message !== null)

  return {
    id,
    title: readString(value.title) || '新对话',
    messages,
    createdAt,
    updatedAt: readTimestamp(value.updatedAt) ?? createdAt
  }
}

/** 探测一次可用性并缓存：无痕模式、禁用 Cookie、策略限制都会让访问直接抛错。 */
let cachedStorage: Storage | null | undefined

function getStorage(): Storage | null {
  if (cachedStorage !== undefined) return cachedStorage

  try {
    const storage = window.localStorage
    const probeKey = `${storageKey}:probe`
    storage.setItem(probeKey, '1')
    storage.removeItem(probeKey)
    cachedStorage = storage
  } catch {
    cachedStorage = null
  }

  return cachedStorage
}

export function readSnapshot(): ChatSnapshot | null {
  const storage = getStorage()
  if (!storage) return null

  let raw: string | null
  try {
    raw = storage.getItem(storageKey)
  } catch {
    return null
  }
  if (!raw) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    // 内容坏了就当没存过，留着只会每次都解析失败
    clearSnapshot()
    return null
  }

  if (!isRecord(parsed) || parsed.version !== schemaVersion) {
    // 版本不认识：当前只有 v1，没有可迁移的旧结构，直接放弃这份数据
    clearSnapshot()
    return null
  }

  if (!Array.isArray(parsed.conversations)) return null

  const conversations = parsed.conversations
    .map(reviveConversation)
    .filter((conversation): conversation is Conversation => conversation !== null)

  if (conversations.length === 0) return null

  const storedActiveId = readString(parsed.activeId) ?? ''
  const activeId = conversations.some((conversation) => conversation.id === storedActiveId)
    ? storedActiveId
    : conversations[0].id

  return { conversations, activeId }
}

/** 按上限裁剪：先砍每个会话的消息，再砍会话总数（丢最旧的）。 */
function trim(conversations: Conversation[], conversationLimit: number): Conversation[] {
  return [...conversations]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, conversationLimit)
    .map((conversation) =>
      conversation.messages.length > maxMessagesPerConversation
        ? { ...conversation, messages: conversation.messages.slice(-maxMessagesPerConversation) }
        : conversation
    )
}

/**
 * 写入快照。返回是否成功，调用方可以据此决定要不要提示用户。
 *
 * 配额写满时不是直接放弃，而是逐步减少保留的会话数再试——把最近的对话存下来
 * 比一条都不存有用。
 */
export function writeSnapshot(snapshot: ChatSnapshot): boolean {
  const storage = getStorage()
  if (!storage) return false

  // 只存有内容的会话，空的「新对话」没必要占配额
  const meaningful = snapshot.conversations.filter(
    (conversation) => conversation.messages.length > 0
  )

  for (let limit = maxConversations; limit >= 1; limit = Math.floor(limit / 2)) {
    const conversations = trim(meaningful, limit)
    const envelope: StoredEnvelope = {
      version: schemaVersion,
      activeId: snapshot.activeId,
      conversations
    }

    try {
      storage.setItem(storageKey, JSON.stringify(envelope))
      return true
    } catch {
      // 大概率是 QuotaExceededError，缩小一半再试
      if (limit === 1) return false
    }
  }

  return false
}

export function clearSnapshot(): void {
  const storage = getStorage()
  if (!storage) return

  try {
    storage.removeItem(storageKey)
  } catch {
    // 清不掉也没有补救手段，忽略
  }
}
