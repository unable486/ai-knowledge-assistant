<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import type { ChatMessage } from '../types/chat'
import MessageBubble from './MessageBubble.vue'
import MessageInput from './MessageInput.vue'
import { useAutoScroll } from '../composables/useAutoScroll'

const props = defineProps<{
  messages: ChatMessage[]
  isStreaming: boolean
}>()

const emit = defineEmits<{
  send: [value: string]
  abort: []
  retry: [message: ChatMessage]
}>()

const scroller = ref<HTMLElement | null>(null)
const { handleScroll, scrollToBottom } = useAutoScroll(scroller)

watch(
  () => props.messages.map((message) => `${message.id}:${message.content.length}:${message.status}`),
  () => void scrollToBottom(),
  { flush: 'post' }
)

async function retry(message: ChatMessage) {
  const previousUser = props.messages[props.messages.indexOf(message) - 1]
  if (previousUser?.role !== 'user') return
  emit('retry', message)
  await nextTick()
  void scrollToBottom(true)
}
</script>

<template>
  <main class="chat-panel">
    <header class="topbar">
      <div>
        <h1>AI 知识库助手</h1>
        <p>用对话练习前端原理、工程实践与项目排查</p>
      </div>
      <span class="mock-badge">前端 Mock</span>
    </header>

    <section ref="scroller" class="message-scroller" @scroll="handleScroll">
      <div v-if="!props.messages.length" class="welcome">
        <div class="welcome-icon">知</div>
        <h2>从一个问题开始</h2>
        <p>试试问我 Vue 响应式、Nginx 缓存、Token 鉴权，或者输入“模拟错误”看看异常处理。</p>
        <div class="suggestions">
          <button type="button" @click="emit('send', 'Vue 2 和 Vue 3 的响应式有什么区别？')">Vue 响应式区别</button>
          <button type="button" @click="emit('send', '前端发布后为什么要清缓存？')">Nginx 缓存排查</button>
          <button type="button" @click="emit('send', 'Token 续期应该怎么处理？')">Token 续期流程</button>
        </div>
      </div>

      <div v-else class="message-list">
        <MessageBubble
          v-for="message in props.messages"
          :key="message.id"
          :message="message"
          @retry="retry(message)"
        />
      </div>
    </section>

    <footer class="composer-area">
      <MessageInput :disabled="props.isStreaming" @submit="emit('send', $event)" @abort="emit('abort')" />
    </footer>
  </main>
</template>

<style scoped>
.chat-panel { display: flex; min-width: 0; flex: 1; flex-direction: column; background: #fff; }
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 76px;
  padding: 0 28px;
  border-bottom: 1px solid #e2e8f0;
}
.topbar h1 { margin: 0; color: #0f172a; font-size: 16px; }
.topbar p { margin: 5px 0 0; color: #94a3b8; font-size: 12px; }
.mock-badge { padding: 5px 8px; border-radius: 4px; color: #0f766e; background: #f0fdfa; font-size: 11px; font-weight: 700; }
.message-scroller { min-height: 0; flex: 1; overflow-y: auto; }
.welcome { max-width: 620px; margin: 14vh auto 0; padding: 24px; text-align: center; }
.welcome-icon {
  display: grid;
  width: 48px;
  height: 48px;
  margin: 0 auto 16px;
  place-items: center;
  border-radius: 12px;
  color: #fff;
  background: #0f766e;
  font-size: 20px;
  font-weight: 800;
}
.welcome h2 { margin: 0; color: #0f172a; font-size: 22px; }
.welcome p { margin: 10px auto 22px; color: #64748b; font-size: 13px; line-height: 1.7; }
.suggestions { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; }
.suggestions button { padding: 8px 11px; border: 1px solid #cbd5e1; border-radius: 6px; color: #475569; background: #fff; cursor: pointer; font: inherit; font-size: 12px; }
.suggestions button:hover { border-color: #5eead4; color: #0f766e; background: #f0fdfa; }
.composer-area { padding: 14px 24px 18px; border-top: 1px solid #f1f5f9; }

@media (max-width: 700px) {
  .topbar { padding: 0 16px; }
  .topbar p { display: none; }
  .composer-area { padding: 12px 14px 16px; }
}
</style>
