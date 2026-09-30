# 前端 > 框架原理：Vue 与 React > 资料说明

来源：https://fqx.lx.ci/frontend-map/

来源：https://fqx.lx.ci/frontend-map/

主线对齐 2026 年的实际工程状况：Vite 6+ / Vue 3.5+ / React 19 / TypeScript 5.7+。INP 已取代 FID，X-XSS-Protection 已废弃，涉及版本差异处单独标注。

# 前端 > 框架原理：Vue 与 React

来源：https://fqx.lx.ci/frontend-map/

一句话概括两者的根本分歧：**Vue 用响应式追踪精确知道什么变了，React 不追踪、靠重新执行组件函数再 diff**。所有其它差异——为什么 React 需要 memo、为什么 Vue 的 ref 要 .value、为什么 hooks 有依赖数组——都是这个选择的推论。

# 前端 > 框架原理：Vue 与 React > Vue 的响应式：Proxy 拦截 + 依赖收集

来源：https://fqx.lx.ci/frontend-map/

**Vue 3 用 `Proxy` 取代了 Vue 2 的 `Object.defineProperty`**，解决了三个具体问题：

| Vue 2 的限制 | Vue 3 |
|---|---|
| 新增属性不响应（要 `Vue.set`） | 自动响应 |
| 删除属性不响应（要 `Vue.delete`） | 自动响应 |
| 数组索引赋值 / `length` 不响应 | 自动响应 |
| 需要递归遍历整个对象初始化 | 惰性代理，访问到才递归 |

**核心机制是「依赖收集 + 触发更新」**：

```
读取（get）→ track()   → 把当前正在运行的 effect 记进这个属性的依赖集合
修改（set）→ trigger() → 取出依赖集合里的所有 effect，重新执行
```

极简实现能说明原理：

```js
let activeEffect = null;
const depsMap = new WeakMap();

function reactive(obj) {
  return new Proxy(obj, {
    get(t, k, r) {
      track(t, k);
      const v = Reflect.get(t, k, r);
      return typeof v === 'object' && v !== null ? reactive(v) : v;  // 惰性递归
    },
    set(t, k, v, r) {
      const old = t[k];
      const ok = Reflect.set(t, k, v, r);
      if (old !== v) trigger(t, k);
      return ok;
    }
  });
}

function effect(fn) {
  activeEffect = fn;
  fn();                 // 执行时会触发 get，从而收集依赖
  activeEffect = null;
}
```

**`ref` 为什么要 `.value`**：`Proxy` 只能代理对象，原始值（number/string）没法拦截。`ref` 把值包成 `{ value: x }` 这个对象再代理它。模板里自动解包是编译器做的，JS 里必须手写 `.value`。

**`reactive` 的三个坑**：

```js
const state = reactive({ count: 0 });

// 1. 解构丢响应性 —— 拿到的是普通值
const { count } = state;              // ✗
const { count } = toRefs(state);      // ✓

// 2. 整体替换丢响应性 —— 变量指向了新对象，旧代理还被模板引用着
let state = reactive({ a: 1 });
state = reactive({ a: 2 });           // ✗ 视图不更新
Object.assign(state, { a: 2 });       // ✓

// 3. 原始对象和代理不是同一个
const raw = { a: 1 };
const p = reactive(raw);
p === raw;                            // false，用 === 比较会踩坑
```

**`computed` 是带缓存的 effect**——依赖没变时不重算。`watch` 和 `watchEffect` 的差别：前者显式声明依赖、可拿到新旧值；后者自动收集、立即执行一次。

**Vue 3.4+ 的 `defineModel`、3.5 的 `useTemplateRef`** 是语法简化，不改变上面的模型。

# 前端 > 框架原理：Vue 与 React > 虚拟 DOM 与 diff：它的价值不是「快」

来源：https://fqx.lx.ci/frontend-map/

**先纠正一个常见误解**：虚拟 DOM **不比直接操作真实 DOM 快**。手写精确的 DOM 操作永远最快。虚拟 DOM 的价值是：

1. **可维护性**——你写「状态应该长什么样」，框架算出怎么变过去
2. **跨平台**——同一套渲染逻辑可以输出到 DOM / Native / Canvas / SSR 字符串
3. **批量化**——多次状态变更合并成一次 DOM 操作

**React 的 diff 三条启发式规则**（用 O(n) 换 O(n³) 的完整树 diff）：

1. **不同类型的元素 → 直接销毁重建**，不尝试复用
2. **同类型元素 → 复用 DOM，只更新变化的属性**
3. **列表靠 `key` 识别**，没 key 就按索引比较

**`key` 用索引的实际后果**：

```jsx
// 列表：[A, B, C]，用 index 做 key
{items.map((it, i) => <Input key={i} defaultValue={it} />)}

// 删掉 A 之后变成 [B, C]
// React 认为 key=0 的还在（内容从 A 变成 B），key=2 消失了
// → 复用了 DOM 但内容错位，输入框里的用户输入串到了别的行
```

**表现就是「删除一行后，输入框的内容对不上了」**。有内部状态的组件（输入框、展开状态、动画）用索引做 key 一定出问题。

**Vue 3 的编译时优化是它和 React 最大的性能差异来源**：

- **静态提升（hoistStatic）**——静态节点只创建一次，diff 时直接跳过
- **PatchFlag**——编译时标记「这个节点只有 class 会变」，运行时只对比 class
- **Block Tree**——把动态节点收集成扁平数组，diff 时不遍历整棵树

React 拿不到这些信息，因为 JSX 是运行时求值的表达式，编译器无法确定哪部分是静态的。**这就是为什么 React 需要 `memo` / `useMemo` 手工优化，Vue 大部分情况不需要。**

**React Compiler（原 React Forget）** 正在补这一课——自动插入 memo。但目前仍在推广期。

# 前端 > 框架原理：Vue 与 React > Hooks 的规则和陷阱

来源：https://fqx.lx.ci/frontend-map/

**为什么 hooks 不能写在条件语句里**：React 内部用**链表按调用顺序**存 hook 状态，没有名字。第一次渲染建立顺序，之后每次渲染必须完全一致，否则状态会错位。

```jsx
// ✗ 第二次渲染时 if 不成立，useState 少了一个，后面所有 hook 状态全部错位
if (cond) { const [a] = useState(1); }
const [b] = useState(2);
```

**陈旧闭包（stale closure）是 hooks 最常见的 bug**：

```jsx
function Counter() {
  const [n, setN] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setN(n + 1), 1000);   // ✗ n 永远是 0
    return () => clearInterval(t);
  }, []);                                              // 依赖数组空，闭包捕获初始 n
}
```

**三种修法**：

```jsx
setN(prev => prev + 1);        // ✓ 用函数式更新，不依赖外部 n
}, [n]);                        // ✓ 加进依赖（但会反复重建 interval）
const nRef = useRef(n);         // ✓ 用 ref 存最新值
```

**`useEffect` 的清理函数不是「组件卸载时执行」**——是**每次 effect 重新运行前**都执行，卸载时也执行。理解成「撤销上一次的副作用」。

**React 18 严格模式下 effect 会执行两次**（开发环境）。这是故意的，用来暴露没写清理函数的副作用。不要用 ref 加锁绕过——那是掩盖问题。

**`useMemo` / `useCallback` 不是免费的**：它们本身有内存和比较开销。判断标准：
- 传给 `memo` 包裹的子组件的对象/函数 → 需要
- 计算量确实大（大数组排序过滤） → 需要
- 依赖数组用在 `useEffect` 里 → 需要
- 普通的 `onClick={() => ...}` → **不需要**，包了反而更慢

**`useRef` 的两个用途**：存 DOM 引用、存「变了不需要重渲染」的可变值（定时器 id、上一次的值、是否首次渲染）。

**并发特性**（React 18+）：
- `useTransition` —— 标记非紧急更新，让输入保持流畅
- `useDeferredValue` —— 延迟一个值的更新
- `Suspense` —— 声明式的加载状态

它们的共同前提是**渲染可被中断**，所以副作用不能写在渲染函数里——组件函数可能被执行多次然后丢弃。

# 前端 > 框架原理：Vue 与 React > 状态管理：什么该进全局

来源：https://fqx.lx.ci/frontend-map/

**先问一句：这个状态真的需要全局吗？** 大部分「需要状态管理库」的场景其实是：
- 服务端数据缓存 → 用 **TanStack Query / SWR**，不是 Redux
- URL 相关状态（筛选、分页、tab） → 放 **URL query**，天然可分享可回退
- 表单状态 → 用 **react-hook-form / vee-validate**
- 只有父子传递 → **props 就够了**

**真正需要全局的**：登录用户信息、主题、权限、跨路由的购物车、WebSocket 连接状态。

**Pinia（Vue）**：

```js
export const useCart = defineStore('cart', () => {
  const items = ref([]);
  const total = computed(() => items.value.reduce((s, i) => s + i.price, 0));
  function add(item) { items.value.push(item); }
  return { items, total, add };
});
```

比 Vuex 好在：无 mutations（少一层样板）、TS 类型自动推导、没有嵌套模块的命名空间地狱。

**Zustand（React）**——现在比 Redux 更常见的选择：

```js
const useCart = create((set) => ({
  items: [],
  add: (item) => set((s) => ({ items: [...s.items, item] })),
}));
```

**Redux 的价值在可预测性**（时间旅行调试、中间件、严格的单向流），代价是样板代码。用 Redux Toolkit 能减少大半样板，但心智负担还在。**小项目上 Redux 是过度设计。**

**Context 的性能陷阱**：Context value 变化时，**所有消费该 context 的组件都重渲染**，不管它们用不用变的那部分。

```jsx
// ✗ 每次渲染都创建新对象 → 所有消费者重渲染
<Ctx.Provider value={{ user, setUser }}>

// ✓ 至少 memo 一下
const value = useMemo(() => ({ user, setUser }), [user]);
```

**更彻底的做法是拆 context**——把「变化频繁的值」和「稳定的 setter」分成两个 Provider。这也是为什么 Zustand 这类库用订阅而非 Context：它能做到「只有用到变化字段的组件才重渲染」。
