import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { ChatMessage, Conversation, MessageStatus } from '../types/chat'
import { createId } from '../utils/id'

/**
 * 会话状态仓库。
 *
 * 只管"数据长什么样"和"怎么改数据",不碰网络请求——请求编排放在
 * useChat.ts 里。这样 store 是纯粹可预测的,单测不需要 mock 网络层。
 */
export const useChatStore = defineStore('chat', () => {
  const conversations = ref<Conversation[]>([])
  const activeId = ref<string>('')

  const activeConversation = computed(
    () => conversations.value.find((c) => c.id === activeId.value) ?? null
  )

  const messages = computed<ChatMessage[]>(() => activeConversation.value?.messages ?? [])

  /** 是否有消息正在生成中——用来控制输入框禁用和"停止"按钮显隐 */
  const isStreaming = computed(() =>
    messages.value.some((m) => m.status === 'pending' || m.status === 'streaming')
  )

  function createConversation(): Conversation {
    const now = Date.now()
    const conv: Conversation = {
      id: createId('conv'),
      title: '新对话',
      messages: [],
      createdAt: now,
      updatedAt: now
    }
    conversations.value.unshift(conv)
    activeId.value = conv.id
    return conv
  }

  /** 保证一定有一个活跃会话,首次进入或删完之后调用 */
  function ensureConversation(): Conversation {
    return activeConversation.value ?? createConversation()
  }

  function switchConversation(id: string) {
    if (conversations.value.some((c) => c.id === id)) {
      activeId.value = id
    }
  }

  function removeConversation(id: string) {
    const idx = conversations.value.findIndex((c) => c.id === id)
    if (idx === -1) return

    conversations.value.splice(idx, 1)

    if (activeId.value === id) {
      // 删掉当前会话后落到相邻的一个,而不是直接清空,减少跳变感
      activeId.value = conversations.value[Math.min(idx, conversations.value.length - 1)]?.id ?? ''
    }
  }

  function appendMessage(
    conversationId: string,
    payload: Pick<ChatMessage, 'role' | 'content' | 'status'>
  ): ChatMessage {
    const conv = conversations.value.find((c) => c.id === conversationId)
    if (!conv) throw new Error(`会话不存在: ${conversationId}`)

    const message: ChatMessage = {
      id: createId('msg'),
      createdAt: Date.now(),
      ...payload
    }
    conv.messages.push(message)
    conv.updatedAt = message.createdAt

    // 用首条用户提问做标题,截断避免侧边栏被撑开
    if (conv.title === '新对话' && payload.role === 'user') {
      conv.title = payload.content.slice(0, 20) || '新对话'
    }

    return message
  }

  function findMessage(conversationId: string, messageId: string): ChatMessage | null {
    const conv = conversations.value.find((c) => c.id === conversationId)
    return conv?.messages.find((m) => m.id === messageId) ?? null
  }

  /** 流式追加内容。第一块到达时顺带把状态从 pending 推进到 streaming */
  function appendDelta(conversationId: string, messageId: string, delta: string) {
    const message = findMessage(conversationId, messageId)
    if (!message) return

    message.content += delta
    if (message.status === 'pending') {
      message.status = 'streaming'
    }
  }

  function setMessageStatus(
    conversationId: string,
    messageId: string,
    status: MessageStatus,
    error?: string
  ) {
    const message = findMessage(conversationId, messageId)
    if (!message) return

    message.status = status
    message.error = status === 'error' ? error : undefined
  }

  /** 重试前把消息清回初始态,复用同一条消息而不是新建,避免界面里留下失败残影 */
  function resetMessage(conversationId: string, messageId: string) {
    const message = findMessage(conversationId, messageId)
    if (!message) return

    message.content = ''
    message.status = 'pending'
    message.error = undefined
  }

  /** 找到某条 assistant 消息对应的用户提问,用于重试 */
  function findPrecedingQuestion(conversationId: string, messageId: string): string | null {
    const conv = conversations.value.find((c) => c.id === conversationId)
    if (!conv) return null

    const idx = conv.messages.findIndex((m) => m.id === messageId)
    for (let i = idx - 1; i >= 0; i -= 1) {
      if (conv.messages[i].role === 'user') return conv.messages[i].content
    }
    return null
  }

  return {
    conversations,
    activeId,
    activeConversation,
    messages,
    isStreaming,
    createConversation,
    ensureConversation,
    switchConversation,
    removeConversation,
    appendMessage,
    appendDelta,
    setMessageStatus,
    resetMessage,
    findPrecedingQuestion
  }
})
