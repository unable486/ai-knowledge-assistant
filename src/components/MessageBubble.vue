<script setup lang="ts">
import { computed } from 'vue'
import type { ChatMessage } from '../types/chat'
import { renderMarkdown } from '../utils/markdown'

type Props = {
  message: ChatMessage
}

const props = defineProps<Props>()
const emit = defineEmits<{ retry: [] }>()

const isAssistant = computed(() => props.message.role === 'assistant')

/**
 * 流式期间是否走纯文本渲染。
 *
 * 修的是一个实测出来的性能债:renderedContent 是 computed，依赖 message.content，
 * 而流式期间每个 token 到达都会改 content —— 于是每个 token 都要跑一次
 * md.render + DOMPurify.sanitize **全文**。一条 2000 字的回复要跑几百次全量渲染，
 * 而且是越到后面单次越慢（文本在变长），总成本随长度平方增长。
 *
 * 所以流式期间只渲染纯文本，done 之后再渲染 markdown。代价是流式过程中看不到
 * 加粗和代码高亮，收完的瞬间会有一次样式跳变 —— 拿这个换掉平方级的重复渲染
 * 是划算的，而且流式期间的 markdown 本来就是半截的（``` 还没配对）。
 */
const isStreamingText = computed(
  () => props.message.status === 'pending' || props.message.status === 'streaming'
)

const renderedContent = computed(() =>
  isStreamingText.value ? '' : renderMarkdown(props.message.content)
)
</script>

<template>
  <article class="message" :class="[message.role, message.status]">
    <div class="avatar" aria-hidden="true">
      {{ isAssistant ? 'AI' : '你' }}
    </div>

    <div class="message-body">
      <div class="message-meta">
        <strong>{{ isAssistant ? '知识答疑' : '你' }}</strong>
        <span v-if="message.status === 'streaming'" class="status-text">正在生成</span>
        <span v-else-if="message.status === 'aborted'" class="status-text">已停止</span>
      </div>

      <!--
        aria-live="polite" 让屏幕阅读器能读到正在生成的内容。
        polite 而不是 assertive:assertive 会打断用户当前正在听的内容,
        而流式回复是持续追加的,用 assertive 等于不停打断。
      -->
      <div
        v-if="message.content"
        class="message-content"
        :class="{ 'markdown-body': !isStreamingText, 'streaming-text': isStreamingText }"
        aria-live="polite"
      >
        <!-- 流式期间用文本插值(不解析 markdown),收完后才 v-html 渲染 -->
        <template v-if="isStreamingText">{{ message.content }}</template>
        <template v-else><span v-html="renderedContent" /></template>
      </div>
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

/*
  流式期间是纯文本插值，浏览器默认会把连续空白和换行折叠成一个空格，
  整段挤成一行。pre-wrap 保留换行但仍然自动折行 —— 这样流式过程中的
  段落结构和收完后 markdown 渲染的结果大致对得上，样式跳变没那么突兀。
*/
.streaming-text {
  white-space: pre-wrap;
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
