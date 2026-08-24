import { onScopeDispose, watch } from 'vue'
import { readSnapshot, writeSnapshot } from '../services/storage/chatStorage'
import { useChatStore } from '../stores/chat'

/**
 * 把会话状态同步到 localStorage。
 *
 * 分成「恢复」和「保存」两半,都放在这里而不是 store 里:store 只描述数据,
 * 一旦它自己去读写 localStorage,单测就得准备一个 Storage 替身才能跑。
 *
 * 写入时机是这个文件里唯一需要想清楚的事。流式过程中每个 token 都会改
 * store,如果原样跟着写,一次回复就是几百次 JSON.stringify + setItem,
 * 而 localStorage 是同步 API,会直接卡住渲染。所以做两层节流:
 *
 * - 防抖 400ms:连续变更合并成一次写入
 * - 兜底 2s:防抖在流式期间会被不断重置(token 间隔远小于 400ms),
 *   没有兜底的话一次长回复直到结束才落盘。中途关页面就全丢了。
 *
 * 再加一道 pagehide 同步刷盘,覆盖「防抖还没到点就关了标签页」。
 */

const debounceDelay = 400
const maxDelay = 2_000

export function useChatPersistence() {
  const store = useChatStore()

  let debounceTimer: number | null = null
  let maxWaitTimer: number | null = null

  function clearTimers() {
    if (debounceTimer !== null) {
      window.clearTimeout(debounceTimer)
      debounceTimer = null
    }
    if (maxWaitTimer !== null) {
      window.clearTimeout(maxWaitTimer)
      maxWaitTimer = null
    }
  }

  function flush() {
    clearTimers()
    writeSnapshot({
      conversations: store.conversations,
      activeId: store.activeId
    })
  }

  function schedule() {
    if (debounceTimer !== null) window.clearTimeout(debounceTimer)
    debounceTimer = window.setTimeout(flush, debounceDelay)

    // 兜底计时器只在没排队时启动,不跟着每次变更重置——否则它也会被推迟,
    // 就失去「最长 2s 必写一次」的意义
    if (maxWaitTimer === null) {
      maxWaitTimer = window.setTimeout(flush, maxDelay)
    }
  }

  /**
   * 启动时恢复。没有快照时不建空会话,交给调用方的 ensureConversation,
   * 避免这里和 App.vue 各建一个。
   */
  function restore() {
    const snapshot = readSnapshot()
    if (snapshot) store.hydrate(snapshot)
  }

  function start() {
    // deep 是必须的:消息内容变更在数组元素内部,浅监听看不到。
    // 代价是每次变更都要遍历整棵会话树,靠上面的节流把频率压下来。
    const stopWatch = watch(
      () => [store.conversations, store.activeId],
      schedule,
      { deep: true }
    )

    // pagehide 比 beforeunload 可靠:移动端 Safari 切后台不触发 beforeunload。
    // visibilitychange 再兜一层,覆盖切标签页后被系统回收的情况。
    const onHide = () => flush()
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flush()
    }

    window.addEventListener('pagehide', onHide)
    document.addEventListener('visibilitychange', onVisibilityChange)

    onScopeDispose(() => {
      stopWatch()
      window.removeEventListener('pagehide', onHide)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      // 卸载前把挂起的变更写掉,而不是丢掉
      flush()
    })
  }

  return { restore, start }
}
