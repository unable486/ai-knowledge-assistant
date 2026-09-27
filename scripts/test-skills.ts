import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, test } from 'node:test'
import { listSkills, prepareSkills, SkillError } from '../server/skills/index.ts'
import { readSkillTrace } from '../shared/skills.ts'

const temporaryRoots: string[] = []
const countTokens = (text: string) => Array.from(text).length
const vocabulary = ['frontend', 'crash', 'console', 'reactive', 'state', 'rag', 'recall', 'ranking', 'citations', 'weather']
const vector = (text: string) => vocabulary.map((word) => Number(new RegExp(`\\b${word}\\b`, 'i').test(text)))
const localEncoder = {
  countTokens,
  embedQuery: async (text: string) => vector(text),
  embedPassages: async (texts: string[]) => texts.map(vector)
}
const frontendCore = '# Frontend workflow\nPreserve this complete core: CORE_FRONTEND_START → CORE_FRONTEND_END.\n\nRead [crashes](references/runtime.md) for console crash details.\nRead [state][state-ref] for reactive updates.\n\n[state-ref]: references/state.md\n'
const ragCore = '# Retrieval workflow\nPreserve this complete core: CORE_RAG_START → CORE_RAG_END.\n\nRead [recall](references/recall.md) when checking retrieval.\n'

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'knowledge-skills-'))
  temporaryRoots.push(root)
  await writeSkill(root, 'frontend-debugging', 'frontend crash console', frontendCore)
  await writeSkill(root, 'rag-evaluation', 'rag recall ranking', ragCore)
  await fs.writeFile(path.join(root, 'frontend-debugging/references/runtime.md'), '# Console crash\nfrontend crash console: RUNTIME_REFERENCE_ONLY.\n\n# CSS styling\nColor contrast and visual spacing: UNRELATED_SECTION_ONLY.\n')
  await fs.writeFile(path.join(root, 'frontend-debugging/references/state.md'), '# Reactive state\nreactive state updates: STATE_REFERENCE_ONLY.\n')
  await fs.writeFile(path.join(root, 'rag-evaluation/references/recall.md'), '# Recall ranking\nrag recall ranking: RAG_REFERENCE_ONLY.\n')
  return root
}

async function writeSkill(root: string, id: string, description: string, body: string, metadata = '') {
  await fs.mkdir(path.join(root, id, 'references'), { recursive: true })
  await fs.writeFile(path.join(root, id, 'SKILL.md'), `---\nname: ${id}\ndescription: >-\n  ${description}\n${metadata}---\n${body}`)
}

afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()))
    assert.ok(path.basename(root).startsWith('knowledge-skills-'))
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('catalog exposes only metadata; manual selection retains both complete cores', async () => {
  const root = await fixture()
  const catalog = await listSkills(root)
  assert.deepEqual(catalog.map((skill) => Object.keys(skill).sort()), [['description', 'id', 'name'], ['description', 'id', 'name']])
  assert.equal(catalog[0].description, 'frontend crash console')
  const result = await prepareSkills('weather tomorrow', { mode: 'manual', ids: catalog.map((skill) => skill.id) }, { root, ...localEncoder })
  assert.equal(result.trace.selected.length, 2)
  assert.ok(result.systemPrompt.includes(frontendCore))
  assert.ok(result.systemPrompt.includes(ragCore))
  assert.ok(result.trace.selected.every((skill) => skill.reason === 'manual' && skill.references.length === 0 && /^[a-f0-9]{64}$/.test(skill.version)))
  assert.ok(!result.systemPrompt.includes('REFERENCE_ONLY'))
})

test('auto uses descriptions, selects relevant skills, and only includes matching reference chunks', async () => {
  const root = await fixture()
  const encoded: string[] = []
  const result = await prepareSkills('frontend crash console', { mode: 'auto', ids: [] }, {
    root,
    ...localEncoder,
    embedPassages: async (texts) => { encoded.push(...texts); return texts.map(vector) }
  })
  assert.deepEqual(result.trace.selected.map((skill) => skill.id), ['frontend-debugging'])
  assert.ok(result.systemPrompt.includes(frontendCore))
  assert.ok(!result.systemPrompt.includes('CORE_RAG'))
  assert.ok(result.systemPrompt.includes('RUNTIME_REFERENCE_ONLY'))
  assert.ok(!result.systemPrompt.includes('UNRELATED_SECTION_ONLY'))
  assert.ok(!result.systemPrompt.includes('STATE_REFERENCE_ONLY'))
  assert.ok(!result.systemPrompt.includes('RAG_REFERENCE_ONLY'))
  assert.ok(!encoded.some((text) => text.includes('CORE_') || text.includes('RAG_REFERENCE_ONLY')))
  const reference = result.trace.selected[0].references[0]
  assert.equal(reference.path, 'frontend-debugging/references/runtime.md')
  assert.equal(reference.heading, 'Console crash')
  assert.match(reference.version, /^[a-f0-9]{64}$/)
  assert.ok(result.systemPrompt.includes(reference.excerpt))
  const two = await prepareSkills('frontend crash console rag recall ranking', { mode: 'auto', ids: [] }, { root, ...localEncoder })
  assert.equal(two.trace.selected.length, 2)
})

test('unrelated questions and off mode activate nothing; off does not read files or embeddings', async () => {
  const root = await fixture()
  const unrelated = await prepareSkills('weather tomorrow', { mode: 'auto', ids: [] }, { root, ...localEncoder })
  assert.equal(unrelated.systemPrompt, '')
  assert.deepEqual(unrelated.trace.selected, [])
  const noWork = async () => { throw new Error('off must do no work') }
  const off = await prepareSkills('$frontend-debugging frontend crash', { mode: 'off', ids: [] }, { root: 'missing-root', countTokens: () => { throw new Error('off must not tokenize') }, embedQuery: noWork, embedPassages: noWork })
  assert.equal(off.systemPrompt, '')
  assert.deepEqual(off.trace, { mode: 'off', selected: [], warnings: [] })
  const emptyManual = await prepareSkills('frontend crash', { mode: 'manual', ids: [] }, { root: 'missing-root', ...localEncoder })
  assert.equal(emptyManual.systemPrompt, '')
})

test('mentions select explicitly; manual mode loads only given ids and unknown ids report errors', async () => {
  const root = await fixture()
  const mention = await prepareSkills('$rag-evaluation weather', { mode: 'auto', ids: [] }, { root, ...localEncoder })
  assert.deepEqual(mention.trace.selected.map((skill) => [skill.id, skill.reason]), [['rag-evaluation', 'mention']])
  const manual = await prepareSkills('$rag-evaluation frontend crash', { mode: 'manual', ids: ['frontend-debugging'] }, { root, ...localEncoder })
  assert.deepEqual(manual.trace.selected.map((skill) => skill.id), ['frontend-debugging'])
  await assert.rejects(prepareSkills('$unknown-skill', { mode: 'auto', ids: [] }, { root, ...localEncoder }), (error) => error instanceof SkillError && error.status === 400)
  await assert.rejects(prepareSkills('weather', { mode: 'manual', ids: ['../secret'] }, { root, ...localEncoder }), (error) => error instanceof SkillError && error.status === 400)
})

test('reference-style Markdown links work; links inside code fences are not loaded', async () => {
  const root = await fixture()
  await fs.appendFile(path.join(root, 'frontend-debugging/SKILL.md'), '\n```md\n[not a reference](../outside.md)\n```\n')
  const result = await prepareSkills('reactive state', { mode: 'manual', ids: ['frontend-debugging'] }, { root, ...localEncoder })
  assert.deepEqual(result.trace.selected[0].references.map((reference) => reference.path), ['frontend-debugging/references/state.md'])
  assert.ok(result.systemPrompt.includes('STATE_REFERENCE_ONLY'))
})

test('declared conflicts reject explicit combinations and remove both automatic candidates', async () => {
  const root = await fixture()
  await writeSkill(root, 'frontend-debugging', 'frontend crash console', frontendCore, 'metadata:\n  conflicts_with: [rag-evaluation]\n')
  const options = { root, ...localEncoder }
  await assert.rejects(prepareSkills('frontend rag', { mode: 'manual', ids: ['frontend-debugging', 'rag-evaluation'] }, options), (error) => error instanceof SkillError && error.status === 409)
  await assert.rejects(prepareSkills('$frontend-debugging $rag-evaluation', { mode: 'auto', ids: [] }, options), (error) => error instanceof SkillError && error.status === 409)
  const auto = await prepareSkills('frontend crash console rag recall ranking', { mode: 'auto', ids: [] }, options)
  assert.equal(auto.systemPrompt, '')
  assert.equal(auto.trace.selected.length, 0)
  assert.equal(auto.trace.warnings.length, 1)
  const preferred = await prepareSkills('$frontend-debugging rag recall ranking', { mode: 'auto', ids: [] }, options)
  assert.deepEqual(preferred.trace.selected.map((skill) => skill.id), ['frontend-debugging'])
  assert.equal(preferred.trace.warnings.length, 1)
})

test('mentions and automatic additions stay within the client trace selection limit', async () => {
  const root = await fixture()
  const ids = Array.from({ length: 21 }, (_, index) => `short-skill-${index}`)
  for (const id of ids) await writeSkill(root, id, 'weather observations', '# Core\nKeep the complete core.\n')
  const options = { root, ...localEncoder }
  await assert.rejects(prepareSkills(ids.map((id) => `$${id}`).join(' '), { mode: 'auto', ids: [] }, options), (error) => error instanceof SkillError && error.status === 400 && error.message.includes('20'))
  const twenty = await prepareSkills(`${ids.slice(0, 20).map((id) => `$${id}`).join(' ')} frontend crash console rag recall ranking`, { mode: 'auto', ids: [] }, options)
  assert.equal(twenty.trace.selected.length, 20)
  assert.ok(twenty.trace.selected.every((skill) => skill.reason === 'mention'))
  assert.deepEqual(readSkillTrace(twenty.trace), twenty.trace)
  const nineteen = await prepareSkills(`${ids.slice(0, 19).map((id) => `$${id}`).join(' ')} frontend crash console rag recall ranking`, { mode: 'auto', ids: [] }, options)
  assert.equal(nineteen.trace.selected.length, 20)
  assert.equal(nineteen.trace.selected.filter((skill) => skill.reason === 'auto').length, 1)
  assert.deepEqual(readSkillTrace(nineteen.trace), nineteen.trace)
})

test('conflict warnings are summarized without invalidating the client trace', async () => {
  const root = await fixture()
  const ids = Array.from({ length: 8 }, (_, index) => `conflicting-skill-${index}`)
  for (const id of ids) await writeSkill(root, id, 'weather observations', '# Core\nKeep the complete core.\n', `metadata:\n  conflicts_with: [${ids.filter((other) => other !== id).join(', ')}]\n`)
  const result = await prepareSkills('weather observations', { mode: 'auto', ids: [] }, { root, ...localEncoder })
  assert.deepEqual(result.trace.selected, [])
  assert.equal(result.trace.warnings.length, 20)
  assert.ok(result.trace.warnings.slice(0, 19).every((warning) => warning.includes('已声明冲突')))
  assert.match(result.trace.warnings[19], /另有 9 条/)
  assert.deepEqual(readSkillTrace(result.trace), result.trace)
})

test('explicit conjunctions route diluted intents with at most three additional queries', async () => {
  const root = await fixture()
  for (const conjunction of ['同时', '并且', '以及']) {
    const encodedQueries: string[] = []
    const result = await prepareSkills(`frontend crash console，${conjunction}rag recall ranking`, { mode: 'auto', ids: [] }, {
      root,
      ...localEncoder,
      embedQuery: async (text) => {
        encodedQueries.push(text)
        return vector(text.includes(conjunction) ? 'frontend crash console' : text)
      }
    })
    assert.deepEqual(result.trace.selected.map((skill) => skill.id).sort(), ['frontend-debugging', 'rag-evaluation'])
    assert.equal(encodedQueries.length, 3)
    assert.deepEqual(readSkillTrace(result.trace), result.trace)
  }
  const encodedQueries: string[] = []
  await prepareSkills('frontend crash console，同时weather tomorrow，并且rag recall ranking，以及reactive state，同时citations，其他问题', { mode: 'auto', ids: [] }, {
    root,
    ...localEncoder,
    embedQuery: async (text) => { encodedQueries.push(text); return vector(text) }
  })
  assert.equal(encodedQueries.length, 4)
})

test('oversized core and total core budget fail explicitly instead of truncating', async () => {
  const root = await fixture()
  await writeSkill(root, 'frontend-debugging', 'frontend crash console', `# Core\n${'x'.repeat(3_000)}`)
  await assert.rejects(prepareSkills('frontend', { mode: 'manual', ids: ['frontend-debugging'] }, { root, ...localEncoder }), (error) => error instanceof SkillError && error.status === 422 && error.message.includes('不能被截断'))
  await writeSkill(root, 'frontend-debugging', 'frontend crash console', 'x'.repeat(2_960))
  await writeSkill(root, 'rag-evaluation', 'rag recall ranking', 'y'.repeat(2_960))
  await assert.rejects(prepareSkills('frontend rag', { mode: 'manual', ids: ['frontend-debugging', 'rag-evaluation'] }, { root, ...localEncoder }), (error) => error instanceof SkillError && error.status === 422 && error.message.includes('核心合计'))
})

test('reference budget skips whole chunks while preserving every core', async () => {
  const root = await fixture()
  const body = `# Core\n${'x'.repeat(2_700)}\n[reference](references/runtime.md)\n`
  await writeSkill(root, 'frontend-debugging', 'frontend crash console', body)
  await writeSkill(root, 'rag-evaluation', 'rag recall ranking', 'y'.repeat(2_850))
  await fs.writeFile(path.join(root, 'frontend-debugging/references/runtime.md'), `# Console crash\nfrontend crash console ${'z'.repeat(430)}\n`)
  const result = await prepareSkills('frontend crash console', { mode: 'manual', ids: ['frontend-debugging', 'rag-evaluation'] }, { root, ...localEncoder })
  assert.ok(result.systemPrompt.includes(body))
  assert.ok(result.systemPrompt.includes('y'.repeat(2_850)))
  assert.equal(result.trace.selected[0].references.length, 0)
  assert.ok(result.trace.warnings.some((warning) => warning.includes('整体跳过')))
})

test('frontmatter requires matching names, valid YAML and conflict metadata', async () => {
  const root = await fixture()
  const file = path.join(root, 'frontend-debugging/SKILL.md')
  for (const raw of [
    '---\nname: different-name\ndescription: crash\n---\nbody',
    '---\nname: frontend-debugging\ndescription: [bad\n---\nbody',
    '---\nname: frontend-debugging\ndescription: crash\nmetadata:\n  conflicts_with: ../outside\n---\nbody'
  ]) {
    await fs.writeFile(file, raw)
    await assert.rejects(listSkills(root), SkillError)
  }
})

test('absolute, traversal and symlink escapes cannot read outside the selected skill', async () => {
  const root = await fixture()
  for (const target of ['../rag-evaluation/references/recall.md', '/outside.md', 'C:/outside.md', 'references/%2e%2e/%2e%2e/outside.md']) {
    await writeSkill(root, 'frontend-debugging', 'frontend crash console', `# Core\n[escape](${target})\n`)
    await assert.rejects(prepareSkills('frontend crash', { mode: 'manual', ids: ['frontend-debugging'] }, { root, ...localEncoder }), (error) => error instanceof SkillError && error.message.includes('路径不安全'))
  }
  await writeSkill(root, 'frontend-debugging', 'frontend crash console', '# Core\n[escape](references/shared/recall.md)\n')
  await fs.symlink(path.join(root, 'rag-evaluation/references'), path.join(root, 'frontend-debugging/references/shared'), process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(prepareSkills('frontend crash', { mode: 'manual', ids: ['frontend-debugging'] }, { root, ...localEncoder }), (error) => error instanceof SkillError && error.message.includes('符号链接超出'))
  await fs.symlink(path.join(root, 'frontend-debugging'), path.join(root, 'frontend-debugging/references/self'), process.platform === 'win32' ? 'junction' : 'dir')
  await writeSkill(root, 'frontend-debugging', 'frontend crash console', '# Core\n[escape](references/self/SKILL.md)\n')
  await assert.rejects(prepareSkills('frontend crash', { mode: 'manual', ids: ['frontend-debugging'] }, { root, ...localEncoder }), (error) => error instanceof SkillError && error.message.includes('符号链接超出'))
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'knowledge-skills-'))
  temporaryRoots.push(outside)
  await writeSkill(outside, 'external-skill', 'external description', '# External\n')
  await fs.symlink(path.join(outside, 'external-skill'), path.join(root, 'external-skill'), process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(listSkills(root), (error) => error instanceof SkillError && error.message.includes('符号链接超出'))
})

test('unsplittable references report a readable skill error with the relative path', async () => {
  const root = await fixture()
  await fs.writeFile(path.join(root, 'frontend-debugging/references/runtime.md'), `# Console\n\`\`\`js\n${'x'.repeat(600)}\n\`\`\`\n`)
  await assert.rejects(prepareSkills('frontend crash', { mode: 'manual', ids: ['frontend-debugging'] }, { root, ...localEncoder }), (error) => error instanceof SkillError && error.status === 422 && error.message.includes('frontend-debugging/references/runtime.md'))
})

test('reference content changes produce a new version and no stale excerpt', async () => {
  const root = await fixture()
  const selection = { mode: 'manual' as const, ids: ['frontend-debugging'] }
  const first = await prepareSkills('frontend crash console', selection, { root, ...localEncoder })
  await fs.writeFile(path.join(root, 'frontend-debugging/references/runtime.md'), '# Console crash\nfrontend crash console: UPDATED_REFERENCE.\n')
  const second = await prepareSkills('frontend crash console', selection, { root, ...localEncoder })
  assert.notEqual(first.trace.selected[0].references[0].version, second.trace.selected[0].references[0].version)
  assert.ok(second.systemPrompt.includes('UPDATED_REFERENCE'))
  assert.ok(!second.systemPrompt.includes('RUNTIME_REFERENCE_ONLY'))
})
