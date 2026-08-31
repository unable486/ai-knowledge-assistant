/**
 * 检索质量评估 CLI。
 *
 * 跑：npx tsx scripts/evaluate-retrieval.ts
 *
 * 做三件事：
 * 1. 把评估语料灌进一个纯内存索引（不碰 data/rag-index.json）
 * 2. 用 vector / keyword / hybrid 三种模式跑同一套问题
 * 3. 打出对比表，并逐条列出混合检索改变了名次的 case
 *
 * 第 3 步是重点。总分变好了不代表混合检索有用——可能是某一条运气好。
 * 要看的是「哪些 case 从 miss 变成 hit」，以及更重要的：
 * 「哪些 case 被融合搞坏了」。后者是 RRF 的真实代价。
 */

import { warmUpEmbedder } from '../server/rag/embedder.ts'
import { evalCases, evalDocuments } from '../server/rag/evalDataset.ts'
import { runEvaluation, type CaseResult, type EvalReport } from '../server/rag/evaluate.ts'
import { ingestDocument } from '../server/rag/ingest.ts'
import type { RetrievalMode } from '../server/rag/retriever.ts'
import { useInMemoryIndex } from '../server/rag/vectorStore.ts'

const modes: RetrievalMode[] = ['vector', 'keyword', 'hybrid']

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

function pad(text: string, width: number): string {
  // 中文字符在等宽终端里占两列，按显示宽度补齐而不是按字符数
  const displayWidth = [...text].reduce(
    (sum, char) => sum + (/[一-鿿＀-￯]/.test(char) ? 2 : 1),
    0
  )
  return text + ' '.repeat(Math.max(0, width - displayWidth))
}

function printOverall(reports: Map<RetrievalMode, EvalReport>): void {
  console.log('\n' + '='.repeat(72))
  console.log('总体指标')
  console.log('='.repeat(72))
  console.log(
    pad('模式', 10) + pad('Recall@4', 11) + pad('MRR', 9) + pad('nDCG@4', 10) +
      pad('未命中', 9) + '平均耗时'
  )

  for (const mode of modes) {
    const report = reports.get(mode)
    if (!report) continue
    const { recall, mrr, ndcg, misses, averageMs } = report.overall
    console.log(
      pad(mode, 10) +
        pad(percent(recall), 11) +
        pad(mrr.toFixed(3), 9) +
        pad(ndcg.toFixed(3), 10) +
        pad(`${misses}/${report.cases.length}`, 9) +
        `${averageMs.toFixed(1)}ms`
    )
  }
}

function printByTag(reports: Map<RetrievalMode, EvalReport>): void {
  console.log('\n' + '='.repeat(72))
  console.log('分组指标（tag 说明：keyword=考精确标识符，semantic=考语义，mixed=两路都该中）')
  console.log('='.repeat(72))

  const tags = ['keyword', 'semantic', 'mixed']
  console.log(pad('tag', 12) + modes.map((mode) => pad(mode, 20)).join(''))
  console.log(pad('', 12) + modes.map(() => pad('Recall / nDCG', 20)).join(''))

  for (const tag of tags) {
    let row = pad(tag, 12)
    for (const mode of modes) {
      const group = reports.get(mode)?.byTag[tag]
      row += pad(group ? `${percent(group.recall)} / ${group.ndcg.toFixed(3)}` : '—', 20)
    }
    console.log(row)
  }
}

/**
 * 把两路名次印成可读文本。
 *
 * 为什么要看名次而不是"进了哪一路":候选池是 12 个位置,最终只取 4 个。
 * 一个块在向量榜排第 9、在 BM25 榜排第 1,它"两路都进榜"了,但纯向量
 * 模式下它根本进不了 top4。名次才解释得了混合检索到底改变了什么。
 */
function formatRanks(ranks: CaseResult['firstHitRanks']): string {
  if (!ranks) return '未命中'
  const vector = ranks.vector === null ? '未进榜' : `第 ${ranks.vector}`
  const keyword = ranks.keyword === null ? '未进榜' : `第 ${ranks.keyword}`
  return `向量 ${vector} / 关键词 ${keyword}`
}

/** 逐条对比 hybrid 和单路的差异。这是判断"混合是否真有用"的关键。 */
function printDiff(reports: Map<RetrievalMode, EvalReport>): void {
  const hybrid = reports.get('hybrid')
  const vector = reports.get('vector')
  if (!hybrid || !vector) return

  const byQuestion = new Map(vector.cases.map((c: CaseResult) => [c.question, c]))

  const rescued: CaseResult[] = []
  const broken: CaseResult[] = []
  const improved: Array<{ result: CaseResult; from: number; to: number }> = []

  for (const hybridCase of hybrid.cases) {
    const vectorCase = byQuestion.get(hybridCase.question)
    if (!vectorCase) continue

    if (vectorCase.recall === 0 && hybridCase.recall > 0) rescued.push(hybridCase)
    else if (vectorCase.recall > 0 && hybridCase.recall === 0) broken.push(hybridCase)
    else if (hybridCase.reciprocalRank > vectorCase.reciprocalRank) {
      improved.push({
        result: hybridCase,
        from: vectorCase.reciprocalRank,
        to: hybridCase.reciprocalRank
      })
    }
  }

  console.log('\n' + '='.repeat(72))
  console.log('hybrid vs vector 逐条差异')
  console.log('='.repeat(72))

  if (rescued.length > 0) {
    console.log(`\n[混合检索救回来的 ${rescued.length} 条] 纯向量完全没命中，混合命中了：`)
    for (const result of rescued) {
      console.log(`  · ${result.question}`)
      console.log(`    命中块的两路名次：${formatRanks(result.firstHitRanks)}`)
    }
  }

  if (improved.length > 0) {
    console.log(`\n[名次变前的 ${improved.length} 条] 本来就命中，但排得更靠前了：`)
    for (const { result, from, to } of improved) {
      console.log(`  · ${result.question}`)
      console.log(`    首个命中位次：第 ${Math.round(1 / from)} → 第 ${Math.round(1 / to)}`)
    }
  }

  // 这段必须打印，哪怕是 0 条。混合检索会不会把对的搞坏是个真实风险，
  // 报告里不体现就等于假装它不存在。
  console.log(`\n[被融合搞坏的 ${broken.length} 条]${broken.length === 0 ? ' 无' : '：'}`)
  for (const result of broken) {
    console.log(`  · ${result.question}`)
    console.log(`    期望：${result.expectedDocuments.join(' / ')}`)
    console.log(`    实际：${result.retrievedDocuments.join(' / ') || '（空）'}`)
  }

  // 两路的名次分歧有多大：这是混合检索真正的作用面积。
  // 分歧为 0 说明两路看法一致，融合可有可无；分歧大说明其中一路
  // 单独用会漏掉这条。
  const disagreements: number[] = []
  for (const result of hybrid.cases) {
    const ranks = result.firstHitRanks
    if (!ranks || ranks.vector === null || ranks.keyword === null) continue
    disagreements.push(Math.abs(ranks.vector - ranks.keyword))
  }

  const onlyOneLane = hybrid.cases.filter((result: CaseResult) => {
    const ranks = result.firstHitRanks
    return ranks !== null && (ranks.vector === null || ranks.keyword === null)
  }).length

  console.log('\n[两路名次分歧] 命中块在向量榜和 BM25 榜的名次差：')
  if (disagreements.length > 0) {
    const sorted = [...disagreements].sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)]
    const large = disagreements.filter((gap) => gap >= 5).length
    console.log(`  中位数 ${median}，最大 ${Math.max(...sorted)}，` +
      `差 5 名以上的 ${large}/${disagreements.length} 条`)
    console.log('  差得越多，说明两路看法越不一致 —— 那正是融合在起作用的地方')
  }
  console.log(`  只进了单路候选榜的：${onlyOneLane} 条（另一路完全没捞到它）`)
}

async function main() {
  // 必须在灌数据之前切换，否则会读到并覆盖用户真实的知识库
  useInMemoryIndex()

  console.log('预热 embedding 模型…')
  await warmUpEmbedder()

  console.log(`灌入 ${evalDocuments.length} 篇评估语料（纯内存，不落盘）…`)
  for (const document of evalDocuments) {
    const result = await ingestDocument(document.title, document.text)
    console.log(`  ${document.title}：${result.chunkCount} 块`)
  }

  const reports = new Map<RetrievalMode, EvalReport>()
  for (const mode of modes) {
    console.log(`\n跑 ${mode} 模式（${evalCases.length} 条问题）…`)
    reports.set(mode, await runEvaluation(evalCases, mode))
  }

  printOverall(reports)
  printByTag(reports)
  printDiff(reports)

  console.log('\n' + '='.repeat(72))
  console.log('怎么读这份报告')
  console.log('='.repeat(72))
  console.log('· keyword 组：hybrid 应明显高于 vector，这是混合检索的主要收益来源')
  console.log('· semantic 组：hybrid 不该低于 vector；如果低了，说明 BM25 的噪声在拖累')
  console.log('· 「被融合搞坏的」：这是 RRF 的代价，为 0 不代表不存在，只是这份语料没触发')
  console.log('· 平均耗时：hybrid 比 keyword 慢的部分几乎全是 embedding，BM25 本身是毫秒级')
  console.log('\n局限见 server/rag/evaluate.ts 顶部注释：语料小、标注是自己写的、只评检索不评生成。')
}

main().catch((error) => {
  console.error('评估失败：', error)
  process.exit(1)
})
