/** node --import tsx --test scripts/test-vector-store.ts
 * 直接测真实存储模块,所有索引文件操作都替换为内存实现。
 * 手工提供向量,不加载模型权重、不调用 embedding 或外部 API。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, mock, test } from 'node:test'
import * as store from '../server/rag/vectorStore.ts'

const indexPath = fileURLToPath(new URL('../data/rag-index.json', import.meta.url))
const vector = [1, ...Array<number>(511).fill(0)]

function entry(id: string) {
  const text = `shared ${id}`
  return {
    document: { id, title: id, characters: text.length, chunkCount: 1, createdAt: 0 },
    chunks: [{ id: `${id}-chunk`, documentId: id, text, heading: '', offset: 0, vector }]
  }
}

function add(id: string): Promise<void> {
  const item = entry(id)
  return store.addDocument(item.document, item.chunks)
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

function assertVisible(ids: string[]) {
  const expected = [...ids].sort()
  assert.deepEqual(store.listDocuments().map((doc) => doc.id).sort(), expected)
  assert.deepEqual(store.search(vector, 20).map((hit) => hit.chunk.documentId).sort(), expected)
  assert.deepEqual(store.searchKeywords('shared', 20).map((hit) => hit.chunk.documentId).sort(), expected)
  assert.equal(store.isEmpty(), ids.length === 0)
}

describe('vector store commits', { concurrency: false }, () => {
  let persisted: string
  let staged: string | undefined
  let writeFailure: Error | undefined
  let renameFailure: Error | undefined
  let beforeRead: (() => Promise<void>) | undefined
  let beforeRename: (() => Promise<void>) | undefined
  let writeCount: number
  let readCount: number

  function assertPersisted(ids: string[]) {
    const snapshot = JSON.parse(persisted) as {
      documents: store.StoredDocument[]
      chunks: store.StoredChunk[]
    }
    assert.deepEqual(snapshot.documents.map((doc) => doc.id).sort(), [...ids].sort())
    assert.deepEqual(snapshot.chunks.map((chunk) => chunk.documentId).sort(), [...ids].sort())
  }

  beforeEach(async () => {
    persisted = JSON.stringify({ version: 1, documents: [], chunks: [] })
    staged = undefined
    writeFailure = renameFailure = undefined
    beforeRead = beforeRename = undefined
    writeCount = readCount = 0

    mock.method(fs, 'readFile', async (file: unknown) => {
      assert.equal(file, indexPath)
      readCount += 1
      const snapshot = persisted
      await beforeRead?.()
      return snapshot
    })
    mock.method(fs, 'mkdir', async (directory: unknown) => {
      assert.equal(directory, path.dirname(indexPath))
    })
    mock.method(fs, 'writeFile', async (file: unknown, payload: unknown) => {
      assert.equal(file, `${indexPath}.tmp`)
      assert.equal(typeof payload, 'string')
      writeCount += 1
      if (writeFailure) {
        const error = writeFailure
        writeFailure = undefined
        throw error
      }
      staged = payload as string
    })
    mock.method(fs, 'rename', async (from: unknown, to: unknown) => {
      assert.equal(from, `${indexPath}.tmp`)
      assert.equal(to, indexPath)
      await beforeRename?.()
      if (renameFailure) {
        const error = renameFailure
        renameFailure = undefined
        throw error
      }
      assert.notEqual(staged, undefined)
      persisted = staged!
      staged = undefined
    })
    await store.loadIndex()
  })

  afterEach(() => mock.restoreAll())

  test('failed upload rejects without publishing document, vector or keywords', async () => {
    await add('existing')
    writeFailure = new Error('disk full')
    await assert.rejects(add('failed'), /disk full/)
    assertVisible(['existing'])
    assertPersisted(['existing'])
  })

  test('failed deletion preserves all committed state', async () => {
    await add('existing')
    renameFailure = new Error('rename denied')
    await assert.rejects(store.removeDocument('existing'), /rename denied/)
    assertVisible(['existing'])
    assertPersisted(['existing'])
  })

  test('queued updates recover after failure without carrying failed state forward', async () => {
    await add('existing')
    renameFailure = new Error('rename denied')
    const failed = assert.rejects(add('failed'), /rename denied/)
    const added = add('next')
    const removed = store.removeDocument('existing')
    try {
      await Promise.all([failed, added])
      assert.equal(await removed, true)
      assertVisible(['next'])
      assertPersisted(['next'])
    } finally {
      await Promise.allSettled([failed, added, removed])
    }
  })

  test('concurrent add and delete expose only the last committed state', async () => {
    await add('existing')
    const addStarted = deferred()
    const releaseAdd = deferred()
    const deleteStarted = deferred()
    const releaseDelete = deferred()
    let renameCount = 0
    beforeRename = async () => {
      renameCount += 1
      if (renameCount === 1) {
        addStarted.resolve()
        await releaseAdd.promise
      } else {
        deleteStarted.resolve()
        await releaseDelete.promise
      }
    }

    const added = add('next')
    const removed = store.removeDocument('existing')
    const removedAgain = store.removeDocument('existing')
    try {
      await addStarted.promise
      assertVisible(['existing'])
      assertPersisted(['existing'])
      assert.equal(writeCount, 2, 'queued delete must not start writing')

      releaseAdd.resolve()
      await added
      await deleteStarted.promise
      assertVisible(['existing', 'next'])
      assertPersisted(['existing', 'next'])

      releaseDelete.resolve()
      assert.equal(await removed, true)
      assert.equal(await removedAgain, false)
      assertVisible(['next'])
      assertPersisted(['next'])
      assert.equal(writeCount, 3, 'duplicate deletion must not write again')
    } finally {
      releaseAdd.resolve()
      releaseDelete.resolve()
      await Promise.allSettled([added, removed, removedAgain])
    }
  })

  test('startup load and concurrent uploads retain every committed document', async () => {
    const existing = entry('existing')
    persisted = JSON.stringify({ version: 1, documents: [existing.document], chunks: existing.chunks })
    const readStarted = deferred()
    const releaseRead = deferred()
    beforeRead = async () => {
      readStarted.resolve()
      await releaseRead.promise
    }
    const loading = store.loadIndex()
    const first = add('first')
    const second = add('second')
    try {
      await readStarted.promise
      assert.equal(writeCount, 0, 'uploads must wait until startup load finishes')
      assertVisible([])
      releaseRead.resolve()
      await Promise.all([loading, first, second])
      assertVisible(['existing', 'first', 'second'])
      assertPersisted(['existing', 'first', 'second'])
    } finally {
      releaseRead.resolve()
      await Promise.allSettled([loading, first, second])
    }
  })

  // 模式开关是单向的,放在最后;生产调用约束是独立进程内首次操作前切换。
  test('in-memory evaluation keeps add/delete behavior without touching index files', async () => {
    store.useInMemoryIndex()
    const readsBefore = readCount
    await store.loadIndex()
    await add('evaluation')
    assertVisible(['evaluation'])
    assert.equal(await store.removeDocument('evaluation'), true)
    assertVisible([])
    assert.equal(readCount, readsBefore)
    assert.equal(writeCount, 0)
    assertPersisted([])
  })
})
