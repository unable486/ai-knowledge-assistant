# 面试 08 · React 机制层 > 说明

React 机制层

答案默认折叠。先自己答一遍，再点开核对。每题末尾的**追问**是面试官顺着你的答案往下挖的那一层 —— 只答得出主问题、答不出追问，通常判定为「背过，没做过」。

- 🔴 必答 — 答不出直接掉档

- 🟡 加分 — 能拉开差距

- ⚪ 可以坦白不会 — 说清边界比硬编好

# 面试 08 · React 机制层 > React 和 Vue 最根本的区别是什么

一句话收口：**Vue 是「框架知道什么变了」，React 是「你告诉框架要重来」。** 别列并列差异清单，把所有差异都从这一条导出来，说服力完全不同。

 

Vue 靠响应式系统在**运行时**追踪依赖：读 `obj.a` 时记下「哪些 effect 用了它」，写 `obj.a` 时精确通知这几个。所以 Vue 里可以直接改数据。React 没有依赖追踪，走的是**不可变数据 + 重新执行**：调了 setter，React 并不知道什么变了，于是把整个组件函数重跑一遍生成新的 element 树，再和上一棵 diff。

 

这条根因最直接的可观察后果是：**改了对象但界面不动，而且不报错**。

 

```jsx
const [user, setUser] = useState({ name: 'a', age: 1 });

// 界面不动：改的是同一个对象，引用没变，Object.is(prev, next) 为 true，直接跳过重渲染
const wrong = () => { user.age = 2; setUser(user); };

// 正确：产生新引用
const right = () => setUser(prev => ({ ...prev, age: 2 }));
```

 

数组同理，`arr.push(x)` 之后 `setArr(arr)` 也不动，必须 `setArr([...arr, x])`。这个 bug 的特征是「数据对了、界面旧了」，在 Vue 里写惯了的人第一周一定会撞一次。

 

其余差异都是同一条的推论：

 

| 现象 | 从哪条根因来 |
| --- | --- |
| 需要 `useCallback` / `useMemo` 手动缓存 | 组件函数每次渲染都重跑，Vue 的 `setup` 只跑一次 |
| 有闭包陷阱（见本文件第 4 题） | 每次渲染产生一批新的局部变量和新闭包 |
| 优化要开发者手动标注 | JSX 是运行时 JS 表达式，没有编译期模板信息；Vue 3 能在编译时算出 patch flag |
| JSX 逻辑更自由 | 反过来说，受限的模板 DSL 才能被静态分析（见 `01-frontend.md` 第 3 题） |

 

**追问「那哪个更好」**：不选边，但要给判断依据而不是和稀泥。取舍是明确的：React 把控制权和心智负担一起给开发者，灵活、但性能问题是「写出来的」；Vue 用约定换编译期自动优化，上手快、跳出约定时（比如包一个非响应式的第三方实例）会别扭。选型上我看三件事——团队现有栈、生态里有没有现成的核心组件、要不要 SSR/RSC 这类框架级能力，框架本身优劣排在这三件后面。再补一层能显示你在跟进：**React Compiler 1.0 稳定版 2025-10 发布**（支持 React 17+，React 19 原生），它自动插入 memo 缓存，等于把 Vue 编译期做的一部分事补上了，所以「手动 memo」这条差异在收窄。但心智模型没变——编译器只是替你插缓存，React 依然没有依赖追踪，你依然必须返回新引用。

# 面试 08 · React 机制层 > useState 的更新是同步还是异步，为什么

setter 调完**不能立即读到新值**。React 把同一个事件里的多次更新攒进队列**批处理**，最后统一触发一次重渲染，避免用户看到中间态、也避免渲染 N 次。

 

所以最经典的错答现象是「点一次只加一次」：

 

```jsx
const [n, setN] = useState(0);

// 点一次 n 只变成 1，不是 2 —— 两次都基于同一个旧 n（闭包里的 0）
const bad = () => { setN(n + 1); setN(n + 1); };

// 点一次 n 变成 2 —— 函数式更新拿的是队列里的最新值
const good = () => { setN(prev => prev + 1); setN(prev => prev + 1); };
```

 

判断规则很简单：**下一个值依赖上一个值时，必须用函数式更新**，因为闭包里的 `n` 是这次渲染的快照，而 `prev` 是队列结算时的值。

 

版本差异必须说出来，这是老项目升级的真实故障点：**React 18（2022-03）之前只有 React 事件处理函数里会批处理**，`setTimeout`、`Promise.then`、原生 `addEventListener` 回调里的多次 setState 是逐个同步渲染的；18 起改成**自动批处理（automatic batching）**，所有场景都批。升级后失效的代码长这样——`setTimeout` 里连着两次 setState 然后立刻读 DOM，18 之前碰巧能读到第一次的结果，18 之后读到的是两次都没提交的旧 DOM。这类 bug 只在升级后出现、没有报错，很难靠 code review 发现。

 

补一个容易混的点：`useState` 的 setter 在同一次事件里如果最终值和当前值相同（`Object.is` 判定），React 可能直接跳过重渲染，但它有时会额外多跑一次组件函数来确认——所以别在组件函数体里放有副作用的代码，那里必须是纯的。

 

**追问「那怎么在更新后拿到最新的 DOM」**：三条路，优先级从上到下。一是把读 DOM 的逻辑放进 `useEffect`，它在渲染提交到 DOM 之后跑，那时拿到的一定是新 DOM——这是默认答案。二是需要「改完立刻量尺寸再调整，不能让用户看到中间态」时用 `useLayoutEffect`（见本文件第 11 题），它在绘制前同步跑。三是 `flushSync(() => setX(v))` 强制同步刷新，之后下一行就能读到新 DOM；但它牺牲批处理、会额外触发一次同步渲染，滥用等于把 18 的性能收益退回去，真实合理场景只有少数几种（比如在原生 `beforeinput` / 手动管理滚动位置时必须先提交 DOM 再计算偏移）。反过来说，**如果你的答案是「加个 setTimeout 0 就能读到了」，这一题就判负了**——那只是碰巧排到了渲染之后，依赖调度顺序的巧合，并发渲染下不保证成立。

# 面试 08 · React 机制层 > useEffect 的执行时机和清理函数什么时候跑

只答「卸载时跑」是这题最常见的错答，也是面试官用来筛人的点。准确的说法是：清理函数在**下一次 effect 执行前**和**组件卸载时**各跑一次。

 

时机上，`useEffect` 在渲染**提交到 DOM 之后异步**执行，不阻塞浏览器绘制。所以订阅类逻辑的正确形状是「先清掉上一次的，再建立新的」：

 

```jsx
useEffect(() => {
  const ws = new WebSocket(`wss://example.com/room/${roomId}`);
  ws.onmessage = e => append(JSON.parse(e.data));
  return () => ws.close();   // roomId 变化时先 close 旧连接，再建新的
}, [roomId]);
```

 

漏掉这个 `return` 的现象非常具体：切了三个房间之后有三条连接同时在推消息，界面上同一条消息出现多次，而且切回第一个房间时会收到本该属于第三个房间的数据。定时器同理——漏清理时切页面几次，计数器就开始跳着走。

 

依赖数组三种写法与对应现象：

 

| 写法 | 何时跑 | 典型事故 |
| --- | --- | --- |
| 不传 | 每次渲染后都跑 | effect 里 setState → 又触发渲染 → 无限循环 |
| `[]` | 只在挂载时跑一次，清理只在卸载 | 里面读的 state 永远是初始值（闭包陷阱，见本文件第 4 题） |
| `[a, b]` | `a` 或 `b` 变了才跑 | 依赖里放对象/数组字面量 → 每次都是新引用 → 无限重跑 |

 

第三行是最费时间的一类：比较用的是 `Object.is` 浅比较，所以 `useEffect(..., [{ page: 1 }])` 或 `[list.filter(...)]` 等于每次渲染都变。现象是网络面板里同一个请求以每秒几十次的速度刷屏。修法是把依赖降到原始值（`[page, size]`），或者用 `useMemo` 把那个对象稳定下来。

 

还有个开发环境专属现象要能解释：**严格模式（StrictMode）下 effect 会故意执行两次**——挂载 → 立即清理 → 再挂载。这是 React 18 引入、React 19 仍然保留的有意设计，目的就是把「没写清理函数」的 bug 在开发期暴露出来（写对了清理，跑两次结果一样；写错了，你立刻看到两条连接或两次请求）。生产构建不会双跑。很多人第一反应是「我代码有 bug」，然后去加 `useRef` 标记位屏蔽第二次——那是把体温计砸了，正确做法是补清理函数。

 

**追问「依赖数组里必须写某个函数，但那个函数每次渲染都是新的，你怎么处理」**：先分类，别一律 `useCallback`。如果这个函数是「effect 逻辑的一部分」（比如根据 `roomId` 建连接的 `connect`），把它挪进 effect 内部定义，依赖就退化成它真正用到的原始值，这是最干净的解。如果它是「effect 里要通知外部的事件」（连上以后弹个 toast，用到 `theme`），那 `theme` 变化不该重连，正解是 `useEffectEvent`——它**已随 React 19.2（2025-10）转为稳定 API**，返回的函数总能读到最新 props/state，且**不写进依赖数组**（要升级 `eslint-plugin-react-hooks` 到 v6+，lint 才不会硬塞进去；另外它只能声明在与该 effect 同一个组件或 hook 内）。如果这函数来自 props、你无权改，才用 `useCallback` 在上游稳定它。**最差的做法是关掉 lint 规则或者把依赖删掉不写**——那样后续改动没人再帮你校对依赖，闭包陷阱会在几个月后以「偶发读到旧数据」的形式回来。

# 面试 08 · React 机制层 > 什么是闭包陷阱，为什么 Vue 里没有这个问题

根因是第 1 题那条：组件函数每次渲染都重新执行，每次都产生一批新的局部变量和新的闭包。如果一个回调被「留」到后面才执行——`setInterval`、事件监听、异步请求的 `then`——它捕获的是**创建它那一次渲染**的 state 快照，不是最新值。

 

最小复现，控制台永远打印 0：

 

```jsx
function Counter() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const id = setInterval(() => console.log(count), 1000);  // 永远是 0
    return () => clearInterval(id);
  }, []);                                                     // 空依赖：只在挂载时建立

  return <button onClick={() => setCount(c => c + 1)}>{count}</button>;
}
```

 

界面上数字在涨，日志里一直是 0。这个不一致就是判断依据：**界面读的是本次渲染的 `count`，定时器读的是挂载那次渲染的 `count`**。同样的机制在异步请求里更危险——点了三次「保存」，前两个请求的 `then` 里拿到的是各自发起时的表单快照，最后落库的可能是旧数据，而且不报错。

 

三种解法及各自代价：

 

| 解法 | 写法 | 代价 |
| --- | --- | --- |
| 依赖里加上 `count` | `}, [count])` | effect 重建，定时器每次跟着销毁重建，计时会被重置 |
| 函数式更新 | `setCount(c => c + 1)` | 只适用于「基于旧值算新值」，不能用来读值做判断 |
| `useRef` 存最新值 | `ref.current = count`，回调里读 `ref.current` | 读不到时不触发重渲染，要自己保证写入时机 |

 

第三种的关键是 ref 对象**身份跨渲染不变**，闭包捕获的是这个容器而不是值，所以 `.current` 读到的永远是当前值。React 19.2 之后这类「回调要读最新值但不该重建 effect」的场景有了官方解——`useEffectEvent`（见本文件第 3 题追问），语义比手搓 ref 清楚。

 

**Vue 里为什么不存在**：因为 `setup` 只执行一次，`ref` 是个稳定对象，闭包捕获的是这个对象的引用，`.value` 读的永远是当前值。同一段逻辑在 Vue 里天然正确：

 

```js
// Vue 3：setup 只跑一次，闭包捕获的是 count 这个 ref 对象本身
const count = ref(0)
onMounted(() => {
  const id = setInterval(() => console.log(count.value), 1000)  // 永远是最新值
  onUnmounted(() => clearInterval(id))
})
```

 

把这个对比讲出来比单独解释闭包陷阱强得多——它显示你能把两个框架的差异追到同一个根因，而不是记住了两套 API。

 

**追问「既然 useRef 能绕开，那为什么不干脆所有 state 都配一个 ref」**：因为那样等于把 React 的数据流手动关掉，会引入一类更难查的 bug。三点判断依据。一是**ref 的写入时机没有保证**：如果你在渲染期间写 `ref.current = count`，这违反渲染必须是纯函数的约定，并发渲染下 React 可能丢弃这次渲染结果、或者在 `<StrictMode>` 下重复执行，ref 就被写成中间态；要写只能写在 effect 里，而 effect 在提交后才跑——于是在「渲染后、effect 前」这段窗口里 `ref.current` 是旧的，事件回调恰好落在这里就读到旧值。二是**ref 不参与依赖比较**，任何以它为输入的 memo、effect 都不会因为它变了而更新，你会得到「数据变了但界面/副作用没反应」，而这次连报错和 lint 提示都没有。三是**读写 ref 在渲染期间是被 React Compiler 明确列为违规的**（编译器遇到渲染期读 `.current` 会跳过这个组件不做优化，而且是静默跳过），所以这种写法还会悄悄让你失去自动 memo 化。正确的边界是：**能进依赖数组的用 state，「只是内部记账、界面不体现」的用 ref，「要读最新值但不想重建 effect」的用 `useEffectEvent`**。

# 面试 08 · React 机制层 > useCallback / useMemo / React.memo 三个各管什么

分工是清楚的：`useMemo` 缓存**值**，`useCallback` 缓存**函数引用**，`React.memo` 是**组件**层面的 props 浅比较（props 没变就跳过重渲染）。

 

关键是三者配套才有效。最常见的无效优化是**只包 memo 不管 props 引用**：

 

```jsx
const Row = React.memo(function Row({ item, onPick }) {
  return <li onClick={() => onPick(item.id)}>{item.name}</li>;
});

function List({ items }) {
  const [q, setQ] = useState('');
  // ❌ 每次渲染都是新函数 → Row 的 props 恒变 → memo 100% 失效
  const onPick = id => console.log(id);
  return <ul>{items.map(it => <Row key={it.id} item={it} onPick={onPick} />)}</ul>;
}
```

 

现象很好验证：打开 React DevTools 的 Profiler 勾上 Highlight updates，在搜索框里敲一个字符，一千个 `Row` 全部闪一遍。把 `onPick` 换成 `useCallback(id => console.log(id), [])` 之后就只闪输入框。**「包了 memo 但没稳定回调」是这题真正想筛的点**——它区分「照着文章包了一层」和「验证过有没有生效」。

 

什么时候真的需要，只有三种：

 

1. 传给 `React.memo` 组件的 props（对象、数组、函数）
2. 作为其他 hook 的依赖项——不缓存的话依赖每次都变，effect 无限重跑
3. 计算本身真的贵：几千条数据的排序过滤、正则批量处理、生成大 DOM 结构

 

除此之外加了是**负优化**：缓存要存旧值、要比较依赖数组，包一个只做加法的函数纯亏。而且它有隐藏成本——被缓存的闭包会把它捕获的变量一起留住，本该回收的大对象因此活得更久。

 

`React.memo` 还有一个必须知道的边界：它只做**浅比较**。props 里传对象字面量、数组字面量、或者 `children`（JSX 每次都是新 element），memo 直接失效。这就是为什么「包了 memo 还是重渲染」大部分时候不是 memo 的错。

 

**追问「React 19 的编译器改变了什么」**：方向上就是把 Vue 在编译期做的事补上——**React Compiler 1.0 稳定版 2025-10-07 发布**，它在构建时分析组件，自动插入等价于 `useMemo` / `useCallback` / `React.memo` 的缓存（编译产物里 import 的是 `react/compiler-runtime`；React 19 原生支持，17/18 要额外装 `react-compiler-runtime`）。所以手动 memo 会逐渐变成过渡期产物，但**现在还不能当它已经生效**，两点原因很实际：一是它对不符合 React 规则的组件会**静默跳过**——渲染期改 props、渲染期读 `ref.current`、条件调用 hook，都会让这个组件不被编译，你以为优化了其实没有，失败模式是「没有报错的性能回归」；二是落地路径要靠 lint 先扫，独立的 `eslint-plugin-react-compiler` 已并入 `eslint-plugin-react-hooks` v6+，先修完违规再开 `compilationMode: 'annotation'` 灰度，最后切 `'all'`，并在 DevTools 里确认组件带上了已编译标记。另外**编译器是增量的、和手写 memo 共存**，不需要先把老的 `useMemo` 删掉。

# 面试 08 · React 机制层 > useRef 有哪两种用途

两个用途完全不同，只是共用一个 API。

 

**一、拿 DOM 节点**：`<input ref={inputRef} />`，之后 `inputRef.current` 就是那个元素，用来 focus、量尺寸、调用 `play()` 这类命令式 API。

 

**二、存一个跨渲染保持不变、改了不触发重渲染的容器**：定时器 id、上一次的值、AbortController、以及第 4 题说的「绕开闭包陷阱」。

 

```jsx
function Search({ onResult }) {
  const abortRef = useRef(null);

  const run = async (q) => {
    abortRef.current?.abort();              // 取消上一次未完成的请求
    const ac = new AbortController();
    abortRef.current = ac;
    const r = await fetch(`/api/s?q=${encodeURIComponent(q)}`, { signal: ac.signal });
    onResult(await r.json());
  };

  return <input onChange={e => run(e.target.value)} />;
}
```

 

这里用 ref 而不是 state 的理由很硬：换 controller 这件事界面上不体现，用 state 会白触发一次重渲染，而且新的 controller 要到下次渲染才可见，取消逻辑会失效。

 

关键区别一句话：**改 state 触发重渲染，改 ref 不触发**。判断标准就是「这个值要不要在界面上体现」。搞错的现象非常典型——把该用 state 的东西放进 ref，改了 `ref.current` 然后疑惑为什么页面没变；更容易误判的是「界面确实变了」的假象：某个无关的 state 更新触发了重渲染，顺手把新的 `ref.current` 渲染出来了，于是这个 bug 时好时坏，取决于旁边有没有别的更新。

 

另外两个实践细节：

 

- `useRef(初始值)` 的初始值只在首次渲染生效，之后传什么都不再更新——所以 `useRef(props.value)` 拿不到后续的 `props.value`，得自己在 effect 里同步。
- 函数组件不能直接被 ref 指向。React 19 起可以把 `ref` 当普通 prop 直接传给函数组件（不再需要 `forwardRef` 包一层），但要暴露方法给父组件仍然用 `useImperativeHandle`——而且暴露命令式方法之前先想清楚能不能用 props 表达，能就别暴露。

 

**追问「怎么用 ref 拿到上一次渲染的 state，为什么能拿到」**：写法是在 effect 里滞后一拍地存——`const ref = useRef(undefined); useEffect(() => { ref.current = value; });` 然后返回 `ref.current`。能拿到的原因是**执行顺序**：组件函数体先跑（此时 `ref.current` 还是上一轮 effect 写进去的旧值，正好就是上一次的 state），渲染提交之后 effect 才把新值写进去。所以「读旧值、写新值」这个错位是被 React 的提交时机保证的，不是巧合。两个坑要一起说：第一，它返回的是**上一次渲染**的值，不是「上一次变化前」的值——如果组件因为别的 state 重渲染了一次，这个「上一个值」就会变成和当前值相同，用它做「值变了才执行」的判断会漏掉；要判断变化应该显式比较而不是依赖它。第二，**不能把这个 ref 用在渲染逻辑里做条件分支**，`useRef` 的写入不参与依赖比较，React 无法感知它变了，并发渲染下同一次渲染可能被丢弃重跑，读到的旧值就不再对应「上一次提交的 state」。要在渲染期用「上一个值」，官方模式是把它存成一个真 state（`if (value !== prevValue) setPrevValue(value)` 这种渲染期直接 setState 的写法，React 会立刻丢弃本次输出重跑，是文档明确允许的），而不是塞 ref。

 

## Hook 与状态（第 7-10 题）

# 面试 08 · React 机制层 > 受控组件和非受控组件的区别，表单怎么选

受控是把值交给 React state 管（`value={v}` + `onChange`），每次输入都触发一次渲染；非受控是让 DOM 自己保存值，需要时用 ref 读（`defaultValue` + `ref.current.value`）。

 

```jsx
// 受控：每敲一个字符，这个组件（及其未 memo 的子树）重渲染一次
<input value={v} onChange={e => setV(e.target.value)} />

// 非受控：输入过程 React 完全不参与，提交时才读
<input defaultValue={init} ref={ref} />
```

 

选择依据是**输入过程中要不要用到这个值**：需要实时校验、字段联动、输入时格式化（手机号加空格、金额加千分位）的用受控；纯提交型的大表单用非受控。分界线不是玄学，是可测的——几十个字段全受控时，每敲一个字符整个表单重渲染一次，字段里再有几个日期选择器或富文本，输入延迟能到几十毫秒，用户能感觉到「打字跟不上」。

 

实践上大表单一般用 `react-hook-form` 这类库：它内部走非受控 + 订阅，只重渲染真正订阅了那个字段的组件，这也是它比早期 Formik（全受控、状态提到顶层）快的直接原因。这个对比说出来比说「我用过 react-hook-form」有用得多。

 

三个必须知道的坑，都有明确现象：

 

- **传了 `value` 没传 `onChange`**：输入框变成只读，敲键盘没反应，控制台一条警告。因为 React 每次渲染都把值重置回 `value`。要做只读应该显式写 `readOnly`。
- **`value={undefined}` 让组件从受控退化成非受控**，之后再变回受控会有警告和意外行为。最常见的来源是后端返回 `null`：`value={data.name}` 在 `name` 为 `null` 时就出问题，所以接口数据进表单前要统一 `?? ''`。
- **受控组件里做「输入时格式化」会让光标跳到末尾**：因为你替换了整个 value，DOM 重设值后 selection 丢失。要保留光标位置得自己算偏移，或者改成失焦时格式化。

 

**追问「一个受控输入框，用户打字很卡，你怎么定位是哪一环慢」**：先分清是**渲染慢**还是**输入被同步阻塞**，两者的修法完全不同。用 DevTools Profiler 录一段打字过程：如果每个字符对应一次几十毫秒的 commit，看火焰图里最宽的那个组件——通常是整个表单或某个没 memo 的重组件跟着重渲染了，解法是把状态下沉到单个字段组件（或者上 `react-hook-form` 的订阅模式），而不是给输入框加防抖，防抖只是把卡顿延后并让 value 和显示脱节。如果 commit 很快但输入依然滞后，那是**同步任务挤在了输入事件里**：`onChange` 里直接跑了正则校验全文、`JSON.parse` 大对象、或者同步写 `localStorage`，Performance 面板里能看到 keydown 到 paint 之间一段长任务；这类要么挪出去（`useTransition` 把重活标成非紧急，见本文件第 13 题）要么真的做异步。判断依据是**看 keydown 到下一帧的间隔里，时间花在 React commit 还是在你自己的同步代码上**——只会说「加防抖」的人，在这一层就停住了。INP 的量化口径见 `01-frontend.md` 第 11 题。

# 面试 08 · React 机制层 > React 里 key 除了 diff 还有什么用

diff 用途和 Vue 一样：给同层元素一个稳定身份，让 React 知道「这条是移动了」而不是「这条被改成了别的内容」。用数组下标当 key 的经典事故也一样——列表头部插入一条，所有下标错位，React 认为每一项内容都变了，于是输入框里的值、展开状态、动画全乱掉。

 

React 里 key 多出来一层语义：**它决定组件实例是复用还是重建**。给同一个组件换 key，React 会卸载旧实例、创建新实例，内部 state、ref、effect 全部重置。这是官方推荐的「用 key 重置状态」模式：

 

```jsx
// 切换用户时，Profile 内部所有 state（草稿、展开项、滚动位置）自动归零
<Profile key={userId} userId={userId} />
```

 

对比手写重置：在 `useEffect` 里监听 `userId` 变化然后逐个 `setXxx(初始值)`。后者的失败现象很具体——**新增一个 state 时忘了加到重置列表里**，于是切换用户后那一个字段还留着上个用户的值，测试很难覆盖到，通常是用户先发现。`key` 的写法不存在这个漏项风险，因为它是整体重建。

 

代价要说清楚，不然会被追问穿：重建意味着子树的 DOM 全部销毁重造、effect 全部重跑（含重新发请求）、动画从头开始。如果这个组件很重（大表格、编辑器实例），换 key 会有一次明显卡顿，这时更合适的是保留实例、只重置真正需要重置的那几个 state。

 

Vue 里 `key` 同样能强制重建组件，只是社区更常见的写法是 `watch` 里手动重置——所以这个模式在两边都成立，`key` 那一套是更省心的一边。

 

**追问「什么时候用 index 当 key 是可以接受的，为什么」**：三个条件同时满足才行——列表**只追加不插入不删除不排序**、每一项**没有内部 state 也没有 DOM 状态**（没有输入框、没有展开/勾选、没有播放中的媒体）、并且列表项不做进出场动画。满足这三条时下标就是稳定身份，用它没有任何问题，反而省掉了造 id 的成本。判断依据是**「同一个下标在两次渲染之间会不会指向不同的数据」**：会，就不能用。这里还有个更隐蔽的坑值得主动说：**用 `Math.random()` 或 `Date.now()` 当 key 比用 index 更糟**——每次渲染 key 都变，等于每次都全量销毁重建，输入框会在打字过程中失焦，性能上比不写 key 还差；而 key 只需要在**同一个父节点的同层兄弟之间**唯一，不需要全局唯一，所以「怕重复所以用随机数」这个理由是站不住的。

# 面试 08 · React 机制层 > 状态管理怎么选，Context 的性能问题是什么

选型按「状态的性质」分，不按项目大小分。先把**服务端状态**（接口数据，有缓存、过期、重取语义）拆给 TanStack Query / SWR 一类的库管（见本文件第 17 题），剩下的纯客户端状态量通常少一大半，这时候：

 

| 方案 | 适用 | 主要代价 |
| --- | --- | --- |
| `useState` + 提层 / Context | 状态少、变化不频繁（主题、当前用户、i18n） | 没有细粒度订阅，见下 |
| Zustand / Jotai | 需要选择器订阅、不想要 boilerplate | 生态和调试工具不如 Redux 成熟 |
| Redux Toolkit | 团队大、要严格的规范和时间旅行调试 | 概念和样板最多 |

 

**Context 的核心问题是没有细粒度订阅**：Provider 的 `value` 一变，所有 `useContext` 这个 context 的组件全部重渲染，哪怕它只读了 `value` 里的一个字段。所以「把整个应用状态塞一个 Context」的结果是任何状态变化都全局重渲染。

 

现象很好复现也很好验证：把 `{ user, theme, cart }` 放同一个 Context，购物车加一件商品，DevTools Profiler 里只用了 `theme` 的顶栏、只用了 `user` 的侧边栏全部跟着 commit。列表页有几百个消费组件时，一次加购能卡掉几帧。

 

三条缓解手段，按成本排序：

 

1. **按变化频率拆 Context**。用户信息、主题几乎不变，和高频的表单/购物车状态分开，各自一个 Provider。这是零依赖的解，也是最有效的一步。
2. **`value` 用 `useMemo` 包住**。否则父组件每次渲染都生成新对象，等于每次都变——这是「明明状态没改但消费者全渲染了」的最常见原因。同理 `value` 里的函数要 `useCallback`。
3. **真需要细粒度就上支持选择器订阅的库**。Zustand 的 `useStore(s => s.cart.count)` 只在 `count` 变化时通知这个组件；Jotai 是原子级订阅。

 

一个常被忽略的替代方案：如果这个 Context 只是为了避免「层层传 props」，而值本身不怎么变，那**把 children 提出去当 props 传**（组合）往往就够了，不需要引入任何状态库。

 

**追问「和 Pinia 比呢」**：Pinia 的对应物最接近 Zustand——都是「定义一个 store，组件按需取」。真正的区别在底层：Vue 有响应式系统，从 store 取到的是响应式引用，读了哪个字段就订阅哪个字段，**细粒度是免费的**；React 没有依赖追踪，所以状态库必须自己解决「怎么只让用到这块数据的组件重渲染」，手段就是选择器 + `useSyncExternalStore`（React 18 提供的官方外部状态订阅接口，解决并发渲染下的读取撕裂问题）。**这也是 React 的状态方案比 Vue 多得多的原因**——它是个真问题，所以有很多解法；Pinia 在 Vue 里近乎唯一，因为响应式已经把难的部分做完了。顺着可以补一句判断依据：从 Vue 转过来的人最容易在这里踩的坑是**以为「取了 store 就只订阅了用到的字段」**，于是在 React 里直接 `const state = useStore()` 整体取出来解构——那等于订阅了整个 store，任何字段变化都重渲染，性能上比 Context 还差，因为 store 通常比 Context 更新更频繁。

# 面试 08 · React 机制层 > 自定义 Hook 怎么设计，有什么规则

规则是硬性的：只能在**函数组件或其他 Hook 的顶层**调用，不能放在条件、循环、`try/catch`、嵌套函数里。

 

原因在实现上：React 靠**调用顺序**把每次渲染的 hook 和它的状态对上——内部是一条链表，首次渲染按调用顺序建立节点，之后每次渲染按同样顺序取。条件调用会让顺序错位：

 

```jsx
function Bad({ show }) {
  if (show) {
    const [a, setA] = useState(0);   // ❌ show 从 true 变 false 时，这个节点消失
  }
  const [b, setB] = useState('');    // 于是 b 读到了原本属于 a 的节点
  // ...
}
```

 

现象是 `b` 突然变成数字 0，或者报「Rendered fewer hooks than expected」。这类 bug 的特征是**只在某个 prop 切换时出现**，首次加载完全正常，所以特别容易漏测。`eslint-plugin-react-hooks` 的 `rules-of-hooks` 能静态挡住绝大部分，项目里必须开。

 

设计上的几条经验，都有对应的失败场景：

 

- **一个 Hook 只管一件事**。`useUserPageEverything` 这种把请求、表单、弹窗状态全塞进去的 hook，复用时你会发现只想要其中三分之一，但拿不掉。
- **返回对象而不是数组**（只返回两个值时例外）。数组解构要求调用方记住顺序，字段一多必错，而且加字段只能往后加。`useState` 用数组是因为恰好两个且要自由命名。
- **Hook 内部自己清理副作用**，别指望调用方记得。这条是自定义 hook 最大的价值来源——把「建立 + 清理」封在一起，调用方不可能漏。
- **参数里别接对象字面量**。`useFetch({ url, headers: {} })` 的调用方每次渲染都传新对象，你在内部 `useEffect` 里依赖它就无限重跑。要么接原始值，要么在内部对关键字段做稳定化。

 

和 Vue 的 composable 是同一个设计思想（`useXxx` 命名、封装状态 + 副作用、组合优于继承），区别只是 React 有调用顺序这条硬约束，Vue 的 `setup` 只跑一次所以没有。

 

**追问「一个自定义 Hook 里的 state，被两个组件同时用，它们共享吗」**：不共享。每个调用它的组件都得到一份**独立的**状态副本——hook 是逻辑复用，不是状态复用。这一点是从 Vue 转过来最容易搞错的地方之一：Vue 里如果把 `ref` 写在 composable 的模块作用域（`setup` 外面），它就是全局单例、天然共享；写在 composable 内部则是每次调用独立。React 里没有这个区别，`useState` 永远绑在**调用它的那个组件实例**上。判断依据是**状态存在哪**：hook 内部的 `useState` → 存在组件的 fiber 上 → 组件级；要共享就必须把状态挪到组件之外——提到共同父组件、放 Context、放外部 store（Zustand 那类），或者服务端数据交给 TanStack Query（它按 query key 共享缓存，这也是「两个组件用同一个 `useUser(id)` 只发一个请求」的原因）。现象层面，搞错的表现是「A 组件登出了，B 组件还显示已登录」——两份独立状态，各自为政。

 

## 渲染与架构（第 11-14 题）

# 面试 08 · React 机制层 > useLayoutEffect 和 useEffect 什么区别

时机不同，只差一个「绘制」：`useEffect` 在浏览器**绘制之后**异步跑，`useLayoutEffect` 在 DOM 更新后、**绘制之前**同步跑（React 会阻塞绘制等它执行完，包括它里面的 setState 引发的重渲染）。

 

所以「读布局然后立即改」的场景必须用后者，典型是 tooltip / 下拉菜单定位：

 

```jsx
useLayoutEffect(() => {
  const { height } = tipRef.current.getBoundingClientRect();
  // 空间不够就翻到上方——这个修正必须在绘制前完成
  setPlacement(anchorBottom + height > innerHeight ? 'top' : 'bottom');
}, [anchorBottom]);
```

 

用 `useEffect` 写这段的现象很具体：菜单先在错误位置画一帧，然后跳到正确位置，视觉上闪一下。慢设备上能看到明显跳动，录屏逐帧看得很清楚。这就是判断该不该换的依据——**看到闪烁/跳动才换，没看到就别换**。

 

代价必须一起说：它是同步的、会阻塞绘制，里面做重活（遍历几百个节点量尺寸、跑复杂计算）直接掉帧，而且这种卡顿发生在首屏路径上，比 `useEffect` 里同样的重活更伤 LCP。所以默认用 `useEffect`。

 

SSR 那条也是常考点：**服务端没有 DOM 和布局，`useLayoutEffect` 在服务端不会执行，而且 React 会打一条警告**（"useLayoutEffect does nothing on the server"）。后果不只是警告——依赖它做的位置修正在服务端渲染的 HTML 里没生效，hydration 后才补上，用户会看到一次跳动。处理方式是把不依赖布局的初值算在渲染期、或者用 `useEffect` 做降级、或者在 SSR 环境下直接不渲染这个悬浮层。

 

**追问「useLayoutEffect 里 setState，会不会多渲染一次，用户看得见吗」**：会多渲染一次，但**用户看不见**——这正是它存在的意义。React 的顺序是：commit DOM → 同步执行所有 `useLayoutEffect` → 如果里面有 setState，立刻同步重新渲染并再次 commit → 才交给浏览器绘制。所以两次渲染的结果被合并成一帧，屏幕上只出现最终位置。判断依据是**用 Performance 面板看这一帧的时长**：正常情况下多出来的那次渲染是几毫秒，看不出；但如果这个组件很重，两次渲染都算在同一帧里，这一帧就可能超过 16ms 变成掉帧——现象是「打开菜单时整页顿一下」。真正需要避免的是**在 `useLayoutEffect` 里无条件 setState**（比如没加「值真的变了才 set」的判断），那会变成同步的无限循环，页面直接卡死、连报错都来不及打；`useEffect` 里犯同样的错还只是疯狂重渲染。所以里面的 setState 必须带条件，且要能说出「一帧内合并」这句话，否则面试官会认为你只是背了「一个同步一个异步」。

# 面试 08 · React 机制层 > 虚拟 DOM 和 Fiber 是什么关系

两者不是一层东西：虚拟 DOM 是**描述**，Fiber 是**执行这个描述的引擎**。

 

虚拟 DOM 是用 JS 对象描述 UI（`{ type: 'div', props: {...}, children: [...] }`）。它的好处不是「比手动操作 DOM 快」——手写精确的 DOM 操作永远更快——而是**让声明式编程成为可能**：你只描述结果，框架算出差异。React 的 element 树、Vue 的 vnode 树都是这个东西。

 

Fiber 是 React 16（2017）重写的**协调（reconciliation）引擎**。它把渲染工作拆成一个个小单元（每个组件对应一个 fiber 节点，用链表而不是递归组织），做完一个单元就检查有没有更高优先级的任务插队，因此渲染可以**中断、恢复、丢弃**。

 

它解决的问题有具体现象：老的递归 diff（Stack Reconciler）一旦开始就必须跑完，一棵几千节点的树 diff 要几百毫秒，这段时间主线程被占满——用户敲键盘没反应、点击没响应、动画卡住。Fiber 之后这类渲染会被切片，输入事件能插进来先处理。

 

由此才有并发特性：`useTransition`、`useDeferredValue`、`Suspense` 都建立在「渲染可中断」这个能力上，没有 Fiber 就没有它们（见本文件第 13 题）。

 

**Vue 没走这条路**，因为它有细粒度依赖追踪：一次更新影响的组件本来就少，不太需要把渲染切片——Vue 3 曾经实验过时间切片，最终没有保留在默认路径上。这个对比能显示你理解两种架构的取舍：**React 用可中断调度对冲「全量重跑」的代价，Vue 用精确依赖从源头减少工作量。**

 

**追问「Fiber 让渲染可以中断，那被中断的那次渲染里已经跑过的代码怎么办」**：这是并发渲染最容易被忽略的后果——**被丢弃的渲染，它的执行不会被回滚**。React 保证的是「不提交」，不是「没执行过」。所以中断安全的前提是**渲染阶段必须是纯的**：组件函数体里只能计算和返回 JSX，不能改外部变量、不能写 `ref.current`、不能发请求、不能 `console` 之外的副作用。违反了会出现一类极难复现的 bug：渲染被中断丢弃，但你在函数体里累加的计数器、push 进去的数组、写进 module 变量的缓存已经脏了，界面和这些副作用不一致。这也是 `<StrictMode>` 开发环境下**故意把组件函数跑两次**的原因——两次结果不一致就说明你的渲染不纯，它在帮你提前暴露。同理，副作用只能放在 effect（提交后才跑，不会被丢弃）或事件处理函数里。**能把「中断 = 丢弃但不回滚」和 StrictMode 双跑串起来的人，是真理解并发渲染的约束；只说得出「Fiber 可以中断」的，就停在名词层。**

# 面试 08 · React 机制层 > React 18 的并发特性有哪些，解决什么问题

先把定位说清楚：这些**不是性能优化手段，是优先级调度手段**。总耗时不变，只是让重要的先响应。这个区分能立刻显示你理解它，而不是把它当「让页面变快的开关」。

 

三个实用的：

 

**自动批处理**——所有场景的 setState 都批（不只是 React 事件里），见本文件第 2 题。这是唯一不用改代码就生效的。

 

**`useTransition`**——把一个状态更新标记为「非紧急」，它引发的渲染可以被更高优先级的输入打断：

 

```jsx
const [isPending, startTransition] = useTransition();

const onChange = (e) => {
  setQuery(e.target.value);                              // 紧急：输入框必须立刻响应
  startTransition(() => setFiltered(filter(e.target.value)));  // 非紧急：上千条结果慢点无所谓
};
```

 

`isPending` 顺带解决了「过渡期间给点反馈」的问题，比自己维护 loading 标记干净。

 

**`useDeferredValue`**——同样效果但作用在值上：`const deferredQuery = useDeferredValue(query)`，重列表用 `deferredQuery` 渲染。适合你拿不到 setter（值来自 props）或者懒得包 transition 的场景。

 

判断要不要用的现象很具体：**输入框打字时字符延迟出现、必须停手才追上**，而 Profiler 显示每次 keystroke 都触发了一次几十毫秒的重列表渲染。没有这个症状就别加——加了不会更快，只会多一层心智负担。反过来，如果卡的原因是「过滤函数本身跑了 200ms」，`useTransition` 也救不了，那是计算问题，该用 `useMemo` 缓存或者搬到 Web Worker。

 

`Suspense` 配合数据获取也是这一代的能力，React 19（2024-12）在此之上又加了 `useOptimistic`（乐观更新）、`useActionState` 和 `<form action>` 那套；截至 2026-09，React 19.2（2025-10）是当前稳定线，没有 React 20 的公开计划。

 

**追问「用了 useTransition，为什么打字还是卡」**：按三个方向查，全都是它的能力边界。**一是紧急更新本身太重**——`setQuery` 触发的重渲染里如果包含了整个页面（比如 query 存在顶层 Context，所有消费者都跟着渲染），那这部分是紧急的、不会被降级，transition 白包。判断依据是 Profiler 里看那次 keystroke 的 commit 里都有谁，如果重列表根本没在 transition 那一批里，说明你把状态放错了层。**二是长任务不可中断**——React 只能在 fiber 单元之间让出主线程，一个组件内部跑 200ms 的同步计算是切不开的，`useTransition` 对它无效；这类要么 `useMemo` 缓存、要么切 Web Worker、要么减少数据量。**三是同步 DOM 读写被塞进了渲染路径**——`useLayoutEffect` 里量尺寸、组件里读 `offsetHeight` 触发强制回流，这些都是同步的，不受调度管。所以正确的排查顺序是先用 Performance 面板确认「这一帧的时间花在 React 渲染、你的同步计算、还是布局回流」，再决定用哪个工具——**只知道「卡就包 startTransition」的人，在这一层就没有下一步了**。

# 面试 08 · React 机制层 > 长列表怎么优化

根本解和 Vue 一样是**虚拟滚动**：只渲染可视区 + 少量缓冲（overscan），DOM 节点数从几千降到几十。库选 `react-window`（轻；2.x 是 2025 年的整体重写，API 换成 `List` / `Grid` + `rowComponent`，自带行高自动测量和自动 memo 化——但它的 `rowKey` 是渲染期调用的，文档明确要求用 `useCallback` 传、不能写内联函数）或 `react-virtuoso` / TanStack Virtual（动态高度、分组、粘性头支持更完整）。动态高度的具体处理（先估高、渲染后测量再修正、滚动锚定）见 `01-frontend.md` 第 12 题。

 

在此之外几条是 React 特有的，因为它们的根因是「重跑组件函数」：

 

1. **列表项用 `React.memo` 包住，配合 `useCallback` 稳定传下去的回调**。不做这一步，父组件一次渲染，一千个列表项全部重渲染——即使包了 memo 也一样，因为箭头函数每次都是新引用（见本文件第 5 题）。
2. **key 用稳定 id**，不要用 index（见本文件第 8 题）。
3. **不在 render 里做过滤排序**，用 `useMemo` 缓存。写在函数体里等于每次渲染都重算，Vue 的 `computed` 有缓存所以从 Vue 转过来最容易漏这条。
4. **行内不要挂重组件**：每行一个日期选择器、一个 Tooltip Provider、一个 ECharts 实例，虚拟滚动也救不回来——快速滚动时每帧要创建销毁十几个重实例。

 

顺序很重要：**先虚拟滚动，再 memo**。DOM 节点数是主因，memo 是次因；反过来做的人会发现包了一堆 memo 但滚动还是卡。

 

**追问「怎么定位是哪个组件在重复渲染」**：用 React DevTools 的 Profiler，而且要说出具体操作路径，否则听起来像是背的。先在 Components 面板打开 **Highlight updates when components render**，做一次操作（敲一个字符、点一个按钮），屏幕上闪的边框直接告诉你哪些组件渲染了——一千个行全闪就是 memo 没生效。然后切 Profiler 面板录一段，火焰图里每个组件都能看到本次渲染耗时，点开右侧的 **"Why did this render?"** 会给出原因分类：props 变了（并且列出是哪个 prop）、state 变了、hook 变了、还是父组件渲染了。这一栏是关键——它区分「这个组件自己该渲染」和「它只是被父组件带着渲染」，后者才是 memo 能解决的。要看到 props 变化明细需要在 Profiler 设置里勾上记录「why did each Fiber render」。**必须强调「先测量再优化」**：没有 Profiler 数据就到处包 `memo`/`useCallback` 是最常见的错误做法，代价是代码变复杂、依赖数组变成新的 bug 来源，收益经常是零——因为真正的瓶颈往往在别处（一次 200ms 的同步计算、一个没做虚拟滚动的列表、或者接口本身慢）。补一句更硬的判断依据：**优化前后各录一次 Profiler，拿 commit 耗时和渲染组件数对比**，说不出这两个数变化的「优化」不算做完。

 

## 生态与迁移（第 15-19 题）

# 面试 08 · React 机制层 > 错误边界是什么，能捕获哪些错误

用 `getDerivedStateFromError` / `componentDidCatch` 的**类组件**包住一棵子树，子树渲染出错时显示兜底 UI 而不是整个应用白屏。注意这是目前唯一必须用类组件的场景——截至 React 19 仍然没有 hook 版本，所以实践中要么自己写一个类，要么直接用 `react-error-boundary` 这个库（它提供 `useErrorBoundary`、reset、`onError` 上报）。

 

```jsx
class Boundary extends React.Component {
  state = { err: null };
  static getDerivedStateFromError(err) { return { err }; }   // 渲染兜底 UI
  componentDidCatch(err, info) { report(err, info.componentStack); }  // 上报
  render() {
    if (this.state.err) return <p>这块加载失败 <button onClick={() => this.setState({ err: null })}>重试</button></p>;
    return this.props.children;
  }
}
```

 

**关键是它捕获不到什么**，这才是这题的判定点：

 

| 错误来源 | 错误边界能捕获 | 兜底手段 |
| --- | --- | --- |
| 渲染期、生命周期、构造函数抛错 | ✅ | — |
| 事件处理函数里抛错 | ❌ | `try/catch` |
| `setTimeout` / `Promise` / `async` 里抛错 | ❌ | `try/catch` + `window.onunhandledrejection` |
| 服务端渲染阶段的错误 | ❌ | 框架层处理（Next.js 的 `error.tsx`） |
| 事件监听器、`requestAnimationFrame` 回调 | ❌ | 全局 `window.onerror` |

 

原因统一：**这些代码不在 React 的渲染调用栈里**，React 无从拦截。现象上很好识别——一个按钮点击后接口报错，页面没白屏、错误边界没触发，控制台一条红字，用户看到的是「点了没反应」。这类必须自己 catch 并把错误塞进 state 才能显示出来。

 

实践上粒度不要只在根组件放一个，那样任何错误都是整页兜底。按路由 + 按功能区块放多层：一个图表挂了只有那块显示「加载失败，重试」，其余照常用。这也是唯一能把「局部故障」和「整站不可用」区分开的手段。

 

React 19（2024-12）在这块补了根级钩子——`createRoot(container, { onCaughtError, onUncaughtError, onRecoverableError })`，用来统一上报（`onRecoverableError` 专门给 hydration 不匹配这类 React 自己恢复了的错误）。它不显示兜底 UI，是上报通道，和错误边界配合用：边界负责界面，根钩子负责监控，注意两边都上报会重复计数。

 

Vue 里的对应物是 `errorCaptured` 钩子和 `app.config.errorHandler`，边界差不多——Vue 也捕不到异步回调里的错误。

 

**追问「错误边界触发之后，怎么让用户能恢复，而不是只看到一句『出错了』」**：光把 `err` 置回 `null` 通常没用——组件重新渲染时同样的 props 会再抛一次，用户点重试看到的还是错误页，这是最常见的半成品实现。要真能恢复得做三件事。**一是重置触发这次错误的输入**：如果错误来自「某个 id 查不到数据」，重试必须同时清掉那个 id 或者重新拉数据，`react-error-boundary` 的 `resetKeys` 就是干这个的——key 变了才重置，避免无脑重试死循环。**二是给边界换 `key`**（见本文件第 8 题）强制重建子树，因为出错组件里的 state 可能已经是坏的，只清边界自己的 state 不够。**三是区分「可重试」和「不可重试」**：网络超时、429 这类给重试按钮；代码 bug（`undefined.map`）重试一万次也是同样结果，正确做法是显示兜底内容 + 上报，并且埋一个降级路径（比如显示缓存的旧数据或者一个只读版本）。判断依据是**上报里带上 `componentStack` 和用户操作路径**，否则线上只能看到一堆「Something went wrong」不知道从哪来。**能说出「重试要连输入一起重置」的人，是真的线上做过这套；只写了 `setState({err:null})` 的，一问就露。**

# 面试 08 · React 机制层 > SSR 解决什么问题，Next.js 的渲染模式有哪几种

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/08-react.html#q16

SSR 解决两件事：**首屏速度**（HTML 直接带内容，不用等 JS 下载执行完才看到东西）和 **SEO**（爬虫能直接读到内容）。代价也是两件：服务器要有渲染能力和 Node 运行时成本，代码要考虑「这段能不能在服务端跑」——碰 `window` / `document` / `localStorage` 的地方全都要处理。

# 面试 08 · React 机制层 > SSR 解决什么问题，Next.js 的渲染模式有哪几种

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/08-react.html#q16

四种模式，按「HTML 什么时候生成」分：

# 面试 08 · React 机制层 > SSR 解决什么问题，Next.js 的渲染模式有哪几种

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/08-react.html#q16

前文：四种模式，按「HTML 什么时候生成」分：

| 模式 | HTML 生成时机 | 适合 | 代价 |
| --- | --- | --- | --- |
| SSG | 构建时 | 文档、营销页、博客 | 内容更新要重新构建 |
| ISR | 构建时 + 后台定期再生成 | 商品列表、有一定时效的内容 | 用户可能读到上一版（陈旧窗口） |
| SSR | 每次请求现渲染 | 个性化内容、要读 cookie 的页 | 每请求都有服务器开销，TTFB 受后端拖累 |
| CSR | 不生成（客户端渲染） | 登录后的中后台系统 | 首屏白屏时间长，SEO 为零 |

# 面试 08 · React 机制层 > SSR 解决什么问题，Next.js 的渲染模式有哪几种

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/08-react.html#q16

**中后台系统一般不需要 SSR**：要登录、不用 SEO、首屏多几百毫秒无感，上 SSR 只是增加复杂度和一个必须运维的 Node 层。能说出「我们那类系统不需要它」比会背四个缩写更能体现判断力——面试官问这题经常就是在看你会不会为了用新东西而用。

# 面试 08 · React 机制层 > SSR 解决什么问题，Next.js 的渲染模式有哪几种

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/08-react.html#q16

现状要补一句时效性：**Next.js 16（2025-10-21）把 PPR 收进了 Cache Components 模型**，`experimental.ppr` 这个标记已经移除，改成 `cacheComponents: true` + 在函数/组件里写 `"use cache"` 指令，缓存从「隐式规则」变成「显式声明」；同版本 Turbopack 转正为默认打包器、`middleware.ts` 改名 `proxy.ts`。PPR 的思路值得会讲：同一个页面里静态外壳先发出去，动态部分用 `Suspense` 包住流式补上，等于把「整页必须二选一」拆到了组件粒度。

# 面试 08 · React 机制层 > SSR 解决什么问题，Next.js 的渲染模式有哪几种

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/08-react.html#q16（连续片段 1/2，需结合相邻段阅读）

**追问「什么是 hydration，为什么会不匹配」**：服务端把组件渲染成 HTML 字符串发给浏览器，客户端 React 再跑一遍同样的组件树、把事件绑到这些已存在的 DOM 上并接管它们，这个过程叫 hydration。**不匹配（mismatch）就是两边渲染出的结构/文本不一致**，React 会报错并在这个子树上放弃复用、改成客户端重新渲染（React 19 起走 `onRecoverableError`）。常见原因是「服务端拿不到或算不出同一个值」：`Date.now()` / `new Date().toLocaleString()`（时区和毫秒都不同）、`Math.random()`、直接读 `localStorage` / `window.innerWidth`、根据 `navigator.userAgent` 分支、以及第三方脚本在 hydration 前改了 DOM。现象层面它不一定报错崩溃——**更常见的是一次可见的闪动或者布局跳一下**，然后一切正常，所以很容易被忽略，直到线上 CLS 指标变差才发现。修法按类型分：客户端专属的值放进 `useEffect` 后再 set（首屏先渲染一个稳定的默认值或骨架）、时间和格式化在服务端统一算好当 props 传下来、真正无法一致的节点用 `suppressHydrationWarning`（这是压警告不是修 bug，只该用在时间戳这类明知不同的叶子节点上）。

# 面试 08 · React 机制层 > SSR 解决什么问题，Next.js 的渲染模式有哪几种

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/08-react.html#q16（连续片段 2/2，需结合相邻段阅读）

**判断依据是「这个值在服务端和客户端是不是必然相同」**——凡是答案为「不一定」的，就不能出现在首屏渲染路径里。

# 面试 08 · React 机制层 > React 里怎么做数据请求，为什么现在推荐用库

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/08-react.html#q17

手写 `useEffect` + `useState` 要自己处理一串状态，而且每个页面都得写一遍：loading、error、**竞态**、重复请求、缓存、组件卸载后 setState 的警告。最容易漏的是竞态：

# 面试 08 · React 机制层 > React 里怎么做数据请求，为什么现在推荐用库

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/08-react.html#q17

前文：手写 `useEffect` + `useState` 要自己处理一串状态，而且每个页面都得写一遍：loading、error、**竞态**、重复请求、缓存、组件卸载后 setState 的警告。最容易漏的是竞态：

```jsx
// ❌ 快速切换筛选条件时，先发的请求后回来，界面显示旧数据
useEffect(() => {
  fetch(`/api/list?type=${type}`).then(r => r.json()).then(setData);
}, [type]);

// ✅ 用清理函数作废过期结果
useEffect(() => {
  const ac = new AbortController();
  fetch(`/api/list?type=${type}`, { signal: ac.signal })
    .then(r => r.json()).then(setData)
    .catch(e => { if (e.name !== 'AbortError') setError(e); });
  return () => ac.abort();
}, [type]);

```

# 面试 08 · React 机制层 > React 里怎么做数据请求，为什么现在推荐用库

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/08-react.html#q17

竞态的现象很具体也很难复现：连点三个筛选 tab，最终停在第三个上，但界面显示的是第一个的数据——因为第一个请求慢，回来得最晚，把 state 覆盖了。本地网络快时几乎撞不到，线上弱网用户天天撞。这也是为什么它经常带着上线。

# 面试 08 · React 机制层 > React 里怎么做数据请求，为什么现在推荐用库

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/08-react.html#q17

所以现在一般用 **TanStack Query（原 React Query）** 或 **SWR**：把「请求状态 + 缓存 + 失效重取 + 竞态处理 + 请求去重」封成一个 `useQuery`。选择依据很直接：要 mutation、分页/无限滚动、乐观更新、缓存调试的选 TanStack Query（v5，功能最全，13KB 左右）；只是读数据、想要最小依赖、Next.js 项目里选 SWR（约 4KB）；已经在 Redux Toolkit 上的用 RTK Query，别为它单独引 Redux。

# 面试 08 · React 机制层 > React 里怎么做数据请求，为什么现在推荐用库

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/08-react.html#q17

**真正能体现理解的是这句**：这类库本质上是把**服务端状态**和**客户端状态**分开管理。以前大家把接口数据也塞进 Redux，但服务端数据有缓存、过期、重取、多组件共享同一份这些特性，和「当前选中哪个 tab」这种纯客户端状态根本不是一类东西。拆开之后 Redux 里剩下的状态少一大半——很多项目拆完发现根本不需要 Redux 了（见本文件第 9 题）。AI 应用里流式响应的请求管理是另一套逻辑，见 `01-frontend.md` 第 13、16 题。

# 面试 08 · React 机制层 > React 里怎么做数据请求，为什么现在推荐用库

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/08-react.html#q17（连续片段 1/2，需结合相邻段阅读）

**追问「TanStack Query 的缓存什么时候会给你旧数据，怎么控制」**：核心是分清 `staleTime` 和 `gcTime`（v5 里 `cacheTime` 改名成了 `gcTime`）两个时间。**`staleTime` 决定「数据多久算新鲜」**，默认 `0`——意思是数据一拿到就立刻被标为 stale，于是组件重新挂载、窗口重新聚焦、网络重连时都会后台重取；重取期间**先把缓存里的旧数据渲染出来**（`data` 有值、`isFetching` 为 true），拿到新数据再替换。这就是「为什么我看到了旧数据」的答案，也是它体验好的原因：不闪白屏。**`gcTime` 决定「没人订阅之后缓存留多久」**，默认 5 分钟，到时间才真正回收；所以 5 分钟内回到这个页面是秒开的，超过就重新 loading。调参依据是**数据的容忍窗口**：几乎不变的字典/配置给 `staleTime: Infinity` 或几小时，看板类给几十秒，涉及钱和库存的给 `0` 并在关键操作后手动 `invalidateQueries` 精确失效。

# 面试 08 · React 机制层 > React 里怎么做数据请求，为什么现在推荐用库

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/08-react.html#q17（连续片段 2/2，需结合相邻段阅读）

两个常见坑要说出来：一是**把 `staleTime` 调大后「改完数据看不到更新」**——因为写操作后没有 invalidate，正确做法是 mutation 的 `onSuccess` 里失效相关 query key，而不是把 `staleTime` 调回 0；二是**query key 没把所有参数写全**（`['list']` 而不是 `['list', type, page]`），不同筛选条件共用一份缓存，切换时看到别的条件的数据——这个 bug 的表现和竞态很像，但根因完全不同。

# 面试 08 · React 机制层 > 从 Vue 转过来写 React，最容易犯哪些错

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/08-react.html#q18

这题是主动出牌的机会：说明你不只是「会」，而是知道自己的迁移风险在哪。按实际犯错频率排：

# 面试 08 · React 机制层 > 从 Vue 转过来写 React，最容易犯哪些错

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/08-react.html#q18

**一、直接改对象/数组。** Vue 里 `arr.push(x)` 就更新了，React 里必须 `setArr([...arr, x])`——改原数组引用没变，`Object.is` 判定没变，界面不动且不报错（见本文件第 1 题）。最阴的变体是深层改：`setUser({...user})` 但里面 `user.profile.name = x`，浅拷贝的顶层变了、profile 还是同一个引用，如果子组件被 memo 包着就不更新。

# 面试 08 · React 机制层 > 从 Vue 转过来写 React，最容易犯哪些错

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/08-react.html#q18

**二、以为 setState 是同步的。** 改完立刻读拿到旧值（见本文件第 2 题）。Vue 里 `nextTick` 的存在让人对「异步更新」有概念，但 Vue 的 `ref.value` 改完立刻读是新值，所以这个直觉带过来就错。

# 面试 08 · React 机制层 > 从 Vue 转过来写 React，最容易犯哪些错

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/08-react.html#q18

**三、依赖数组漏项。** 导致闭包陷阱，effect 里读到旧 state（见本文件第 3、4 题）。Vue 的 `watchEffect` 自动收集依赖，不存在「写依赖」这件事，所以从 Vue 过来的人第一反应是「依赖数组是给 React 看的形式主义」——它不是，它决定了闭包捕获哪一次渲染的值。

# 面试 08 · React 机制层 > 从 Vue 转过来写 React，最容易犯哪些错

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/08-react.html#q18

**四、把该 `useMemo` 的计算写在函数体里。** Vue 的 `computed` 有缓存，React 里函数体每次渲染都重跑，重计算写在里面就是每次都算。反过来也要小心：Vue 转过来的人一旦知道了这条，容易变成给所有东西包 `useMemo`，那是另一种错（见本文件第 5 题）。

# 面试 08 · React 机制层 > 从 Vue 转过来写 React，最容易犯哪些错

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/08-react.html#q18

**五、以为组件里的函数只创建一次。** 由此衍生出「为什么 memo 不生效」「为什么 effect 无限重跑」两类问题，根因都是「组件函数每次渲染都重跑」这一条没内化。

# 面试 08 · React 机制层 > 从 Vue 转过来写 React，最容易犯哪些错

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/08-react.html#q18

这么答的效果是把「我可能不够熟」转成了「我清楚这两个模型的差异在哪，所以知道该注意什么」。**面试官真正担心的不是你不会语法，是你会带着 Vue 的思维写出错的 React**——你先说出来，这个担心就消了。

# 面试 08 · React 机制层 > 从 Vue 转过来写 React，最容易犯哪些错

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/08-react.html#q18（连续片段 1/2，需结合相邻段阅读）

**追问「你说的这些坑，在你的代码里靠什么挡住，而不是靠记性」**：三层，全都是能立刻查证的工程手段。**一是 lint**：`eslint-plugin-react-hooks` 的 `rules-of-hooks` 和 `exhaustive-deps` 必须开成 error 而不是 warn——前者挡条件调用 hook，后者挡依赖漏项，这两条覆盖了上面第三类的绝大部分；独立的 `eslint-plugin-react-compiler` 已并入 `eslint-plugin-react-hooks` v6+，顺带能扫出渲染期改数据、渲染期读 `ref.current` 这类违反 React 规则的写法（也就是 React Compiler 会静默跳过的那些组件）。**二是类型层面挡住原地修改**：把状态类型写成 `readonly T[]` / `ReadonlyArray<T>`，或者上 Immer（`produce` 让你写「看起来在改」的代码但产出新对象），这样 `arr.push()` 直接是编译错误，把运行时的静默 bug 变成编译期报错——这是第一类坑唯一可靠的挡法。**三是开发环境的 `<StrictMode>` 常开**：它双跑 effect 和组件函数，把漏清理、渲染不纯这两类问题在本地就暴露出来（见本文件第 3、12 题）。剩下的靠 code review 兜底，重点看两处：`useEffect` 有没有 `return`，以及依赖数组里有没有对象字面量。

# 面试 08 · React 机制层 > 从 Vue 转过来写 React，最容易犯哪些错

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/08-react.html#q18（连续片段 2/2，需结合相邻段阅读）

**答这题的关键是别停在「我会注意」——「注意」不是工程手段，lint 规则、类型约束、StrictMode 才是。**

# 面试 08 · React 机制层 > 你简历上都是 Vue 项目，React 你实际写过多少

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/08-react.html#q19

这题一定会被问，而且它考的不是 React——是你会不会夸大，以及那些 React 知识是读来的还是练出来的。所以答法是「如实给量级 → 立刻转到能验证的地方」，顺序不能反。

# 面试 08 · React 机制层 > 你简历上都是 Vue 项目，React 你实际写过多少

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/08-react.html#q19

完整话术，量级换成你自己项目里的真实情况：

# 面试 08 · React 机制层 > 你简历上都是 Vue 项目，React 你实际写过多少

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/08-react.html#q19

> 「我的主要交付项目是 Vue，公司技术栈是这么定的。React 我写过，但都是小项目和自己的东西——换成你自己项目里的数：几个内部工具、一个自己维护的小站，没有大型生产项目的经验，这个差别我不含糊。
> 
>  
> 
> 不过 React 的模型我是搞清楚了的，而且很多坑是因为我熟 Vue 才特别敏感：比如闭包陷阱这类问题在 Vue 里根本不存在，因为 `setup` 只跑一次；反过来 React 需要手动 memo 的地方，Vue 3 在编译期就做了。你可以挑任何一个点往深里问。」

# 面试 08 · React 机制层 > 你简历上都是 Vue 项目，React 你实际写过多少

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/08-react.html#q19

为什么这是最优答法，三点：

# 面试 08 · React 机制层 > 你简历上都是 Vue 项目，React 你实际写过多少

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/08-react.html#q19

前文：为什么这是最优答法，三点：

1. **划清了「写过」和「有大型生产经验」的界限**，不给对方抓夸大的机会。面试官对量级的容忍度很高，对含糊其辞的容忍度极低。
2. **把双栈背景变成了优势**——懂两个框架差异的人比只懂一个的更能说明理解深度，这在 `06-narrative.md` 第 3 题（前端背景是优势还是短板）里是同一个逻辑。
3. **最后那句主动邀请深挖，是最强的可信度信号**，前提是这一章的题你真的能答。

# 面试 08 · React 机制层 > 你简历上都是 Vue 项目，React 你实际写过多少

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/08-react.html#q19

两个极端都别走：说「我 React 很熟」然后答不出清理函数的时机（本文件第 3 题），整场信任都没了，因为面试官会开始怀疑你别的答案；说「我不会 React」又白扔了你真有的知识，而且对方会直接判定岗位不匹配。**准确的自我描述本身就是能力信号**——能说清自己会到哪一层的人，通常也能说清系统的边界在哪。

# 面试 08 · React 机制层 > 你简历上都是 Vue 项目，React 你实际写过多少

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/08-react.html#q19

补一层能加分的：如果对方的栈是 React，主动说「上手期我预期是两周左右能到能独立交付功能的水平，前三周的 code review 麻烦盯紧我依赖数组和不可变更新这两处」。给出**具体的风险点和预期时间**比说「我学得快」有说服力，而且这两处正好是第 18 题列的高频错误，说明你不是随口编的。

# 面试 08 · React 机制层 > 你简历上都是 Vue 项目，React 你实际写过多少

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/08-react.html#q19（连续片段 1/2，需结合相邻段阅读）

**追问「你说 React 的模型你搞清楚了。那你写的最复杂的那个 React 东西，遇到过什么当时不理解、后来才想明白的问题」**：这一问是在验真——读来的知识答不出「当时不理解」，因为读文章不会产生困惑，只有跑不通的代码才会。答的时候不要编大项目，就用你真做过的小东西，但必须给出**具体的错误现象 + 当时的错误判断 + 最后的正确解释**这三段，比如：「一个轮询组件，本地测好的，改成可配置间隔之后发现改了间隔定时器不生效，我当时以为是 `setInterval` 的参数没更新，加了 `clearInterval` 重建还是不对；后来才明白是 effect 的依赖数组里没有 interval，effect 根本没重跑，闭包里的回调还在用旧值——就是闭包陷阱，只是当时不知道它叫这个名字。」这个形状为什么可信：**「不知道它叫这个名字」是练出来的人才会有的细节**，背过的人会先说名词。反过来，如果你答不出任何一个这样的故事，那上面那套「你可以挑任何一个点往深里问」的邀请就不要说——它会把追问引到你答不出的地方，比一开始就承认深度有限更糟。

# 面试 08 · React 机制层 > 你简历上都是 Vue 项目，React 你实际写过多少

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/08-react.html#q19（连续片段 2/2，需结合相邻段阅读）

所以准备这一章的正确顺序是：先把第 2、3、4、5 题练熟，再准备一个你自己真踩过的坑（换成你自己项目里的那个），最后才是背这题的措辞。

# 面试 08 · React 机制层 > React 中为什么必须用 setState 来改值

这题几乎总是拆成三步问：这段代码有问题吗 → 有什么问题 → 为什么。

 

```jsx
const [user, setUser] = useState({ name: '哲玄', age: 18 });

user.name = '哲玄前端';                        // ① 直接改：不会触发任何渲染
setUser({ ...user, ...{ name: '哲玄前端' } }); // ② 新对象：会触发渲染
setUser(user);                                 // ③ 同一个引用：不会触发（bailout）
```

 

**根本原因是 React 没有劫持数据，只劫持了「你告诉我要更新」这个动作。** Vue 3 用 Proxy 拦截 `set`，所以 `user.name = x` 本身就是通知；React 的 state 就是一个普通值，组件函数跑完它对这个值再没有任何拦截手段，唯一的通知渠道就是调用 setter。setter 做的是「把更新排进队列 + 标记这个 fiber 需要重渲」，不调用它，React 根本不知道有事发生。

 

第二层是 `Object.is` 浅比较。setter 拿到新值后跟当前值比一次，相等就走 bailout（跳过这次更新）。所以第 ③ 行不生效不是因为「值没变」，而是因为**引用没变**——你先前的 mutation 已经把新值写进了同一个对象，React 看到的两边是同一个引用，判定无事发生。注意 React 官方文档写明的一个细节：即使 bailout，React 仍可能把这个组件本身再渲染一次，但不会往子树下走，所以「完全不渲染」这个说法不准确。

 

顺带修正一个常见口径：上面第 ② 行**是会更新的**。展开运算符产生了新对象，引用变了，`Object.is` 不等，渲染照常发生。真正的问题在于它前面那行 mutation ——它让 bug 变成间歇性的：只要每次都顺手 new 一个对象，页面看起来一直是对的；直到某天有人写了 `setUser(user)`，或者某个 `React.memo` / `useMemo` 的依赖是这个对象，才突然不更新，而此时污染源已经离案发现场很远了。

 

**不可变还有三处硬性依赖，答出来就不只是背规则**：

 

1. `React.memo`、`useMemo`、`useEffect` 依赖数组全是逐项 `Object.is`。原地改属性 → 引用不变 → 这些比较全部判定「没变」→ 该跑的 effect 不跑，该重渲的子组件不渲。
2. 并发渲染下 React 可能中断一次渲染、稍后重来。渲染过程中读到的对象被别处原地改掉，同一次提交里的不同组件会读到不一致的值（tearing）。不可变数据天然免疫。
3. 撤销/重做、状态回放、Redux DevTools 的时间旅行，全部建立在「旧值还在」上。原地改就没有旧值了。

 

**追问「那 Vue 里我直接改就行，是不是 Vue 的设计更好」**：不是好坏，是两种代价。Vue 用 Proxy 换来了写法自由，代价是深层代理的建立成本（大对象、ECharts 实例这类要 `shallowRef` / `markRaw`，见 `07-vue.md` 第 4 题）、Proxy 与原对象 `!==` 带来的一类坑、以及依赖收集的运行时开销。React 把这份成本推给你手写不可变更新，换来的是渲染的确定性：给定同样的 props 和 state 输出就固定，才可能做并发渲染和中断重放。所以能加一句判断：**Vue 的响应式是「运行时精确追踪」，React 是「用不可变换取可预测」**，两边都不能只做一半——React 里原地改，等于两套心智都不占。

# 面试 08 · React 机制层 > useEffect 的第二个参数是干什么的，三种写法分别怎么跑

依赖数组决定的是**这个 effect 什么时候重新执行**，不是「什么时候执行」——首次挂载后一定会跑一次，三种写法只在后续更新时有区别。

 

```jsx
const [count, setCount] = useState(0);

useEffect(() => {
  console.log('执行 effect');
}, [count]);   // ① 传 [count]
               // ② 传 []
               // ③ 不传
```

 

- **① `[count]`**：挂载跑一次；之后每次渲染用 `Object.is` 逐项比对数组，`count` 变了才重跑。
- **② `[]`**：只在挂载跑一次，之后永不重跑。常见误用是把它当「只执行一次」的语法糖，但闭包也就此冻结在首次渲染——effect 里读到的 `count` 永远是 0（`08-react.md` 第 4 题的闭包陷阱）。
- **③ 不传**：**每次渲染后都跑**。这跟 `[]` 是两个极端，写漏一个空数组的后果通常是 effect 里发请求 → setState → 触发渲染 → effect 再跑，一个死循环，表现是接口被打成瀑布流。

 

三个必须一起说清的细节：

 

1. **清理函数在每次重跑之前先执行**，不是只在卸载时。所以 `[count]` 的 effect 里订阅了东西，count 每变一次就是「先退订旧的、再订新的」。
2. **比较是浅比较，逐项 `Object.is`**。依赖里放对象字面量、内联函数、`{...obj}` 的结果，每次渲染都是新引用，等价于不传依赖。这也是 `useCallback` / `useMemo` 真正的用途来源（第 5 题）。
3. **开发环境 StrictMode 下挂载时会「跑一次 → 清理 → 再跑一次」**，用来暴露没写清理函数的 effect。生产环境不会。看到 log 打两遍先别急着找 bug，这是设计。

 

**追问「lint 让我把 props.onChange 加进依赖，加了就死循环，怎么办」**：先别关 lint 规则——它报的是真依赖，关掉只是把 bug 藏起来。按原因分三种解法：**依赖是函数** → 让调用方用 `useCallback` 稳定它，或把函数塞进 `useRef` 后在 effect 里读 `ref.current`（适合「只想拿到最新回调、不想因此重跑」的场景，这也是 `useEffectEvent` 要解决的问题，该 API 已随 React 19.2 / 2025-10 转稳定）；**依赖是对象** → 只依赖你真正用到的那几个原始字段（`[user.id]` 而不是 `[user]`）；**依赖是你自己 setState 出来的值** → 说明这段逻辑本来就不该在 effect 里，应该在事件处理函数里做，或者用 `useMemo` 直接由 state 推导出来。**最后一条是这题的分水岭：绝大多数「effect 死循环」的正解是删掉这个 effect，而不是修依赖数组。**
