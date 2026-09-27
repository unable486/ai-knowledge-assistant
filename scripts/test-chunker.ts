/** node --import tsx --test scripts/test-chunker.ts；纯切块测试不加载模型、不写索引。 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chunkDocument, ChunkingError, type Chunk } from '../server/rag/chunker.ts'

const countTokens = (text: string) => Array.from(text).length + 2
const bodyOf = (chunk: Chunk) => chunk.heading ? chunk.text.slice(`【${chunk.heading}】\n`.length) : chunk.text

function assertSourceSlices(raw: string, chunks: Chunk[]) {
  for (const chunk of chunks) {
    const body = bodyOf(chunk)
    assert.equal(raw.slice(chunk.offset, chunk.offset + body.length), body)
    assert.ok(countTokens(chunk.text) <= 512)
  }
}

test('Markdown fences, indented code and quoted headings retain their structure', () => {
  const raw = '# 部署\r\n\r\n### 执行\r\n\r\n```sh\r\n# 这不是标题\r\necho ok\r\n```\r\n\r\n~~~text\r\n## 也不是标题\r\n~~~\r\n\r\n    # 缩进代码\r\n    run()\r\n\r\n> # 引用标题\r\n> 引用正文\r\n\r\n## 验证\r\n\r\n确认成功。'
  const chunks = chunkDocument(raw, { countTokens })
  assert.deepEqual(chunks.map((chunk) => chunk.heading), ['部署 > 执行', '部署 > 验证'])
  for (const fragment of ['```sh\r\n# 这不是标题\r\necho ok\r\n```', '~~~text\r\n## 也不是标题\r\n~~~', '    # 缩进代码\r\n    run()', '> # 引用标题\r\n> 引用正文']) {
    assert.ok(chunks.some((chunk) => chunk.text.includes(fragment)))
  }
  assertSourceSlices(raw, chunks)
})

test('complete prerequisites, nested list and exception stay together across the target size', () => {
  const introduction = `前提：只有审核通过并完成备份后才允许操作。${'备份必须保留。'.repeat(30)}`
  const list = `- 下载部署包。${'核对版本。'.repeat(15)}\n  - 校验签名。\n- 执行发布。${'记录结果。'.repeat(16)}`
  const rule = `${introduction}\n\n${list}\n\n否则不得发布。`
  assert.ok(rule.length > 400 && rule.length < 500)
  const raw = `# 发布\n\n${'背景说明。'.repeat(40)}\n\n${rule}`
  const chunks = chunkDocument(raw, { countTokens })
  assert.equal(chunks.length, 2)
  assert.ok(chunks[1].text.includes(rule))
  assertSourceSlices(raw, chunks)
})

test('a table keeps its header, separator and every row with the introduction', () => {
  const table = '以下配置适用生产环境：\n\n| 参数 | 值 |\n| --- | --- |\n| PORT | 8787 |\n| MODE | production |'
  const raw = `# 配置\n\n${table}\n\n下一段正文。`
  const chunks = chunkDocument(raw, { countTokens })
  assert.ok(chunks.some((chunk) => chunk.text.includes(table)))
  assertSourceSlices(raw, chunks)
})

test('token budget includes heading and special tokens, including short-tail merges', () => {
  const expensiveCounter = (text: string) => Array.from(text).length * 3 + 2
  const paragraph = `${'甲'.repeat(150)}。`
  const raw = `# 边界\n\n${paragraph}\n\n${'乙'.repeat(20)}。`
  const chunks = chunkDocument(raw, { countTokens: expensiveCounter })
  assert.equal(chunks.length, 2)
  assert.ok(chunks.every((chunk) => expensiveCounter(chunk.text) <= 512))
  assertSourceSlices(raw, chunks)
  assert.throws(() => chunkDocument('# 过长标题\n正文。', { countTokens, maxTokens: 8 }), ChunkingError)
  assert.throws(() => chunkDocument('正文。', { countTokens, maxTokens: 513 }), ChunkingError)
})

test('long prose splits at whole sentences with no missing or duplicated body text', () => {
  const body = Array.from({ length: 45 }, (_, index) => `第${index}段说明保持原样，数据完整。`).join('')
  const raw = `# 正文\r\n\r\n${body}`
  const chunks = chunkDocument(raw, { countTokens, maxTokens: 100 })
  assert.ok(chunks.length > 1)
  assert.equal(chunks.map(bodyOf).join(''), body)
  assert.ok(chunks.every((chunk) => countTokens(chunk.text) <= 100))
  assert.ok(chunks.every((chunk) => bodyOf(chunk).endsWith('。')))
  assertSourceSlices(raw, chunks)
})

test('raw CRLF offsets distinguish repeated text and retain reference definitions', () => {
  const raw = '# 一级\r\n\r\n重复正文。\r\n\r\n### 三级\r\n\r\n重复正文。\r\n\r\n[ref]: https://example.com\r\n\r\n二级\r\n----\r\n重复正文。'
  const chunks = chunkDocument(raw)
  assert.deepEqual(chunks.map((chunk) => chunk.heading), ['一级', '一级 > 三级', '一级 > 二级'])
  assert.deepEqual(chunks.map((chunk) => chunk.offset), Array.from(raw.matchAll(/重复正文/g), (match) => match.index))
  assert.ok(chunks.some((chunk) => chunk.text.includes('[ref]: https://example.com')))
  assertSourceSlices(raw, chunks)
})

test('oversized indivisible structures and conditions fail explicitly without partial output', () => {
  const structures = [
    `\`\`\`js\n${'const value = 1;\n'.repeat(50)}\`\`\``,
    `| 参数 | 值 |\n| --- | --- |\n${'| name | value |\n'.repeat(50)}`,
    Array.from({ length: 80 }, (_, index) => `- 第${index}项条件。`).join('\n'),
    `如果审核通过，${'检查条件。'.repeat(150)}否则停止。`,
    '没有可用句子边界'.repeat(100)
  ]
  for (const structure of structures) {
    assert.throws(() => chunkDocument(`# 规则\n\n${structure}`, { countTokens }), (error: unknown) => {
      assert.ok(error instanceof ChunkingError)
      assert.match(error.message, /规则.*512 token.*无法安全拆分/)
      return true
    })
  }
  assert.deepEqual(chunkDocument('  \r\n\n'), [])
  assert.throws(() => chunkDocument('正文', { countTokens: () => NaN }), ChunkingError)
})
