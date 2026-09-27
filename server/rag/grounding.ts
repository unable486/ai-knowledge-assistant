import type { ChatRequestMessage } from '../../shared/chatContext.ts'

export const insufficientEvidenceReply = '知识库中没有找到足够的相关依据，暂时无法根据资料回答这个问题。请补充相关文档，或说明具体要查询的内容。'

/** 明确的指代追问补上最近一个用户问题；独立问题不混入旧话题。 */
export function buildRetrievalQuery(question: string, history: readonly ChatRequestMessage[] = []): string {
  const followsUp = /它们?|这个|那个|这种|那种|这些|这么|这样|这里|上述|^(那|那么|还有|然后|为什么[？?]?$|多少[？?]?$)/.test(question)
  const previous = followsUp ? [...history].reverse().find((message) => message.role === 'user') : undefined
  if (!previous) return question
  // ponytail: 只补一个近期问题，避免重发整段历史；复杂省略句留给后续查询改写。
  return `${question}\n上一个问题：${previous.content.slice(0, 300)}`
}

export function citationIds(answer: string): string[] {
  return [...new Set([...answer.matchAll(/\[([^\]\r\n]*)\]/g)]
    .flatMap((group) => [...group[1].matchAll(/\bS\d+\b/g)].map((match) => match[0])))]
}

export function unknownCitationIds(answer: string, availableIds: readonly string[]): string[] {
  const allowed = new Set(availableIds)
  return citationIds(answer).filter((id) => !allowed.has(id))
}
