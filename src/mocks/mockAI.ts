import type { StreamChunk } from '../types/chat'

/**
 * Mock AI 层。
 *
 * 用异步生成器(async function*)模拟 SSE 流式响应,这样调用方可以用
 * `for await...of` 逐块消费,和真实接入 fetch + ReadableStream 时的
 * 消费方式完全一致——以后换真实后端,只需要替换这个文件的实现,
 * useChat.ts 和上层组件都不用改。这是"面向接口编程"在前端的落地。
 *
 * 取消机制用标准的 AbortSignal,不是自造一个 cancel() 方法:
 * - 和浏览器 fetch API 保持同一套语义,以后接真实后端时 AbortController
 *   可以原样传给 fetch(url, { signal })
 * - sleep() 内部监听 signal 的 abort 事件,让"取消"能立刻打断等待,
 *   而不是等当前 chunk 的延迟结束才检查
 */

/** 可取消的 sleep:abort 时立刻 reject,而不是等 timeout 走完 */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }

    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)

    function onAbort() {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }

    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/** 把一段完整文本切成若干小块,模拟 token 级流式输出 */
function splitIntoChunks(text: string): string[] {
  const chunks: string[] = []
  // 按 2~4 个字符切,中英文混排都能有"逐字吐出"的视觉效果
  let i = 0
  while (i < text.length) {
    const size = 2 + Math.floor(Math.random() * 3)
    chunks.push(text.slice(i, i + size))
    i += size
  }
  return chunks
}

interface Scenario {
  /** 命中关键词就使用这个场景 */
  keywords: string[]
  reply: string
}

/**
 * 预置场景。面试/演示时最怕的就是"AI回答不可控",这里用关键词匹配
 * 做成确定性的:同样的输入永远给同样的输出,方便复现和讲解。
 */
const SCENARIOS: Scenario[] = [
  {
    keywords: ['vue', 'vue2', 'vue3', '响应式'],
    reply:
      'Vue 的响应式系统在 Vue 2 和 Vue 3 里实现方式不同。\n\n' +
      '**Vue 2** 用 `Object.defineProperty` 劫持对象已有属性的 getter/setter,' +
      '所以新增属性不会自动响应,需要 `Vue.set`。\n\n' +
      '**Vue 3** 用 `Proxy` 劫持整个对象,可以拦截属性的新增、删除,' +
      '不再需要 `Vue.set` 这类特殊 API。\n\n' +
      '```js\n' +
      '// Vue 3 Proxy 的核心思路\n' +
      'const state = new Proxy(target, {\n' +
      '  get(obj, key) {\n' +
      '    track(obj, key) // 收集依赖\n' +
      '    return obj[key]\n' +
      '  },\n' +
      '  set(obj, key, value) {\n' +
      '    obj[key] = value\n' +
      '    trigger(obj, key) // 触发更新\n' +
      '    return true\n' +
      '  }\n' +
      '})\n' +
      '```'
  },
  {
    keywords: ['nginx', '缓存', 'cache'],
    reply:
      '前端发布后浏览器还是旧内容,常见根因排在前面的三个:\n\n' +
      '1. **入口 HTML 没有内容哈希**,又被缓存了——`index.html` 必须设置' +
      '`Cache-Control: no-cache`,让浏览器每次都回源校验(用 304 应答,不是真的' +
      '重新下载)。\n' +
      '2. **手写引入的静态资源没有 hash 文件名**,比如直接写` /static/lib.css`,' +
      '这类文件必须靠文件名变化才能让浏览器认为是新资源。\n' +
      '3. **CDN/反向代理层有独立缓存**,即使源站配置正确,代理层的缓存策略' +
      '(比如 `proxy_cache_valid`)没跟着变,用户拿到的还是代理缓存的旧版本。\n\n' +
      '排查顺序建议:先看 Network 面板里 `index.html` 的响应头,再看具体' +
      '静态资源的文件名是否变化,最后才排查代理层。'
  },
  {
    keywords: ['token', '登录', '鉴权', 'jwt'],
    reply:
      '典型的前端 token 鉴权流程:\n\n' +
      '1. 登录接口返回 `access_token`(短期有效)和 `refresh_token`(长期有效)\n' +
      '2. `access_token` 存在内存或 sessionStorage,通过 Axios 请求拦截器' +
      '统一挂到 `Authorization: Bearer <token>` 头上\n' +
      '3. 响应拦截器捕获 401,用 `refresh_token` 换新的 `access_token`,' +
      '换成功后重放原请求;换失败则清空状态跳转登录页\n' +
      '4. 并发场景下要注意"多个请求同时 401"只触发一次刷新,用一个' +
      '标志位 + 请求队列把其他请求挂起,等刷新完成后统一重试\n\n' +
      '这一套在很多企业后台系统里都是标准实现。'
  }
]

const FALLBACK_REPLY =
  '这是一个 Mock 回复,用来演示流式输出效果。\n\n' +
  '真实项目里这部分会替换成对接大模型 API 的请求,现在先用固定文本' +
  '模拟"逐字吐字"的视觉效果,方便打磨交互细节而不用先付费调真实接口。'

function matchScenario(question: string): string {
  const lower = question.toLowerCase()
  const hit = SCENARIOS.find((s) => s.keywords.some((k) => lower.includes(k.toLowerCase())))
  return hit ? hit.reply : FALLBACK_REPLY
}

/**
 * 触发错误场景的魔法词。演示和联调时需要能"按需复现失败",
 * 否则错误分支的 UI 永远测不到。
 */
const ERROR_TRIGGER = '模拟错误'
const SLOW_TRIGGER = '模拟慢速'

/**
 * 模拟流式对话接口。
 *
 * @param question 用户输入
 * @param signal   取消信号,来自调用方的 AbortController
 * @throws DOMException('AbortError') 被取消时抛出
 * @throws Error 命中错误场景时抛出
 */
export async function* streamMockReply(
  question: string,
  signal: AbortSignal
): AsyncGenerator<StreamChunk, void, void> {
  const wantError = question.includes(ERROR_TRIGGER)
  const chunkDelay = question.includes(SLOW_TRIGGER) ? 220 : 28

  // 模拟首字延迟(真实大模型都有 TTFT,首字节时间)
  await sleep(400, signal)

  if (wantError) {
    throw new Error('服务暂时不可用,请稍后重试(这是被"模拟错误"触发的演示异常)')
  }

  const chunks = splitIntoChunks(matchScenario(question))

  for (const delta of chunks) {
    // 每块之前都检查一次:取消要能在流的中途立刻生效
    await sleep(chunkDelay, signal)
    yield { delta }
  }
}

export const MOCK_TRIGGERS = {
  error: ERROR_TRIGGER,
  slow: SLOW_TRIGGER
} as const
