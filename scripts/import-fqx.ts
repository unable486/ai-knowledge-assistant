/** Import the reviewed fqx snapshot through the existing local document API. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chunkDocument } from '../server/rag/chunker.ts'
import { getEmbeddingTokenCounter } from '../server/rag/embedder.ts'

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const corpus = path.join(project, 'docs/knowledge/fqx')
const indexFile = path.join(project, 'data/rag-index.json')
const ledgerFile = path.join(project, 'data/fqx-import.json')
const api = 'http://127.0.0.1:8787/api/documents'
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')
interface Entry {
  key: string; title: string; originalPath: string; indexPath: string
  originalSha256: string; indexSha256: string; chunkCount: number
}
interface Imported { id: string; title: string; chunkCount: number }
interface Receipt { id: string; sha256: string; chunkCount: number }
const manifest = JSON.parse(await fs.readFile(path.join(corpus, 'manifest.json'), 'utf8')) as { documents: Entry[] }
const countTokens = await getEmbeddingTokenCounter()
const prepared: { entry: Entry; text: string }[] = []
for (const entry of manifest.documents) {
  for (const relative of [entry.originalPath, entry.indexPath]) {
    const resolved = path.resolve(corpus, relative)
    assert(resolved.startsWith(`${corpus}${path.sep}`), '文档路径必须位于资料目录内')
  }
  const original = await fs.readFile(path.join(corpus, entry.originalPath), 'utf8')
  const text = await fs.readFile(path.join(corpus, entry.indexPath), 'utf8')
  assert.equal(sha256(original), entry.originalSha256, `${entry.key}: 原文校验失败`)
  assert.equal(sha256(text), entry.indexSha256, `${entry.key}: 索引文本校验失败`)
  assert(text.length <= 200_000 && Buffer.byteLength(JSON.stringify({ title: entry.title, text })) < 1_000_000)
  assert.equal(chunkDocument(text, { countTokens }).length, entry.chunkCount, `${entry.key}: 切块数量变化`)
  prepared.push({ entry, text })
}
assert.equal(new Set(prepared.map(({ entry }) => entry.key)).size, prepared.length)
assert.equal(new Set(prepared.map(({ entry }) => entry.title)).size, prepared.length)
console.log(`预检通过：${prepared.length} 份文档 / ${prepared.reduce((n, d) => n + d.entry.chunkCount, 0)} 块，所有片段 ≤ 512 token。`)
if (!process.argv.includes('--apply')) {
  console.log('仅预检。启动 npm run dev 后，添加 --apply 参数导入。')
} else {
  const response = await fetch(api, { signal: AbortSignal.timeout(10_000) })
  assert(response.ok, `API 不可用：${response.status}`)
  const { documents: before } = await response.json() as { documents: Imported[] }
  let diskText: string | undefined
  try { diskText = await fs.readFile(indexFile, 'utf8') }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  const disk = diskText ? JSON.parse(diskText) as { documents: Imported[] } : { documents: [] }
  assert.deepEqual(before.map(d => d.id).sort(), disk.documents.map(d => d.id).sort(), 'API 与本项目索引不一致；请确认运行的是本项目服务')
  let receipts: Record<string, Receipt> = {}
  try { receipts = JSON.parse(await fs.readFile(ledgerFile, 'utf8')) }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  const pending = prepared.filter(({ entry }) => {
    const receipt = receipts[entry.key]
    const existing = receipt && before.find(d => d.id === receipt.id)
    if (existing) {
      assert.equal(receipt.sha256, entry.indexSha256, `${entry.key}: 源快照变化，请核对后再更新，不能重复添加`)
      assert.equal(existing.title, entry.title)
      assert.equal(existing.chunkCount, entry.chunkCount)
      return false
    }
    assert(!before.some(d => d.title === entry.title), `${entry.title}: 已有同名文档但没有匹配的导入记录，请先核对`)
    return true
  })
  if (pending.length && diskText !== undefined) {
    const backup = path.join(project, 'data/backups', `before-fqx-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
    await fs.mkdir(path.dirname(backup), { recursive: true })
    await fs.copyFile(indexFile, backup, 1)
    console.log(`原索引已备份：${backup}`)
  }
  for (const [index, { entry, text }] of pending.entries()) {
    const saved = await fetch(api, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: entry.title, text }), signal: AbortSignal.timeout(300_000)
    })
    const result = await saved.json() as { document?: Imported; error?: string }
    assert(saved.ok && result.document, `${entry.title}: ${result.error ?? saved.status}`)
    assert.equal(result.document.chunkCount, entry.chunkCount)
    receipts[entry.key] = { id: result.document.id, sha256: entry.indexSha256, chunkCount: result.document.chunkCount }
    await fs.writeFile(`${ledgerFile}.tmp`, JSON.stringify(receipts, null, 2) + '\n')
    await fs.rename(`${ledgerFile}.tmp`, ledgerFile)
    console.log(`[${index + 1}/${pending.length}] ${entry.title}：${result.document.chunkCount} 块`)
  }
  const finalResponse = await fetch(api, { signal: AbortSignal.timeout(10_000) })
  assert(finalResponse.ok)
  const { documents: after } = await finalResponse.json() as { documents: Imported[] }
  assert(before.every(d => after.some(a => a.id === d.id)), '已有文档必须保留')
  assert.equal(after.length, before.length + pending.length)
  console.log(`完成：新增 ${pending.length} 份，跳过已导入 ${prepared.length - pending.length} 份；知识库共 ${after.length} 份。`)
}
