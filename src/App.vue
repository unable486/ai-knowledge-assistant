<script setup lang="ts">
import { onMounted } from 'vue'
import AppSidebar from './components/AppSidebar.vue'
import ChatPanel from './components/ChatPanel.vue'
import type { ChatMessage } from './types/chat'
import { useChat } from './composables/useChat'
import { useChatPersistence } from './composables/useChatPersistence'
import { useChatStore } from './stores/chat'

const store = useChatStore()
const { send, retry, abort } = useChat()
const persistence = useChatPersistence()

// 顺序有讲究:先恢复历史,再补一个空会话(没历史时才会真的建),
// 最后才开始监听。反过来的话,hydrate 本身会触发一次写入。
persistence.restore()
persistence.start()

onMounted(() => {
  store.ensureConversation()
})

function handleCreate() {
  abort()
  store.createConversation()
}

function handleSelect(id: string) {
  // 切会话前先中止在飞的请求,否则流会继续往旧会话里写
  abort()
  store.switchConversation(id)
}

function handleRemove(id: string) {
  if (id === store.activeId) abort()
  store.removeConversation(id)
  store.ensureConversation()
}

function handleRetry(message: ChatMessage) {
  void retry(message.id)
}
</script>

<template>
  <div class="app-shell">
    <AppSidebar
      :conversations="store.conversations"
      :active-id="store.activeId"
      @create="handleCreate"
      @select="handleSelect"
      @remove="handleRemove"
    />
    <ChatPanel
      :messages="store.messages"
      :is-streaming="store.isStreaming"
      @send="send"
      @abort="abort"
      @retry="handleRetry"
    />
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  height: 100vh;
  overflow: hidden;
}
</style>
