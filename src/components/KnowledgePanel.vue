<script setup lang="ts">
import { computed, ref } from 'vue'
import { useKnowledgeStore } from '../stores/knowledge'

const store = useKnowledgeStore()

const isOpen = ref(false)
const title = ref('')
const text = ref('')
const fileInput = ref<HTMLInputElement | null>(null)

const canSubmit = computed(() => text.value.trim().length > 0 && !store.isUploading)

async function submit() {
  if (!canSubmit.value) return
  const ok = await store.upload(title.value.trim() || '未命名文档', text.value)
  if (ok) {
    title.value = ''
    text.value = ''
    isOpen.value = false
  }
}

/** 只读纯文本类文件。PDF/Word 需要额外解析库，目前不支持。 */
async function pickFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  text.value = await file.text()
  if (!title.value.trim()) title.value = file.name.replace(/\.[^.]+$/, '')
  // 清掉 value，否则选同一个文件不会再触发 change
  input.value = ''
}

function formatSize(characters: number): string {
  return characters >= 1000 ? `${(characters / 1000).toFixed(1)}k 字` : `${characters} 字`
}
</script>

<template>
  <section class="knowledge">
    <div class="section-label">
      <span>知识库</span>
      <span v-if="store.documents.length" class="chunk-count">{{ store.totalChunks }} 块</span>
    </div>

    <button type="button" class="add-doc" @click="isOpen = !isOpen">
      <span aria-hidden="true">{{ isOpen ? '−' : '＋' }}</span>
      <span>{{ isOpen ? '收起' : '添加文档' }}</span>
    </button>

    <form v-if="isOpen" class="upload-form" @submit.prevent="submit">
      <input v-model="title" type="text" placeholder="标题（可留空）" maxlength="80" />
      <textarea
        v-model="text"
        placeholder="粘贴文档内容，或选择 .txt / .md 文件"
        rows="5"
      />
      <div class="form-actions">
        <button type="button" class="file-button" @click="fileInput?.click()">选择文件</button>
        <button type="submit" class="submit-button" :disabled="!canSubmit">
          {{ store.isUploading ? '处理中…' : '入库' }}
        </button>
      </div>
      <input
        ref="fileInput"
        type="file"
        accept=".txt,.md,.markdown,text/plain"
        hidden
        @change="pickFile"
      />
    </form>

    <p v-if="store.error" class="error-text">{{ store.error }}</p>

    <ul class="doc-list">
      <li v-if="store.isLoading" class="hint">加载中…</li>
      <li v-else-if="!store.documents.length" class="hint">还没有文档，问答只用模型自身知识</li>
      <li v-for="doc in store.documents" :key="doc.id" class="doc-item">
        <div class="doc-info">
          <span class="doc-title">{{ doc.title }}</span>
          <span class="doc-meta">{{ doc.chunkCount }} 块 · {{ formatSize(doc.characters) }}</span>
        </div>
        <button type="button" class="remove-button" title="删除文档" @click="store.remove(doc.id)">
          ×
        </button>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.knowledge { display: flex; min-height: 0; flex: 1 1 auto; flex-direction: column; }

.section-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 24px 9px 9px;
  color: #94a3b8;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.05em;
}

.chunk-count { font-weight: 600; letter-spacing: 0; }

.add-doc {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  height: 32px;
  border: 1px dashed #cbd5e1;
  border-radius: 6px;
  color: #64748b;
  background: transparent;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
}

.add-doc:hover { border-color: #5eead4; color: #0f766e; background: #f0fdfa; }

.upload-form { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }

.upload-form input[type='text'],
.upload-form textarea {
  width: 100%;
  padding: 7px 8px;
  border: 1px solid #cbd5e1;
  border-radius: 5px;
  color: #334155;
  background: #fff;
  font: inherit;
  font-size: 12px;
  resize: vertical;
}

.upload-form input[type='text']:focus,
.upload-form textarea:focus { border-color: #5eead4; outline: none; }

.form-actions { display: flex; gap: 6px; }

.file-button,
.submit-button {
  flex: 1;
  height: 30px;
  border-radius: 5px;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
}

.file-button { border: 1px solid #cbd5e1; color: #475569; background: #fff; }
.file-button:hover { border-color: #94a3b8; }

.submit-button { border: 0; color: #fff; background: #0f766e; font-weight: 600; }
.submit-button:hover:not(:disabled) { background: #115e59; }
.submit-button:disabled { background: #cbd5e1; cursor: not-allowed; }

.error-text {
  margin: 8px 2px 0;
  color: #b91c1c;
  font-size: 11px;
  line-height: 1.6;
}

.doc-list { margin: 8px 0 0; padding: 0; overflow-y: auto; list-style: none; }
.hint { padding: 8px 9px; color: #94a3b8; font-size: 11px; line-height: 1.6; }

.doc-item {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 7px 8px;
  border-radius: 5px;
}

.doc-item:hover { background: #eef2f6; }
.doc-info { min-width: 0; flex: 1; }

.doc-title {
  display: block;
  overflow: hidden;
  color: #475569;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.doc-meta { display: block; margin-top: 2px; color: #94a3b8; font-size: 10px; }

.remove-button {
  display: none;
  width: 24px;
  height: 24px;
  flex: 0 0 24px;
  border: 0;
  border-radius: 4px;
  color: #94a3b8;
  background: transparent;
  cursor: pointer;
  font-size: 16px;
}

.doc-item:hover .remove-button { display: block; }
.remove-button:hover { color: #be123c; background: #fff1f2; }
</style>
