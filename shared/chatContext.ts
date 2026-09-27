export interface ChatRequestMessage {
  role: 'user' | 'assistant'
  content: string
}

// 浏览器裁剪和服务端校验共用同一份上限，避免长会话再次撞到接口限制。
export const chatLimits = {
  maxMessages: 40,
  maxMessageCharacters: 20_000,
  maxConversationCharacters: 120_000
} as const

/** 只裁剪本次请求，保留最近的完整轮次和当前问题，不修改聊天记录。 */
// ponytail: 复用字符上限；需要精确控制模型窗口时再接对应模型的 token 计数。
export function selectChatContext(messages: readonly ChatRequestMessage[]): ChatRequestMessage[] {
  const latest = messages[messages.length - 1]
  if (!latest || latest.role !== 'user' || !latest.content.trim()) {
    throw new Error('请输入要发送的问题。')
  }
  if (latest.content.trim().length > chatLimits.maxMessageCharacters) {
    throw new Error(`问题过长，请缩短到 ${chatLimits.maxMessageCharacters} 字符以内后重新发送。`)
  }

  let start = messages.length
  let characters = 0
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const length = messages[index].content.trim().length
    if (
      messages.length - index > chatLimits.maxMessages ||
      length > chatLimits.maxMessageCharacters ||
      characters + length > chatLimits.maxConversationCharacters
    ) break
    start = index
    characters += length
  }

  // 不能把缺少对应用户问题的 assistant 回复作为上下文开头。
  while (messages[start].role !== 'user') start += 1
  return messages.slice(start).map(({ role, content }) => ({ role, content: content.trim() }))
}
