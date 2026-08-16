import { onScopeDispose, ref } from 'vue'
import { streamMockReply } from '../mocks/mockAI'
import { useChatStore } from '../stores/chat'

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

  /** 发送和重试共用的流消费逻辑 */
  async function runStream(conversationId: string, replyId: string, question: string) {
    const ac = new AbortController()
    controller.value = ac

    try {
      for await (const chunk of streamMockReply(question, ac.signal)) {
        store.appendDelta(conversationId, replyId, chunk.delta)
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

    const conversationId = store.ensureConversation().id

    store.appendMessage(conversationId, { role: 'user', content: input, status: 'done' })

    // 先占位一条空的 assistant 消息,UI 立刻能显示"正在思考",
    // 不用等首字节到达才渲染气泡
    const reply = store.appendMessage(conversationId, {
      role: 'assistant',
      content: '',
      status: 'pending'
    })

    await runStream(conversationId, reply.id, input)
  }

  /** 重试失败的回复:复用同一条消息,不新增用户提问 */
  async function retry(messageId: string) {
    const conversationId = store.activeConversation?.id
    if (!conversationId || store.isStreaming) return

    const question = store.findPrecedingQuestion(conversationId, messageId)
    if (!question) return

    store.resetMessage(conversationId, messageId)
    await runStream(conversationId, messageId, question)
  }

  // 组件销毁时中止在飞的请求,否则回调里还会往已卸载的 store 写数据
  onScopeDispose(abort)

  return { send, retry, abort }
}
