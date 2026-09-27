<script setup lang="ts">
import type { SkillTrace } from '../../shared/skills'

defineProps<{ trace: SkillTrace }>()
const modeNames = { auto: '自动', manual: '手动', off: '关闭' }
const reasonNames = { auto: '自动匹配问题', manual: '手动选择', mention: '问题中点名' }
</script>

<template>
  <details class="skill-trace">
    <summary>本次技能 · {{ trace.selected.length ? `已使用 ${trace.selected.length} 个` : trace.mode === 'off' ? '已关闭' : '未选用' }}</summary>
    <div class="skill-trace-body">
      <p class="skill-note">{{ modeNames[trace.mode] }}模式 · 技能提供回答步骤和格式，不是知识库事实来源。</p>
      <p v-if="!trace.selected.length" class="skill-note">本次未使用技能。</p>
      <section v-for="skill in trace.selected" :key="skill.id" class="skill-use">
        <strong>{{ skill.name }}</strong>
        <p class="skill-note">选择原因：{{ reasonNames[skill.reason] }} · 版本：<code>{{ skill.version }}</code></p>
        <p v-if="skill.description" class="skill-description">{{ skill.description }}</p>
        <details v-for="(reference, index) in skill.references" :key="index" class="skill-reference">
          <summary>按需参考原文 · {{ reference.heading || reference.path }}</summary>
          <p class="skill-note">{{ reference.path }} · 版本：<code>{{ reference.version }}</code></p>
          <div class="skill-excerpt">{{ reference.excerpt }}</div>
        </details>
      </section>
      <p v-for="(warning, index) in trace.warnings" :key="index" class="skill-warning">{{ warning }}</p>
    </div>
  </details>
</template>

<style scoped>
.skill-trace { margin-top: 10px; border: 1px solid #e2e8f0; border-radius: 7px; color: #475569; background: #f8fafc; font-size: 12px; overflow-wrap: anywhere; }
summary { padding: 8px 10px; cursor: pointer; line-height: 1.6; }
summary:focus-visible { outline: 2px solid #64748b; outline-offset: 2px; border-radius: 5px; }
.skill-trace-body { padding: 0 10px 9px; }
.skill-note { margin: 5px 0; color: #64748b; font-size: 11px; line-height: 1.6; }
.skill-use { margin-top: 9px; padding-top: 9px; border-top: 1px solid #e2e8f0; }
.skill-description { margin: 5px 0; line-height: 1.6; }
.skill-reference { margin-top: 7px; border: 1px solid #e2e8f0; border-radius: 5px; background: #fff; }
.skill-reference .skill-note { padding: 0 10px; }
.skill-excerpt { padding: 10px; border-top: 1px solid #e2e8f0; color: #334155; line-height: 1.7; white-space: pre-wrap; }
.skill-warning { margin: 7px 0 0; color: #92400e; line-height: 1.6; }
code { font-size: inherit; }
</style>
