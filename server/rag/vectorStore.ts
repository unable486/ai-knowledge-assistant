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
import { Bm25Index, type Bm25Hit } from './bm25.ts'
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

/**
 * BM25 索引不落盘,每次 chunks 变化后从内存重建。
 *
 * 不落盘的理由:它是 chunks 的纯函数,存下来就多了一份要保持同步的状态。
 * 漏同步的后果很隐蔽——删掉的文档还能被关键词检索到,但向量检索里已经
 * 没有了,表现为"有时能搜到有时搜不到"。几百块规模下重建是毫秒级,
 * 拿确定性换这点开销是划算的。
 */
const keywordIndex = new Bm25Index()

function rebuildKeywordIndex(): void {
  keywordIndex.build(chunks.map((chunk) => ({ id: chunk.id, text: chunk.text })))
}

/** 写盘串行化:多个 ingest 并发写同一个文件会写坏。 */
let writeQueue: Promise<void> = Promise.resolve()

/**
 * 落盘开关。
 *
 * 评估脚本需要一个干净的、和用户真实知识库隔离的索引:它要灌入固定的
 * 测试语料才能算出可复现的指标,而那些语料不该出现在用户的知识库里,
 * 更不该把用户已有的 data/rag-index.json 覆盖掉。
 *
 * 做成开关而不是让评估脚本走另一套存储实现,是为了保证评估跑的是
 * **同一条检索代码路径**——换一套存储就等于评估的不是线上行为了。
 */
let persistenceEnabled = true

/**
 * 切成纯内存模式并清空当前索引。只给评估脚本用。
 *
 * 调用后本进程内的所有写入都不落盘,已加载的索引也被丢弃。
 * 因为存储是模块级单例,这个操作对整个进程生效——所以评估脚本必须
 * 单独跑,不能和 API 服务同进程。
 */
export function useInMemoryIndex(): void {
  persistenceEnabled = false
  documents = []
  chunks = []
  rebuildKeywordIndex()
}

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
  // 纯内存模式下读盘是没意义的:评估要的是只含测试语料的干净索引,
  // 读进用户的真实文档会让指标随「用户装了什么文档」变化,不可复现。
  if (!persistenceEnabled) return

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

  rebuildKeywordIndex()

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
  if (!persistenceEnabled) return Promise.resolve()

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
  rebuildKeywordIndex()
  await schedulePersist()
}

export async function removeDocument(id: string): Promise<boolean> {
  const before = documents.length
  documents = documents.filter((doc) => doc.id !== id)
  if (documents.length === before) return false

  chunks = chunks.filter((chunk) => chunk.documentId !== id)
  rebuildKeywordIndex()
  await schedulePersist()
  return true
}

/** 向量已归一化,余弦相似度就是点积。 */
function dotProduct(a: number[], b: number[]): number {
  let sum = 0
  for (let i = 0; i < a.length; i += 1) sum += a[i] * b[i]
  return sum
}

function documentTitles(): Map<string, string> {
  return new Map(documents.map((doc) => [doc.id, doc.title]))
}

/** 向量检索:全量扫描算点积,取前 topK。 */
export function search(queryVector: number[], topK: number): SearchHit[] {
  if (chunks.length === 0) return []

  const titles = documentTitles()

  return chunks
    .map((chunk) => ({
      chunk,
      documentTitle: titles.get(chunk.documentId) ?? '未命名文档',
      score: dotProduct(queryVector, chunk.vector)
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
}

/**
 * 关键词检索(BM25)。
 *
 * 返回的 score 和向量检索的 score **不可比**:这里是无上界的 BM25 分,
 * 那边是 [-1,1] 的余弦。合并两路必须用 RRF(见 fusion.ts),不能直接比大小。
 */
export function searchKeywords(query: string, topK: number): SearchHit[] {
  if (chunks.length === 0) return []

  const titles = documentTitles()
  const byId = new Map(chunks.map((chunk) => [chunk.id, chunk]))

  return keywordIndex
    .search(query, topK)
    .flatMap((hit: Bm25Hit) => {
      const chunk = byId.get(hit.id)
      if (!chunk) return []
      return [{
        chunk,
        documentTitle: titles.get(chunk.documentId) ?? '未命名文档',
        score: hit.score
      }]
    })
}
