import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import {
  deleteDocument,
  fetchDocuments,
  uploadDocument,
  type KnowledgeDocument
} from '../services/knowledgeApi'

/**
 * 知识库文档列表。
 *
 * 这个 store 和 chat store 的取舍不同:它直接调网络层,没有单独的
 * composable 编排。列表、上传、删除没有流式生命周期,不需要跨入口
 * 共享 controller；写操作成功后基于当前列表更新，避免旧快照覆盖并发结果。
 * chat 那边分层是因为请求生命周期本身复杂,这里照搬只会增加间接层。
 */
export const useKnowledgeStore = defineStore('knowledge', () => {
  const documents = ref<KnowledgeDocument[]>([])
  const isLoading = ref(false)
  const isUploading = ref(false)
  const error = ref<string | null>(null)

  const totalChunks = computed(() =>
    documents.value.reduce((sum, doc) => sum + doc.chunkCount, 0)
  )

  function readErrorMessage(err: unknown): string {
    return err instanceof Error ? err.message : '操作失败，请重试。'
  }

  async function load() {
    isLoading.value = true
    error.value = null
    try {
      documents.value = await fetchDocuments()
    } catch (err) {
      error.value = readErrorMessage(err)
    } finally {
      isLoading.value = false
    }
  }

  async function upload(title: string, text: string): Promise<boolean> {
    isUploading.value = true
    error.value = null
    try {
      const document = await uploadDocument(title, text)
      documents.value = [document, ...documents.value]
      return true
    } catch (err) {
      error.value = readErrorMessage(err)
      return false
    } finally {
      isUploading.value = false
    }
  }

  async function remove(id: string) {
    error.value = null
    try {
      await deleteDocument(id)
      // 服务端确认写盘成功后再移除，失败时不回滚整张列表，避免覆盖并发上传。
      documents.value = documents.value.filter((doc) => doc.id !== id)
    } catch (err) {
      error.value = readErrorMessage(err)
    }
  }

  return { documents, isLoading, isUploading, error, totalChunks, load, upload, remove }
})
