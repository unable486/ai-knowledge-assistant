export interface SkillSummary {
  id: string
  name: string
  description: string
}

export interface SkillSelection {
  mode: 'auto' | 'manual' | 'off'
  ids: string[]
}

export interface SkillReferenceTrace {
  path: string
  heading: string
  version: string
  excerpt: string
}

export interface SkillUseTrace extends SkillSummary {
  version: string
  reason: 'auto' | 'manual' | 'mention'
  references: SkillReferenceTrace[]
}

export interface SkillTrace {
  mode: SkillSelection['mode']
  selected: SkillUseTrace[]
  warnings: string[]
}

/** 请求边界校验。旧客户端未传选择时继续使用自动模式。 */
export function readSkillSelection(value: unknown): SkillSelection | null {
  if (value === undefined) return { mode: 'auto', ids: [] }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const { mode, ids } = value as Record<string, unknown>
  if (mode !== 'auto' && mode !== 'manual' && mode !== 'off') return null
  if (!Array.isArray(ids) || ids.length > 20 || ids.some((id) => typeof id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || id.length > 64)) return null
  return { mode, ids: mode === 'manual' ? [...new Set(ids)] as string[] : [] }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function boundedText(value: unknown, limit: number): value is string {
  return typeof value === 'string' && value.length <= limit
}

/** 目录和 SSE 都只保留已校验的公开字段，原文不截断、不解析 HTML。 */
export function readSkillSummary(value: unknown): SkillSummary | null {
  if (!isRecord(value)) return null
  const { id, name, description } = value
  if (typeof id !== 'string' || id.length > 64 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) return null
  if (!boundedText(name, 200) || !name.trim() || !boundedText(description, 2_000)) return null
  return { id, name, description }
}

export function readSkillTrace(value: unknown): SkillTrace | null {
  if (!isRecord(value)) return null
  const { mode, selected, warnings } = value
  if (mode !== 'auto' && mode !== 'manual' && mode !== 'off') return null
  if (!Array.isArray(selected) || selected.length > 20 || !Array.isArray(warnings) || warnings.length > 20) return null
  if (!warnings.every((warning) => boundedText(warning, 2_000))) return null

  const skills: SkillUseTrace[] = []
  for (const item of selected) {
    const summary = readSkillSummary(item)
    if (!summary || !isRecord(item) || !boundedText(item.version, 128) || !item.version) return null
    if (item.reason !== 'auto' && item.reason !== 'manual' && item.reason !== 'mention') return null
    if (!Array.isArray(item.references) || item.references.length > 20) return null
    const references: SkillReferenceTrace[] = []
    for (const reference of item.references) {
      if (!isRecord(reference)) return null
      if (!boundedText(reference.path, 500) || !reference.path || !boundedText(reference.heading, 1_000)) return null
      if (!boundedText(reference.version, 128) || !reference.version || !boundedText(reference.excerpt, 16_000)) return null
      references.push({ path: reference.path, heading: reference.heading, version: reference.version, excerpt: reference.excerpt })
    }
    skills.push({ ...summary, version: item.version, reason: item.reason, references })
  }
  return { mode, selected: skills, warnings: [...warnings] as string[] }
}
