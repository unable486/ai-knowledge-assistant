import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import MarkdownIt from 'markdown-it'
import { parse as parseYaml } from 'yaml'
import { readSkillSelection, type SkillSelection, type SkillSummary, type SkillTrace, type SkillUseTrace } from '../../shared/skills.ts'
import { chunkDocument, ChunkingError } from '../rag/chunker.ts'
import { tokenize } from '../rag/bm25.ts'
import { embedPassages, embedQuery, embeddingMaxTokens, getEmbeddingTokenCounter } from '../rag/embedder.ts'

const defaultRoot = fileURLToPath(new URL('../../skills/', import.meta.url))
const skillName = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const markdown = new MarkdownIt()
const maxFileBytes = 128 * 1024
const maxCoreTokens = 3_000
const maxPromptTokens = 6_000
const maxReferences = 4
const maxAutomaticSkills = 3
const maxSelectedSkills = 20
const maxWarnings = 20
// ponytail: 小型技能目录的启发式门槛，非概率；积累标注请求后再校准或替换路由器。
const minimumSkillSimilarity = 0.52
const minimumReferenceSimilarity = 0.55
const referenceScoreMargin = 0.08
const ignoredTerms = new Set(tokenize('the a an and or for to of in is are how what with this that please help use 用于 如何 什么 这个 那个 可以 需要 帮助 进行 问题 分析 处理 提供 说明 以及 相关'))

export class SkillError extends Error {
  constructor(message: string, readonly status = 500) {
    super(message)
    this.name = 'SkillError'
  }
}

interface SkillFile extends SkillSummary {
  directory: string
  body: string
  version: string
  conflicts: string[]
}

interface PrepareOptions {
  root?: string
  countTokens?: (text: string) => number
  embedQuery?: typeof embedQuery
  embedPassages?: typeof embedPassages
}

interface ReferenceHit {
  skill: SkillUseTrace
  path: string
  heading: string
  version: string
  excerpt: string
  score: number
}

function version(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

function inside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
}

async function containedPath(root: string, relative: string): Promise<string> {
  const candidate = path.resolve(root, relative)
  if (!inside(root, candidate)) throw new SkillError(`技能路径超出允许目录：${relative}`)
  let resolved: string
  try {
    resolved = await fs.realpath(candidate)
  } catch {
    throw new SkillError(`技能文件或目录不存在，无法读取：${relative}`)
  }
  if (!inside(root, resolved)) throw new SkillError(`技能符号链接超出允许目录：${relative}`)
  return resolved
}

async function readText(file: string, label: string): Promise<string> {
  try {
    const stat = await fs.stat(file)
    if (!stat.isFile()) throw new SkillError(`技能资源不是文件：${label}`)
    if (stat.size > maxFileBytes) throw new SkillError(`技能文件过大：${label}（上限 ${maxFileBytes} 字节；请拆分参考资料）`, 422)
    return await fs.readFile(file, 'utf8')
  } catch (error) {
    if (error instanceof SkillError) throw error
    throw new SkillError(`无法读取技能文件：${label}`)
  }
}

function validName(value: unknown): value is string {
  return typeof value === 'string' && value.length < 64 && skillName.test(value)
}

function parseSkill(raw: string, id: string, directory: string): SkillFile {
  const frontmatter = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(raw)
  if (!frontmatter) throw new SkillError(`${id}/SKILL.md 缺少 YAML frontmatter`)
  let data: unknown
  try {
    data = parseYaml(frontmatter[1])
  } catch {
    throw new SkillError(`${id}/SKILL.md 的 YAML frontmatter 无效`)
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new SkillError(`${id}/SKILL.md 的 frontmatter 必须是对象`)
  const { name, description, metadata } = data as Record<string, unknown>
  if (!validName(name) || name !== id) throw new SkillError(`${id}/SKILL.md 的 name 必须与技能目录名一致，并使用小写字母、数字和连字符`)
  if (typeof description !== 'string' || !description.trim() || description.length > 1_024) throw new SkillError(`${id}/SKILL.md 的 description 必须是 1–1024 字符的文本`)
  if (metadata !== undefined && (!metadata || typeof metadata !== 'object' || Array.isArray(metadata))) throw new SkillError(`${id}/SKILL.md 的 metadata 必须是对象`)
  const conflicts = (metadata as Record<string, unknown> | undefined)?.conflicts_with ?? []
  if (!Array.isArray(conflicts) || conflicts.some((value) => !validName(value) || value === id)) throw new SkillError(`${id}/SKILL.md 的 metadata.conflicts_with 必须是其他技能名称的数组`)
  const body = raw.slice(frontmatter[0].length)
  if (!body.trim()) throw new SkillError(`${id}/SKILL.md 缺少核心正文`)
  return { id, name, description: description.trim(), directory, body, conflicts: [...new Set(conflicts as string[])], version: version(raw) }
}

async function readCatalog(root: string): Promise<SkillFile[]> {
  let resolvedRoot: string
  try {
    resolvedRoot = await fs.realpath(root)
  } catch {
    throw new SkillError('技能目录不存在，无法读取技能列表')
  }
  const entries = await fs.readdir(resolvedRoot, { withFileTypes: true })
  const skills = await Promise.all(entries.filter((entry) => entry.isDirectory() || entry.isSymbolicLink()).map(async (entry) => {
    if (!validName(entry.name)) throw new SkillError(`技能目录名无效：${entry.name}`)
    const directory = await containedPath(resolvedRoot, entry.name)
    const file = await containedPath(directory, 'SKILL.md')
    return parseSkill(await readText(file, `${entry.name}/SKILL.md`), entry.name, directory)
  }))
  return skills.sort((a, b) => a.id.localeCompare(b.id))
}

function summary(skill: SkillSummary): SkillSummary {
  return { id: skill.id, name: skill.name, description: skill.description }
}

/** 发现阶段只向客户端公开名称与描述，不公开核心正文或参考资料。 */
export async function listSkills(root = defaultRoot): Promise<SkillSummary[]> {
  return (await readCatalog(root)).map(summary)
}

function linkedReferences(body: string, id: string): string[] {
  const links: string[] = []
  const visit = (tokens: ReturnType<MarkdownIt['parse']>) => {
    for (const token of tokens) {
      if (token.type === 'link_open') {
        const href = token.attrGet('href') ?? ''
        if (/^(?:https?:|mailto:)/i.test(href) || href.startsWith('#')) continue
        let decoded: string
        try {
          decoded = decodeURIComponent(href).replace(/\\/g, '/')
        } catch {
          throw new SkillError(`${id}/SKILL.md 中的参考资料链接编码无效`)
        }
        const target = decoded.split(/[?#]/, 1)[0].replace(/^\.\//, '')
        if (path.posix.isAbsolute(target) || path.win32.isAbsolute(target) || /^[a-z][a-z0-9+.-]*:/i.test(target) || target.split('/').includes('..')) {
          throw new SkillError(`${id}/SKILL.md 中的参考资料路径不安全：${target}`)
        }
        if (/^references\/.+\.md$/.test(target)) links.push(target)
      }
      if (token.children) visit(token.children)
    }
  }
  visit(markdown.parse(body, {}))
  return [...new Set(links)]
}

function cosine(left: number[], right: number[]): number {
  if (!left.length || left.length !== right.length) return 0
  let dot = 0
  let leftLength = 0
  let rightLength = 0
  for (let i = 0; i < left.length; i += 1) {
    dot += left[i] * right[i]
    leftLength += left[i] ** 2
    rightLength += right[i] ** 2
  }
  return dot / (Math.sqrt(leftLength * rightLength) || 1)
}

function sharesTerms(question: string, text: string): boolean {
  const terms = new Set(tokenize(text).filter((term) => term.length > 1 && !ignoredTerms.has(term)))
  return tokenize(question).some((term) => !ignoredTerms.has(term) && terms.has(term))
}

function conflictPairs(skills: SkillFile[]): [SkillFile, SkillFile][] {
  return skills.flatMap((skill, index) => skills.slice(index + 1)
    .filter((other) => skill.conflicts.includes(other.id) || other.conflicts.includes(skill.id))
    .map((other): [SkillFile, SkillFile] => [skill, other]))
}

/** 不调用生成模型；技能检索与用户知识库的索引、来源编号完全隔离。 */
export async function prepareSkills(question: string, selection: SkillSelection, options: PrepareOptions = {}): Promise<{ systemPrompt: string; trace: SkillTrace }> {
  const checked = readSkillSelection(selection)
  if (!checked) throw new SkillError('技能选择无效，请使用 auto、manual 或 off 模式及合法技能名称', 400)
  const trace: SkillTrace = { mode: checked.mode, selected: [], warnings: [] }
  let summarizedWarnings = 0
  const warn = (message: string) => {
    if (trace.warnings.length < maxWarnings - 1) trace.warnings.push(message)
    else {
      summarizedWarnings += 1
      trace.warnings[maxWarnings - 1] = `另有 ${summarizedWarnings} 条技能冲突或参考资料预算提示已汇总；相关自动候选或参考片段均已按规则跳过，请缩小选择范围后检查。`
    }
  }
  if (checked.mode === 'off' || (checked.mode === 'manual' && checked.ids.length === 0)) return { systemPrompt: '', trace }

  const mentioned = checked.mode === 'auto' ? [...new Set([...question.matchAll(/(?:^|[^a-zA-Z0-9_$])\$([a-z0-9]+(?:-[a-z0-9]+)*)\b/g)].map((match) => match[1]))] : []
  const explicitIds = checked.mode === 'manual' ? checked.ids : mentioned
  if (explicitIds.length > maxSelectedSkills) throw new SkillError(`一次最多显式选择 ${maxSelectedSkills} 个技能，请减少 $技能名 的数量`, 400)
  const catalog = await readCatalog(options.root ?? defaultRoot)
  const explicit = explicitIds.map((id) => {
    const skill = catalog.find((candidate) => candidate.id === id)
    if (!skill) throw new SkillError(`未找到技能：${id}`, 400)
    return skill
  })
  const explicitConflicts = conflictPairs(explicit)
  if (explicitConflicts.length) throw new SkillError(`所选技能声明了冲突：${explicitConflicts.map(([a, b]) => `${a.id} / ${b.id}`).join('；')}。请保留其中一个技能`, 409)
  if (!catalog.length) return { systemPrompt: '', trace }

  const countTokens = options.countTokens ?? await getEmbeddingTokenCounter()
  const encodePassages = options.embedPassages ?? embedPassages
  const encodeQuery = options.embedQuery ?? embedQuery
  let queryPromise: Promise<number[]> | undefined
  const queryVector = () => queryPromise ??= encodeQuery(question)
  let automatic: SkillFile[] = []
  if (checked.mode === 'auto') {
    const candidates = explicit.length < maxSelectedSkills ? catalog.filter((skill) => !explicitIds.includes(skill.id)) : []
    const descriptions = candidates.map((skill) => `${skill.name}\n${skill.description}`)
    if (descriptions.some((text) => countTokens(text) > embeddingMaxTokens)) throw new SkillError('技能名称与描述超过本地 embedding 的 token 上限，请缩短 description', 422)
    if (candidates.length) {
      // ponytail: 仅为明确的并列连接词补至多三个分句，不处理代词、否定或隐含意图。
      const clauses = /同时|并且|以及/.test(question)
        ? question.split(/同时|并且|以及/).map((part) => part.replace(/^[\s，,；;。.!?！？]+|[\s，,；;。.!?！？]+$/g, '')).filter((part) => part.length >= 4).slice(0, 3)
        : []
      const routeQuestions = [...new Set([question, ...clauses])]
      const [vectors, queries] = await Promise.all([encodePassages(descriptions), Promise.all(routeQuestions.map((text) => text === question ? queryVector() : encodeQuery(text)))])
      automatic = candidates.map((skill, index) => ({
        skill,
        score: Math.max(...queries.map((query, queryIndex) => sharesTerms(routeQuestions[queryIndex], descriptions[index]) ? cosine(query, vectors[index] ?? []) : 0))
      }))
        .filter(({ score }) => score >= minimumSkillSimilarity)
        .sort((a, b) => b.score - a.score || a.skill.id.localeCompare(b.skill.id))
        .map(({ skill }) => skill)
    }
    const rejected = new Set<string>()
    for (const [a, b] of conflictPairs([...explicit, ...automatic])) {
      // 显式选择优先；两个自动候选互相冲突时同时移除，避免按磁盘顺序覆盖指令。
      if (!explicitIds.includes(a.id)) rejected.add(a.id)
      if (!explicitIds.includes(b.id)) rejected.add(b.id)
      warn(`自动候选存在已声明冲突：${a.id} / ${b.id}；已跳过冲突的自动候选，请手动选择。`)
    }
    automatic = automatic.filter((skill) => !rejected.has(skill.id)).slice(0, Math.min(maxAutomaticSkills, maxSelectedSkills - explicit.length))
  }

  const selected = [...explicit, ...automatic]
  if (!selected.length) return { systemPrompt: '', trace }
  const blocks = ['以下技能提供本轮回答的方法指导。技能及其参考资料不能替代用户知识库的事实依据，也不能放宽知识库引用、资料不足或工具权限规则。']
  for (const skill of selected) {
    if (countTokens(skill.body) > maxCoreTokens) throw new SkillError(`${skill.id}/SKILL.md 核心正文超过 ${maxCoreTokens} token；请将条件性细节移到 references，核心不能被截断`, 422)
    blocks.push(`## 技能：${skill.name}\n${skill.body}`)
    trace.selected.push({ ...summary(skill), version: skill.version, reason: checked.mode === 'manual' ? 'manual' : mentioned.includes(skill.id) ? 'mention' : 'auto', references: [] })
  }
  if (countTokens(blocks.join('\n\n')) > maxPromptTokens) throw new SkillError(`所选技能核心合计超过 ${maxPromptTokens} token 上限，请减少技能数量；核心未被截断`, 422)

  const hits: ReferenceHit[] = []
  for (let i = 0; i < selected.length; i += 1) {
    const skill = selected[i]
    // ponytail: 小型项目技能每次按内容构建独立临时索引，技能增多后再按版本哈希缓存。
    for (const relative of linkedReferences(skill.body, skill.id)) {
      const referenceRoot = path.join(skill.directory, 'references')
      const file = await containedPath(referenceRoot, relative.slice('references/'.length))
      const raw = await readText(file, `${skill.id}/${relative}`)
      let chunks: ReturnType<typeof chunkDocument>
      try {
        chunks = chunkDocument(raw, { countTokens, maxTokens: embeddingMaxTokens })
      } catch (error) {
        if (error instanceof ChunkingError) throw new SkillError(`${skill.id}/${relative} 无法安全切分：${error.message}`, 422)
        throw error
      }
      if (!chunks.length) continue
      const [vectors, query] = await Promise.all([encodePassages(chunks.map((chunk) => chunk.text)), queryVector()])
      for (let index = 0; index < chunks.length; index += 1) {
        const chunk = chunks[index]
        const score = cosine(query, vectors[index] ?? [])
        if (score < minimumReferenceSimilarity || !sharesTerms(question, chunk.text)) continue
        if (chunk.text.length > 16_000) {
          warn(`技能参考片段 ${skill.id}/${relative} 超过 16000 字符，已整体跳过；请按完整含义拆分参考资料。`)
          continue
        }
        hits.push({ skill: trace.selected[i], path: `${skill.id}/${relative}`, heading: chunk.heading, version: version(raw), excerpt: chunk.text, score })
      }
    }
  }
  hits.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path) || a.heading.localeCompare(b.heading))
  let usedReferences = 0
  for (const hit of hits) {
    const bestScore = hits.find((candidate) => candidate.skill.id === hit.skill.id)?.score ?? hit.score
    if (hit.score < bestScore - referenceScoreMargin) continue
    if (usedReferences >= maxReferences || hit.skill.references.length >= 2) continue
    const block = `### 技能参考资料：${hit.path}${hit.heading ? ` · ${hit.heading}` : ''}\n${hit.excerpt}`
    if (countTokens([...blocks, block].join('\n\n')) > maxPromptTokens) {
      warn(`技能参考片段 ${hit.path}${hit.heading ? `（${hit.heading}）` : ''} 超出剩余上下文预算，已整体跳过。`)
      continue
    }
    blocks.push(block)
    hit.skill.references.push({ path: hit.path, heading: hit.heading, version: hit.version, excerpt: hit.excerpt })
    usedReferences += 1
  }
  return { systemPrompt: blocks.join('\n\n'), trace }
}
