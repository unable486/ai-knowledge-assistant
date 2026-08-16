/**
 * 生成短唯一 ID。
 *
 * crypto.randomUUID() 只在 HTTPS 或 localhost 下可用,
 * 局域网 IP 访问 dev server 时 window.crypto 可能没有该方法,
 * 所以保留一条降级路径,避免开发时白屏。
 */
export function createId(prefix = ''): string {
  const core =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

  return prefix ? `${prefix}_${core}` : core
}
