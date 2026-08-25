/**
 * 文档切块。
 *
 * 切块质量直接决定 RAG 效果,比换模型影响大。两个方向都会出问题:
 * 太小则单块信息不完整,检索到了也答不出来;太大则一块混了多个主题,
 * 向量被平均化,检索精度下降,还更占 prompt 额度。
 *
 * 策略是先按结构切(Markdown 标题、空行),保留作者自己划的语义边界;
 * 结构切完还超长的再按句子边界硬切,并留重叠避免关键信息正好落在
 * 边界上。每块记住它所属的标题路径——检索到孤立一块时,模型还知道
 * 它在讲什么。
 */

/** 目标块长度。bge-small 上限 512 token,中文约 1 字 1 token,留足余量。 */
const targetSize = 400
const maxSize = 600
const overlapSize = 60
/** 短于此长度的块并进相邻块,避免产生一堆碎片。 */
const minSize = 60

export interface Chunk {
  /** 送去 embedding 和拼进 prompt 的文本,已带标题前缀 */
  text: string
  /** 所属标题路径,如 "部署方式 > 端口配置" */
  heading: string
  /** 在原文中的起始位置,用于将来做高亮定位 */
  offset: number
}

interface Section {
  heading: string
  body: string
  offset: number
}

/** 按 Markdown 标题切成若干段,每段带上它的标题路径。 */
function splitByHeadings(text: string): Section[] {
  const lines = text.split('\n')
  const sections: Section[] = []
  const headingStack: string[] = []

  let body: string[] = []
  let bodyOffset = 0
  let cursor = 0

  const flush = () => {
    const joined = body.join('\n').trim()
    if (joined) {
      sections.push({ heading: headingStack.join(' > '), body: joined, offset: bodyOffset })
    }
    body = []
  }

  for (const line of lines) {
    const match = /^(#{1,6})\s+(.+)$/.exec(line)
    if (match) {
      flush()
      const level = match[1].length
      // 截断到当前层级,再压入自己,这样标题路径反映真实层级关系
      headingStack.length = Math.min(headingStack.length, level - 1)
      headingStack[level - 1] = match[2].trim()
      bodyOffset = cursor + line.length + 1
    } else {
      if (body.length === 0) bodyOffset = cursor
      body.push(line)
    }
    cursor += line.length + 1
  }
  flush()

  return sections
}

/** 按句末标点切句。中英文标点都要认。 */
function splitSentences(text: string): string[] {
  const parts = text.split(/(?<=[。！？；.!?;\n])/)
  return parts.filter((part) => part.trim())
}

/** 把句子按目标长度打包,超长的硬切。 */
function packSentences(sentences: string[]): string[] {
  const packed: string[] = []
  let current = ''

  const push = () => {
    const trimmed = current.trim()
    if (trimmed) packed.push(trimmed)
    current = ''
  }

  for (const sentence of sentences) {
    // 单句就超过 maxSize:找不到句子边界,只能按字数硬切
    if (sentence.length > maxSize) {
      push()
      for (let i = 0; i < sentence.length; i += targetSize) {
        packed.push(sentence.slice(i, i + targetSize).trim())
      }
      continue
    }

    if (current.length + sentence.length > targetSize && current.length >= minSize) {
      push()
      // 重叠:把上一块尾部一段带到下一块开头
      const previous = packed[packed.length - 1] ?? ''
      current = previous.slice(-overlapSize)
    }

    current += sentence
  }
  push()

  return packed
}

/** 把过短的块并进前一块,避免碎片。 */
function mergeShortChunks(chunks: Chunk[]): Chunk[] {
  const merged: Chunk[] = []

  for (const chunk of chunks) {
    const previous = merged[merged.length - 1]
    const bodyLength = chunk.text.length - chunk.heading.length
    if (previous && bodyLength < minSize && previous.heading === chunk.heading) {
      previous.text += `\n${chunk.text.slice(chunk.heading.length).trim()}`
      continue
    }
    merged.push({ ...chunk })
  }

  return merged
}

export function chunkDocument(rawText: string): Chunk[] {
  const text = rawText.replace(/\r\n/g, '\n')
  const chunks: Chunk[] = []

  for (const section of splitByHeadings(text)) {
    for (const piece of packSentences(splitSentences(section.body))) {
      // 标题拼进文本一起 embedding:标题里的词能参与向量化,提升命中率,
      // 也让模型在只看到这一块时知道上下文。
      const prefix = section.heading ? `【${section.heading}】\n` : ''
      chunks.push({
        text: `${prefix}${piece}`,
        heading: section.heading,
        offset: section.offset + Math.max(0, section.body.indexOf(piece))
      })
    }
  }

  return mergeShortChunks(chunks)
}
