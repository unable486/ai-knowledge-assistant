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
 * composable 编排。理由是这里的请求没有竞态可言——列表、上传、删除
 * 各自独立,没有流式,没有中止,不需要跨入口共享 controller。
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
    // 乐观更新:先从列表移除,失败再拉回来。删除几乎不会失败,
    // 等一个往返才消失会让界面显得迟钝。
    const snapshot = documents.value
    documents.value = documents.value.filter((doc) => doc.id !== id)
    try {
      await deleteDocument(id)
    } catch (err) {
      documents.value = snapshot
      error.value = readErrorMessage(err)
    }
  }

  return { documents, isLoading, isUploading, error, totalChunks, load, upload, remove }
})
