# 面试 07 · Vue 深挖 > 说明

来源：https://fqx.lx.ci/interview-prep/07-vue.html

Vue 深挖

答案默认折叠。先自己答一遍，再点开核对。每题末尾的**追问**是面试官顺着你的答案往下挖的那一层 —— 只答得出主问题、答不出追问，通常判定为「背过，没做过」。

- 🔴 必答 — 答不出直接掉档

- 🟡 加分 — 能拉开差距

- ⚪ 可以坦白不会 — 说清边界比硬编好

# 面试 07 · Vue 深挖 > Vue 2 和 Vue 3 的响应式差在哪，换成 Proxy 解决了什么

来源：https://fqx.lx.ci/interview-prep/07-vue.html#q1

`Object.defineProperty` 劫持的是**某个已知属性**的 getter/setter，所以它必须在初始化时就遍历到那个属性。由此有三个绕不过去的缺陷，每个都对应一个具体的「页面不动」现象：

 

```js
// Vue 2
this.form.remark = 'x'      // 新增属性：拦不到，页面不更新 → 必须 this.$set
delete this.form.remark     // 删除：拦不到 → 必须 this.$delete
this.list[0] = newItem      // 数组下标赋值：拦不到
this.list.length = 0        // 改长度：拦不到
this.list.push(newItem)     // 这个能更新，因为 Vue 2 把七个数组方法重写了一遍
```

 

`push / pop / shift / unshift / splice / sort / reverse` 这七个方法被 Vue 2 重写过，所以能触发更新；下标赋值和 `length` 没有对应的方法可以劫持，只能靠 `$set`。这套补丁是 Vue 2 响应式最明显的漏点——它不是设计取舍，是机制上做不到。

 

Vue 3 用 `Proxy` 代理整个对象，拦的是「对这个对象的操作」而不是「某个属性」，`set`、`deleteProperty`、`has`、`ownKeys` 都有对应的 trap，所以上面五行在 Vue 3 里全都正常触发更新，`$set` / `$delete` 也就从 API 里删掉了。

 

第二个差别是性能：Vue 2 初始化时要深度递归遍历整个 `data` 逐属性劫持，对象越大启动越慢；Proxy 是**惰性**的，只在真正访问到某一层时才继续代理下去，模板没用到的分支根本不会被处理。中后台那种嵌套很深的表单配置对象，这个差别在页面初始化耗时上能直接量出来（要报数字就换成你自己项目里的数）。

 

代价也要主动说：**Proxy 无法被 polyfill**，这是 Vue 3 放弃 IE11 的根本原因——不是不想支持，是 ES6 Proxy 的行为没办法用 ES5 模拟。被问「为什么 Vue 3 不支持 IE」时这一句就是标准答案。

 

再往前看一层：Vue 3.6 把 `@vue/reactivity` 基于 alien-signals 重写了一遍，主要收益是内存占用和依赖传播效率，但对外的 `ref` / `computed` / `watch` 语义没变，Proxy 这层也没变。截至 2026-09-03，3.6 仍在 RC 阶段（最新 `3.6.0-rc.6`，2026-08-28），npm 上 `latest` 还是 3.5.x，所以说「我们线上用的是 3.5」是正确答案，不用为了显得新而说 3.6。

 

**追问「Vue 3 里还有什么是 Proxy 也拦不住的」**：三类，都是真踩过才知道的。**一是解构**——`const { count } = reactive(state)` 拿到的是那一刻的值，之后 `state.count` 再变，解构出来的变量不会动，因为 Proxy 只能拦「访问 state 的 count」这个动作，拦不了「一个普通变量」；这是 `toRefs` 存在的唯一理由。**二是带私有字段的 class 实例**——`class A { #id = 1; get id() { return this.#id } }`，把实例塞进 `reactive()` 再读 `id` 会直接抛 `TypeError: Cannot read private member`，因为方法执行时 `this` 是 Proxy 而不是原始对象，私有字段在 Proxy 上不存在。第三方 SDK 的实例（地图、编辑器、播放器）放进 `reactive` 就常撞这个，正确做法是 `shallowRef` 或 `markRaw` 包起来——这些对象本来也不需要响应式。**三是 Map / Set 靠单独的 collection handler 处理**，因为 `map.get(k)` 是方法调用不是属性访问，Vue 内部替换了这些方法才让它响应式，所以自己实现的类似容器类不会自动获得这个能力。

# 面试 07 · Vue 深挖 > 响应式是怎么知道「谁用了这个数据」的

来源：https://fqx.lx.ci/interview-prep/07-vue.html#q2

一句话：**读的时候记下来，写的时候通知**。依赖关系不是声明的，是「跑一遍看它读了什么」得出的。

 

具体过程：渲染一个组件前，Vue 把当前的副作用函数（渲染函数）设为「正在运行的 effect」（内部一个全局变量），然后执行渲染。模板里读到哪个属性，那个属性的 getter 就被触发，getter 把当前这个 effect 记进自己的依赖集合。之后这个属性被写入，setter 遍历依赖集合，把里面的 effect 重新排进调度队列跑一遍。`watch` / `watchEffect` / `computed` 都是同一套机制的不同封装，区别只在调度器（渲染 effect 走异步队列，`watch` 默认 pre 时机，`{ flush: 'sync' }` 就同步跑）。

 

这套机制直接解释了四个平时会被当成「Vue 的怪毛病」的现象：

 

- **模板里没用到的数据改了不触发渲染** —— 没被收集过。调试时看着数据变了但界面没动，第一反应应该是「这个字段模板真的读了吗」，而不是「响应式坏了」。
- **`v-if="false"` 分支里的数据不会被收集** —— 那段渲染代码没执行，getter 没被触发。条件变成 true 重新渲染时才收集到新分支的依赖。
- **`watchEffect` 的依赖时有时无** —— 同一个原因。条件分支里的读取只在走到那条路时才建立依赖，所以「上次没监听到、这次监听到了」是正常行为，不是 bug。
- **异步回调里读的数据不会被追踪** —— `watchEffect(async () => { await f(); console.log(state.x) })`，`await` 之后同步执行栈已经结束，全局的「当前 effect」指针早就被清掉了，此时读 `state.x` 收集不到。所以异步 effect 里要追踪的依赖必须写在第一个 `await` **之前**。

 

```js
// 会踩坑的写法
watchEffect(async () => {
  const res = await fetch(`/api/list?p=${page.value}`)  // page 在 await 之前读，能收集
  total.value = (await res.json()).total
  console.log(keyword.value)   // await 之后读，收集不到！keyword 变化不会重跑
})

// 修法：依赖显式读到前面
watchEffect(async () => {
  const p = page.value, kw = keyword.value   // 先同步读完
  const res = await fetch(`/api/list?p=${p}&kw=${kw}`)
  total.value = (await res.json()).total
})
```

 

**追问「依赖是每次渲染重新收集的，那切换分支后旧依赖为什么不会残留」**：因为每次 effect 重跑前会做一次**依赖清理**。Vue 3 的实现是给每个 effect 维护它当前依赖的集合，重跑时用版本号标记本轮又被读到的依赖，跑完把没被标记的从对应属性的订阅者列表里摘掉（3.4 之前是先全清空再重建，3.4 之后改成双向链表加版本标记，省掉了大量重复的增删；3.6 的 alien-signals 重写进一步优化了这套结构）。**验证它真的清理了很容易**：`v-if` 切走一个分支后，改那个分支里用到的数据，组件不应该重新渲染——如果重新渲染了就说明依赖残留。反过来，自己写的 effect 里如果把 `.value` 存进了外部的闭包变量或者数组，那个引用不会被依赖清理机制回收，这才是真正的泄漏来源，要靠 `onScopeDispose` 自己清（见 `07-vue.md` 第 23 题）。

# 面试 07 · Vue 深挖 > computed 和 watch 的区别，watchEffect 什么时候用

来源：https://fqx.lx.ci/interview-prep/07-vue.html#q3

判断标准一句话：**要算出一个新值就用 computed，要做一件事就用 watch。**

 

|  | computed | watch | watchEffect |
| --- | --- | --- | --- |
| 产出 | 一个值 | 无（做副作用） | 无（做副作用） |
| 缓存 | 有，依赖不变时多次读只算一次 | 不涉及 | 不涉及 |
| 依赖 | 自动收集 | 显式声明 | 自动收集 |
| 首次执行 | 惰性，第一次被读时才算 | 默认不执行（要 `immediate: true`） | 立即执行一次 |
| 拿得到旧值 | 不需要 | 能 | 不能 |

 

`computed` 必须是**同步纯函数**：不该在里面发请求、不该改别的状态。理由不是「规范要求」，是它的求值时机由依赖收集和缓存决定，你无法预测它什么时候跑、跑几次——在里面改状态就会写出「看着像随机触发」的 bug。

 

`watchEffect` 的取舍很具体：依赖多而且都要、只是「任一变了就重跑」时它最省事；代价是**依赖隐式**——代码长到三十行以后没人看得出它在监听什么，加上条件分支里依赖时有时无（见 `07-vue.md` 第 2 题），排查「为什么这次没触发」会很痛。所以复杂逻辑倾向显式 `watch`，简单的联动用 `watchEffect`。

 

一个容易忽略的现象：**`computed` 里读了个非响应式的值，它就永远不会更新**。

 

```js
// 错：Date.now() 不是响应式的，这个 computed 算一次就永远缓存住
const elapsed = computed(() => Date.now() - startTime.value)
// 页面上时间戳「卡住不动」，但控制台手动读它又是新的（读的时候依赖没变，返回缓存）
```

 

这个 bug 的现象特别迷惑：数据看着对、界面不动、而且不报错。判断方法是问「这个 computed 的所有输入都是响应式的吗」，不是的话要么换成 `watch` 加定时器主动推，要么把那个外部量也做成 `ref`。

 

**追问「computed 里能不能发请求」**：不能。三个理由，从轻到重：**一是返回值不对**——异步函数返回的是 Promise 而不是值，模板里渲染出来是 `[object Promise]`。**二是时机不可控**——`computed` 什么时候求值由依赖收集和读取决定，可能在一次渲染里被读多次，也可能几轮都不跑，请求次数完全不可预测；模板里放两处引用就可能打两次接口。**三是没有取消和错误边界**——请求失败没地方 catch，快速切换依赖会有响应竞态，后发的先回时你拿到的是过期数据。「根据某个值去拉数据」是 `watch` 的活：`watch(id, fetchDetail, { immediate: true })`，需要的话再配 `AbortController` 取消上一次（竞态处理见 `07-vue.md` 第 12 题）。Vue 3.5+ 有 `watch` 的 `onCleanup` 参数专门做这件事。

# 面试 07 · Vue 深挖 > ref 和 reactive 怎么选，为什么 ref 要 .value

来源：https://fqx.lx.ci/interview-prep/07-vue.html#q4

`.value` 不是设计冗余，是实现上的必然。JS 里基本类型是值传递，函数拿到的是一份拷贝，没有任何办法劫持它的读写——`Proxy` 只能代理对象。所以 `ref` 的做法是包一个 `{ value: x }` 对象，把响应式做在这个对象的 `value` 访问器上。`reactive` 直接返回 Proxy，所以只能接对象，而且解构会丢响应性（拿到的是那一刻的普通值，要用 `toRefs`）。

 

实践上的建议是**统一用 ref**，理由是心智负担：不用每次判断「这个是对象吗、能不能解构、要不要 toRefs」，一律 `.value`；而且替换整个对象很自然。模板里 `ref` 自动解包，写起来并不啰嗦。

 

`reactive` 最坑的现象是**整体替换丢响应性**：

 

```js
const list = reactive([])
list = newArr                       // 报错，const 不能重新赋值
// 换成 let 之后：
let list = reactive([])
list = newArr                       // 不报错，但 list 变成了普通数组，页面从此不再更新
list.splice(0, list.length, ...newArr)   // 正确：在原 Proxy 上操作
// 或者干脆用 ref
const list2 = ref([])
list2.value = newArr                // 正确，而且 Vue 会自动把新数组也变成响应式
```

 

「筛选后整体替换列表」在中后台是每天都在写的场景，这个坑就藏在这里，而且**不报错**——页面停在旧数据上，看着像接口没返回。

 

`.value` 的第二个坑是**在模板之外忘记写**：`if (loading)` 永远为真（`ref` 对象是 truthy），`count + 1` 得到 `[object Object]1`。这类错误 TypeScript 能挡住一部分，`eslint-plugin-vue` 也有规则，但 `if (someRef)` 这种在类型上是合法的，只能靠习惯。

 

**追问「统一用 ref 之后，深层对象每次改一个字段都要写 obj.value.a.b.c，不嫌烦吗，性能上有区别吗」**：写法上确实啰嗦，解法是**在 setup 里解构出局部 ref**（`const { name, age } = toRefs(form)`）或者按业务粒度拆成多个 `ref`，而不是维护一个大对象。性能上有个真实差别值得说：`ref(bigObject)` 内部会对 `.value` 调 `reactive()`，所以**深层依然是深度响应式的**，和 `reactive(bigObject)` 一样；真要省开销得用 `shallowRef`。这在一个具体场景下是刚需：接口返回上千行的表格数据放进 `ref`，Vue 会给每一行每个字段建 Proxy，几万个 Proxy 的创建成本直接体现在「数据回来了但页面卡住半秒」上。这时候用 `shallowRef` + 整体替换（`data.value = res.list`），Vue 只在顶层比较引用，性能差一个数量级——代价是不能再原地改某个单元格，要改就整体替换或者对那一行单独做响应式。**说得出「大列表用 shallowRef，因为深度代理的成本在数据量上是线性的」，比背 ref/reactive 的区别有用得多**（表格性能的完整解法见 `07-vue.md` 第 19 题）。

# 面试 07 · Vue 深挖 > Composition API 比 Options API 好在哪，什么时候不该用

来源：https://fqx.lx.ci/interview-prep/07-vue.html#q5

真正的收益是**逻辑关注点聚合与复用**，不是少写几个字。

 

Options API 里一个功能的状态在 `data`、逻辑在 `methods`、副作用在 `watch`、初始化在 `created`，四处分开。组件长到八百行时，改一个功能要在文件里上下跳四次，而且很难看出「这三个字段是同一个功能的」。Composition API 把一件事的所有代码放在一起，抽成 `useXxx` 就能跨组件复用。

 

这正是 mixin 想解决但解决不好的问题，三个缺陷都很具体：**来源不明确**（模板里一个 `this.total` 看不出是哪个 mixin 给的，全局搜索才能找到）、**命名冲突静默发生**（两个 mixin 都有 `loading`，后面的覆盖前面的，不报错）、**顺序有隐式依赖**（mixin A 的 `created` 依赖 mixin B 已经初始化，调换数组顺序就坏）。`useXxx` 的返回值是显式解构出来的，这三个问题全部消失。

 

不该用的场景有两类：

 

**一是简单的展示型组件。** 只有 props 和一段模板，用 `<script setup>` 也无所谓，但如果项目还在用 `setup()` 函数式写法，为了三行逻辑套一层 setup 加 return 就是纯噪音。

 

**二是存量 Vue 2 项目。** 强行装 `@vue/composition-api` 混写会让代码风格分裂：同一个目录下一半组件是 Options 一半是 Composition，新人接手要同时理解两套心智模型，而收益只是「新写的代码好看一点」。「在存量项目里我选择不引入」这个判断，比多背一个 API 更能体现取舍能力。

 

顺带把 Vue 2 的现状说准：Vue 2 已于 **2023-12-31 EOL**，2.7.16 是最后一个版本，之后只有 HeroDevs 的商业 NES 在提供安全补丁。所以「存量项目不引入 Composition API」的正确表述是「不为了写法去改造，但要有升级 Vue 3 的计划」——留在 EOL 版本上是安全合规问题，不是技术偏好问题。

 

**追问「Composition API 有没有引入新的问题」**：有三个，都是抽 composable 之后才会遇到的。**一是响应式丢失比 Options API 更容易发生**——`const { data } = useList()` 如果 `useList` 里返回的是解构过的 `reactive` 属性，拿到的就是死值；Options API 里 `this.data` 不存在这个问题。所以 composable 的返回值约定成「一律返回 ref，或者返回 `toRefs(state)`」。**二是生命周期的绑定变隐式**——`onMounted` 只在同步的 setup 执行栈里注册才有效，写在 `await` 之后或者回调里会静默失效（Vue 会警告但生产构建里看不到）；composable 在 `<script setup>` 的顶层调用是硬要求。**三是清理责任容易漏**——Options API 里「`created` 里申请、`destroyed` 里释放」写在同一个文件的两处，虽然分散但都在组件里；composable 里申请的监听器如果不在内部用 `onScopeDispose` 清掉，调用方根本不知道有东西要清。**我的规则是「谁申请谁释放，写在同一个函数里」**，用 `onScopeDispose` 而不是 `onUnmounted`，因为 composable 可能在组件之外的 `effectScope` 里被调用（比如 Pinia store 里）。

 

## 组件与路由

# 面试 07 · Vue 深挖 > 组件生命周期有哪些，请求该放哪个钩子

来源：https://fqx.lx.ci/interview-prep/07-vue.html#q6

Vue 3 的顺序：`setup` → `onBeforeMount` → `onMounted` →（更新时 `onBeforeUpdate` → `onUpdated`）→ `onBeforeUnmount` → `onUnmounted`。Vue 2 对应 `created` / `mounted` / `updated` / `destroyed`。

 

**请求放 `created`（Vue 3 里直接放 setup 顶层）而不是 `mounted`**：发请求不需要 DOM，放早一点能让请求和首次渲染并行，省掉的是「渲染完成」到「发出请求」之间那几毫秒。只有需要真实 DOM 的才必须等 `mounted`——拿容器尺寸、初始化图表、挂载第三方库。

 

父子顺序要能背出来，因为它决定了一类问题的答案：

 

```
挂载：父 beforeMount → 子 beforeMount → 子 mounted → 父 mounted
销毁：父 beforeUnmount → 子 beforeUnmount → 子 unmounted → 父 unmounted
```

 

所以**父组件的 `mounted` 里子组件已经挂好了**，「能不能在父组件 mounted 里访问子组件的 ref 并调它的方法」答案是能。反过来子组件 `mounted` 里访问父组件的 DOM 尺寸就不一定准，因为父组件还没挂完。

 

两个具体的踩坑现象：

 

**`onUpdated` 里改响应式数据会触发新一轮更新**，容易写出无限循环——表现是页面卡死、CPU 打满、控制台可能一直没报错。要在这里做事必须加条件跳出，或者改用 `watch` 精确监听某个字段。

 

**`setup` 里 `await` 之后注册的钩子会静默失效**：

 

```js
// 错：await 之后已经不在同步执行栈里，onMounted 注册不上
const data = await fetchData()
onMounted(() => initChart())   // 开发环境警告，生产环境什么都不发生

// 对：先注册钩子，异步逻辑放里面或者用 .then
onMounted(async () => { await fetchData(); initChart() })
```

 

**追问「keep-alive 缓存的组件，第二次进来走哪些钩子」**：`mounted` **只跑一次**，之后进出走的是 `onActivated` / `onDeactivated`，`unmounted` 在被缓存期间根本不会触发。这个区别造成两类线上问题。**一是数据不刷新**：把「每次进页面都要拉的数据」写在 `onMounted` 里，用户从详情页返回列表页，看到的是几分钟前的数据，而且他不会意识到——列表看起来是正常渲染的。这类数据要放 `onActivated`。**二是定时器和监听器不会随失活停止**：组件被缓存住了，它的 `setInterval` 还在跑，用户切到别的标签页你还在每 5 秒轮询一次接口，`onUnmounted` 又永远不触发，所以清理必须写在 `onDeactivated` 里。判断依据是**「这件事该跟着 DOM 的生命周期还是跟着可见性」**——建 DOM 相关的一次性初始化放 `mounted`，跟可见性有关的（拉数据、开轮询、恢复滚动位置）放 `activated` / `deactivated`（完整解法见 `07-vue.md` 第 16 题）。

# 面试 07 · Vue 深挖 > nextTick 是干什么的，原理是什么

来源：https://fqx.lx.ci/interview-prep/07-vue.html#q7

Vue 的更新是**异步批量**的：同一个 tick 里改十次数据，只在微任务阶段统一渲染一次，避免十次重排。代价是改完数据立刻读 DOM 拿到的是旧值：

 

```js
count.value = 100
console.log(el.value.textContent)   // 还是旧的
await nextTick()
console.log(el.value.textContent)   // '100'
```

 

实现上 `nextTick` 把回调放进微任务队列（`Promise.then`，Vue 2 里降级到 `MutationObserver` / `setTimeout`），排在渲染任务之后——本质上就是「等这次 flush 完再执行」。

 

真的需要它的场景是固定的三类，都有具体现象：

 

- **要读更新后的尺寸或位置**（`scrollHeight`、`getBoundingClientRect`）。典型例子是聊天窗口追加一条消息后滚到底，不等 `nextTick` 拿到的 `scrollHeight` 是加消息之前的，滚动就差一条消息的高度。
- **要操作刚被 `v-if` 渲染出来的 DOM**。`show.value = true` 之后立刻 `document.querySelector` 会拿到 `null`。
- **第三方库需要真实容器**。图表库在弹窗里初始化前必须 `nextTick`——`v-if` 打开弹窗那一瞬间容器还没插进文档，`init` 拿到的宽高是 0，画出来就是 0×0（这个坑的完整版本见 `07-vue.md` 第 18 题）。

 

**追问「和 setTimeout(fn, 0) 的区别」**：微任务 vs 宏任务。`nextTick` 在本次事件循环的微任务阶段就跑完，`setTimeout` 要等到下一个宏任务——中间浏览器可能已经渲染了一帧。用 `setTimeout` 做「渲染后立即读 DOM」的后果是多一帧延迟，视觉上是**闪一下**：先看到旧布局绘制出来，下一帧才跳到正确位置。滚动到底、弹窗定位这类场景用户能直接看出抖动。另一个实际差别是**执行顺序不可控**：多个 `setTimeout(0)` 之间会插入浏览器的渲染、其他宏任务、甚至用户的点击事件；而 `nextTick` 的回调一定紧跟在这次 DOM 更新之后。真正需要 `setTimeout` 的只有一种情况——你要等的不是 Vue 的渲染，而是**浏览器的布局或动画**（比如 CSS transition 结束、`display` 从 `none` 变回来后的重排），这种时候 `nextTick` 不够，得用 `requestAnimationFrame` 或者监听 `transitionend`。

# 面试 07 · Vue 深挖 > key 的作用是什么，为什么不能用 index

来源：https://fqx.lx.ci/interview-prep/07-vue.html#q8

`key` 是 diff 时判断「新旧两个 vnode 是不是同一个」的依据。用 `index` 的话，在头部插入一条，所有元素的 index 全部往后错位，Vue 认为每个位置的节点都变了，于是就地更新每一个——复用失效，一次插入退化成整列表重建。

 

性能只是次要问题，真正会被判为线上 bug 的是**组件内部状态错位**：

 

```vue
<!-- 列表每行有一个输入框 -->
<div v-for="(item, index) in list" :key="index">
  <input v-model="item.name" />
  <MyEditor />   <!-- 组件内部有自己的 state -->
</div>
```

 

你在第一行输了字，然后往列表头部插一条。Vue 复用了原来那个 DOM 节点和组件实例，只更新了绑定的数据——**你输的字出现在了新插入的那一行上**，或者 `MyEditor` 里未提交的编辑内容跟着位置漂移了。数据是对的，界面是错的，而且不报错。同类现象还有：多选框的勾选状态跟着错位、CSS 过渡动画作用在了错误的元素上、`<transition-group>` 的动画顺序乱掉。

 

正确做法是用**数据本身的稳定唯一标识**，一般是后端 id。没有 id 的话前端生成一个跟着数据走——注意是在数据进来时生成一次存进对象里，不是在模板里 `:key="Math.random()"`，那样每次渲染都是新节点，比用 index 还糟（每次重渲染整列表全部销毁重建，输入框会失焦）。

 

纯静态、不会增删也不会排序的列表用 `index` 无害，但没必要为这点省事留个隐患——列表一旦加了「置顶」「删除」功能，这个 bug 就上线了。

 

**追问「key 一样但是 key 值重复了会怎样」**：这是比 index 更隐蔽的一类，因为它在开发环境只是一条警告（`Duplicate keys detected`），页面看着还能渲染出来。后果有三个：**一是 diff 结果不确定**——Vue 3 的 patchKeyedChildren 会用 key 建一个 `Map`，重复 key 后写的覆盖先写的，于是有些节点找不到自己的旧节点，被当成新增，另一些旧节点被当成删除，实际表现是「明明只改了一条，界面上闪了三条」。**二是状态错位比 index 更难查**，因为它不随位置规律漂移，而是随 Map 的覆盖关系跳。**三是 `<transition-group>` 会直接抛错或动画完全错乱**。最常见的成因是**用了业务上不唯一的字段做 key**（比如用 `item.name`、用 `item.type`，或者两个数据源合并后 id 撞了），以及**分页追加时把不同页的数据拼在一起而后端 id 恰好重复**。排查方法很直接：`new Set(list.map(i => i.id)).size === list.length`，不相等就是重复；上线前在开发环境把这条 Vue 警告当错误处理是最省事的做法。

# 面试 07 · Vue 深挖 > 后端菜单驱动的动态路由，具体怎么实现

来源：https://fqx.lx.ci/interview-prep/07-vue.html#q9

这题问的是**刷新丢路由**这个坑，其余部分只是铺垫。

 

主流程：登录后拿菜单树，递归转成路由配置。后端给的 `component` 字段是字符串路径（比如 `"report/detail"`），前端要映射成真正的组件——Vite 下用 `import.meta.glob`，Webpack 下用 `require.context`，因为动态 `import(变量)` 打包时无法静态分析，路径必须是可枚举的字面量。然后 Vue 3 用 `router.addRoute()` 逐条注册（Vue 2 是 `router.addRoutes()`），同一份数据同时驱动侧边栏渲染。

 

```js
const modules = import.meta.glob('../views/**/*.vue')   // 建立路径 → 加载函数的映射

function toRoute(node) {
  return {
    path: node.path,
    name: node.name,
    meta: { title: node.title, keepAlive: node.keepAlive },
    component: modules[`../views/${node.component}.vue`],   // 拿不到就是后端路径写错了
    children: node.children?.map(toRoute),
  }
}
```

 

**关键是刷新这个坑。** 动态路由存在内存里，刷新页面就全没了：用户在 `/report/detail` 按 F5，路由表还没重建，`to.matched` 是空的，于是跳 404 或者被守卫踢回登录页。用户的感受是「刷新一下就被登出了」。

 

处理是在全局前置守卫里加一个「已加载」标志：

 

```js
let loaded = false
router.beforeEach(async (to) => {
  if (!hasToken()) return to.path === '/login' ? true : `/login?redirect=${to.fullPath}`
  if (!loaded) {
    const menus = await fetchMenus()
    menus.map(toRoute).forEach(r => router.addRoute(r))
    router.addRoute({ path: '/:pathMatch(.*)*', component: NotFound })  // 404 最后加
    loaded = true
    return { ...to, replace: true }    // 重新走一次匹配
  }
})
```

 

**这里必须是返回 `{ ...to, replace: true }`（Vue 2 里是 `next({ ...to, replace: true })`），不能只 `next()`**。原因是 `addRoute()` 只登记路由，不会重新解析当前地址——本次导航的匹配结果在进守卫之前就算好了，那时新路由还不存在，直接放行匹配到的仍然是空。必须重新触发一次导航才能命中。`replace: true` 是为了不在历史记录里留下这次中转，否则用户点浏览器返回会回到「正在重建路由」的那个中间态。

 

另外 `loaded` 标志必须能被重置：退出登录、切换租户、后端菜单变更后不重置的话，用户换了账号还在用上一个账号的路由表。

 

**追问「404 路由为什么不能一开始就注册」**：因为通配路由必须在所有动态路由**之后**注册。Vue Router 3 里路由是按注册顺序线性匹配的，先注册的 `*` 会先命中，动态路由永远轮不到，表现是「侧边栏点得动但页面全是 404」。Vue Router 4 换成了自己的解析系统，会给路由**按具体度（route ranking）排序**，静态段比动态段优先、参数比通配符优先，所以理论上 `/:pathMatch(.*)*` 的排序权重最低，先注册也不一定被抢先。但**实践上仍然要最后注册**，两个理由：一是嵌套路由的 children 参与排序的规则更复杂，父级是通配的场景容易出意外；二是这个行为依赖 ranking 实现细节，跨版本不该赌。更稳的做法是干脆不注册全局 404，而在守卫里判断 `to.matched.length === 0` 时显式重定向——**判断依据是「有没有匹配到」这个事实，而不是「有没有一条兜底路由排在最后」这个约定**。

# 面试 07 · Vue 深挖 > 路由守卫有哪几个，鉴权逻辑放哪里

来源：https://fqx.lx.ci/interview-prep/07-vue.html#q10

三类，按作用范围：

 

| 类型 | 钩子 | 典型用途 |
| --- | --- | --- |
| 全局 | `beforeEach` / `beforeResolve` / `afterEach` | 鉴权、进度条、埋点 |
| 路由独享 | `beforeEnter` | 只有这条路由需要的校验 |
| 组件内 | `beforeRouteEnter` / `beforeRouteUpdate` / `beforeRouteLeave` | 离开前确认、参数变化时重取数据 |

 

鉴权放全局 `beforeEach`：判断有没有 token、有没有这个路由的权限，没有就跳登录或 403。放这里的理由是它必须对所有路由生效，漏一条就是越权入口。

 

四个实际要点，每条都对应过一次线上问题：

 

**`beforeEach` 里必须保证每条分支都有出口。** Vue 2 的 `next()` 漏调一个分支，页面就永久卡住——白屏、不报错、控制台干净，是最难查的一类。Vue 3 改成返回值风格（返回 `true` / `false` / 路径 / `undefined`）后好很多，但 `async` 守卫里某个 `await` 抛异常没 catch 也一样卡住。

 

**重定向到登录要带原路径**：`/login?redirect=${to.fullPath}`，登录成功后跳回去。注意 `fullPath` 而不是 `path`，否则查询参数丢了；跳回去之前要校验它是站内相对路径，否则 `redirect=//evil.com` 就是一个开放重定向漏洞。

 

**`beforeRouteLeave` 用来做「表单没保存，确定离开吗」**，这是它最主要的用途。它只管路由跳转，管不了关闭标签页和刷新——那个要另外监听 `beforeunload`。

 

**`afterEach` 里不能改变导航**，它只适合做埋点和收进度条；想拦下来必须在 `beforeEach` 或 `beforeResolve`。

 

**追问「前端做了权限判断，后端还需要校验吗」**：必须。前端的权限控制是**体验**，不是安全边界——用户改不了后端的判断，但能改前端的一切：改 store 里的权限数组、把按钮的 `disabled` 去掉、直接在控制台构造请求。菜单和按钮藏起来只是让正常用户看不见，一个 F12 就绕过了。正确的分层是**前端隐藏 + 后端每个接口鉴权**，而且后端要校验的是「这个 token 的主体能不能操作这个具体资源」，不只是「能不能调这个接口」——只判接口不判资源归属，就会出现「A 用户改 URL 里的 id 改掉了 B 用户的订单」这种越权（这类逻辑放在服务端的位置和幂等的关系见 `02-node-java.md` 第 13 题）。反过来说，**后端有了校验，前端的判断也不能省**，否则用户点进一个没权限的页面才被拒绝，体验是「到处都是报错弹窗」。两层的职责不同，都要有。

# 面试 07 · Vue 深挖 > 按钮级权限怎么做，自定义指令和 v-if 怎么选

来源：https://fqx.lx.ci/interview-prep/07-vue.html#q11

先说指令方案的收益：它把「权限标识集合」这个全局状态从业务模板里拿掉了。

 

用 `v-if` 的写法是每个按钮 `v-if="perms.includes('order:delete')"`，每个页面都得从 store 取一遍 `perms`；用指令是 `v-perm="'order:delete'"`，取 store、比对、不匹配就处理掉元素，业务代码只声明「我要什么权限」。收益在改判定逻辑的时候才体现出来——加超管绕过、加租户维度、权限标识改成通配匹配，只改一个文件而不是三百个模板。

 

**代价要主动说，这是这题真正的考点：**

 

**指令是一次性的。** Vue 3 的 `mounted`（Vue 2 的 `inserted`）只在挂载时跑一次，权限集合之后变了不会重新判定。如果权限只在登录时确定，这个代价可以接受；要支持运行时改权限立即生效，就得同时实现 `updated` 钩子，或者干脆改用组件包一层（`<Perm code="x"><button/></Perm>`）——组件方案天然响应式，代价是模板多一层嵌套。

 

**指令是删 DOM 不是不渲染。** 组件已经创建过了，`setup` 跑过了，里面的请求也发过了。所以真正敏感的东西必须在路由层和接口层拦——按钮级权限的定位是「不让用户看到他做不了的操作」，不是安全机制。

 

**直接 `removeChild` 会让虚拟 DOM 和真实 DOM 不一致。** 现象是父组件重新渲染时报 `Failed to execute 'insertBefore' on 'Node'`，或者被你删掉的按钮又被插回来了——因为 Vue 的 vnode 树里那个节点还在，patch 时按旧引用去操作，找不到父子关系。更稳的两种做法：

 

```js
// 做法一：不删元素，只让它不可见不可点
app.directive('perm', {
  mounted(el, binding) {
    if (!useUserStore().perms.includes(binding.value)) {
      el.style.display = 'none'
      el.setAttribute('aria-hidden', 'true')   // 别让屏幕阅读器读到它
    }
  },
  updated(el, binding) {   // 权限运行时会变就必须有这个
    const ok = useUserStore().perms.includes(binding.value)
    el.style.display = ok ? '' : 'none'
    el.toggleAttribute('aria-hidden', !ok)
  },
})
```

 

第二种是保留 `v-if`，只把判定逻辑收进一个 `hasPerm()` 函数或 computed，模板写 `v-if="hasPerm('order:delete')"`。它比指令啰嗦一点，但完全没有上面三个坑，而且天然响应式。**如果只能选一个，我选这个**——指令方案的净收益在「判定逻辑复杂且经常改」时才超过它的代价。

 

**追问「指令改成 display:none 之后，用户在控制台把这行样式删掉就能点了，你怎么看」**：这不是指令方案的缺陷，是**把安全需求放错层**的表现。前端能做的只有三件事：让入口不可见（按钮级权限）、让路由进不去（路由守卫）、让请求不发出（接口封装里的前置判断）。这三层全部可以被用户绕过，因为代码在他机器上跑。**唯一的安全边界在服务端**：每个写接口都要独立校验「当前主体对这个资源有没有这个操作权限」。判断一个团队有没有做对，看一个具体的事实——**能不能在浏览器里手动 fetch 一个自己没权限的接口并被 403 拦住**。能，就是安全的；如果返回了 200，那不管前端藏得多好都是漏洞。反过来，这也说明按钮级权限不该做得太重：它是体验优化，投入应该和它的定位匹配，把 ACL 的复杂逻辑塞进前端指令是本末倒置。

 

## 请求与状态

# 面试 07 · Vue 深挖 > Axios 请求层你怎么封装的

来源：https://fqx.lx.ci/interview-prep/07-vue.html#q12

三段拦截加一层业务方法：

 

**请求拦截器** —— 统一注入 `Authorization`、加 loading 计数、取消重复请求。**响应拦截器** —— 按业务状态码分流：HTTP 200 但业务码是失败的情况要在这里抛出去，否则每个调用方都得自己 `if (res.code !== 0)`，漏一处就是「失败了还当成功往下走」。**错误拦截** —— 按 401 / 403 / 5xx / 超时 / 网络错误分别处理，统一提示。最外层再包一层业务方法，让页面只调 `getUserList(params)`，不直接碰 axios——好处是换掉 axios 或者给某个接口加缓存时，改动收在一个文件里。

 

两个最容易漏的：

 

**取消重复请求，解决的是响应竞态。** 用「method + url + 参数」做 key 存 `AbortController`，同 key 的新请求发起时取消旧的：

 

```js
const pending = new Map()
const keyOf = (c) => [c.method, c.url, JSON.stringify(c.params ?? {}), JSON.stringify(c.data ?? {})].join('&')

instance.interceptors.request.use((config) => {
  const key = keyOf(config)
  pending.get(key)?.abort()          // 取消上一个同 key 请求
  const ctrl = new AbortController()
  config.signal = ctrl.signal
  pending.set(key, ctrl)
  return config
})
instance.interceptors.response.use(
  (res) => { pending.delete(keyOf(res.config)); return res },
  (err) => { if (err.config) pending.delete(keyOf(err.config)); return Promise.reject(err) },
)
```

 

不做的现象很具体：用户快速切换筛选条件，请求 A（部门=技术）先发、请求 B（部门=销售）后发，但 A 的响应后回来——**列表最终显示的是技术部的数据，而筛选器上写着销售部**。纯后端视角很难想到这个问题，因为每个请求单独看都是对的；用户一定会碰上，尤其是有防抖但防抖窗口比接口耗时短的时候。

 

**文件下载要单独处理。** `responseType: 'blob'` 的响应不能走统一的 JSON 解析，而且统一的错误提示逻辑对它无效。

 

还有一个容易忽略的：`AbortController` 取消的请求在 axios 里抛出的是 `CanceledError`（`err.code === 'ERR_CANCELED'`），**必须在错误拦截里识别出来并静默丢弃**。不识别的后果是每次切换筛选条件都弹一个「请求失败」的红条，用户看到的是「这系统一直在报错」。

 

**追问「Blob 下载失败时怎么拿到错误信息」**：后端出错时返回的是 JSON（比如 `{"code":403,"msg":"无导出权限"}`），但你已经声明了 `responseType: 'blob'`，axios 不会解析它，`err.response.data` 是一个 Blob 对象。直接 `alert` 出来是 `[object Blob]`，或者更糟——前端把这段 JSON 当文件存下来，用户下载到一个几十字节、打不开的 `.xlsx`，来投诉「导出的文件坏了」。修法是判断响应的 `content-type`：如果它是 `application/json` 而不是预期的 excel/zip 类型，就把 Blob 读回文本再 parse——`if (blob.type.includes('json')) { const { msg } = JSON.parse(await blob.text()); throw new Error(msg) }`（老环境用 `FileReader`，`blob.text()` 更简洁）。**判断依据是 `content-type` 而不是 blob 大小**——用大小猜（「小于 1KB 就当错误」）在导出空数据的时候会误判。这个细节答出来说明真做过下载功能，因为它只在后端报错那一次才暴露。

# 面试 07 · Vue 深挖 > refresh_token 无感续期，多个请求同时 401 怎么办

来源：https://fqx.lx.ci/interview-prep/07-vue.html#q13

这是 Axios 封装类问题里区分度最高的一题，考点是**并发刷新**。

 

不处理的后果：页面上五个请求同时 401，就会发五次 refresh。后端如果做了 refresh\_token 单次使用（用完即换新的，这是标准做法），第一次成功、后四次带着已失效的旧 token 全部失败，用户直接被踢下线——**结果比不做续期更糟**，因为不做续期至少只是让他重新登录一次，做错了是「用着好好的突然被登出，而且复现不了」。

 

合并的做法是一个标志位加一个等待队列：

 

```js
let refreshing = false
let queue = []   // 存等待中的 resolve

instance.interceptors.response.use(null, async (err) => {
  const { response, config } = err
  if (response?.status !== 401 || config._retry) return Promise.reject(err)

  if (refreshing) {
    // 不发请求，返回一个挂起的 Promise，等 refresh 完成后重放
    return new Promise((resolve, reject) => queue.push({ resolve, reject, config }))
  }
  refreshing = true
  try {
    await refreshToken()                       // 用独立的 axios 实例，不走这套拦截器
    queue.forEach(({ resolve, config }) => { config._retry = true; resolve(instance(config)) })
    queue = []
    config._retry = true
    return instance(config)                    // 重放触发本次刷新的那个请求
  } catch (e) {
    queue.forEach(({ reject }) => reject(e))
    queue = []
    redirectToLogin()
    return Promise.reject(e)
  } finally {
    refreshing = false
  }
})
```

 

三个容易漏的点：

 

**refresh 那个请求自己不能走这套拦截器**，否则它返回 401 时会递归调用自己，表现是瞬间发出几十个请求然后栈溢出。用一个裸的 axios 实例发它。

 

**重放要有次数上限**，靠 `config._retry` 标记；不加的话遇到「refresh 成功但新 token 也被拒」的情况会无限重试。

 

**refresh\_token 该放 HttpOnly Cookie 而不是 localStorage。** 放 localStorage 的话一次 XSS 就等于长期凭证泄露——access\_token 短时效还能扛一下（攻击者拿到只有几分钟窗口），refresh 泄露是彻底的：攻击者可以一直续期，你改密码都不一定能踢掉他，除非服务端主动吊销。

 

**追问「和接口幂等有什么关系」**：同一个思路的两面。重放的请求如果是**写操作**，重放这个动作本身就会造成重复提交——用户点了一次「提交订单」，请求带着过期 token 返回 401，你续期后重放，但后端可能在鉴权之前已经处理了一部分（或者 401 其实来自网关而业务已经落库），结果是两笔订单。所以重放的前提是这些请求幂等：客户端在**发起时**生成幂等键（`Idempotency-Key` 头），重放时**带同一个键**，后端靠唯一索引挡住第二次（完整设计见 `02-node-java.md` 第 13 题）。关键细节是**键必须在第一次发起时生成并绑在 config 上**，不能在重放时新生成——新生成就是两个不同的请求，幂等完全失效。保守一点的做法是**只重放读请求，写请求直接失败并提示用户重试**：代价是体验差一点，收益是绝对不会重复下单。取舍依据是这个接口重复执行的代价——查询重复只是多一次流量，支付重复是资金问题。

# 面试 07 · Vue 深挖 > Vuex 和 Pinia 的区别，什么时候根本不需要状态管理

来源：https://fqx.lx.ci/interview-prep/07-vue.html#q14

后半句才是这题的重点，因为滥用全局状态是中后台最常见的架构问题。

 

Pinia 相对 Vuex 的三个变化：**去掉了 mutation**（action 里直接改 state，同步异步不再分家，也不用记 `commit` / `dispatch` 的区别）、**去掉了嵌套 module**（改成多个平级 store，互相 import 就能组合，不再有 `namespaced` 和 `rootState` 那套东西）、**TypeScript 类型推导天然可用**（Vuex 里 `this.$store.state.a.b` 基本推不出类型，要手写声明补）。心智模型简单了一档，而且 Pinia 是 Vue 官方推荐的状态管理方案，Vuex 处于维护状态、不再加新特性。

 

**什么时候不需要**，三条边界：

 

- **只在父子之间传的状态** —— `props` + `emit` 就够。
- **只在一棵子树里共享的** —— `provide` / `inject` 更合适。
- **只在当前页面用的临时状态** —— 就放组件里。

 

放进全局 store 的代价很具体：**这个状态的生命周期变成了「和应用一样长」**。页面切走了它还在，用户下次进来看到的是上次的脏数据——最典型的是表单：用户填了一半离开，回来发现表单里还是旧内容，或者更糟，他以为是新表单，提交时带上了上次的隐藏字段。要避免就得在 `onUnmounted` 或路由守卫里手动 `reset()`，于是你为了「方便共享」付出了「到处记得清理」的成本。

 

**标准是：跨路由且需要长期存在的才进 store。** 典型就三类——用户信息、权限集合、字典缓存。表单的临时状态放 store 是最常见的过度设计。

 

**追问「Pinia 怎么做持久化」**：插件里订阅 `$subscribe` 写存储（或者直接用 `pinia-plugin-persistedstate`），但有三条必须自己判断的：**一是不能全存**——token 之类的敏感项不该进 localStorage（XSS 直接读走），`loading` / `error` 这种瞬时状态存了会让用户刷新后看到一个永远转不停的 loading。所以要显式声明 `paths` 白名单，而不是默认全量。**二是读回来必须校验**——localStorage 是用户可改的不可信输入，而且旧版本会留下结构不一样的数据；直接 `Object.assign(state, JSON.parse(saved))` 的后果是新版本代码拿到旧结构的字段，报 `Cannot read property of undefined`，而且**只有老用户会白屏，新用户完全正常**，这类 bug 在本地永远复现不出来。正确做法是存一个 `version` 字段，读的时候版本不匹配就丢弃并用默认值（有 schema 校验更好）。**三是写入频率要控**——`$subscribe` 默认每次 state 变更都触发，而 `localStorage.setItem` 是同步 API，和渲染抢主线程；高频变更的 state 要节流（见 `07-vue.md` 第 17 题）。

# 面试 07 · Vue 深挖 > 组件通信有哪些方式，大项目里怎么组织

来源：https://fqx.lx.ci/interview-prep/07-vue.html#q15

按作用范围排：

 

| 范围 | 方式 | 备注 |
| --- | --- | --- |
| 父 → 子 | `props`（`defineProps`） | 单向数据流的基础 |
| 子 → 父 | `emit`（`defineEmits`） | `v-model` 是这两者的语法糖，Vue 3 支持多个具名 v-model |
| 父调子的方法 | `ref` + `defineExpose` | `<script setup>` 默认不暴露内部，必须显式 expose |
| 跨层级 | `provide` / `inject` | 组件库和布局层用得多 |
| 全局 | Pinia store | 只放跨路由且长期存在的 |
| 兄弟之间 | 没有直接通道 | 提到共同父级，或走 store |

 

组织原则两条，每条都对应一类真实的雷：

 

**一、数据向下、事件向上，不在子组件里直接改 props。** 这条有个隐蔽的例外必须知道：**改基础类型的 props Vue 会警告，改对象类型 props 的内部属性不会警告**。

 

```js
// props.form 是对象
props.form.name = 'x'   // 不报错、不警告、能改动父组件的数据，页面也会更新
```

 

它「能用」，所以很容易被写出来，然后半年后有人问「这个字段是谁改的」——全局搜不到 `emit`，因为改动发生在子组件里，父组件毫不知情。这是最容易埋雷的地方。修法是要么 `emit('update:form', {...})` 让父组件改，要么在子组件里深拷贝一份本地副本。

 

**二、能用 props 表达的就不用 provide。** `inject` 的来源是隐式的：模板上看不出这个值从哪来，组件被复用到另一棵树下时会**静默拿不到值**（默认值是 `undefined`，然后在某个 computed 里炸掉）。所以 `provide` 应该用在真正「跨很多层且中间层不关心」的地方——主题、i18n、表单上下文，而不是当成偷懒的传参手段。给 `inject` 一律写默认值或者在开发环境抛错，比让它悄悄返回 undefined 好查。

 

**EventBus 不用。** 三个理由：没有类型（`bus.emit('some-event', payload)` 拼错事件名不报错，只是永远不触发）、没有来源（谁 emit 的、谁在听，只能全局搜字符串）、卸载时忘了 `off` 就是泄漏加重复执行（组件重新进入后监听器叠加，一次点击触发三次）。Vue 3 也移除了 `$on` / `$off`，官方态度很明确。真需要跨模块广播就用 store 的 state 或者一个显式的、有类型的事件中心（`mitt` + TS 泛型），并且保证在 `onUnmounted` 里解绑。

 

**追问「provide 一个 ref 和 provide 一个普通值，行为差在哪」**：`provide` 本身不做响应式包装，它只是把值放进当前组件的 provides 链上。所以 **provide 普通值等于给了一份快照**——上游后来改了那个变量，下游拿到的还是最初的值，而且不报错。这个 bug 的现象是「主题切换了但某个深层组件没变色」，排查时会发现 `inject` 到的值是对的（只是旧的），特别容易怀疑到别处去。正确做法是 provide 一个 `ref` 或 `computed`，下游用 `.value`（或者在模板里自动解包）。第二个必须知道的规则是**写权限的归属**：官方推荐 provide 方同时给出修改函数（`provide('theme', { theme, setTheme })`），而不是让下游直接改注入的 ref——下游能改的话，一个共享状态就有了 N 个不受控的写入点，出问题时无法定位是谁改的。需要强约束时用 `readonly(state)` 包一层再 provide，下游试图写入会在开发环境直接警告。**这条和「不改 props」是同一个原则的两个表现：状态的写入点必须收敛到定义它的地方。**

# 面试 07 · Vue 深挖 > keep-alive 怎么用，缓存了但数据要刷新怎么办

来源：https://fqx.lx.ci/interview-prep/07-vue.html#q16

需求是真实的：列表页 → 详情页 → 返回，要保留筛选条件和滚动位置；但列表页 → 新建页 → 返回，要刷新列表。中后台几乎必问。

 

用法是 `<keep-alive>` 包住 `router-view`，组件不销毁只是失活，`include` / `exclude` / `max` 控制缓存范围。Vue Router 4 里要用 v-slot 写法：

 

```vue
<router-view v-slot="{ Component, route }">
  <keep-alive :include="cachedViews">
    <component :is="Component" :key="route.path" />
  </keep-alive>
</router-view>
```

 

`include` 匹配的是**组件的 name**（`<script setup>` 下由文件名推导，或者用 `defineOptions({ name: 'UserList' })` 显式声明）。这里最常见的失效原因就是**组件没有 name**，表现是「配了 keep-alive 但完全没生效」，而且不报错。

 

被缓存的组件 `mounted` 只跑一次，之后走 `onActivated` / `onDeactivated`，所以**「每次进来都要刷新的数据」必须放 `activated`**，放 `mounted` 就只有第一次生效（详见 `07-vue.md` 第 6 题的追问）。

 

**「返回时刷新还是不刷新」的完整解法**是按来源判断，别把它做成全局开关：

 

```js
// 列表页：只有从「新建/编辑」返回时才刷新
const store = useListStore()
onActivated(() => {
  if (store.needRefresh) { fetchList(); store.needRefresh = false }
  scrollEl.value.scrollTop = savedTop           // 恢复滚动位置
})
onDeactivated(() => { savedTop = scrollEl.value.scrollTop })
```

 

标志位由新建/编辑页在提交成功后置上（或者用路由 `meta` 标记 from 的来源判断）。做成「一律刷新」会丢筛选条件，做成「一律不刷新」则新建完看不到新数据——用户会以为提交失败又提交一次。

 

**滚动位置一定要自己存。** keep-alive 只保证 DOM 不销毁，不保证滚动位置：DOM 被移出文档再插回来时，`scrollTop` 会被重置为 0。所以在 `deactivated` 存、`activated` 里恢复（有虚拟滚动的话恢复前要等 `nextTick`，否则容器高度还没算出来，`scrollTop` 赋值会被截断）。

 

**追问「缓存起来的组件里定时器还在跑吗，怎么发现的」**：在跑。这是 keep-alive 最实际的代价——`onUnmounted` 永远不触发，`setInterval` / `WebSocket` / `ResizeObserver` / `window` 上的监听全都活着。现象有三种，一种比一种难查：**一是用户切走了你还在轮询**，服务端看到「明明没人在看这个页面，请求却一直来」，多标签页多缓存页面叠加起来是几倍的无效 QPS。**二是监听器越堆越多**——如果监听是写在 `activated` 里注册而没在 `deactivated` 里移除，每次进出叠加一次，切换十次标签页之后一次 resize 事件触发十次图表重绘，页面明显卡顿。**三是数据串台**：缓存的 A 页面的轮询回调还在往一个共享 store 写数据，而用户已经在 B 页面了，B 看到的数据被 A 覆盖。发现方法很直接——**在 Network 面板过滤那个轮询接口，切到别的页面，看请求有没有停**；或者在 `deactivated` 里打日志，确认清理逻辑真的执行了。规则是**「activated 里申请的，deactivated 里必须成对释放」**，而且带 keep-alive 的组件里凡是写了 `onMounted` 注册监听的地方，都要重新审一遍它对应的释放时机是不是 `onUnmounted`——那个钩子在这里等于不存在。

 

## 性能与工程

# 面试 07 · Vue 深挖 > deep watch 的代价是什么，怎么避免

来源：https://fqx.lx.ci/interview-prep/07-vue.html#q17

`deep: true` 要**递归遍历整个对象**把每一层都读一遍来建立依赖，对象越深越大，每次变更的遍历成本越高。而且它只告诉你「变了」，不告诉你哪变了——回调里 `newVal` 和 `oldVal` 是同一个引用（同一个对象被原地改了），拿不到 diff，想知道改了什么只能自己存一份快照对比。

 

具体的代价场景：把一棵数据树持久化到 localStorage，用 `deep: true` 监听整棵树。如果数据是高频变化的（比如流式追加文本、表格里连续编辑），每次变更都触发一次全树遍历加一次 `JSON.stringify`，而 **localStorage 是同步 API**，和渲染抢同一个主线程——不管的话直接掉帧，用户感受是「打字有延迟」。

 

解法是双层节流：

 

```js
let throttleTimer = null   // 短间隔：高频时不每次都写
let forceTimer = null      // 长间隔：一直在变时也保证落盘

watch(tree, () => {
  if (!throttleTimer) {
    throttleTimer = setTimeout(() => { throttleTimer = null; save() }, 300)
  }
  if (!forceTimer) {
    forceTimer = setTimeout(() => { forceTimer = null; save() }, 3000)
  }
}, { deep: true })
```

 

**两个计时器都不能在新变更时重置**——都重置就退化成防抖，数据一直在变就永远不写盘，进程崩了全丢。这里的写法是「已经排上了就不再排」，所以 300ms 那个保证短暂停顿时立刻落盘，3s 那个保证连续变更时也有下限。

 

更好的做法是绕开 deep：

 

- **能精确监听就别 deep**：`watch(() => obj.a.b, fn)`，只遍历一个 getter。
- **反过来，不 watch 数据，而在变更入口显式触发保存** —— store 的 action 里改完数据顺手调 `save()`。数据流向清楚（谁改的一目了然），也不用遍历，而且能按业务判断「这次改动值不值得落盘」。这是我更倾向的做法，watch 只在「数据来源不可控」时才用。

 

Vue 3.5+ 还有个能省一半成本的选项：`deep: 数字` 可以限制遍历深度（比如 `deep: 1` 只监听第一层），对「只关心顶层字段增删」的场景够用。

 

**追问「deep watch 数组的时候，push 一条和整体替换，触发次数和开销一样吗」**：不一样，而且这是个能量出来的差别。**整体替换**（`list.value = newArr`）只触发一次回调，但 deep 遍历要走完新数组的每一层重新建立依赖——一万条数据就是一万次属性读取。**push 一条**在 `ref` 上也是触发一次回调、然后重新遍历整个数组（Vue 3 的 deep 遍历不做增量，它不知道只有末尾变了），所以**单次 push 的 deep 遍历成本和整体替换几乎一样**，这才是真正的坑：在循环里 push 一千次，就是一千次全数组遍历，复杂度 O(n²)。现象是「数据只有几千条，但导入过程卡死好几秒」。判断方法是在 watch 回调里打个计数器，看它被调了多少次；如果次数和你的写入次数成正比且数据量大，就是这个问题。修法三个：批量写入用一次整体替换代替循环 push（`list.value = [...list.value, ...batch]` 只触发一次）、把 `deep` 换成监听长度或版本号（`watch(() => list.value.length, fn)`）、或者数据本身不需要深度响应式时改用 `shallowRef` 手动触发。**说得出「deep 遍历不是增量的」，就说明你真的因为它卡过一次。**

# 面试 07 · Vue 深挖 > 图表在标签页或弹窗里尺寸不对，怎么解决

来源：https://fqx.lx.ci/interview-prep/07-vue.html#q18

根因是**初始化时容器没有尺寸**，不是「resize 没调」。

 

图表库在 `init` 时读容器的 `clientWidth` / `clientHeight` 来定画布尺寸，而隐藏的容器宽高是 0：`display: none` 的标签页、还没打开的弹窗、折叠的面板。初始化恰好发生在这个时刻，图表就是 0×0，之后容器显示出来它也不会自己变——canvas 的尺寸是初始化那一刻定死的属性。现象是「切到第二个标签页，图表区域一片空白，F12 看 canvas 的 width=0」，或者手动 resize 一下浏览器窗口它突然就正常了（因为触发了 resize 监听）。

 

所以要在**容器真正可见之后**再 init 或 resize：

 

- 标签页切换事件里（Element Plus 的 `tab-change`）
- 弹窗的 `opened` 回调里，**不是 `open`** —— `open` 触发时进场动画还没结束，容器尺寸还在变
- 折叠面板展开后
- 一律配 `nextTick` 等 DOM 更新完

 

更可靠的做法是不依赖这些业务时机，改用 `ResizeObserver` 监听容器本身：

 

```js
let chart = null
const el = ref(null)

onMounted(() => {
  const ro = new ResizeObserver(([entry]) => {
    const { width, height } = entry.contentRect
    if (!width || !height) return              // 还不可见，什么都不做
    if (!chart) chart = echarts.init(el.value)  // 第一次有尺寸时才初始化
    else chart.resize()
  })
  ro.observe(el.value)
  onScopeDispose(() => { ro.disconnect(); chart?.dispose(); chart = null })
})
```

 

把「0 变成非 0 时初始化，之后每次变化 resize」交给浏览器判断，比在业务代码里到处找时机可靠得多——它对所有让容器可见的路径都有效，包括你没想到的那些。

 

沉淀成组件时统一管四件事：init 时机（上面这套）、数据更新（用 `setOption` 而不是重新 init，第二个参数 `notMerge` 要按场景决定——**数据结构变了不传 `true` 会残留旧系列**，表现是切换图表类型后旧的柱子还在）、加载和空数据状态、销毁时 `dispose` 加移除监听。

 

不 `dispose` 是明确的内存泄漏：实例持有 canvas 和全量数据，组件销毁了它还被 `window` 上的 resize 监听引用着，GC 收不掉。中后台切页面频繁，几十次之后内存曲线肉眼可见地往上走。

 

**追问「ResizeObserver 的回调里改了会影响布局的样式，会怎么样」**：会触发 `ResizeObserver loop completed with undelivered notifications` 这个错误（Chrome 里是一条 error，还会被 Sentry 当异常上报），本质是**回调里改的东西又让被观察元素尺寸变了，形成观察循环**。浏览器为了防止死循环，检测到深度超限就中断并报这个错，结果是本轮的部分通知被丢弃——现象是「图表偶尔尺寸不对，刷新一下就好了」，很难复现。这题的判断依据是**回调里只做「不影响被观察元素几何」的事**：调 `chart.resize()` 是安全的（canvas 内部像素变化不改变容器盒子），而在回调里给容器设 `height`、加/去掉 class、往里插 DOM 就危险。真的需要改布局时，把动作推到下一帧（`requestAnimationFrame`）跳出本轮观察循环，并且给尺寸变化加一个阈值判断（变化小于 1px 就忽略），避免亚像素抖动引起的反复触发。另外这条错误在很多项目里被当成噪音全局屏蔽掉了——**屏蔽之前要确认它不是自己代码引起的**，否则真正的布局循环被藏起来了。

# 面试 07 · Vue 深挖 > 大数据量表格性能怎么优化

来源：https://fqx.lx.ci/interview-prep/07-vue.html#q19

先定位瓶颈：一千行 × 二十列 = 两万个单元格，每个单元格如果还有插槽、格式化、状态标签，就是几万个组件实例。卡在**创建和更新组件实例**上，不是数据量本身——同样一千行数据，纯文本表格流畅，加了插槽就卡，这个对比就能说明问题在哪。

 

**虚拟滚动是唯一的根本解**：只渲染可视区加缓冲区，DOM 数量和数据量脱钩。行高不固定时要给估算值，配合渲染后实测高度修正（动态高度的完整处理见 `01-frontend.md` 第 12 题）。

 

其余几条按收益排：

 

- **格式化逻辑别写在模板表达式里** —— `{{ formatMoney(row.amount) }}` 每次重渲染都重跑，一千行就是一千次函数调用。挪到数据进来时预处理一次。
- **字典翻译用 Map 而不是 `find`** —— 一千行 × 每行三个字典字段 × 数组遍历，这是很典型的隐形 O(n²)。现象是「字典项从几十个涨到几百个之后表格突然变卡」，而代码一行没改。
- **操作列的按钮权限判定同理** —— 别在每一行里 `perms.includes(...)`，提到外面算一次布尔值。
- **可编辑表格用局部更新**，别整体替换 `tableData`——替换整个数组会让所有行的 key 重新比对，一次编辑触发全表 patch。
- **大数据用 `shallowRef` 装** —— 避免给几万个字段建 Proxy（见 `07-vue.md` 第 4 题的追问）。

 

一个容易忽略的：**列数也是变量**。二十列固定表头 + 固定列 + 合并单元格的组合会让每次滚动都触发大量布局计算，这种情况下先砍列（可配置显示哪些列）比优化渲染更有效。

 

**追问「虚拟滚动为什么导出 Excel 会缺数据」**：因为 DOM 里只有可视区那几十行。凡是「读 DOM 生成文件」的导出实现（`table-to-excel` 这类库、或者自己 `querySelectorAll('tr')`），在虚拟滚动下拿到的就是屏幕上那几十行，导出的文件只有一页数据——**而且不报错，用户要打开文件才发现**。同类问题还有：全选复选框只勾中可视区、Ctrl+F 浏览器搜索找不到没渲染的行、打印只出一页。正确做法是**导出必须走数据源而不是读 DOM**：前端有全量数据就用数据数组生成（`xlsx` / `exceljs`），数据是分页拉的就让后端导出（返回文件流或者异步任务加下载链接）。判断依据很简单——**导出功能的输入是不是和表格渲染完全解耦**，只要它依赖渲染结果，虚拟滚动、懒加载、分页任何一个都会让它出错。数据量大到几十万行时只有后端导出这条路，前端生成会直接把浏览器内存打爆。

# 面试 07 · Vue 深挖 > Vue 3 编译期做了哪些优化，为什么比 Vue 2 快

来源：https://fqx.lx.ci/interview-prep/07-vue.html#q20

性能提升主要来自**编译期**，不是运行时 diff 算法更聪明——这是很多人答错的地方。

 

三个机制：

 

**静态提升（hoistStatic）** —— 完全不变的节点被提到渲染函数外面，只创建一次 vnode，之后每次重渲染直接复用同一个引用。同时静态的 props 对象也会被提升，避免每次重建对象。

 

**patch flag** —— 编译时就标出这个节点哪些部分是动态的。`<div :class="cls">{{ text }}</div>` 会被标成「class 和 text 是动态的」（flag 是位运算组合），运行时 patch 只比对这两项，不做全属性遍历。

 

**block tree** —— 把模板里的动态节点收集成一个扁平数组挂在 block 上，diff 时直接遍历这个数组，跳过中间所有静态层级。**所以 diff 成本和模板的静态部分规模无关了**：一个包含 500 行静态布局、只有 3 处动态绑定的页面，Vue 2 要递归比对整棵树，Vue 3 只看那 3 个节点。

 

一句总结：Vue 2 是「运行时才知道什么变了，所以要逐层比」，Vue 3 是「编译时已经知道哪里可能变，运行时只看那几处」。

 

再加上 tree-shaking 友好的模块设计（没用到的 `Transition`、`KeepAlive` 不进 bundle）和 Proxy 的惰性代理，才是整体更快的原因。

 

顺带把版本状态说准（截至 2026-09-03）：**Vue 3.6 仍在 RC 阶段**（`3.6.0-rc.6`，2026-08-28），npm 的 `latest` 还是 3.5.x。3.6 的两个大改动是 `@vue/reactivity` 基于 alien-signals 重写（默认生效，属于运行时优化）和 **Vapor Mode**（编译模式，完全 opt-in，把 SFC 直接编译成命令式 DOM 操作、绕过虚拟 DOM，只支持 Vue API 的一个子集——依赖 vnode 和组件实例代理的特性用不了）。面试时提一句「关注 Vapor 但还没上生产，因为它现在是 RC 且 API 覆盖不全」是准确的表述；说「Vue 3.6 已经不用虚拟 DOM 了」是错的。

 

**追问「既然编译期能标出动态节点，为什么还需要 v-memo 和手动优化」**：因为编译器只能看出**模板结构**里哪些绑定是动态的，看不出**运行时数据**有没有真的变。patch flag 的作用是「跳过静态属性的比对」，它不能跳过「这个组件要不要重新渲染」这个判断——父组件重渲染时，子组件只要收到的 props 引用变了（哪怕内容一样）就会重渲染，这一层编译器无能为力。所以两类场景仍然要手动介入：**一是大列表**，一千行里每行都是动态绑定，patch flag 帮你把每行的比对从 10 个属性缩到 2 个，但一千次组件更新的成本还在，这时候 `v-memo` 才有用（给一个依赖数组，依赖没变就整块跳过 patch，代价是里面的任何变化都不会更新，用错了就是「数据变了界面不动」）。**二是传给子组件的对象/函数 props**，每次渲染新建一个字面量对象就一定让子组件重渲染，这个要靠自己稳定引用。判断依据是**先测再优化**：打开 Vue DevTools 的 Performance 或者 `app.config.performance = true`，看是哪个组件的渲染耗时高、被触发了多少次，再决定要不要上 `v-memo`——它可读性差、容易写出 bug，不该作为默认手段。

# 面试 07 · Vue 深挖 > 发布后浏览器还在加载旧版本，怎么定位

来源：https://fqx.lx.ci/interview-prep/07-vue.html#q21

先分层排查，因为「缓存」至少有四层，看错层就白忙：

 

打开 DevTools 的 Network，看那个请求的 Size 列显示什么：

 

| 显示 | 含义 | 说明 |
| --- | --- | --- |
| `(memory cache)` | 内存缓存 | 本次会话内，关标签页就没了 |
| `(disk cache)` | 磁盘缓存 | 强缓存命中，**根本没发请求** |
| `304` | 协商缓存命中 | 发了请求，服务端说没变 |
| `200` | 真的重新下载了 | 缓存没参与 |

 

前两种是强缓存，说明是 `Cache-Control: max-age` 在起作用；`304` 是协商缓存，说明 `ETag` / `Last-Modified` 生效。然后看响应头里的 `Cache-Control` 是谁给的——可能是 Nginx、CDN、或者网关，三处配置互相覆盖是常见的坑（CDN 的规则通常盖过源站）。

 

根因通常是 **`index.html` 被强缓存了**。构建产物的 JS/CSS 带 contenthash，文件名会变，本来不会有缓存问题；但引用它们的 `index.html` 如果被缓存住，浏览器根本不知道有新文件名，于是继续加载旧 chunk——**新版本代码明明部署上去了，用户一个字节都没拿到**。

 

正确的两套策略：

 

```nginx
# 带 hash 的静态资源：永久缓存
location ~* \.(js|css|woff2)$ {
  add_header Cache-Control "public, max-age=31536000, immutable";
}
# 入口文件：每次回源校验
location = /index.html {
  add_header Cache-Control "no-cache";
}
```

 

`no-cache` 不是不缓存，是**每次都要回源校验**，配合 `ETag` 命中就返回 304，只有几百字节的开销，很省流量。真正的不缓存是 `no-store`。一句话：**入口不缓存，资源永久缓存。** CDN 上还要记得发布后刷新 `index.html` 的缓存，否则你的 Nginx 配置对了但 CDN 那层还在发旧的。

 

**追问「用户已经打开着页面，你发版了怎么办」**：这是另一个问题，而且比缓存那个更常见于事故报告。已经加载的页面持有的是旧版 `index.html` 里的 chunk 映射，用户点进一个还没访问过的懒加载路由时，浏览器去请求那个 chunk 名——但新版部署后旧 chunk 文件已经被删掉了，**请求 404，动态 import 抛错，页面白屏**。现象特点是「只有发版后半小时内、只有一直没刷新页面的用户会遇到」，本地绝对复现不出来。三层处理：**一是兜底**——全局捕获动态 import 失败（Vue Router 的错误回调，或 Vite 的 `vite:preloadError` 事件），命中后 `location.reload()` 自动刷新一次，注意要**加一个只刷新一次的标记**（存 sessionStorage），否则新版本自己坏了会变成无限刷新。**二是提示**——轮询一个版本号文件（或用 SSE 推），发现版本变了给用户一个「有新版本，点击刷新」的提示条，让他自己选时机，比替他刷新更礼貌，尤其是他正在填表单的时候。**三是发布策略**——旧 chunk 保留一到两个版本再删（构建产物累加而不是清空目录），从根上把 404 的窗口消掉。这三条里第三条最有效，前两条是兜底。**能提到「旧 chunk 保留一段时间」这一条，说明真的经历过发布事故。**

# 面试 07 · Vue 深挖 > 代码分割和首屏优化怎么做

来源：https://fqx.lx.ci/interview-prep/07-vue.html#q22

顺序是**先测再改**，说不出「优化前后哪个指标变了多少」的答案说服力很弱。

 

`rollup-plugin-visualizer`（Vite）或 `webpack-bundle-analyzer` 看产物构成，找体积最大的那几块。中后台的典型元凶就那几样：

 

| 元凶 | 处理 |
| --- | --- |
| 图表库全量引入 | 按需引入核心 + 用到的图表和组件，全量是几百 KB |
| 组件库全量注册 | 按需 + `unplugin-vue-components` 自动导入 |
| moment / lodash 整包 | 换 dayjs / 只 `import` 用到的函数（或用 `lodash-es` + tree-shaking） |
| 未拆分的路由 | 路由级懒加载 `() => import('...')`，一个路由一个 chunk |

 

再往下三条：

 

- **`manualChunks` 把稳定的第三方库拆成单独 vendor chunk** —— 业务代码改了它的 hash 不变，用户能一直吃缓存。注意别拆太碎：几十个小 chunk 在 HTTP/1.1 下会被并发上限卡住排队（见 `07-vue.md` 第 28 题）。
- **gzip / brotli 压缩** —— Nginx 层开就行，收益大成本近零。
- **首屏图片和字体做预加载和格式优化** —— 首屏图片 `fetchpriority="high"`，字体 `preload` + `font-display: swap`。

 

**指标看 LCP 和 FCP，不看 bundle 体积**——体积小了但首屏没变快的优化是白做的。这种情况真实存在：把一个 300KB 的库拆成异步加载，bundle 报告很好看，但那个库首屏就要用，结果变成「先加载入口再加载它」两个串行的往返，LCP 反而变差。

 

顺带把 Core Web Vitals 的现状说准：**INP 已于 2024-03 取代 FID** 成为 Core Web Vitals 的响应性指标，现在的三个是 LCP / INP / CLS。面试里还说 FID 会显得知识停在两年前。

 

**追问「拆了 chunk 之后首屏反而变慢了，怎么排查」**：先分清是**请求数问题**还是**依赖链问题**。请求数问题在 Network 的瀑布图上很明显——一堆小 chunk 排成阶梯状，前面的没下完后面的不开始，说明撞上了并发上限（HTTP/1.1 同域约 6 个），修法是合并小 chunk 或者升 HTTP/2。依赖链问题更隐蔽：Vite/Rollup 拆出来的 chunk 之间有 import 关系，浏览器必须先下载并解析 A 才知道要下载 B，形成**串行的请求瀑布**，每一层都是一个 RTT。判断方法是看瀑布图上这些 chunk 是**同时开始**（并行，健康）还是**依次错开**（串行，有问题）。修法是让入口 HTML 里直接 `<link rel="modulepreload">` 声明这些依赖（Vite 构建默认会做，自定义 `manualChunks` 时容易破坏它），把发现时机从「解析完 A 之后」提前到「解析 HTML 时」。第三种可能是**拆错了边界**——把首屏必需的代码拆进了异步 chunk，纯粹多了一个往返。所以 `manualChunks` 的原则是**按「变更频率 + 是否首屏必需」两个维度拆**，不是按 node\_modules 目录机械拆分；拆完必须回头量 LCP，只看 bundle 报告会得出相反的结论。

# 面试 07 · Vue 深挖 > Vue 项目里内存泄漏一般出在哪，怎么查

来源：https://fqx.lx.ci/interview-prep/07-vue.html#q23

四类来源，共同点都是「组件销毁了但引用还在」：

 

- **`window` / `document` 上的事件监听没移除** —— `resize`、`scroll`、`keydown`。回调是个闭包，持有组件作用域里的一切。
- **`setInterval` / `setTimeout` 没清** —— 定时器本身持有回调，回调持有组件。
- **第三方实例没销毁** —— 图表、地图、富文本编辑器、播放器。这类最重，一个实例可能持有几 MB 的 canvas 和数据。
- **闭包持有了 DOM 节点** —— 把 `el` 存进模块级的数组或 Map 里，节点从文档移除了但对象还在。

 

中后台切页面频繁，这些会累积，表现是「用了两小时之后整个系统变卡，刷新一下就好了」。

 

**怎么查**（这段要能具体到操作步骤，否则听起来像看过文章）：

 

DevTools 的 Memory 面板：在 A 页面拍一个堆快照（Heap snapshot），切到 B 再切回 A，重复三到五次，再拍一个。把第二个快照的视图切成 Comparison，或者在筛选框里搜 `Detached`——看 **Detached HTMLElement 的数量只涨不降就是泄漏**，顺着 Retainers 面板往上找就能看到是谁在引用它（通常直接指到那个监听器或数组）。

 

Performance 面板录一段操作看内存曲线：**健康的是锯齿状**（涨上去后 GC 能回收下来），**泄漏是阶梯状往上**（每次操作涨一截，回不去）。这个判断只要三十秒，是排查的第一步。

 

**预防写在申请的地方**：

 

```js
// composable 内部自己清理，别让调用方记得
export function useResize(fn) {
  window.addEventListener('resize', fn)
  onScopeDispose(() => window.removeEventListener('resize', fn))
}
```

 

用 `onScopeDispose` 而不是 `onUnmounted` 的理由是 composable 可能在组件之外的 `effectScope` 里被调用（比如在 Pinia store 里），那种情况下 `onUnmounted` 拿不到组件实例，注册不上（开发环境有警告，生产环境静默失效）。**「谁申请谁释放，写在同一个函数里」是最不容易漏的规则。**

 

**追问「组件都正确卸载了、监听也移除了，内存还是不降，还有什么可能」**：三种，按排查顺序。**一是快照本身的误导**——拍快照前必须先手动点一次垃圾回收（Memory 面板的垃圾桶图标），否则你看到的可能只是还没被回收的对象；而且 DevTools 打开着本身会持有一些引用，实际测量最好在无痕窗口里做。**二是引用在你没想到的地方**：Vue DevTools 会缓存组件树（生产构建里没有这个问题）、Pinia store 里存了大对象而 store 是应用级单例（用户信息没问题，把整个列表数据缓存进 store 就是永不释放）、`console.log` 打印过的对象在控制台里被引用着（这条最阴，因为它只在开发环境出现，会让你误以为有泄漏）、以及 Promise 一直 pending 时它的回调链和闭包都不会释放。**三是「不是泄漏而是缓存」**——`keep-alive` 缓存的组件按设计就不该被回收，`max` 设成 20 意味着二十个页面的 DOM 和数据常驻，内存涨上去是预期行为。判断依据是**「涨的量有没有上界」**：有上界（涨到某个值就平了）是缓存，无上界（一直线性涨）是泄漏。这个区分说不出来，很容易花半天去修一个本来正常的现象。

# 面试 07 · Vue 深挖 > 通用组件的 API 你怎么设计

来源：https://fqx.lx.ci/interview-prep/07-vue.html#q24

三条原则，每条都有一个「不这样做会怎样」：

 

**props 只收数据不收行为。** 要定制行为用插槽或事件。props 里塞回调函数（`onRowClick`、`beforeSubmit`、`formatter`）会让组件参数无限膨胀——每个用它的页面都有一点特殊需求，半年后这个组件有四十个 props，没人敢改，因为不知道哪个页面依赖哪个。

 

**插槽优先于配置项。** 一旦出现 `showFooter`、`emptyText`、`headerStyle` 这类补丁式 props，说明该开一个插槽让调用方自己写。判断信号很明确：**你在给一个 prop 加第二个「只有某个页面需要」的选项时，就该换成插槽了。**

 

**受控和非受控要选一个。** 别让同一个状态既能由内部改又能由外部改：

 

```vue
<!-- 危险：value 是 prop，但组件内部也维护了 innerValue -->
<MySelect :value="v" @change="v = $event" />
```

 

内部改了不同步给外部、外部改了内部没跟上，就会出现「界面显示 A，实际提交 B」的 bug，而且极难查——因为两处状态在大部分路径下是一致的，只有特定操作顺序才分叉。要么完全受控（`modelValue` + `update:modelValue`，内部不留状态），要么完全非受控（只在初始化时读一次 `defaultValue`，之后只通过 `emit` 汇报）。

 

**一个实际的判断：组件管展示和交互，数据获取留给调用方。** 封装表格组件时最容易犯的错是把「查询接口」也封进去（传个 `url` 进来，组件自己发请求）。第一个页面很爽，第二个页面接口的参数结构不一样就要加分支，三个页面之后组件里全是 `if (type === 'xxx')`。而且它顺带毁掉了可测试性——组件测试变成必须 mock 网络。正确的边界是组件接收 `data` / `loading` / `total`，`emit` 出「用户想翻页/排序/筛选」这些意图，请求由调用方发。

 

面试时如果能说「我曾经把 X 封进去了，后来发现是错的」这种反思，比讲成功案例更有说服力——但要用你自己项目里真实发生过的那个例子，别套模板。

 

**追问「组件已经有二十个页面在用了，现在要改一个 prop 的默认值，你怎么做」**：这题问的是**破坏性变更的处理流程**，不是技术。默认值变更是**静默的破坏性变更**——不报错、不警告，二十个页面里没有显式传这个 prop 的都会跟着变，而 CI 全绿。所以流程上四步：**一是先量影响面**，用 `ast-grep` 或 IDE 全局搜这个组件的使用点，统计有多少处没显式传这个 prop（这些就是会被影响的）。**二是不改默认值，加新入口**——如果新旧行为都合理，加一个新的 prop 或新的值让需要的人显式选，老行为保持不动；默认值是契约的一部分，改它等于改所有人的代码。**三是必须改的时候（比如老默认值是个 bug），走一个版本的过渡期**：新版本里检测到「没显式传这个 prop」时在开发环境打一条 warn，说明将在下个版本改默认值并给出迁移方式，让使用方有时间显式声明。**四是有测试才敢改**——组件的行为测试（断言默认渲染出什么）是这类改动唯一的安全网。**判断依据是「这个改动能不能靠自动化发现」**：能（类型报错、测试红）就可以改，只能靠人肉审查就不该悄悄改。补一句：如果这个组件只在一个仓库里、二十个页面都是你自己团队的，可以更激进——全局搜索加全部显式补上，一次改完；跨团队或跨仓库使用的组件就必须走过渡期。

# 面试 07 · Vue 深挖 > 怎么保证团队代码质量一致，Code Review 看什么

来源：https://fqx.lx.ci/interview-prep/07-vue.html#q25

分两层，边界很清楚：

 

**能自动化的绝不靠人。** ESLint + Prettier 定风格（风格问题在 review 里争论是纯浪费时间，而且伤感情）、TypeScript strict 卡类型、`lint-staged` 在提交前只跑改动的文件、CI 里跑 typecheck + lint + test，不过就不许合。这一层的目标是**让机器能判断的事永远不进入人的视野**。

 

**人只看机器看不了的四类：**

 

- **边界条件和失败路径想没想过** —— 空数组、接口超时、权限不足、并发操作。绝大多数线上 bug 出在这里，而绝大多数 review 意见都在讨论命名。
- **命名和抽象是否表达了意图** —— `handleData`、`utils.js`、`flag` 这种名字是设计没想清楚的信号，不只是不好看。
- **有没有引入不必要的全局状态** —— 一个组件私有的状态被塞进 store，是最常见的架构熵增（见 `07-vue.md` 第 14 题）。
- **这个改动会不会让下一个人更难改** —— 加了第三个 `if (type === ...)` 分支、复制了一段逻辑、给通用组件加了业务专用 prop，都属于这类。

 

**Review 的沟通方式也值得说一句**：区分「必须改」和「建议」。两者混在一起提，对方要么全接受（在风格问题上浪费时间争论）要么全抵触（觉得你在挑刺）。明确标出哪条是阻塞项、其余标成可选，效率高很多。另外**一次 review 的改动量要有上限**——超过四百行的 PR 基本得不到有效审查，人会开始只看 diff 的表面。

 

**追问「团队里有人就是不按规范写，lint 也被他用 eslint-disable 绕过去了，你怎么处理」**：先分清是**规则不合理**还是**人不配合**，判断依据是**他绕的是同一条规则还是各种规则**。如果全团队都在绕同一条规则（比如某个 `any` 的限制在对接一个没类型的老 SDK 时确实做不到），那是**规则的问题**——该改规则或者给那个目录加 overrides，硬扛只会让所有人学会用 disable，最后 lint 形同虚设。如果是个别人到处 disable，那是协作问题，技术手段能做的是：**让绕过留下痕迹**（约定 `eslint-disable` 必须带 `--` 注释说明原因，CI 里统计 disable 的数量并在 PR 里显示增量，涨了就要在 review 里解释）、**把最关键的几条规则做成不可绕过的门禁**（比如 CI 里单独跑一次 `--no-inline-config` 的 lint，忽略文件内的 disable 注释）。但根子上这不是工具能解决的问题——**技术手段的作用是让偏离变得可见，不是让它变得不可能**。可见之后就是管理问题：找他谈，问清楚是不知道规则、不认同规则、还是赶工期。我的态度是先假设第三种，因为大部分「不守规范」是排期压力的外化，工具再严也压不住。

# 面试 07 · Vue 深挖 > 怎么给 Vue 项目写测试，测什么不测什么

来源：https://fqx.lx.ci/interview-prep/07-vue.html#q26

答「全都要测」和答「前端不用测」一样糟，这题考的是取舍。

 

按性价比排：

 

| 对象 | 值不值得测 | 理由 |
| --- | --- | --- |
| 纯函数（格式化、校验、数据转换） | **最该测** | 输入输出直接断言，成本最低收益最高 |
| store（Pinia） | 值得 | `createTestingPinia` 不用 mock 网络，逻辑集中 |
| 组件行为 | 值得，但只测行为 | 断言「点了按钮 emit 了什么」，不断言内部变量 |
| composable | 值得 | 抽出来就是为了复用，测它等于测所有用它的地方 |
| 快照测试 | 谨慎 | 容易变成「改了就更新快照」的橡皮图章 |
| 纯展示组件的样式 | 不测 | 改一次样式测试全红，维护成本大于收益 |
| 第三方库的行为 | 不测 | 那是它们的测试职责 |
| 频繁改的 UI 细节 | 不测 | 需求一变全部重写 |

 

**组件测行为不测实现**这条要能举例说明区别：断言 `wrapper.emitted('submit')[0]` 是测行为——重构内部实现（把 `ref` 换成 `reactive`、把逻辑抽到 composable）测试依然通过；断言 `wrapper.vm.someInternalFlag === true` 是测实现——重构一次测试全红，于是团队开始讨厌写测试。

 

**E2E 只覆盖最关键的几条主流程**（登录、下单、核心报表）。它慢且脆（一个选择器变了就红），铺太多会拖垮 CI 让人干脆跳过——**一个被跳过的测试套件比没有测试更糟**，因为它给了虚假的安全感。

 

工具选 Vitest + `@vue/test-utils`（Vite 项目里配置几乎为零，还能复用 vite.config 的别名），E2E 用 Playwright。

 

**追问「测试覆盖率要求到多少，怎么定这个数」**：不定全局数字，或者说定了也只当参考。理由是覆盖率衡量的是「代码有没有被执行到」，不是「行为有没有被验证」——一个把所有函数调一遍但不写任何断言的测试能刷到 90% 覆盖率，而它什么都没保证。硬性要求一个高数字的直接后果是团队开始写这种测试来凑指标，成本付了、收益没有。**我的做法是按模块分层要求**：核心的纯函数和 store 要求高（80% 以上，它们本来就好测，达不到说明有没测的分支）；组件层不设硬指标，只要求「关键交互路径有测试」；UI 细节和胶水代码不算进分母。**更有用的是看覆盖率的变化方向而不是绝对值**——CI 里加一条「这个 PR 新增的代码覆盖率不能低于某个线」（diff coverage），它精准地作用在正在写的代码上，不会因为存量代码没测就永远达不标。判断一个测试套件有效的标准也不是覆盖率，而是**「线上出的 bug 里，有多少本该被测试拦住」**——每次事故复盘时补一个回归测试，比追着覆盖率数字跑有用得多。

 

## 场景实战

# 面试 07 · Vue 深挖 > 支付场景怎么防止用户重复提交订单

来源：https://fqx.lx.ci/interview-prep/07-vue.html#q27

前端三层，但结论要先说：**前端所有手段都只是体验，唯一可靠的是服务端幂等。**

 

前端该做的：按钮加 loading + 置灰给视觉反馈，同时用一个**同步的状态锁**挡住重复调用：

 

```js
const submitting = ref(false)

async function submit() {
  if (submitting.value) return        // 同步判断，这一行才是真正挡住的东西
  submitting.value = true
  try {
    await validate()                  // 表单校验，可能是异步的
    await confirmDialog()             // 二次确认弹窗，用户可能停留几秒
    await api.createOrder({ ...form, requestId })   // requestId 在进入页面时就生成好
  } finally {
    submitting.value = false          // 失败要恢复，否则用户再也提交不了
  }
}
```

 

注意 `requestId` 必须在**这次提交动作开始时生成一次**并复用，不是每次调接口都新生成——否则重试就变成两笔订单。

 

**为什么单纯按钮置灰 `disabled = true` 不能解决问题**（面试官一定会顺着这里挖 Vue 的更新机制）：`flag.value = true` 之后 Vue 不会同步更新 DOM——它把渲染任务排进微任务队列，同一个 tick 里再改一千个属性也只在 flush 时统一渲染一次，所以**这一行执行完的瞬间，DOM 上的 `disabled` 属性还没有被写上去**。在纯同步的代码路径里这不构成问题（同步执行期间浏览器不处理点击事件，用户没有机会再点）；但只要 `submit` 里在真正发请求之前有 `await`（表单校验、二次确认弹窗、拉一次库存），执行栈就交还给了浏览器——**DOM 更新和用户下一次点击之间就有了窗口**，尤其是二次确认弹窗停留好几秒的时候。所以真正挡住重复的是那个同步的 JS 状态锁 `submitting`（判断和赋值都在同一个同步块里，不可能被插入），`disabled` 只负责告诉用户「点了、在处理中」。想让 DOM 立刻反映出来可以 `await nextTick()`，但那也只是提前了一个微任务，逻辑正确性不该依赖它。

 

**为什么单纯加防抖也不行**：方向是反的。防抖是「等它停下来再执行一次」——对「手抖双击」有效，对「点了之后 3 秒没响应又点一次」完全无效，因为两次点击的间隔远大于防抖窗口，会被当成两次独立的意图。更糟的是**防抖会延迟首次提交**：用户点了「支付」，界面要等 300ms 才开始有反应，支付场景要的恰恰是立即响应。真要用节流类手段，应该是 leading 版本（第一次立即执行、窗口内忽略后续），但它本质上还是靠时间窗口猜意图，不如状态锁准确——状态锁的语义是「上一次还没结束就不许开始下一次」，和时间无关。

 

**唯一可靠的是服务端幂等。** 客户端生成 `requestId` / `Idempotency-Key` 随请求带上，服务端拿它建唯一索引，第二次插入直接冲突返回上一次的结果（完整设计见 `02-node-java.md` 第 13 题）。理由是前端的三层保护全部可以被绕过或失效：用户开两个标签页、网络超时后客户端自动重试、浏览器崩溃后重新提交、甚至有人直接构造请求。**前端防重是减少无效请求，不是保证不重复下单**——这句话说出来，这题就答满了。

 

**追问「网络超时了，前端该不该自动重试，重试和幂等键是什么关系」**：该重试，但**必须带同一个幂等键**。超时是最危险的场景，因为客户端**根本不知道服务端有没有收到、有没有处理成功**——请求可能死在路上，也可能订单已经落库只是响应回不来。不重试的结果是用户自己点第二次（等价于一次没有任何保护的重试），所以重试要做，关键是怎么做：**键的生命周期绑在「用户的一次提交意图」上，不是绑在「一次 HTTP 请求」上**。重试时新生成一个键，服务端就把它当成一笔新订单，于是「超时了我重试一下」直接变成扣两次钱——这是这类事故最常见的成因，而且它只在超时那一次才暴露，测试环境几乎碰不到。工程上还有两条：**重试次数要有上限并且退避**（立即重试撞上的往往是同一个瞬时故障，指数退避加抖动才有意义），以及**超时不等于失败，界面文案不能写「提交失败」**——正确的处理是提示「结果确认中」并主动查一次订单状态，让服务端告诉你到底成没成。**判断一个团队有没有真做过支付的标志就是这一条：他们的超时分支是去查询状态，还是直接报错让用户重来。**

# 面试 07 · Vue 深挖 > 瀑布流怎么实现，难点在哪

来源：https://fqx.lx.ci/interview-prep/07-vue.html#q28

瀑布流是**定宽不定高的多列布局，每个新元素放进当前最短的那一列**，视觉上像砌砖。它和普通网格的区别是行不对齐，所以不能用 `grid` 的行线约束。

 

三种实现路线的取舍：

 

| 方案 | 优点 | 代价 |
| --- | --- | --- |
| CSS `columns` | 几行 CSS，零 JS | **顺序是竖向的**（先填满第一列再第二列），不符合瀑布流「按时间从左到右插入」的阅读顺序；分页追加时整列重排 |
| 绝对定位 + JS 算列高 | 完全可控，顺序正确，能配虚拟滚动 | 要自己处理 resize、图片高度未知、以及每次插入的重算 |
| flex 多列容器 | 比绝对定位简单 | 需要自己把数据分配到各列，列间高度平衡靠估算 |

 

生产上最常用的是第二种：维护一个 `columnHeights` 数组，每来一个元素找 `Math.min` 的那一列，把它绝对定位到 `(列 x, 该列当前高度)`，然后累加列高。容器高度取所有列的最大值。

 

**难点具体化，这才是这题的考点：**

 

**一、图片高度未知导致布局跳动。** 插入元素时图片还没加载，你不知道它多高，只能先按 0 或者估算值算列高；图片加载完高度撑开，后面所有元素的位置全错，要重排一次——用户看到的是内容不断向下跳。**解法是让高度在布局前就已知**：后端返回图片的原始宽高，前端按容器宽度算出渲染高度，先用 `aspect-ratio` 或 padding-top 占位把位置固定住，图片加载完直接填进已有的框里，一次跳动都没有。这条是瀑布流所有实现的前提，拿不到宽高就只能忍受抖动。

 

**二、懒加载和列高计算互相依赖。** 懒加载的逻辑是「快进入视口才加载」，但要判断是否进入视口就得知道它的位置，要知道位置就得先算出前面所有元素的列高——而前面的元素如果还没加载就不知道高度。这是个循环。破解方式还是上面那条：**高度来自数据而不是来自 DOM 测量**，布局计算就和加载状态解耦了，懒加载只影响「什么时候把 src 填进去」，不影响布局。

 

**三、resize 要整体重排。** 容器宽度变了，列数和列宽都变，所有元素位置重算。用 `ResizeObserver` 监听容器，重算前判断列数有没有真的变化（宽度小幅变化只需要改列宽不需要换列），并且要节流——不做的话拖动窗口时每帧重排几百个元素，直接卡死。

 

CSS 原生瀑布流的状态也要说准：经过 CSSWG 几年的语法之争，最终方案是并进 Grid 的 `display: grid-lanes`（不是早期提案里的 `display: masonry`），**Safari 26.4 于 2026-03 首个正式支持**，Chrome / Firefox 目前仍在 flag 后面（caniuse 上全球支持率个位数）。所以 2026 年的正确做法是把它当渐进增强用 `@supports` 包起来，主路径还是 JS 方案。

 

**追问「一个页面同时加载 5 张和 10+ 张图片有什么区别」**：区别在**连接层的排队**，而且答案随协议版本变化，这是这题的分水岭。**HTTP/1.1 下同域名的并发连接上限约 6 个**（Chrome 的实现里 `kMaxNumDelayableRequestsPerHostPerClient = 6`），所以 5 张图基本同时开始下载，10 张里后 4 张要在队列里等前面的完成——在 Network 瀑布图上看到的就是明显的阶梯（Queueing / Stalled 时间很长）。这正是「域名发散」（把图片分散到 `img1.` / `img2.` 等多个子域，骗浏览器多开连接）这个老优化手段的由来。**但 HTTP/2 之后域名发散成了反模式**：H2 用单个 TCP 连接多路复用，本来就没有 6 个的限制，发散反而带来额外的 DNS 查询、TCP 握手和 TLS 握手，还**破坏了 H2 的流优先级**——浏览器无法跨连接给不同域的资源排优先级，首屏图片可能排在页脚图片后面。所以现在正确的做法是 **HTTP/2 + 单域名**，把连接层的调度交给协议。剩下的优化落在应用层：图片本身按需裁剪（不要下发原图让浏览器缩）、首屏之外的用懒加载（见 `07-vue.md` 第 30 题）、首屏的用 `fetchpriority="high"`，以及**接口收敛**——十个卡片如果各自打一个详情接口，问题就不在图片而在请求数了，该做 BFF 层聚合成一个。**判断依据是先看 Network 面板到底在等什么**：等排队就是并发问题，等服务端响应（TTFB 长）就是后端问题，等解码就该换图片格式。

# 面试 07 · Vue 深挖 > 白屏问题一般是什么原因，怎么排查

来源：https://fqx.lx.ci/interview-prep/07-vue.html#q29

白屏是**现象不是原因**，所以答「可能是 JS 报错」这种猜测式回答会被追问穿。要给一条**按可观测性分层**的排查路径，每一层都有明确的判定手段和下一步。

 

**1. 有没有 HTML。** `curl -i` 那个地址看返回。返回 500 / 502 就是服务端或网关的事，前端一行代码都不用看；返回了正常的 HTML 骨架（`<div id="app"></div>`）说明服务端没问题，往下走。这一步能立刻把责任范围切一半。

 

**2. 资源有没有 404。** Network 面板过滤 JS/CSS，看有没有红的。**发版后 chunk 名变了是最高频的一种**——用户开着旧页面，点进新路由请求一个已经不存在的 chunk，动态 import 失败，白屏（完整处理见 `07-vue.md` 第 21 题）。次高频的是部署路径不对（`base` 配错，资源 404 但 index.html 正常返回）。

 

**3. JS 有没有抛错。** Console 有堆栈就直接定位。没有的话看 Sentry 或自己的 `window.onerror` 上报——注意**跨域脚本的错误会被浏览器吞成 `Script error.`**，什么信息都没有，这时要给 CDN 上的 script 标签加 `crossorigin="anonymous"` 并让 CDN 返回 `Access-Control-Allow-Origin`，否则线上永远拿不到真实堆栈。另外 `onerror` 抓不到未处理的 Promise rejection，要另外监听 `unhandledrejection`；Vue 内部的渲染错误要靠 `app.config.errorHandler`，它不会自动冒泡到 `window.onerror`。

 

**4. 路由匹配失败。** 动态路由刷新丢失、`base` 和实际部署路径不一致、history 模式下服务端没配 fallback（刷新子路由返回 404 页面）。判定方法是看 `router.currentRoute.value.matched` 是不是空数组。

 

**5. 有 DOM 但看不见。** Elements 面板里 DOM 树正常渲染出来了，那就不是 JS 问题，是 CSS 或渲染问题——CSS 文件加载失败、`height: 0` 的容器、`z-index` 被盖住、字体颜色和背景同色、或者某个 CSS 特性在目标浏览器不支持（老 Safari 上的 `:has()`、新语法的 CSS 嵌套）。这一层最容易被忽略，因为大家默认白屏 = JS 挂了。

 

顺序不能颠倒：每一层都是在**缩小范围**，跳过前面直接猜第三层，遇到「其实是 CDN 挂了」这种情况会浪费一整天。

 

**追问「面对一个真实白屏问题，你会给 AI 什么信息让它帮你定位」**：**给现象，不给猜测**——这是这题真正的考点，也是用 AI 排查问题的核心方法。绝大多数人给 AI 的输入是「页面白了帮我看看」，或者更糟的「我怀疑是路由问题，你说是不是」；第二种比第一种还差，因为它把 AI 锚定在了你的错误假设上，它会顺着你的猜测编出一套自洽的解释。我会给的是这几类事实：**一、复现条件** —— 是否偶现（偶现和必现的排查路径完全不同）、是否只有第一次进入时出现（指向初始化时序或缓存）、是否只在特定路由、是否发版后才开始。**二、环境** —— 什么浏览器和版本、什么设备、什么网络（4G 还是 WiFi，慢网下才出现指向超时或加载顺序）、是否走了代理或企业网络。**三、量化指标** —— LCP / FCP / TTI 的实测值：FCP 正常但 LCP 极大，说明骨架渲染了但主内容没出来；FCP 本身就没有，说明连第一帧都没绘制，问题在更早的地方。**四、原始产物** —— 完整的报错堆栈（sourcemap 还原后的）、Network 面板里失败请求的状态码和响应头、`curl` 的原始返回。**五、我已经排除了什么** —— 这比「我怀疑什么」有用得多，它直接压缩搜索空间。反过来说，AI 在这个任务上真正的价值是**帮我把可能性列全并按概率排序**、以及读那些又长又相似的堆栈和构建产物；判断哪条是真因还是得靠我去验证。**给它现象、让它输出假设、验证由我做**——把顺序搞反（让它直接给结论然后照着改）是这类问题上最常见的浪费时间的方式。偶现白屏还要补一层数据来源：本地复现不了不等于不存在，得靠前端错误埋点上报加会话录制，把真实用户那一次的环境和堆栈捞回来，否则给 AI 的信息只能是猜测。

# 面试 07 · Vue 深挖 > 图片懒加载是怎么实现的

来源：https://fqx.lx.ci/interview-prep/07-vue.html#q30

三代做法，取舍很清楚：

 

**一、`scroll` 事件 + `getBoundingClientRect()`。** 最古老的写法：滚动时遍历所有图片，算它离视口的距离，进入范围就把 `data-src` 赋给 `src`。两个必须知道的代价：`scroll` 事件触发极密（不节流的话一次滑动几十次回调），而 `getBoundingClientRect()` 会**强制同步布局**（forced synchronous layout）——浏览器为了给你准确的坐标必须立刻重新计算布局，在滚动这种本来就紧张的帧预算里做这件事就是掉帧。现在只在需要兼容极老环境时才用。

 

**二、`IntersectionObserver`（推荐）。** 浏览器自己判断相交，回调是异步批量的，不阻塞主线程也不触发强制布局：

 

```js
const io = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue
    const img = e.target
    img.src = img.dataset.src
    io.unobserve(img)              // 加载过就停止观察，别一直回调
  }
}, { rootMargin: '200px 0px' })    // 提前 200px 开始加载，用户滚到时已经出来了

document.querySelectorAll('img[data-src]').forEach(img => io.observe(img))
```

 

`rootMargin` 是它比手写方案好用的关键：提前量可调，图片能在进入视口之前就加载完，用户完全感觉不到懒加载的存在。Vue 里包成指令（`v-lazy`）时记得在 `unmounted` 里 `unobserve` 并在组件销毁时 `disconnect`，否则又是一个泄漏点。

 

**三、原生 `loading="lazy"`。** 一行属性，零 JS，evergreen 浏览器全支持（Chromium 77+ / Firefox 75+ / Safari 15.4+ for images）。代价是**不可控**：触发阈值由浏览器自己决定（Chrome 会按网络状况调整），你没有 `rootMargin` 这种旋钮，也拿不到「开始加载」的时机做骨架屏或埋点。所以策略是**默认用原生，需要精细控制（占位动画、加载失败重试、按优先级分批）时用 IntersectionObserver**。

 

两个必须点出的坑：

 

**`src=""` 是错的。** 空字符串的 `src` 在部分浏览器（历史上包括 IE、Safari 的某些版本）会被解析成当前页面 URL 并**发起一次对当前页面的请求**——多一个无意义的请求，而且如果当前页是个动态接口，服务端会看到诡异的重复请求。正确做法是用一个极小的透明占位图（1×1 的 base64 gif）、或者干脆不写 `src` 只留 `data-src`。

 

**必须给图片预留高度。** 不给宽高（或 `aspect-ratio`），图片加载前占 0 高度，加载完撑开把下面的内容全推走——这就是 CLS，Core Web Vitals 里直接扣分的那一项，用户体验上是「正要点的按钮突然跑了」。所以 `<img width="800" height="600">`（属性值只需要正确的比例，实际尺寸由 CSS 控制）或者容器上写 `aspect-ratio: 4/3`。**懒加载和 CLS 是一对孪生问题**，只做前者不做后者是净负收益。

 

**追问「首屏的图片该怎么处理」**：**绝对不能懒加载**，而且要反向优化。这是懒加载最常见的误用——「所有图片都加 `loading="lazy"`」看起来很省，但如果 LCP 元素（通常就是首屏那张大图）被标成 lazy，浏览器在布局确认可见性之前会**先把它的请求优先级降到 Low**，等布局算完才升级，凭空多一个往返。web.dev 的实测数据是这样一次误用能让 LCP 从 2.6s 变成 4.0s；Web Almanac 2025 统计约 10% 的移动端页面在懒加载自己的 LCP 图片。正确做法是三件事：`loading="eager"`（或干脆不写这个属性）、`fetchpriority="high"` 把它在图片队列里提到最前（Chrome 101+ / Safari 17.2+ / Firefox 132+，2024-10 起属于 Baseline），必要时再加 `<link rel="preload" as="image">` 让它在 HTML 解析阶段就被发现。**判断哪张图是 LCP 元素不能靠猜**——用 Lighthouse 或 `PerformanceObserver` 监听 `largest-contentful-paint` 条目，它会直接告诉你是哪个元素。另外注意 `fetchpriority` 的语义是「相对同类资源」，它不会让图片抢在 CSS 前面，所以指望它解决渲染阻塞是误解。
