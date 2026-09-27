import assert from 'node:assert/strict'
import { test } from 'node:test'
import { planChatReply } from '../server/chatPolicy.ts'
import { insufficientEvidenceReply } from '../server/rag/grounding.ts'
import type { Retrieval } from '../server/rag/retriever.ts'

const insufficient: Retrieval = {
  status: 'insufficient', systemPrompt: 'knowledge instructions', sources: [],
  trace: {
    question: 'q', query: 'q', status: 'insufficient',
    timings: { embed: 0, vector: 0, keyword: 0, fuse: 0, total: 0 },
    counts: { vector: 0, keyword: 0, fused: 0 }, candidates: []
  }
}

test('without skills insufficient knowledge keeps the deterministic response and empty library stays ordinary chat', () => {
  assert.equal(planChatReply(insufficient, '').localReply, insufficientEvidenceReply)
  assert.deepEqual(planChatReply(null, ''), { localReply: null, systemPrompt: '' })
})

test('skill analysis preserves the full core while marking missing knowledge as missing evidence', () => {
  const core = 'CORE_START\n检查输入。\n例外：没有代码时不能声称已定位根因。\nCORE_END'
  const result = planChatReply(insufficient, core)
  assert.equal(result.localReply, null)
  assert.ok(result.systemPrompt.includes(core))
  assert.ok(result.systemPrompt.includes(insufficient.systemPrompt))
  assert.ok(result.systemPrompt.includes('不得伪造引用'))
  assert.ok(result.systemPrompt.includes('不授予工具或文件访问能力'))
})

test('matched knowledge and selected skills are both included, with no instructions leaking to a later off request', () => {
  const matched: Retrieval = { ...insufficient, status: 'matched', systemPrompt: 'evidence [S1]' }
  assert.ok(planChatReply(matched, 'selected core').systemPrompt.includes('evidence [S1]'))
  assert.ok(planChatReply(matched, 'selected core').systemPrompt.includes('selected core'))
  assert.equal(planChatReply(matched, '').systemPrompt, matched.systemPrompt)
})
