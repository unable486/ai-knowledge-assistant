/**
 * 向量库:内存数组 + JSON 落盘,暴力算余弦相似度。
 *
 * 为什么不用专门的向量库:几百块的规模下,512 维向量扫 1000 块是 50 万次
 * 乘加,亚毫秒级。引入 sqlite-vec 或别的方案只是多一个依赖和部署步骤,
 * 换不来可感知的收益。等到十万块量级再换带 HNSW/IVF 索引的实现,
 * 这个文件的对外接口不用变。
 *
 * 落盘用 JSON 是为了可读可手改,代价是体积——512 个 float 转成十进制文本
 * 约是原文的 4 倍。真上体量应该换二进制格式。
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { embeddingDimensions } from './embedder.ts'

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))
const dataDirectory = path.resolve(currentDirectory, '../../data')
const indexPath = path.join(dataDirectory, 'rag-index.json')
const schemaVersion = 1

export interface StoredDocument {
  id: string
  title: string
  characters: number
  chunkCount: number
  createdAt: number
}

export interface StoredChunk {
  id: string
  documentId: string
  text: string
  heading: string
  offset: number
  vector: number[]
}

export interface SearchHit {
  chunk: StoredChunk
  documentTitle: string
  score: number
}

let documents: StoredDocument[] = []
let chunks: StoredChunk[] = []

/** 写盘串行化:多个 ingest 并发写同一个文件会写坏。 */
let writeQueue: Promise<void> = Promise.resolve()

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function reviveChunk(value: unknown): StoredChunk | null {
  if (!isRecord(value)) return null
  const { id, documentId, text, heading, offset, vector } = value
  if (typeof id !== 'string' || typeof documentId !== 'string' || typeof text !== 'string') {
    return null
  }
  if (!Array.isArray(vector) || vector.length !== embeddingDimensions) return null
  if (!vector.every((n) => typeof n === 'number' && Number.isFinite(n))) return null

  return {
    id,
    documentId,
    text,
    heading: typeof heading === 'string' ? heading : '',
    offset: typeof offset === 'number' ? offset : 0,
    vector
  }
}

function reviveDocument(value: unknown): StoredDocument | null {
  if (!isRecord(value)) return null
  const { id, title, characters, chunkCount, createdAt } = value
  if (typeof id !== 'string') return null

  return {
    id,
    title: typeof title === 'string' && title ? title : '未命名文档',
    characters: typeof characters === 'number' ? characters : 0,
    chunkCount: typeof chunkCount === 'number' ? chunkCount : 0,
    createdAt: typeof createdAt === 'number' ? createdAt : Date.now()
  }
}

export async function loadIndex(): Promise<void> {
  let raw: string
  try {
    raw = await fs.readFile(indexPath, 'utf8')
  } catch {
    return
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    console.warn('[rag] 索引文件损坏，已忽略')
    return
  }

  if (!isRecord(parsed) || parsed.version !== schemaVersion) {
    console.warn('[rag] 索引版本不匹配，已忽略')
    return
  }

  const rawDocuments = Array.isArray(parsed.documents) ? parsed.documents : []
  const rawChunks = Array.isArray(parsed.chunks) ? parsed.chunks : []

  documents = rawDocuments
    .map(reviveDocument)
    .filter((doc): doc is StoredDocument => doc !== null)

  // 维度校验很重要:换 embedding 模型后旧向量没有可比性,混着用会让
  // 检索悄悄变差而不报错。宁可丢掉重建。
  const revived = rawChunks.map(reviveChunk).filter((c): c is StoredChunk => c !== null)
  const documentIds = new Set(documents.map((doc) => doc.id))
  // 清孤儿块:删文档时若残留,它们会继续参与检索
  chunks = revived.filter((chunk) => documentIds.has(chunk.documentId))

  const dropped = rawChunks.length - chunks.length
  console.log(
    `[rag] 已加载 ${documents.length} 篇文档 / ${chunks.length} 块` +
      (dropped > 0 ? `（丢弃 ${dropped} 块）` : '')
  )
}

async function persist(): Promise<void> {
  const payload = JSON.stringify({ version: schemaVersion, documents, chunks })
  await fs.mkdir(dataDirectory, { recursive: true })
  // 先写临时文件再原子重命名:崩在写一半不会留下坏索引
  const tempPath = `${indexPath}.tmp`
  await fs.writeFile(tempPath, payload, 'utf8')
  await fs.rename(tempPath, indexPath)
}

function schedulePersist(): Promise<void> {
  writeQueue = writeQueue.then(persist).catch((error) => {
    console.error('[rag] 索引写盘失败:', error)
  })
  return writeQueue
}

export function listDocuments(): StoredDocument[] {
  return [...documents].sort((a, b) => b.createdAt - a.createdAt)
}

export function isEmpty(): boolean {
  return chunks.length === 0
}

export async function addDocument(
  document: StoredDocument,
  newChunks: StoredChunk[]
): Promise<void> {
  documents.push(document)
  chunks.push(...newChunks)
  await schedulePersist()
}

export async function removeDocument(id: string): Promise<boolean> {
  const before = documents.length
  documents = documents.filter((doc) => doc.id !== id)
  if (documents.length === before) return false

  chunks = chunks.filter((chunk) => chunk.documentId !== id)
  await schedulePersist()
  return true
}

/** 向量已归一化,余弦相似度就是点积。 */
function dotProduct(a: number[], b: number[]): number {
  let sum = 0
  for (let i = 0; i < a.length; i += 1) sum += a[i] * b[i]
  return sum
}

export function search(queryVector: number[], topK: number): SearchHit[] {
  if (chunks.length === 0) return []

  const titles = new Map(documents.map((doc) => [doc.id, doc.title]))

  return chunks
    .map((chunk) => ({
      chunk,
      documentTitle: titles.get(chunk.documentId) ?? '未命名文档',
      score: dotProduct(queryVector, chunk.vector)
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
}
