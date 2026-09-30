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
const textarea = ref<HTMLTextAreaElement | null>(null)
const settings = ref<HTMLDetailsElement | null>(null)
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
const skillLabel = computed(() => ({ auto: '自动', manual: '手动', off: '关闭' })[skillMode.value])

onMounted(() => { void skillStore.load() })

function focusComposer(event: MouseEvent) {
  // 卡片留白也能输入；控件和文本内的点击保留原本的行为与光标位置。
  if (event.target instanceof Element && event.target.closest('button, textarea, details')) return
  textarea.value?.focus({ preventScroll: true })
}

function closeSettings() {
  if (!settings.value?.open) return
  settings.value.open = false
  settings.value.querySelector('summary')?.focus()
}

function submit() {
  if (!canSubmit.value) return
  const value = input.value.trim()
  input.value = ''
  textarea.value?.focus({ preventScroll: true })
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
  <form class="composer" aria-label="消息输入区" @click="focusComposer" @submit.prevent="submit">
    <textarea
      ref="textarea"
      v-model="input"
      class="composer-input"
      rows="2"
      aria-label="输入消息"
      aria-describedby="composer-hint"
      placeholder="向知识库提问，或聊聊你的问题"
      @keydown="handleKeydown"
      @focus="settings && (settings.open = false)"
      @compositionstart="isComposing = true"
      @compositionend="isComposing = false"
    />
    <div class="composer-toolbar">
      <details ref="settings" class="composer-settings" @keydown.esc.stop.prevent="closeSettings">
        <summary :title="skillStore.error || '选择回答使用的技能'">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">
            <path d="M4 7h9m4 0h3M4 17h3m4 0h9" stroke-linecap="round" />
            <circle cx="15" cy="7" r="2" /><circle cx="9" cy="17" r="2" />
          </svg>
          <span>技能 · {{ skillLabel }}</span>
          <span v-if="skillStore.error" class="settings-warning" aria-label="技能加载失败">!</span>
          <svg class="settings-chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
            <path d="m4 6 4 4 4-4" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </summary>
        <div class="skill-controls">
          <div class="skill-mode-row">
            <label for="skill-mode">技能模式</label>
            <select id="skill-mode" v-model="skillMode">
              <option value="auto">自动</option>
              <option value="manual">手动</option>
              <option value="off">关闭</option>
            </select>
            <span v-if="skillStore.isLoading" role="status">加载中…</span>
          </div>
          <p class="skill-hint">更改从下次发送生效，重试沿用原选择。</p>
          <fieldset v-if="skillMode === 'manual' && skillStore.skills.length" class="skill-options">
            <legend>选择技能（可多选）</legend>
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
          <p v-if="skillMode === 'manual' && !skillStore.skills.length && !skillStore.isLoading && !skillStore.error" class="skill-hint">
            当前没有可选技能，可继续普通聊天。
          </p>
          <p v-else-if="skillMode === 'manual' && !selectedSkillIds.length && !skillStore.isLoading" class="skill-hint">
            未选择技能，本次按普通聊天发送。
          </p>
          <p v-if="skillStore.error" class="skill-error" role="alert">
            {{ skillStore.error }}
            <button type="button" :disabled="skillStore.isLoading" @click="skillStore.load()">重新加载</button>
          </p>
        </div>
      </details>
      <span v-if="disabled" class="generating-hint" role="status">正在回复，可继续输入</span>
      <button
        v-if="disabled"
        type="button"
        class="send-button stop-button"
        title="停止生成"
        aria-label="停止生成"
        @click="emit('abort')"
      >
        <span class="stop-icon" aria-hidden="true" />
      </button>
      <button v-else type="submit" class="send-button" title="发送消息" aria-label="发送消息" :disabled="!canSubmit">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path d="M12 19V5m-6 6 6-6 6 6" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
    </div>
  </form>
  <p id="composer-hint" class="composer-hint">Enter 发送 · Shift + Enter 换行<span class="context-hint"> · 长对话优先参考最近内容</span></p>
</template>

<style scoped>
.composer {
  display: flex;
  position: relative;
  flex-direction: column;
  gap: 10px;
  max-width: 820px;
  margin: 0 auto;
  padding: 18px 16px 12px;
  border: 1px solid #e2e8f0;
  border-radius: 26px;
  background: #f8fafb;
  box-shadow: 0 2px 8px rgb(15 23 42 / 3%);
  cursor: text;
  transition: border-color 150ms ease, box-shadow 150ms ease, background 150ms ease;
}

.composer:hover { border-color: #cbd5e1; }
.composer:focus-within { border-color: #5a9f97; background: #fff; box-shadow: 0 0 0 3px rgb(15 118 110 / 8%); }

.composer-input {
  display: block;
  width: 100%;
  min-width: 0;
  min-height: 56px;
  max-height: min(220px, 35dvh);
  field-sizing: content;
  resize: none;
  overflow-y: auto;
  margin: 0;
  padding: 0 6px;
  border: 0;
  outline: 0;
  color: #1e293b;
  background: transparent;
  font: inherit;
  font-size: 16px;
  line-height: 1.65;
  scrollbar-width: thin;
}

.composer-input::placeholder { color: #7b8795; }
.composer-toolbar { display: flex; align-items: center; gap: 10px; }
.composer-settings { position: relative; margin-right: auto; cursor: default; }
.composer-settings summary {
  display: flex;
  align-items: center;
  gap: 7px;
  min-height: 40px;
  padding: 0 10px;
  border-radius: 20px;
  color: #64748b;
  list-style: none;
  font-size: 12px;
  cursor: pointer;
  user-select: none;
}
.composer-settings summary::-webkit-details-marker { display: none; }
.composer-settings summary:hover, .composer-settings[open] summary { color: #334155; background: #eaf0f2; }
.composer-settings svg { width: 18px; height: 18px; }
.composer-settings .settings-chevron { width: 14px; height: 14px; }
.composer-settings[open] .settings-chevron { transform: rotate(180deg); }
.settings-warning { color: #b91c1c; font-weight: 700; }
.skill-controls {
  position: absolute;
  z-index: 5;
  bottom: calc(100% + 12px);
  left: 0;
  width: min(340px, calc(100vw - 76px));
  max-height: min(360px, 55dvh);
  overflow-y: auto;
  padding: 16px;
  border: 1px solid #e2e8f0;
  border-radius: 16px;
  color: #475569;
  background: #fff;
  box-shadow: 0 8px 30px rgb(15 23 42 / 12%);
  font-size: 12px;
}
.skill-mode-row { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.skill-mode-row > label { font-weight: 600; }
.skill-mode-row select { min-height: 32px; padding: 4px 8px; border: 1px solid #cbd5e1; border-radius: 8px; color: #334155; background: #fff; font: inherit; }
.skill-hint { margin: 10px 0 0; color: #64748b; font-size: 11px; line-height: 1.6; }
.skill-options { display: grid; gap: 10px; margin: 12px 0 0; padding: 12px; border: 1px solid #e2e8f0; border-radius: 10px; }
.skill-options legend { padding: 0 4px; color: #64748b; font-size: 11px; }
.skill-options label { display: flex; align-items: center; gap: 8px; cursor: pointer; }
.skill-options input { margin: 0; accent-color: #0f766e; }
.skill-error { margin: 10px 0 0; color: #b91c1c; overflow-wrap: anywhere; line-height: 1.6; }
.skill-error button { margin-left: 6px; padding: 3px 6px; border: 1px solid #fecaca; border-radius: 6px; color: inherit; background: #fff; font: inherit; cursor: pointer; }
.generating-hint { color: #64748b; font-size: 12px; }

.send-button {
  display: grid;
  flex: 0 0 40px;
  width: 40px;
  height: 40px;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 50%;
  color: #fff;
  background: #0f766e;
  cursor: pointer;
  transition: background 150ms ease;
}

.send-button svg { width: 22px; height: 22px; }
.send-button:hover:not(:disabled) { background: #115e59; }
.send-button:disabled { color: #9aa7b3; background: #e7ecef; cursor: default; }
.stop-button { color: #0f766e; background: #dcefea; }
.stop-button:hover:not(:disabled) { background: #c6e5dd; }
.stop-icon { width: 12px; height: 12px; border-radius: 2px; background: currentColor; }
.send-button:focus-visible, .composer-settings summary:focus-visible { outline: 2px solid #0f766e; outline-offset: 3px; }

.composer-hint {
  max-width: 820px;
  margin: 10px auto 0;
  color: #7b8795;
  font-size: 11px;
  line-height: 1.5;
  text-align: center;
}

@media (max-width: 700px) {
  .composer { padding: 16px 12px 10px; border-radius: 22px; }
  .context-hint { display: none; }
  .generating-hint { font-size: 11px; }
}

@media (prefers-reduced-motion: reduce) {
  .composer, .send-button { transition: none; }
}
</style>
