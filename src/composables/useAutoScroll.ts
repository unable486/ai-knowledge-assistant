import { nextTick, onMounted, ref, type Ref } from 'vue'

const BOTTOM_THRESHOLD = 40

/**
 * 流式输出时自动滚到底部,但用户手动上滚后要停下来。
 *
 * 这是流式 UI 里最容易做砸的交互:一路强制 scrollTo(bottom) 会导致
 * 用户想回看上文时被反复拽回底部。正确做法是维护一个"是否贴底"的标志:
 * - 用户滚动时更新标志(距底部小于阈值才算贴底)
 * - 只有贴底状态才自动跟随
 *
 * 阈值不能是 0:浏览器缩放和小数像素会让 scrollTop + clientHeight
 * 永远差几个像素,严格相等判断在部分设备上永远为 false。
 */
export function useAutoScroll(container: Ref<HTMLElement | null>) {
  const pinnedToBottom = ref(true)

  function isNearBottom(el: HTMLElement): boolean {
    return el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_THRESHOLD
  }

  function handleScroll() {
    const el = container.value
    if (el) pinnedToBottom.value = isNearBottom(el)
  }

  /** 内容变化后调用。等 DOM 更新完再滚,否则 scrollHeight 还是旧值 */
  async function scrollToBottom(force = false) {
    if (!force && !pinnedToBottom.value) return

    await nextTick()
    const el = container.value
    if (el) el.scrollTop = el.scrollHeight
  }

  onMounted(() => void scrollToBottom(true))

  return { pinnedToBottom, handleScroll, scrollToBottom }
}
