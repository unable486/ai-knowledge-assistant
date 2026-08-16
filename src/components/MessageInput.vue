<script setup lang="ts">
import { computed, ref } from 'vue'

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
  <p class="composer-hint">Enter 发送 · Shift + Enter 换行 · 输入“模拟错误”测试异常分支</p>
</template>

<style scoped>
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
