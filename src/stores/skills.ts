import { defineStore } from 'pinia'
import { ref } from 'vue'
import { readSkillSelection, readSkillSummary, type SkillSelection, type SkillSummary } from '../../shared/skills'
import { httpClient } from '../services/http/client'

export const useSkillStore = defineStore('skills', () => {
  const skills = ref<SkillSummary[]>([])
  const selection = ref<SkillSelection>({ mode: 'auto', ids: [] })
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  function setSelection(value: SkillSelection) {
    const parsed = readSkillSelection(value)
    if (parsed) selection.value = parsed
  }

  async function load() {
    if (isLoading.value) return
    isLoading.value = true
    error.value = null
    try {
      const response = await httpClient.request('/api/skills')
      const body: unknown = await response.json()
      const raw = body && typeof body === 'object' && 'skills' in body ? body.skills : null
      if (!Array.isArray(raw) || raw.length > 200) throw new Error('服务端返回的技能列表无法解析。')
      const parsed = raw.map(readSkillSummary)
      if (parsed.some((skill) => skill === null)) throw new Error('服务端返回的技能列表无法解析。')
      skills.value = [...new Map((parsed as SkillSummary[]).map((skill) => [skill.id, skill])).values()]
    } catch (err) {
      error.value = `技能列表加载失败：${err instanceof Error ? err.message : '请稍后重试。'} 仍可继续聊天。`
    } finally {
      isLoading.value = false
    }
  }

  return { skills, selection, isLoading, error, setSelection, load }
})
