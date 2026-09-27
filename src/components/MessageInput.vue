<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { SkillSelection } from '../../shared/skills'
import { useSkillStore } from '../stores/skills'

const props = defineProps<{
  disabled?: boolean
}>()

const emit = defineEmits<{
  submit: [value: string]
  abort: []
}>()

const input = ref('')
const isComposing = ref(false)
const canSubmit = computed(() => input.value.trim().length > 0 && !props.disabled)
const skillStore = useSkillStore()
const skillMode = computed({
  get: () => skillStore.selection.mode,
  set: (mode: SkillSelection['mode']) => skillStore.setSelection({ mode, ids: skillStore.selection.ids })
})
const selectedSkillIds = computed({
  get: () => skillStore.selection.ids,
  set: (ids: string[]) => skillStore.setSelection({ mode: 'manual', ids })
})

onMounted(() => { void skillStore.load() })

function submit() {
  if (!canSubmit.value) return
  const value = input.value.trim()
  input.value = ''
  emit('submit', value)
}

function handleKeydown(event: KeyboardEvent) {
  // 中文输入法组字时 Enter 只确认候选词,不能误发消息
  if (event.isComposing || isComposing.value) return
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    submit()
  }
}
</script>

<template>
  <div class="skill-controls">
    <div class="skill-mode-row">
      <label for="skill-mode">技能</label>
      <select id="skill-mode" v-model="skillMode">
        <option value="auto">自动</option>
        <option value="manual">手动</option>
        <option value="off">关闭</option>
      </select>
      <span class="skill-hint">更改从下次发送生效，重试沿用原选择</span>
      <span v-if="skillStore.isLoading" role="status">加载中…</span>
    </div>
    <fieldset v-if="skillMode === 'manual' && skillStore.skills.length" class="skill-options">
      <legend>选择本次使用的技能（可多选）</legend>
      <label v-for="skill in skillStore.skills" :key="skill.id" :title="skill.description">
        <input
          v-model="selectedSkillIds"
          type="checkbox"
          :value="skill.id"
          :disabled="selectedSkillIds.length >= 20 && !selectedSkillIds.includes(skill.id)"
        />
        {{ skill.name }}
      </label>
    </fieldset>
    <p v-if="skillMode === 'manual' && !skillStore.skills.length && !skillStore.isLoading && !skillStore.error" class="skill-hint skill-empty">
      当前没有可选技能，可继续普通聊天。
    </p>
    <p v-else-if="skillMode === 'manual' && !selectedSkillIds.length && !skillStore.isLoading" class="skill-hint skill-empty">
      未选择技能，本次按普通聊天发送。
    </p>
    <p v-if="skillStore.error" class="skill-error" role="alert">
      {{ skillStore.error }}
      <button type="button" :disabled="skillStore.isLoading" @click="skillStore.load()">重新加载</button>
    </p>
  </div>
  <form class="composer" @submit.prevent="submit">
    <textarea
      v-model="input"
      rows="1"
      placeholder="问问 Vue、前端工程化或项目中的问题..."
      :disabled="disabled"
      @keydown="handleKeydown"
      @compositionstart="isComposing = true"
      @compositionend="isComposing = false"
    />
    <button
      v-if="disabled"
      type="button"
      class="send-button stop-button"
      title="停止生成"
      @click="emit('abort')"
    >
      <span class="stop-icon" aria-hidden="true" />
      <span>停止</span>
    </button>
    <button v-else type="submit" class="send-button" :disabled="!canSubmit">
      <span>发送</span>
      <span aria-hidden="true">↑</span>
    </button>
  </form>
  <p class="composer-hint">Enter 发送 · Shift + Enter 换行</p>
  <p class="composer-hint">长对话会优先参考最近的内容；需要引用较早的信息时，请在问题中补充。</p>
</template>

<style scoped>
.skill-controls { max-width: 820px; margin: 0 auto 9px; color: #475569; font-size: 12px; }
.skill-mode-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.skill-mode-row > label { font-weight: 600; }
.skill-mode-row select { padding: 3px 6px; border: 1px solid #cbd5e1; border-radius: 5px; color: #334155; background: #fff; font: inherit; }
.skill-hint { color: #64748b; font-size: 11px; }
.skill-options { display: flex; flex-wrap: wrap; gap: 7px 14px; max-height: 120px; overflow-y: auto; margin: 8px 0 0; padding: 8px 10px; border: 1px solid #e2e8f0; border-radius: 6px; }
.skill-options legend { padding: 0 4px; color: #64748b; font-size: 11px; }
.skill-options label { display: flex; align-items: center; gap: 4px; cursor: pointer; }
.skill-options input { margin: 0; accent-color: #0f766e; }
.skill-empty { margin: 7px 0 0; }
.skill-error { margin: 7px 0 0; color: #b91c1c; overflow-wrap: anywhere; }
.skill-error button { margin-left: 6px; padding: 2px 5px; border: 1px solid #fecaca; border-radius: 4px; color: inherit; background: #fff; font: inherit; cursor: pointer; }

.composer {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  max-width: 820px;
  margin: 0 auto;
  padding: 12px;
  border: 1px solid #cbd5e1;
  border-radius: 10px;
  background: #fff;
  box-shadow: 0 4px 18px rgba(15, 23, 42, 0.07);
}

textarea {
  flex: 1;
  min-width: 0;
  max-height: 140px;
  resize: vertical;
  border: 0;
  outline: 0;
  color: #1e293b;
  font: inherit;
  line-height: 1.5;
}

textarea::placeholder { color: #94a3b8; }
textarea:disabled { background: #fff; cursor: not-allowed; }

.send-button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 34px;
  padding: 0 12px;
  border: 0;
  border-radius: 6px;
  color: #fff;
  background: #0f766e;
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
}

.send-button:hover:not(:disabled) { background: #115e59; }
.send-button:disabled { background: #cbd5e1; cursor: not-allowed; }
.stop-button { background: #be123c; }
.stop-button:hover { background: #9f1239; }
.stop-icon { width: 9px; height: 9px; background: currentColor; }

.composer-hint {
  max-width: 820px;
  margin: 8px auto 0;
  color: #94a3b8;
  font-size: 11px;
  text-align: center;
}
</style>
