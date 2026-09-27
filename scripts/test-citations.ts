import assert from 'node:assert/strict'
import { test } from 'node:test'
import { streamChatReply } from '../src/services/chatApi.ts'
import { readSnapshot, writeSnapshot, type ChatSnapshot } from '../src/services/storage/chatStorage.ts'
import { readMessageSources, type MessageSource, type RetrievalTrace } from '../src/types/chat.ts'

const source: MessageSource = {
  citationId: 'S1',
  documentId: 'document-1',
  chunkId: 'chunk-1',
  documentTitle: '检索指南',
  heading: '引用 > 原文',
  score: 0.82,
  excerpt: '  第一行原文。\n第二行保留换行和空白。  '
}
const legacySource: MessageSource = { documentTitle: '旧文档', heading: '', score: 0.4 }

test('SSE preserves citation snapshots and legacy sources alongside answer text', async (t) => {
  const sources = [source, legacySource]
  t.mock.method(globalThis, 'fetch', async () => new Response([
    `event: sources\ndata: ${JSON.stringify({ sources })}\n\n`,
    'event: delta\ndata: {"text":"答案 [S1]"}\n\n',
    'event: done\ndata: {"notice":null}\n\n'
  ].join(''), { headers: { 'Content-Type': 'text/event-stream' } }))

  const events = []
  for await (const event of streamChatReply([{ role: 'user', content: '查看引用' }], new AbortController().signal)) {
    events.push(event)
  }
  assert.deepEqual(events, [
    { kind: 'sources', sources },
    { kind: 'delta', text: '答案 [S1]' }
  ])
})

test('source parsing bounds untrusted data without truncating an excerpt into false evidence', () => {
  const invalid = {
    ...source,
    citationId: '<script>1</script>',
    documentId: 'x'.repeat(201),
    chunkId: 123,
    heading: 'x'.repeat(1_001),
    score: Infinity,
    excerpt: 'x'.repeat(6_001),
    retrievalTrace: { hidden: 'must not be retained' }
  }
  assert.deepEqual(readMessageSources([
    null, [], 'wrong', { documentTitle: 12 }, { documentTitle: 'x'.repeat(501) }, invalid
  ]), [{ documentTitle: source.documentTitle, heading: '', score: 0 }])
  assert.equal(invalid.excerpt.length, 6_001)
  assert.deepEqual(readMessageSources({ sources: [source] }), [])
  assert.deepEqual(readMessageSources(undefined), [])

  const boundary = {
    ...source,
    citationId: 'S999',
    documentId: 'd'.repeat(200),
    chunkId: 'c'.repeat(200),
    documentTitle: 't'.repeat(500),
    heading: 'h'.repeat(1_000),
    excerpt: 'e'.repeat(6_000)
  }
  assert.deepEqual(readMessageSources([boundary]), [boundary])
  assert.equal(readMessageSources(Array.from({ length: 21 }, () => source)).length, 20)
  assert.equal(readMessageSources([{ ...source, citationId: 'S0' }])[0].citationId, undefined)
  assert.equal(readMessageSources([{ ...source, chunkId: 'bad\nid' }])[0].chunkId, undefined)
})

test('malformed SSE sources are ignored without losing the answer', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response([
    'event: sources\ndata: {"sources":{"not":"an array"}}\n\n',
    'event: delta\ndata: {"text":"仍可回答"}\n\n',
    'event: done\ndata: {}\n\n'
  ].join('')))
  const events = []
  for await (const event of streamChatReply([{ role: 'user', content: '问题' }], new AbortController().signal)) {
    events.push(event)
  }
  assert.deepEqual(events, [{ kind: 'sources', sources: [] }, { kind: 'delta', text: '仍可回答' }])
})

test('snapshots restore exact citation text and old sources while excluding runtime traces', (t) => {
  // Node-only Storage substitute: never access a browser or the user's real localStorage.
  const values = new Map<string, string>()
  const storage: Storage = {
    get length() { return values.size },
    clear: () => values.clear(),
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value) },
    removeItem: (key) => { values.delete(key) }
  }
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', { value: { localStorage: storage }, configurable: true })
  t.after(() => {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
    else Reflect.deleteProperty(globalThis, 'window')
  })

  const html = '<img src=x onerror="globalThis.citationExecuted=true">\n<script>alert(1)</script>'
  const htmlSource = { ...source, citationId: 'S2', documentTitle: '<b>标题</b>', heading: '<svg onload=alert(1)>', excerpt: html }
  const parsedSources = readMessageSources([source, legacySource, htmlSource])
  assert.equal(parsedSources[2].excerpt, html)
  assert.equal(parsedSources[2].documentTitle, '<b>标题</b>')
  const trace: RetrievalTrace = {
    question: 'runtime-only trace',
    timings: { embed: 1, vector: 1, keyword: 1, fuse: 1, total: 4 },
    counts: { vector: 1, keyword: 1, fused: 1 },
    candidates: []
  }
  const snapshot: ChatSnapshot = {
    activeId: 'conversation-1',
    conversations: [{
      id: 'conversation-1', title: '引用回归', createdAt: 1, updatedAt: 2,
      messages: [{
        id: 'message-1', role: 'assistant', content: '答案 [S1]', status: 'done', createdAt: 2,
        sources: parsedSources, retrievalTrace: trace
      }]
    }]
  }
  const original = structuredClone(snapshot)
  assert.equal(writeSnapshot(snapshot), true)
  assert.deepEqual(snapshot, original)
  const saved = values.get('ai-knowledge-assistant:chat')!
  assert.ok(saved)
  assert.equal(saved.includes('retrievalTrace'), false)
  const restored = readSnapshot()!
  assert.deepEqual(restored.conversations[0].messages[0].sources, parsedSources)
  assert.equal(restored.conversations[0].messages[0].retrievalTrace, undefined)
  assert.equal(restored.conversations[0].messages[0].sources![2].excerpt, html)

  // An unchanged v1 envelope still restores, and invalid optional fields degrade to old metadata.
  const oldEnvelope = JSON.parse(saved)
  oldEnvelope.conversations[0].messages[0].sources = [
    legacySource,
    { ...source, excerpt: 'x'.repeat(6_001), documentId: {}, chunkId: [], citationId: false }
  ]
  oldEnvelope.conversations[0].messages[0].retrievalTrace = trace
  storage.setItem('ai-knowledge-assistant:chat', JSON.stringify(oldEnvelope))
  const legacyMessage = readSnapshot()!.conversations[0].messages[0]
  assert.deepEqual(legacyMessage.sources, [
    legacySource,
    { documentTitle: source.documentTitle, heading: source.heading, score: source.score }
  ])
  assert.equal(legacyMessage.retrievalTrace, undefined)
})
