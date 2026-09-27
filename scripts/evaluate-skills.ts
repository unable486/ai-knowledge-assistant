import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { prepareSkills } from '../server/skills/index.ts'
import type { SkillSelection } from '../shared/skills.ts'

// 手写场景，只检查本项目随附的示例技能路由；不调用生成 API，不代表真实用户准确率。
const cases: { question: string; expected: string[]; selection?: SkillSelection }[] = [
  { question: 'Vue 页面白屏，控制台报 TypeError，应该如何定位？', expected: ['frontend-debugging'] },
  { question: 'React 状态更新后页面没有重新渲染，如何排查？', expected: ['frontend-debugging'] },
  { question: 'RAG 知识库的召回率和 MRR 有什么区别，如何设计评估？', expected: ['rag-evaluation'] },
  { question: 'RAG 回答的引用编号都存在，是否就能说明答案忠于证据？', expected: ['rag-evaluation'] },
  { question: '前端 Vue 页面白屏，同时需要评估 RAG 知识库召回率。', expected: ['frontend-debugging', 'rag-evaluation'] },
  { question: '前端Vue页面白屏，同时评估RAG召回率', expected: ['frontend-debugging', 'rag-evaluation'] },
  { question: '明天上海会下雨吗？', expected: [] },
  { question: '番茄炒蛋怎么做？', expected: [] },
  { question: '你好', expected: [] },
  { question: '$rag-evaluation 请按这个技能说明工作步骤', expected: ['rag-evaluation'] },
  { question: '前端 Vue 页面白屏', expected: [], selection: { mode: 'off', ids: [] } },
  { question: '说明排查与评估的共同步骤', expected: ['frontend-debugging', 'rag-evaluation'], selection: { mode: 'manual', ids: ['frontend-debugging', 'rag-evaluation'] } }
]

async function main() {
  const results = []
  for (const item of cases) {
    const selection = item.selection ?? { mode: 'auto' as const, ids: [] }
    const plan = await prepareSkills(item.question, selection)
    const actual = plan.trace.selected.map((skill) => skill.id).sort()
    const expected = [...item.expected].sort()
    const passed = JSON.stringify(actual) === JSON.stringify(expected)
    results.push({ question: item.question, selection, expected, actual, passed, trace: plan.trace })
    console.log(`${passed ? 'PASS' : 'FAIL'} [${selection.mode}] ${item.question} → ${actual.join(', ') || '无技能'}`)
  }
  const output = fileURLToPath(new URL('../reports/skill-evaluation.json', import.meta.url))
  await fs.mkdir(fileURLToPath(new URL('../reports/', import.meta.url)), { recursive: true })
  const passed = results.filter((item) => item.passed).length
  await fs.writeFile(output, JSON.stringify({
    createdAt: new Date().toISOString(), passed, total: results.length,
    note: '手写技能路由场景；使用真实本地 embedding，未验证生成模型是否遵循技能，也不是独立外部测试集。', results
  }, null, 2) + '\n', 'utf8')
  console.log(`${passed}/${results.length} 路由场景通过；报告：${output}`)
  if (passed !== results.length) process.exitCode = 1
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
