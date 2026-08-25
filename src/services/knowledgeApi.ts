import { httpClient } from './http/client'

export interface KnowledgeDocument {
  id: string
  title: string
  characters: number
  chunkCount: number
  createdAt: number
}

function readDocument(value: unknown): KnowledgeDocument | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (typeof raw.id !== 'string') return null

  return {
    id: raw.id,
    title: typeof raw.title === 'string' && raw.title ? raw.title : '未命名文档',
    characters: typeof raw.characters === 'number' ? raw.characters : 0,
    chunkCount: typeof raw.chunkCount === 'number' ? raw.chunkCount : 0,
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now()
  }
}

export async function fetchDocuments(): Promise<KnowledgeDocument[]> {
  const response = await httpClient.request('/api/documents')
  const body: unknown = await response.json()
  const raw = (body as { documents?: unknown })?.documents
  if (!Array.isArray(raw)) return []

  return raw.flatMap((item) => {
    const document = readDocument(item)
    return document ? [document] : []
  })
}

export async function uploadDocument(title: string, text: string): Promise<KnowledgeDocument> {
  const response = await httpClient.postJson('/api/documents', { title, text })
  const body: unknown = await response.json()
  const document = readDocument((body as { document?: unknown })?.document)
  if (!document) throw new Error('服务端返回的文档数据无法解析。')
  return document
}

export async function deleteDocument(id: string): Promise<void> {
  await httpClient.request(`/api/documents/${encodeURIComponent(id)}`, { method: 'DELETE' })
}
