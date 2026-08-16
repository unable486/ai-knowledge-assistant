<script setup lang="ts">
import type { Conversation } from '../types/chat'

const props = defineProps<{
  conversations: Conversation[]
  activeId: string
}>()

const emit = defineEmits<{
  select: [id: string]
  create: []
  remove: [id: string]
}>()
</script>

<template>
  <aside class="sidebar">
    <div class="brand">
      <div class="brand-mark">知</div>
      <div>
        <strong>知识库助手</strong>
        <span>AI 前端学习项目</span>
      </div>
    </div>

    <button type="button" class="new-chat" @click="emit('create')">
      <span aria-hidden="true">＋</span>
      <span>新建对话</span>
    </button>

    <div class="section-label">对话记录</div>
    <nav class="conversation-list" aria-label="对话记录">
      <div v-if="!props.conversations.length" class="empty-list">还没有对话</div>
      <div
        v-for="conversation in props.conversations"
        :key="conversation.id"
        class="conversation-item"
        :class="{ active: conversation.id === props.activeId }"
      >
        <button type="button" class="conversation-select" @click="emit('select', conversation.id)">
          <span class="conversation-dot" aria-hidden="true" />
          <span class="conversation-title">{{ conversation.title }}</span>
        </button>
        <button
          type="button"
          class="remove-button"
          title="删除对话"
          @click="emit('remove', conversation.id)"
        >
          ×
        </button>
      </div>
    </nav>

    <div class="sidebar-footer">
      <span class="status-dot" />
      <span>Mock 模式 · 无需 API Key</span>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  display: flex;
  flex-direction: column;
  width: 254px;
  flex: 0 0 254px;
  padding: 22px 14px 16px;
  border-right: 1px solid #e2e8f0;
  background: #f8fafc;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 8px 24px;
}

.brand-mark {
  display: grid;
  width: 34px;
  height: 34px;
  place-items: center;
  border-radius: 8px;
  color: #fff;
  background: #0f766e;
  font-weight: 800;
}

.brand strong,
.brand span { display: block; }
.brand strong { color: #0f172a; font-size: 14px; }
.brand span { margin-top: 3px; color: #94a3b8; font-size: 11px; }

.new-chat {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  height: 38px;
  border: 1px solid #99f6e4;
  border-radius: 6px;
  color: #0f766e;
  background: #f0fdfa;
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
}

.new-chat:hover { background: #ccfbf1; }
.section-label {
  margin: 28px 9px 9px;
  color: #94a3b8;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.05em;
}

.conversation-list { overflow-y: auto; }
.empty-list { padding: 12px 9px; color: #94a3b8; font-size: 12px; }
.conversation-item { display: flex; align-items: center; border-radius: 6px; }
.conversation-item.active { background: #e2e8f0; }
.conversation-select {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1;
  padding: 10px 8px;
  border: 0;
  color: #475569;
  background: transparent;
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  text-align: left;
}
.conversation-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.conversation-dot { width: 5px; height: 5px; flex: 0 0 5px; border-radius: 50%; background: #cbd5e1; }
.active .conversation-dot { background: #0f766e; }
.remove-button {
  display: none;
  width: 28px;
  height: 28px;
  margin-right: 4px;
  border: 0;
  border-radius: 4px;
  color: #94a3b8;
  background: transparent;
  cursor: pointer;
  font-size: 18px;
}
.conversation-item:hover .remove-button { display: block; }
.remove-button:hover { color: #be123c; background: #fff1f2; }

.sidebar-footer {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-top: auto;
  padding: 14px 8px 0;
  border-top: 1px solid #e2e8f0;
  color: #94a3b8;
  font-size: 11px;
}
.status-dot { width: 6px; height: 6px; border-radius: 50%; background: #14b8a6; }

@media (max-width: 700px) {
  .sidebar { width: 220px; flex-basis: 220px; }
}
</style>
