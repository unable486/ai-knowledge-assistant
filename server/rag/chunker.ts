/** 按 Markdown 原始结构切块；超出模型容量且无法安全拆分的结构明确拒绝。 */
import MarkdownIt from 'markdown-it'

// 保留原来的目标长度；完整段落/结构可以超过目标，但不能超过 token 上限。
const targetSize = 400
const minSize = 60
const markdown = new MarkdownIt({ html: true })
const sentences = new Intl.Segmenter('zh', { granularity: 'sentence' })

export interface Chunk {
  /** 送去 embedding 和拼进 prompt 的文本，已带标题前缀。 */
  text: string
  heading: string
  /** 正文在输入原文中的 UTF-16 offset，保留 CRLF，不按规范化后的文本定位。 */
  offset: number
}

export interface ChunkOptions {
  /** 应包含模型 special tokens；不提供时使用字符数作保守预算。 */
  countTokens?: (text: string) => number
  /** 可以调低预算，不能高于当前 embedding 模型的 512 token 上限。 */
  maxTokens?: number
}

export class ChunkingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ChunkingError'
  }
}

interface Block {
  start: number
  end: number
  kind: string
  splittable: boolean
}

interface Section {
  heading: string
  start: number
  end: number
  blocks: Block[]
}

// ponytail: 只识别显式条件措辞；任意自然语言的跨段依赖仍需作者用标题/段落表达。
const condition = /如果|只有|仅当|仅在|除非|否则|前提|条件|适用|必须满足|\b(?:if|unless|otherwise|prerequisite|provided that|only when)\b/i
const continuation = /^(?:[*_ ]*)(?:否则|但(?:是)?|除非|例外|注意|\b(?:otherwise|however|except|note)\b)/i

function parseSections(rawText: string): Section[] {
  // markdown-it 的 map 使用行号；从未改写过的输入计算行首，避免 CRLF 偏移。
  const lineStarts = [0]
  for (const match of rawText.matchAll(/\r\n|\n|\r/g)) {
    lineStarts.push(match.index + match[0].length)
  }
  const atLine = (line: number) => lineStarts[line] ?? rawText.length
  const tokens = markdown.parse(rawText, {})
  const sections: Section[] = []
  const headings: { level: number; title: string }[] = []
  let section: Section = { heading: '', start: 0, end: rawText.length, blocks: [] }

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    // 顶层 token 已覆盖嵌套列表、引用、围栏；其中的 # 不是文档标题。
    if (token.level !== 0 || !token.map || token.nesting === -1) continue
    const start = atLine(token.map[0])
    const end = atLine(token.map[1])
    if (token.type === 'heading_open') {
      section.end = start
      sections.push(section)
      const level = Number(token.tag.slice(1))
      while (headings.length && headings[headings.length - 1].level >= level) headings.pop()
      headings.push({ level, title: tokens[index + 1].content.trim() })
      section = { heading: headings.map((heading) => heading.title).join(' > '), start: end, end: rawText.length, blocks: [] }
    } else {
      const inline = tokens[index + 1]
      const plainParagraph = token.type === 'paragraph_open' && inline?.children?.every(
        (child) => ['text', 'softbreak', 'hardbreak'].includes(child.type)
      )
      section.blocks.push({ start, end, kind: token.type, splittable: Boolean(plainParagraph) })
    }
  }
  sections.push(section)
  return sections
}

/** 补回 parser 不输出的链接定义等原文，再绑定结构的说明/前提。 */
function semanticBlocks(rawText: string, section: Section): Block[] {
  const blocks: Block[] = []
  let cursor = section.start
  for (const block of section.blocks) {
    if (rawText.slice(cursor, block.start).trim()) {
      blocks.push({ start: cursor, end: block.start, kind: '原文定义', splittable: false })
    } else if (blocks.length) {
      blocks[blocks.length - 1].end = block.start
    }
    blocks.push({ ...block })
    cursor = block.end
  }
  if (rawText.slice(cursor, section.end).trim()) {
    blocks.push({ start: cursor, end: section.end, kind: '原文定义', splittable: false })
  } else if (blocks.length) {
    blocks[blocks.length - 1].end = section.end
  }

  const combined: Block[] = []
  for (const block of blocks) {
    const previous = combined[combined.length - 1]
    const previousText = previous ? rawText.slice(previous.start, previous.end).trimEnd() : ''
    const body = rawText.slice(block.start, block.end)
    const isStructure = ['bullet_list_open', 'ordered_list_open', 'table_open', 'fence', 'code_block', 'blockquote_open'].includes(block.kind)
    const followsIntroduction = previous && previous.kind === 'paragraph_open' && (
      isStructure || /[:：]$/.test(previousText) || condition.test(previousText)
    )
    if (previous && (followsIntroduction || (previous.kind === '完整结构及前提' && isStructure) || continuation.test(body.trimStart()))) {
      previous.end = block.end
      previous.kind = '完整结构及前提'
      previous.splittable = false
    } else {
      combined.push({ ...block, splittable: block.splittable && !condition.test(body) })
    }
  }
  return combined
}

export function chunkDocument(rawText: string, options: ChunkOptions = {}): Chunk[] {
  const maxTokens = options.maxTokens ?? 512
  if (!Number.isSafeInteger(maxTokens) || maxTokens < 1 || maxTokens > 512) {
    throw new ChunkingError('切块 token 上限必须是 1 到 512 的整数。')
  }
  const countTokens = options.countTokens ?? ((text: string) => text.length)
  const chunks: Chunk[] = []

  for (const section of parseSections(rawText)) {
    const prefix = section.heading ? `【${section.heading}】\n` : ''
    const textOf = (block: Block) => `${prefix}${rawText.slice(block.start, block.end)}`
    const fits = (block: Block) => {
      const count = countTokens(textOf(block))
      if (!Number.isSafeInteger(count) || count < 0) throw new ChunkingError('token 计数器返回了无效长度。')
      return count <= maxTokens
    }
    const reject = (block: Block): never => {
      const kind = ({ fence: '代码块', code_block: '代码块', bullet_list_open: '完整列表', ordered_list_open: '完整列表', table_open: '表格', blockquote_open: '引用块', paragraph_open: '完整段落', html_block: 'HTML 块' } as Record<string, string>)[block.kind] ?? block.kind
      throw new ChunkingError(`“${section.heading || '正文'}”在原文位置 ${block.start} 的${kind}超过 ${maxTokens} token（含标题），无法安全拆分。请缩短该结构或按完整含义拆成独立小节后重试。`)
    }
    let current: Block | undefined
    const flush = () => {
      if (!current) return
      // 合并和添加标题之后再次校验，防止短块合并绕过模型限制。
      if (!fits(current)) reject(current)
      chunks.push({ text: textOf(current), heading: section.heading, offset: current.start })
      current = undefined
    }
    const append = (block: Block) => {
      if (!fits(block)) reject(block)
      if (current) {
        const joined = { ...current, end: block.end }
        const reachesTarget = joined.end - joined.start > targetSize && current.end - current.start >= minSize
        const shortTail = block.end - block.start < minSize
        if (!fits(joined) || (reachesTarget && !shortTail)) flush()
      }
      current = current ? { ...current, end: block.end } : { ...block }
    }

    for (const block of semanticBlocks(rawText, section)) {
      if (fits(block)) {
        append(block)
      } else if (block.splittable) {
        // 只拆超限的纯正文段落；每个完整句子都必须能装下，绝不按字数硬截。
        for (const sentence of sentences.segment(rawText.slice(block.start, block.end))) {
          append({ ...block, start: block.start + sentence.index, end: block.start + sentence.index + sentence.segment.length, kind: '完整句子' })
        }
      } else {
        reject(block)
      }
    }
    flush()
  }
  return chunks
}
