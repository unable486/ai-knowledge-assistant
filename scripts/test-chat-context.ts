import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createPinia, setActivePinia } from 'pinia'
import { effectScope } from 'vue'
import { selectChatContext, type ChatRequestMessage } from '../shared/chatContext.ts'
import { streamChatReply } from '../src/services/chatApi.ts'
import { useChat } from '../src/composables/useChat.ts'
import { useChatStore } from '../src/stores/chat.ts'
import { useKnowledgeStore } from '../src/stores/knowledge.ts'

function history(turns: number, content?: string): ChatRequestMessage[] {
  return Array.from({ length: turns }, (_, index): ChatRequestMessage[] => [
    { role: 'user', content: content ?? `question ${index + 1}` },
    { role: 'assistant', content: content ?? `answer ${index + 1}` }
  ]).flat()
}

function completedStream(): Response {
  return new Response('event: done\ndata: {"stopReason":"end_turn","notice":null}\n\n', {
    headers: { 'Content-Type': 'text/event-stream' }
  })
}

async function consumeReply(messages: ChatRequestMessage[]): Promise<void> {
  for await (const event of streamChatReply(messages, new AbortController().signal)) {
    assert.ok(event)
  }
}

test('the 21st question sends recent complete turns without changing saved history', async (t) => {
  const messages: ChatRequestMessage[] = [
    ...history(20), { role: 'user', content: 'question 21' }
  ]
  const original = structuredClone(messages)
  let sent: ChatRequestMessage[] = []
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    sent = JSON.parse(String(init.body)).messages
    return completedStream()
  })

  await consumeReply(messages)
  assert.equal(sent.length, 39)
  assert.deepEqual(sent[0], { role: 'user', content: 'question 2' })
  assert.deepEqual(sent[sent.length - 1], messages[messages.length - 1])
  assert.deepEqual(messages, original)
})

test('character budget keeps a whole suffix rather than slicing individual messages', () => {
  const messages: ChatRequestMessage[] = [
    ...history(10, 'x'.repeat(20_000)), { role: 'user', content: 'y'.repeat(20_000) }
  ]
  assert.deepEqual(selectChatContext(messages), messages.slice(-5))
  const short: ChatRequestMessage[] = [...history(1), { role: 'user', content: 'follow-up' }]
  assert.deepEqual(selectChatContext(short), short)
})

test('an oversized old answer cannot permanently block later questions', () => {
  const messages: ChatRequestMessage[] = [
    { role: 'user', content: 'old question' },
    { role: 'assistant', content: 'x'.repeat(20_001) },
    ...history(1),
    { role: 'user', content: 'current question' }
  ]
  assert.deepEqual(selectChatContext(messages), messages.slice(2))
})

test('an oversized current question fails before fetch and is never truncated', async (t) => {
  const request = t.mock.method(globalThis, 'fetch', async () => completedStream())
  await assert.rejects(
    consumeReply([{ role: 'user', content: 'x'.repeat(20_001) }]),
    /20000/
  )
  assert.equal(request.mock.callCount(), 0)
})

test('retry uses the same budget and excludes messages after the failed reply', async (t) => {
  setActivePinia(createPinia())
  const store = useChatStore()
  const conversation = store.createConversation()
  for (const message of history(20)) {
    store.appendMessage(conversation.id, { ...message, status: 'done' })
  }
  store.appendMessage(conversation.id, { role: 'user', content: 'retry this', status: 'done' })
  const failed = store.appendMessage(conversation.id, { role: 'assistant', content: '', status: 'error' })
  store.appendMessage(conversation.id, { role: 'user', content: 'future question', status: 'done' })
  const originalCount = conversation.messages.length
  let sent: ChatRequestMessage[] = []
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    sent = JSON.parse(String(init.body)).messages
    return completedStream()
  })
  const scope = effectScope()
  try {
    const chat = scope.run(useChat)!
    await chat.retry(failed.id)
    assert.equal(sent.length, 39)
    assert.deepEqual(sent[sent.length - 1], { role: 'user', content: 'retry this' })
    assert.ok(sent.every((message) => message.content !== 'future question'))
    assert.equal(conversation.messages.length, originalCount)
    assert.equal(conversation.messages.find((message) => message.id === failed.id)?.status, 'done')
  } finally {
    scope.stop()
  }
})

test('a failed deletion preserves the document and does not undo concurrent changes', async (t) => {
  setActivePinia(createPinia())
  const store = useKnowledgeStore()
  const document = (id: string) => ({ id, title: id, characters: 1, chunkCount: 1, createdAt: 1 })
  store.documents = [document('a'), document('b')]
  let finishA!: (response: Response) => void
  let finishB!: (response: Response) => void
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    if (init.method === 'POST') return Response.json({ document: document('c') }, { status: 201 })
    if (url.endsWith('/a')) return new Promise<Response>((resolve) => { finishA = resolve })
    if (url.endsWith('/b')) return new Promise<Response>((resolve) => { finishB = resolve })
    throw new Error('Unexpected request')
  })

  const removeA = store.remove('a')
  const removeB = store.remove('b')
  assert.deepEqual(store.documents.map((item) => item.id), ['a', 'b'])
  await store.upload('c', 'content')
  finishB(new Response(null, { status: 204 }))
  await removeB
  finishA(Response.json({ error: 'Document could not be saved' }, { status: 500 }))
  await removeA
  assert.deepEqual(store.documents.map((item) => item.id), ['c', 'a'])
  assert.equal(store.error, 'Document could not be saved')
})
