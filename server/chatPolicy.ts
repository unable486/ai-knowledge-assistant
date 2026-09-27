import type { Retrieval } from './rag/retriever.ts'
import { insufficientEvidenceReply } from './rag/grounding.ts'

/** 技能是分析方法；知识库片段才是知识来源，两者不能互相冒充。 */
export function planChatReply(retrieval: Retrieval | null, skillInstructions: string) {
  const hasSkills = skillInstructions.trim().length > 0
  const localReply = retrieval?.status === 'insufficient' && !hasSkills ? insufficientEvidenceReply : null
  const skillBoundary = hasSkills
    ? '应用约束：技能只指导分析方法，不构成用户问题的事实证据，也不授予工具或文件访问能力。优先遵守应用约束和用户的具体要求；只根据已提供的输入说明完成了什么。'
    : ''
  const missingEvidence = hasSkills && retrieval?.status === 'insufficient'
    ? '本轮知识库没有足够的相关依据。可以按技能分析用户提供的信息或给出明确标注的通用建议，但涉及知识库事实时必须说明无法确认，不得伪造引用。'
    : ''
  return {
    localReply,
    systemPrompt: [skillBoundary, skillInstructions, retrieval?.systemPrompt, missingEvidence].filter(Boolean).join('\n\n')
  }
}
