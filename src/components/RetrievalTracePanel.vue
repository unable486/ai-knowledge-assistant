<script setup lang="ts">
/**
 * 检索过程可视化。
 *
 * 做这个面板的动因:混合检索的行为在黑盒里完全说不清。答案不对时,原因
 * 可能是"没召回"、"召回了但排太后被截掉"、"召回了排也够前但块本身没用",
 * 三种情况的修法完全不同(改切块 / 调 topK / 改 prompt),但从最终回答上
 * 看不出区别。
 *
 * 面板要回答的核心问题是:**这次是哪一路在起作用**。所以两路的名次分开
 * 展示,不合成一个数 —— 两路分数不可比(余弦在 [-1,1],BM25 无上界),
 * 合成就把信息毁了,而"向量第 8 / 关键词第 1"这种分歧恰好是融合的价值所在。
 */

import { computed, ref } from 'vue'
import type { RetrievalCandidate, RetrievalTrace } from '../types/chat'

const props = defineProps<{ trace: RetrievalTrace }>()

const isOpen = ref(false)

/** 名次差 5 名以上视为"两路看法明显不一致",这种块最值得看 */
const divergenceThreshold = 5

function divergence(candidate: RetrievalCandidate): number | null {
  if (candidate.vectorRank === null || candidate.keywordRank === null) return null
  return Math.abs(candidate.vectorRank - candidate.keywordRank)
}

const usedCount = computed(() => props.trace.candidates.filter((c) => c.used).length)

/** 摘要行:不展开也能看到最关键的三个数 */
const summary = computed(() => {
  const { counts, timings } = props.trace
  return `向量 ${counts.vector} / 关键词 ${counts.keyword} → 融合 ${counts.fused} 去重候选，用了 ${usedCount.value} 块，${Math.round(timings.total)}ms`
})

/** 只进单路候选榜的块:另一路完全没捞到它,是两路盲区的直接证据 */
const singleLaneCount = computed(
  () => props.trace.candidates.filter((c) => c.vectorRank === null || c.keywordRank === null).length
)

const divergentCount = computed(
  () => props.trace.candidates.filter((c) => {
    const diff = divergence(c)
    return diff !== null && diff >= divergenceThreshold
  }).length
)

function formatRank(rank: number | null): string {
  return rank === null ? '—' : `#${rank}`
}

/** 余弦保留 3 位、BM25 保留 2 位:两者量纲不同，精度需求也不同 */
function formatScore(score: number | null, digits: number): string {
  return score === null ? '—' : score.toFixed(digits)
}

function formatMs(ms: number): string {
  return ms < 1 ? '<1ms' : `${Math.round(ms)}ms`
}
</script>

<template>
  <section class="trace">
    <button
      type="button"
      class="trace-toggle"
      :aria-expanded="isOpen"
      @click="isOpen = !isOpen"
    >
      <span class="chevron" :class="{ open: isOpen }" aria-hidden="true">▸</span>
      <span class="trace-title">检索过程</span>
      <span class="trace-summary">{{ summary }}</span>
    </button>

    <div v-if="isOpen" class="trace-body">
      <!-- 耗时拆解:说明混合检索的成本几乎全在 embedding，BM25 本身可以忽略 -->
      <dl class="timings">
        <div>
          <dt>embedding</dt>
          <dd>{{ formatMs(trace.timings.embed) }}</dd>
        </div>
        <div>
          <dt>向量检索</dt>
          <dd>{{ formatMs(trace.timings.vector) }}</dd>
        </div>
        <div>
          <dt>BM25</dt>
          <dd>{{ formatMs(trace.timings.keyword) }}</dd>
        </div>
        <div>
          <dt>RRF 融合</dt>
          <dd>{{ formatMs(trace.timings.fuse) }}</dd>
        </div>
        <div class="total">
          <dt>合计</dt>
          <dd>{{ formatMs(trace.timings.total) }}</dd>
        </div>
      </dl>

      <p v-if="divergentCount > 0 || singleLaneCount > 0" class="insight">
        <template v-if="divergentCount > 0">
          {{ divergentCount }} 块的两路名次差 {{ divergenceThreshold }} 名以上
        </template>
        <template v-if="divergentCount > 0 && singleLaneCount > 0">，</template>
        <template v-if="singleLaneCount > 0">
          {{ singleLaneCount }} 块只被单路捞到
        </template>
        —— 这些正是融合在起作用的地方。
      </p>

      <div class="table-scroll">
        <table>
          <caption class="sr-only">
            检索候选块及其在向量检索与 BM25 两路中的名次
          </caption>
          <thead>
            <tr>
              <th scope="col" class="numeric">#</th>
              <th scope="col">来源</th>
              <th scope="col" class="numeric">向量</th>
              <th scope="col" class="numeric">余弦</th>
              <th scope="col" class="numeric">关键词</th>
              <th scope="col" class="numeric">BM25</th>
              <th scope="col" class="numeric">RRF</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="candidate in trace.candidates"
              :key="candidate.chunkId"
              :class="{ used: candidate.used }"
            >
              <td class="numeric">
                {{ candidate.fusedRank }}
                <span v-if="candidate.used" class="used-dot" title="进了 prompt">●</span>
              </td>
              <td>
                <span class="doc-title">{{ candidate.documentTitle }}</span>
                <span v-if="candidate.heading" class="doc-heading">{{ candidate.heading }}</span>
                <span class="preview">{{ candidate.preview }}</span>
              </td>
              <td class="numeric" :class="{ absent: candidate.vectorRank === null }">
                {{ formatRank(candidate.vectorRank) }}
              </td>
              <td class="numeric muted">{{ formatScore(candidate.vectorScore, 3) }}</td>
              <td class="numeric" :class="{ absent: candidate.keywordRank === null }">
                {{ formatRank(candidate.keywordRank) }}
              </td>
              <td class="numeric muted">{{ formatScore(candidate.keywordScore, 2) }}</td>
              <td class="numeric muted">{{ candidate.fusedScore.toFixed(4) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <p class="footnote">
        ● 表示这一块真的进了 prompt。排进前几名但没有 ● 的，是被参考资料的字符预算截掉了。
        「余弦」和「BM25」两列<strong>不可比</strong>：前者在 [-1,1]，后者无上界，
        这也是融合用名次（RRF）而不是加权求和的原因。
      </p>
    </div>
  </section>
</template>

<style scoped>
.trace {
  margin-top: 10px;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  background: #fbfdfe;
}

.trace-toggle {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  padding: 8px 10px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
  font: inherit;
  text-align: left;
}

.trace-toggle:hover { background: #f0fdfa; }
.trace-toggle:focus-visible { outline: 2px solid #0f766e; outline-offset: -2px; }

.chevron {
  flex: 0 0 auto;
  color: #94a3b8;
  font-size: 10px;
  transition: transform 0.15s ease;
}

.chevron.open { transform: rotate(90deg); }

.trace-title {
  flex: 0 0 auto;
  color: #0f766e;
  font-size: 11px;
  font-weight: 700;
}

.trace-summary {
  min-width: 0;
  overflow: hidden;
  color: #94a3b8;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.trace-body { padding: 0 10px 10px; }

.timings {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0 0 9px;
}

.timings > div {
  padding: 5px 8px;
  border: 1px solid #e2e8f0;
  border-radius: 5px;
  background: #fff;
}

.timings dt { color: #94a3b8; font-size: 10px; }
.timings dd { margin: 2px 0 0; color: #334155; font-size: 12px; font-variant-numeric: tabular-nums; }
.timings .total { border-color: #ccfbf1; background: #f0fdfa; }
.timings .total dd { color: #0f766e; font-weight: 700; }

.insight {
  margin: 0 0 9px;
  padding: 7px 9px;
  border-left: 2px solid #5eead4;
  color: #475569;
  background: #f0fdfa;
  font-size: 11px;
  line-height: 1.6;
}

.table-scroll { overflow-x: auto; }

table { width: 100%; border-collapse: collapse; font-size: 11px; }

th {
  padding: 5px 6px;
  border-bottom: 1px solid #e2e8f0;
  color: #94a3b8;
  font-size: 10px;
  font-weight: 700;
  text-align: left;
  white-space: nowrap;
}

td {
  padding: 6px;
  border-bottom: 1px solid #f1f5f9;
  color: #475569;
  vertical-align: top;
}

.numeric { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
th.numeric { text-align: right; }

tr.used { background: #f0fdfa; }
.used-dot { margin-left: 3px; color: #0f766e; font-size: 8px; }

.absent { color: #cbd5e1; }
.muted { color: #94a3b8; }

.doc-title { display: block; color: #334155; font-weight: 600; }
.doc-heading { display: block; margin-top: 1px; color: #0f766e; font-size: 10px; }

.preview {
  display: block;
  max-width: 320px;
  margin-top: 3px;
  overflow: hidden;
  color: #94a3b8;
  font-size: 10px;
  line-height: 1.5;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.footnote {
  margin: 9px 0 0;
  color: #94a3b8;
  font-size: 10px;
  line-height: 1.7;
}

.footnote strong { color: #64748b; }

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
</style>
