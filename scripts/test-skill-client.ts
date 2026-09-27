import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createPinia, setActivePinia } from 'pinia'
import { effectScope } from 'vue'
import { readSkillSelection, readSkillSummary, readSkillTrace, type SkillTrace } from '../shared/skills.ts'
import { useChat } from '../src/composables/useChat.ts'
import { streamChatReply } from '../src/services/chatApi.ts'
import { readSnapshot, writeSnapshot, type ChatSnapshot } from '../src/services/storage/chatStorage.ts'
import { useChatStore } from '../src/stores/chat.ts'
import { useSkillStore } from '../src/stores/skills.ts'

const trace: SkillTrace = {
  mode: 'manual',
  selected: [{
    id: 'debug-guide', name: '排查指南', description: '按步骤排查', version: 'abc123', reason: 'manual',
    references: [{ path: 'references/checklist.md', heading: '检查步骤', version: 'def456', excerpt: '  原文\n<script>不执行</script>  ' }]
  }],
  warnings: []
}
const question = [{ role: 'user' as const, content: '如何排查？' }]
const done = 'event: done\ndata: {}\n\n'

test('sending snapshots the selection and retry uses it even after the controls change', async (t) => {
  setActivePinia(createPinia())
  const store = useChatStore()
  const skills = useSkillStore()
  const inputIds = ['debug-guide']
  skills.setSelection({ mode: 'manual', ids: inputIds })
  inputIds.push('other-guide')
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', { value: { setTimeout, clearTimeout }, configurable: true })
  t.after(() => {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
    else Reflect.deleteProperty(globalThis, 'window')
  })

  const requests: Record<string, unknown>[] = []
  let resolveFirst!: (response: Response) => void
  let markStarted!: () => void
  const started = new Promise<void>((resolve) => { markStarted = resolve })
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    requests.push(JSON.parse(String(init.body)))
    if (requests.length === 1) {
      markStarted()
      return new Promise<Response>((resolve) => { resolveFirst = resolve })
    }
    assert.equal(store.messages[1].skillTrace, undefined, 'retry clears the previous trace before requesting')
    return new Response(`event: skills\ndata: ${JSON.stringify({ trace })}\n\n${done}`)
  })

  const scope = effectScope()
  try {
    const chat = scope.run(useChat)!
    const sending = chat.send('如何排查？')
    await started
    skills.setSelection({ mode: 'off', ids: [] })
    resolveFirst(new Response([
      `event: skills\ndata: ${JSON.stringify({ trace })}\n\n`,
      'event: delta\ndata: {"text":"部分回复"}\n\n',
      'event: error\ndata: {"message":"模拟失败"}\n\n'
    ].join('')))
    await sending
    const reply = store.messages[1]
    assert.equal(reply.status, 'error')
    assert.deepEqual(reply.skillTrace, trace)
    assert.deepEqual(reply.skillSelection, { mode: 'manual', ids: ['debug-guide'] })

    await chat.retry(reply.id)
    assert.equal(store.messages.length, 2)
    assert.equal(reply.status, 'done')
    assert.deepEqual(requests.map((request) => request.skillSelection), [
      { mode: 'manual', ids: ['debug-guide'] }, { mode: 'manual', ids: ['debug-guide'] }
    ])
    assert.deepEqual(skills.selection, { mode: 'off', ids: [] })

    // A reply created before skills existed always retries in the documented auto mode.
    delete reply.skillSelection
    await chat.retry(reply.id)
    assert.deepEqual(requests[2].skillSelection, { mode: 'auto', ids: [] })
  } finally {
    scope.stop()
  }
})

test('fragmented SSE preserves skill text and sources while rejecting malformed skill diagnostics', async (t) => {
  const source = { citationId: 'S1', documentTitle: '知识文档', heading: '', score: 0.7, excerpt: '事实原文' }
  const withUnknownFields = { ...trace, privateData: 'discard', selected: trace.selected.map((skill) => ({ ...skill, body: 'discard' })) }
  const data = [
    'event: skills\r\ndata: invalid-json\r\n\r\n',
    'event: skills\r\ndata: {"trace":{"mode":"auto","selected":false,"warnings":[]}}\r\n\r\n',
    `event: skills\r\ndata: ${JSON.stringify({ trace: withUnknownFields })}\r\n\r\n`,
    `event: sources\r\ndata: ${JSON.stringify({ sources: [source] })}\r\n\r\n`,
    'event: delta\r\ndata: {"text":"正常回答 [S1]"}\r\n\r\n', done
  ].join('')
  const bytes = new TextEncoder().encode(data)
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      // Single-byte chunks split both UTF-8 characters and every CRLF boundary.
      for (let index = 0; index < bytes.length; index += 1) controller.enqueue(bytes.slice(index, index + 1))
      controller.close()
    }
  })))
  const events = []
  for await (const event of streamChatReply(question, new AbortController().signal)) events.push(event)
  assert.deepEqual(events, [
    { kind: 'skills', trace }, { kind: 'sources', sources: [source] }, { kind: 'delta', text: '正常回答 [S1]' }
  ])
})

test('skill readers reject invalid structures and oversized text without modifying reference excerpts', () => {
  assert.deepEqual(readSkillTrace(trace), trace)
  assert.equal(readSkillTrace({ ...trace, selected: Array(21).fill(trace.selected[0]) }), null)
  assert.equal(readSkillTrace({ ...trace, warnings: [false] }), null)
  for (const changes of [
    { reason: 'untrusted' }, { version: 'x'.repeat(129) },
    { references: [{ ...trace.selected[0].references[0], excerpt: 'x'.repeat(16_001) }] },
    { references: [{ ...trace.selected[0].references[0], path: [] }] }
  ]) {
    assert.equal(readSkillTrace({ ...trace, selected: [{ ...trace.selected[0], ...changes }] }), null)
  }
  assert.equal(readSkillSummary({ id: '../escape', name: '坏数据', description: '' }), null)
  assert.equal(readSkillSummary({ id: 'okay', name: '', description: '' }), null)
  assert.equal(readSkillSelection({ mode: 'manual', ids: ['../escape'] }), null)
  assert.deepEqual(readSkillSelection({ mode: 'manual', ids: ['debug-guide', 'debug-guide'] }), { mode: 'manual', ids: ['debug-guide'] })
  assert.deepEqual(readSkillSelection({ mode: 'off', ids: ['debug-guide'] }), { mode: 'off', ids: [] })
  assert.equal(trace.selected[0].references[0].excerpt, '  原文\n<script>不执行</script>  ')
})

test('v1 snapshots persist request choices, omit traces, and default old or corrupt choices to auto', (t) => {
  const values = new Map<string, string>()
  const storage: Storage = {
    get length() { return values.size }, clear: () => values.clear(),
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value) }, removeItem: (key) => { values.delete(key) }
  }
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', { value: { localStorage: storage }, configurable: true })
  t.after(() => {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
    else Reflect.deleteProperty(globalThis, 'window')
  })
  const snapshot: ChatSnapshot = {
    activeId: 'c1', conversations: [{
      id: 'c1', title: '快照', createdAt: 1, updatedAt: 2,
      messages: [{ id: 'm1', role: 'assistant', content: '已完成', status: 'done', createdAt: 2,
        skillSelection: { mode: 'manual', ids: ['debug-guide'] }, skillTrace: trace }]
    }]
  }
  assert.equal(writeSnapshot(snapshot), true)
  assert.deepEqual(snapshot.conversations[0].messages[0].skillTrace, trace)
  const saved = values.get('ai-knowledge-assistant:chat')!
  const envelope = JSON.parse(saved)
  assert.equal(envelope.version, 1)
  assert.equal(saved.includes('skillTrace'), false)
  assert.deepEqual(readSnapshot()!.conversations[0].messages[0].skillSelection, { mode: 'manual', ids: ['debug-guide'] })

  for (const value of [undefined, { mode: 'manual', ids: [42] }, { mode: 'unknown', ids: [] }]) {
    envelope.conversations[0].messages[0].skillSelection = value
    envelope.conversations[0].messages[0].skillTrace = trace
    storage.setItem('ai-knowledge-assistant:chat', JSON.stringify(envelope))
    const restored = readSnapshot()!.conversations[0].messages[0]
    assert.deepEqual(restored.skillSelection, { mode: 'auto', ids: [] })
    assert.equal(restored.skillTrace, undefined)
  }
})

test('catalog failure reports a clear error while ordinary chat remains available', async (t) => {
  setActivePinia(createPinia())
  const skills = useSkillStore()
  const chatStore = useChatStore()
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    if (url === '/api/skills') return Response.json({ skills: [{ id: 'bad/id' }] })
    return new Response(done)
  })
  await skills.load()
  assert.match(skills.error!, /技能列表加载失败/)
  assert.deepEqual(skills.skills, [])
  const scope = effectScope()
  try {
    await scope.run(useChat)!.send('继续普通聊天')
    assert.equal(chatStore.messages[1].status, 'done')
  } finally {
    scope.stop()
  }
})
