<script setup lang="ts">
import { computed } from 'vue'
import type { ChatMessage } from '../types/chat'
import { renderMarkdown } from '../utils/markdown'

type Props = {
  message: ChatMessage
}

const props = defineProps<Props>()
const emit = defineEmits<{ retry: [] }>()

const renderedContent = computed(() => renderMarkdown(props.message.content))
const isAssistant = computed(() => props.message.role === 'assistant')
</script>

<template>
  <article class="message" :class="[message.role, message.status]">
    <div class="avatar" aria-hidden="true">
      {{ isAssistant ? 'AI' : '你' }}
    </div>

    <div class="message-body">
      <div class="message-meta">
        <strong>{{ isAssistant ? '知识库助手' : '你' }}</strong>
        <span v-if="message.status === 'streaming'" class="status-text">正在生成</span>
        <span v-else-if="message.status === 'aborted'" class="status-text">已停止</span>
      </div>

      <div v-if="message.content" class="message-content markdown-body" v-html="renderedContent" />
      <div v-else-if="message.status === 'pending'" class="typing-indicator" aria-label="正在生成">
        <i /><i /><i />
      </div>

      <div v-if="message.sources?.length" class="sources">
        <span class="sources-label">参考</span>
        <span v-for="(source, index) in message.sources" :key="index" class="source-chip">
          {{ source.documentTitle }}<template v-if="source.heading"> · {{ source.heading }}</template>
        </span>
      </div>

      <div v-if="message.status === 'error'" class="error-box">
        <span>{{ message.error }}</span>
        <button type="button" class="retry-button" @click="emit('retry')">重试</button>
      </div>
    </div>
  </article>
</template>

<style scoped>
.message {
  display: flex;
  gap: 12px;
  max-width: 820px;
  margin: 0 auto;
  padding: 20px 24px;
}

.message.user {
  background: rgba(255, 255, 255, 0.35);
}

.avatar {
  flex: 0 0 32px;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  display: grid;
  place-items: center;
  font-size: 12px;
  font-weight: 700;
  color: #fff;
  background: #0f766e;
}

.message.user .avatar {
  background: #334155;
}

.message-body {
  min-width: 0;
  flex: 1;
}

.message-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 7px;
  color: #0f172a;
  font-size: 14px;
}

.status-text {
  color: #94a3b8;
  font-size: 12px;
  font-weight: 400;
}

.message-content {
  color: #334155;
  line-height: 1.75;
  overflow-wrap: anywhere;
}

.typing-indicator {
  display: flex;
  gap: 4px;
  padding: 10px 0;
}

.typing-indicator i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #0f766e;
  animation: bounce 1s infinite ease-in-out;
}

.typing-indicator i:nth-child(2) { animation-delay: 0.12s; }
.typing-indicator i:nth-child(3) { animation-delay: 0.24s; }

.sources {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-top: 10px;
}

.sources-label {
  color: #94a3b8;
  font-size: 11px;
  font-weight: 600;
}

.source-chip {
  padding: 2px 7px;
  border: 1px solid #ccfbf1;
  border-radius: 10px;
  color: #0f766e;
  background: #f0fdfa;
  font-size: 11px;
}

.error-box {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 8px;
  padding: 10px 12px;
  border: 1px solid #fecaca;
  border-radius: 6px;
  color: #b91c1c;
  background: #fff1f2;
  font-size: 13px;
}

.retry-button {
  flex: 0 0 auto;
  border: 0;
  padding: 3px 8px;
  border-radius: 4px;
  color: #b91c1c;
  background: transparent;
  cursor: pointer;
  font-weight: 600;
}

.retry-button:hover { background: #ffe4e6; }

@keyframes bounce {
  0%, 60%, 100% { transform: translateY(0); opacity: 0.45; }
  30% { transform: translateY(-4px); opacity: 1; }
}
</style>
