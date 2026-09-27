import Anthropic from '@anthropic-ai/sdk'
import dotenv from 'dotenv'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { answerCases, answerDocuments, type AnswerEvalCase } from '../server/rag/answerDataset.ts'
import { evidenceRecall } from '../server/rag/evaluate.ts'
import { citationIds, insufficientEvidenceReply, unknownCitationIds } from '../server/rag/grounding.ts'
import { ingestDocument } from '../server/rag/ingest.ts'
import { minimumVectorSimilarity, retrieve, type Retrieval } from '../server/rag/retriever.ts'
import { useInMemoryIndex } from '../server/rag/vectorStore.ts'
import { selectChatContext } from '../shared/chatContext.ts'

const root = fileURLToPath(new URL('../', import.meta.url))
const { values } = parseArgs({ options: {
  live: { type: 'boolean', default: false },
  limit: { type: 'string' },
  case: { type: 'string' },
  output: { type: 'string', default: 'reports/answer-evaluation.json' }
} })

interface CaseResult {
  id: string
  category: AnswerEvalCase['category']
  split: AnswerEvalCase['split']
  question: string
  query: string
  expectedAnswer: string
  expectedEvidence: AnswerEvalCase['evidence']
  evidenceRecall: number | null
  retrievalStatus: string
  topVectorSimilarity: number
  sources: NonNullable<Retrieval>['sources']
  answer?: string
  citationIds?: string[]
  unknownCitationIds?: string[]
  stopReason?: string | null
  usage?: unknown
  manualReview?: 'pending'
  error?: string
}

async function main() {
  const limit = Number(values.limit ?? (values.live ? 4 : answerCases.length))
  if (!Number.isInteger(limit) || limit < 1 || limit > answerCases.length) {
    throw new Error(`--limit 必须是 1 到 ${answerCases.length} 的整数`)
  }
  // 实际生成默认选验证集的不同类别，避免只测最容易的前几道题。
  const validation = answerCases.filter((item) => item.split === 'validation')
  const categories = ['answerable', 'unanswerable', 'followup', 'version'] as const
  const balanced = Array.from({ length: 5 }, (_, index) => categories.flatMap((category) =>
    validation.filter((item) => item.category === category).slice(index, index + 1)
  )).flat()
  const selected = values.case
    ? answerCases.filter((item) => item.id === values.case)
    : (values.live ? [...balanced, ...answerCases.filter((item) => item.split === 'calibration')] : answerCases).slice(0, limit)
  if (selected.length === 0) throw new Error('未找到 --case 指定的样本')

  let client: Anthropic | undefined
  let key = ''
  let model = ''
  if (values.live) {
    dotenv.config({ path: path.join(root, '.env'), quiet: true })
    key = process.env.ANTHROPIC_API_KEY?.trim() ?? ''
    if (!key) throw new Error('--live 需要配置 ANTHROPIC_API_KEY；不带 --live 可运行离线证据评估')
    model = process.env.ANTHROPIC_MODEL?.trim() || 'claude-opus-5'
    const baseURL = process.env.ANTHROPIC_BASE_URL?.trim()
    // 人工核查用小批量调用；遇到限流即停，不叠加 SDK 自动重试。
    client = new Anthropic({ apiKey: key, ...(baseURL ? { baseURL } : {}), maxRetries: 0, timeout: 30_000 })
  }

  useInMemoryIndex()
  for (const document of answerDocuments) await ingestDocument(document.title, document.text)
  const results: CaseResult[] = []
  for (const item of selected) {
    const row: CaseResult = {
      id: item.id, category: item.category, split: item.split,
      question: item.question, query: item.question,
      expectedAnswer: item.expectedAnswer, expectedEvidence: item.evidence,
      evidenceRecall: null, retrievalStatus: 'error', topVectorSimilarity: 0, sources: []
    }
    results.push(row)
    try {
      const retrieval = await retrieve(item.question, 'hybrid', item.history)
      const sources = retrieval?.sources ?? []
      row.query = retrieval?.trace.query ?? item.question
      row.sources = sources
      row.evidenceRecall = evidenceRecall(item.evidence, sources)
      row.retrievalStatus = retrieval?.status ?? 'empty'
      row.topVectorSimilarity = Math.max(0, ...(retrieval?.trace.candidates.map((candidate) => candidate.vectorScore ?? 0) ?? []))
      if (client && retrieval) {
        if (retrieval.status === 'insufficient') {
          row.answer = insufficientEvidenceReply
          row.stopReason = 'local_no_evidence'
        } else {
          const response = await client.messages.create({
            model, max_tokens: 768, system: retrieval.systemPrompt,
            messages: selectChatContext([...(item.history ?? []), { role: 'user', content: item.question }])
          })
          row.answer = response.content.flatMap((block) => block.type === 'text' ? [block.text] : []).join('')
          row.stopReason = response.stop_reason
          row.usage = response.usage
        }
        row.citationIds = citationIds(row.answer)
        row.unknownCitationIds = unknownCitationIds(row.answer, sources.map((source) => source.citationId))
        row.manualReview = 'pending'
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      row.error = key ? message.split(key).join('[REDACTED]') : message
      console.error(`${item.id}: 评估失败，已停止后续调用并保留已完成结果。`)
      process.exitCode = 1
      break
    }
    console.log(`${item.id} [${item.split}] evidence=${row.evidenceRecall ?? 'n/a'} retrieval=${row.retrievalStatus}${row.answer ? ` citations=${row.citationIds?.join(',') || 'none'}` : ''}`)
  }

  const average = (numbers: number[]) => numbers.length ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : null
  const summaries = ['calibration', 'validation'].map((split) => {
    const rows = results.filter((row) => row.split === split)
    const answerable = rows.filter((row) => row.evidenceRecall !== null)
    const unanswerable = rows.filter((row) => row.category === 'unanswerable' && row.retrievalStatus !== 'error')
    return {
      split, count: rows.length,
      evidenceRecall: average(answerable.map((row) => row.evidenceRecall!)),
      answerableFiltered: answerable.filter((row) => row.retrievalStatus === 'insufficient').length,
      unanswerableLowRelevanceFiltered: unanswerable.filter((row) => row.retrievalStatus === 'insufficient').length,
      unanswerableCount: unanswerable.length
    }
  })
  const report = {
    createdAt: new Date().toISOString(), mode: values.live ? 'live-manual-review' : 'offline-evidence',
    model: values.live ? model : undefined, minimumVectorSimilarity,
    selectedCaseIds: selected.map((item) => item.id),
    complete: results.length === selected.length && results.every((row) => !row.error),
    note: '固定的虚构测试语料；证据召回与低相关过滤不等于答案准确率。真实回答需按 expectedAnswer 和证据人工核查，引用编号存在也不证明结论得到支持。',
    summaries, results
  }
  const output = path.resolve(root, values.output!)
  await fs.mkdir(path.dirname(output), { recursive: true })
  await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n', 'utf8')
  console.log(JSON.stringify(summaries, null, 2))
  console.log(`报告：${output}`)
  console.log(report.note)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
