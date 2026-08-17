import { onScopeDispose, ref } from 'vue'
import { streamChatReply, type ChatRequestMessage } from '../services/chatApi'
import { useChatStore } from '../stores/chat'
import type { Conversation } from '../types/chat'

/**
 * 对话请求编排。
 *
 * store 只管数据,这里管"一次发送的完整生命周期":
 * 建消息占位 -> 消费流 -> 逐块写回 store -> 收尾(done/aborted/error)。
 *
 * 关键点是 AbortController 存在 ref 里:"停止"按钮、重试和组件卸载
 * 都要能拿到同一个 controller。
 */
export function useChat() {
  const store = useChatStore()
  const controller = ref<AbortController | null>(null)

  function abort() {
    controller.value?.abort()
    controller.value = null
  }

  /** 只把已经完成的文本消息发给模型,避免把空占位消息或失败草稿发上去 */
  function buildHistory(conversation: Conversation, beforeMessageId?: string): ChatRequestMessage[] {
    const endIndex = beforeMessageId
      ? conversation.messages.findIndex((message) => message.id === beforeMessageId)
      : conversation.messages.length
    const messages = conversation.messages.slice(0, endIndex === -1 ? conversation.messages.length : endIndex)

    return messages
      .filter((message) => message.status === 'done' && message.content.trim())
      .map((message) => ({ role: message.role, content: message.content }))
  }

  /** 发送和重试共用的流消费逻辑 */
  async function runStream(
    conversationId: string,
    replyId: string,
    history: ChatRequestMessage[]
  ) {
    const ac = new AbortController()
    controller.value = ac

    try {
      for await (const delta of streamChatReply(history, ac.signal)) {
        store.appendDelta(conversationId, replyId, delta)
      }
      store.setMessageStatus(conversationId, replyId, 'done')
    } catch (err) {
      // 取消不是错误,单独分支:保留已收到的内容,标成 aborted
      if (err instanceof DOMException && err.name === 'AbortError') {
        store.setMessageStatus(conversationId, replyId, 'aborted')
      } else {
        const message = err instanceof Error ? err.message : '未知错误'
        store.setMessageStatus(conversationId, replyId, 'error', message)
      }
    } finally {
      // 只有当前 controller 还是自己时才清空,防止竞态下清掉后一次请求的
      if (controller.value === ac) {
        controller.value = null
      }
    }
  }

  async function send(rawInput: string) {
    const input = rawInput.trim()
    // 空输入和"上一条还在生成"都直接拦掉,避免并发写同一条消息
    if (!input || store.isStreaming) return

    const conversation = store.ensureConversation()
    store.appendMessage(conversation.id, { role: 'user', content: input, status: 'done' })

    // 先占位一条空的 assistant 消息,UI 立刻能显示"正在思考",
    // 不用等首字节到达才渲染气泡
    const reply = store.appendMessage(conversation.id, {
      role: 'assistant',
      content: '',
      status: 'pending'
    })

    await runStream(conversation.id, reply.id, buildHistory(conversation))
  }

  /** 重试失败的回复:复用同一条消息,不新增用户提问 */
  async function retry(messageId: string) {
    const conversation = store.activeConversation
    if (!conversation || store.isStreaming) return

    const history = buildHistory(conversation, messageId)
    store.resetMessage(conversation.id, messageId)
    await runStream(conversation.id, messageId, history)
  }

  // 组件销毁时中止在飞的请求,否则回调里还会往已卸载的 store 写数据
  onScopeDispose(abort)

  return { send, retry, abort }
}
