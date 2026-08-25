/** 文档入库:切块 -> 批量 embedding -> 存储。 */

import { randomUUID } from 'node:crypto'
import { chunkDocument } from './chunker.ts'
import { embedPassages } from './embedder.ts'
import { addDocument, type StoredChunk, type StoredDocument } from './vectorStore.ts'

/** 一批的块数。太大占内存,太小浪费批处理的收益。 */
const batchSize = 32

export interface IngestResult {
  document: StoredDocument
  chunkCount: number
}

export async function ingestDocument(title: string, rawText: string): Promise<IngestResult> {
  const pieces = chunkDocument(rawText)
  if (pieces.length === 0) {
    throw new Error('文档内容为空或无法切块。')
  }

  const documentId = randomUUID()
  const vectors: number[][] = []

  // 分批而不是一次全送:一篇长文档可能切出几百块,一次性 embedding
  // 会让内存峰值很高
  for (let i = 0; i < pieces.length; i += batchSize) {
    const batch = pieces.slice(i, i + batchSize)
    vectors.push(...(await embedPassages(batch.map((piece) => piece.text))))
  }

  const chunks: StoredChunk[] = pieces.map((piece, index) => ({
    id: randomUUID(),
    documentId,
    text: piece.text,
    heading: piece.heading,
    offset: piece.offset,
    vector: vectors[index]
  }))

  const document: StoredDocument = {
    id: documentId,
    title,
    characters: rawText.length,
    chunkCount: chunks.length,
    createdAt: Date.now()
  }

  await addDocument(document, chunks)
  return { document, chunkCount: chunks.length }
}
