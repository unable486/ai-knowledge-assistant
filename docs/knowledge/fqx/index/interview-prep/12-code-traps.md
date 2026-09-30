# 面试 12 · 代码陷阱题 > 说明

代码陷阱题

答案默认折叠。先自己答一遍，再点开核对。每题末尾的**追问**是面试官顺着你的答案往下挖的那一层 —— 只答得出主问题、答不出追问，通常判定为「背过，没做过」。

- 🔴 必答 — 答不出直接掉档

- 🟡 加分 — 能拉开差距

- ⚪ 可以坦白不会 — 说清边界比硬编好

# 面试 12 · 代码陷阱题 > 这段代码 n() 输出什么，怎么调用才能输出 200

```js
globalThis.a = 100;
function fn() {
  return {
    a: 200,
    n: () => {
      console.log(this.a);
    }
  };
}
fn.call(fn()).n();   // 200
fn().n();            // 100
```

 

实测（CommonJS，非严格模式）：`fn.call(fn()).n()` 打印 **200**，`fn().n()` 打印 **100**。

 

原题写的是 `window.a = 100`，那只在浏览器里有 `window`；上面换成了 `globalThis` 好在 Node 里直接跑，语义一样。

 

关键在于**箭头函数的 `this` 在定义时就被外层词法作用域固定了，调用方式完全影响不到它**。`n` 是在 `fn` 的函数体里定义的，所以它的 `this` 就是「这一次 `fn` 执行时的 `this`」，之后无论怎么调 —— `obj.n()`、`n.call(x)`、`n.bind(y)()` —— 都改不了。

 

于是两次调用的差别全在 `fn` 自己是怎么被调用的：

 

| 调用 | `fn` 执行时的 this | 箭头函数捕获到 | 输出 |
| --- | --- | --- | --- |
| `fn().n()` | 非严格模式下是 `globalThis` | `globalThis` | `100` |
| `fn.call(fn()).n()` | `call` 的第一个参数，即里层 `fn()` 返回的 `{a:200,...}` | 那个对象 | `200` |

 

注意 `fn.call(fn())` 里的 `fn()` 被执行了两次：里层那次先跑，产出一个 `{a:200, n}` 对象当作外层的 `this`；外层再跑一次，产出**另一个**对象，我们调的是外层这个对象的 `n`，而它捕获的 `this` 正是里层那个对象。两个对象的 `a` 都是 200，所以巧合地看不出区别 —— 把里层改成 `fn.call({a: 999}).n()` 就会打印 999，此时对象自己的 `a: 200` 完全没被读到。这一点能主动说出来，比只报数字强一档。

 

想让它输出 200 有两条路：一是像上面那样用 `call`/`apply`/`bind` 把 `fn` 的 `this` 设成一个 `a` 为 200 的对象；二是把 `n` 改成普通方法（`n() { console.log(this.a) }`），这时 `this` 由调用点决定，`fn().n()` 的调用者是那个对象，直接打印 200。

 

**真实故障**：这个机制最常害人的地方是 Vue 2 的 `methods` 和对象字面量里的回调。`methods: { load: () => this.list = [] }` 写成箭头函数，`this` 捕获的是模块作用域而不是组件实例，运行时报 `Cannot set properties of undefined`；而同一个组件里 `setTimeout(() => this.loading = false)` 必须写箭头函数才对。同一个文件里两种写法一个必须用一个绝对不能用，靠背规则是记不住的，得理解「箭头函数没有自己的 this，它只是在读外层的那个变量」。

 

**追问「同样这段代码，放到 ESM 或者严格模式下跑，输出变成什么」**：`fn.call(fn()).n()` 仍然是 **200**，因为 `call` 显式传了对象，严格模式不影响它。但 `fn().n()` 变成抛错 —— 实测是 `TypeError: Cannot read properties of undefined (reading 'a')`。原因是严格模式下普通函数调用不再把 `this` 兜底成全局对象，`this` 就是 `undefined`，箭头函数捕获到 `undefined` 再读 `.a` 就炸。这里要说清两件容易混的事：**一是 ESM 的顶层 `this` 是 `undefined`，而 CommonJS 的顶层 `this` 是 `module.exports`（实测 `this === module.exports` 为 `true`）**，所以同一份代码从 `.js` 改名成 `.mjs` 就可能从「打印 100」变成「抛错」；二是 `globalThis.a = 100` 这句在两种模式下都成功了，问题不在赋值端而在读取端 —— 全局变量还在，只是没人再把 `this` 指向全局对象。工程含义是：`.mjs`、`<script type="module">`、以及所有被打包器当 ESM 处理的 `.vue`/`.ts` 文件都默认严格模式，那种「本地跑好好的，上了构建就 undefined」的怪问题，一半出在这里。

# 面试 12 · 代码陷阱题 > AI 写的 isEmpty 判空，Symbol 键会返回 true 还是 false

```js
function isEmpty(o) {
  return Object.keys(o).length === 0;
}
console.log(isEmpty({ [Symbol('a')]: 1 }));   // true
```

 

实测输出 **true** —— 对象里明明有一个属性，函数说它是空的。

 

原因是 `Object.keys` 的定义就只返回**自身的、可枚举的、字符串键**。Symbol 键不在其中，这不是 bug 而是规范：Symbol 被设计成「不会被常规枚举意外撞见的键」，所以 `Object.keys`、`for...in`、`JSON.stringify` 全部跳过它。取 Symbol 键要用另外两个 API，实测对比：

 

```js
const s = Symbol('a');
const o = { [s]: 1, b: 2 };
Object.keys(o);                    // ["b"]
Object.getOwnPropertySymbols(o);   // [Symbol(a)]
Reflect.ownKeys(o);                // ["b", Symbol(a)]   ← 字符串键 + Symbol 键都要
JSON.stringify(o);                 // '{"b":2}'          ← Symbol 键被静默丢掉
Object.getOwnPropertySymbols({ ...o });  // [Symbol(a)]  ← 但展开运算符会带过去
```

 

`JSON.stringify` 丢 Symbol、展开运算符保留 Symbol，这一对不一致是很多「数据传到后端就少了一块」的来源。

 

Symbol 只是这个实现最戏剧化的漏洞。我把七种输入全跑了一遍，其中五种的行为是明确错的：

 

| 输入 | 返回 | 应该是 | 为什么 |
| --- | --- | --- | --- |
| `{ [Symbol('a')]: 1 }` | `true` | `false` | `Object.keys` 不枚举 Symbol 键 |
| `new Map([['a', 1]])` | `true` | `false` | Map 的数据在内部槽里，`Object.keys` 得到 `[]` |
| `new Set([1])` | `true` | `false` | 同上，要看 `.size` |
| 不可枚举属性的对象 | `true` | `false` | `enumerable: false` 被跳过 |
| `'ab'` | `false` | `false`（但巧合） | `Object.keys('ab')` 是 `["0","1"]`，靠索引凑对了 |
| `0` / `false` | `true` | 看语义 | 原始值被装箱成没有自有键的包装对象 |
| `null` / `undefined` | **抛错** | `true` | `TypeError: Cannot convert undefined or null to object` |

 

`null` 那条是线上最容易炸的：判空函数本身在空值上抛异常，而调用方通常写成 `if (isEmpty(res.data))`，接口返回 `null` 时整个渲染流程挂掉。

 

所以我会让它改，改法是**按类型分派**，不要指望一个 `Object.keys` 覆盖所有输入。下面这版在 19 组用例上实测全通过：

 

```js
function isEmpty(v) {
  if (v == null) return true;                                  // null / undefined
  if (typeof v === 'string' || Array.isArray(v)) return v.length === 0;
  if (v instanceof Map || v instanceof Set) return v.size === 0;
  if (v instanceof Date) return false;
  if (typeof v === 'object') return Reflect.ownKeys(v).length === 0;
  return false;                                                // number / boolean / function
}
```

 

更重要的是**这题真正的答案不是写一个更全的 isEmpty，而是拒绝写通用 isEmpty**。「空」是业务概念不是语言概念：搜索框里 `' '` 该算空，表单里 `0` 不该算空，列表接口里 `null` 和 `[]` 都算空。lodash 的取舍和上面这版就不一样 —— 我实测 `_.isEmpty(0)`、`_.isEmpty(true)`、`_.isEmpty(new Date())` 全部返回 `true`（它的规则是「非集合类型一律算空」），而 `_.isEmpty({[Symbol('a')]:1})` 也返回 `true`（它同样不看 Symbol 键）。这些都是合理的库设计，但未必是你要的语义。用在哪就写在哪，函数名带上业务含义（`isBlankQuery`、`hasNoRows`），比一个万能判空安全得多。

 

**追问「你换成 Reflect.ownKeys 了，那我传一个 class 实例进来，字段全在原型上，你返回什么，对吗」**：返回 `true`，而且这个行为**是对的，但必须是你主动选的**。实测 `Reflect.ownKeys(Object.create({ a: 1 })).length === 0`，因为 `ownKeys` 顾名思义只看自有键，原型链上的东西一概不看。这里的判断依据是：**继承来的属性通常是方法和默认值，不是「数据」**，把它们算进「非空」会让每个 class 实例都永远非空 —— 一个 `new UserDTO()` 什么都没填也被判定有内容，比漏判更糟。真要连原型一起看，你得先回答「原型上的 `constructor`、getter、方法算不算内容」，一旦开始讨论这个就说明抽象错了。顺带一个容易搞混的点：`Object.getOwnPropertySymbols` 也只看自有 Symbol 键，所以 `class A { get [Symbol.toStringTag]() {...} }` 的实例上实测返回 `0` 个 Symbol —— 那个 Symbol 键在 `A.prototype` 上。**能说出「own 和 inherited 的边界是我选的，理由是数据和行为要分开」，比背出 `Reflect.ownKeys` 这个 API 名字重要得多**（同一个思路 —— 「格式合法不等于业务有效，校验要放在业务边界上」—— 在 `04-ai.md` 第 2 题里是同一道题的另一种问法）。

# 面试 12 · 代码陷阱题 > await 一个 Proxy，为什么会打印 then

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/12-code-traps.html#q3

```js
async function fn() {
  return new Proxy({}, {
    get(target, key) {
      console.log(key);
    }
  });
}
(async function () {
  await fn();
})();

```

# 面试 12 · 代码陷阱题 > await 一个 Proxy，为什么会打印 then

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/12-code-traps.html#q3

实测输出一行 **`then`**，并且**只打印一次**（我在 `get` 里计数验证过，`then` 被读取 1 次）。

# 面试 12 · 代码陷阱题 > await 一个 Proxy，为什么会打印 then

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/12-code-traps.html#q3

打印的来源是 **thenable 检测**。`await x` 和 `Promise.resolve(x)` 都不能假设 `x` 是 Promise，规范要求它们先做一件事：把 `x` 的 `then` 属性读出来，看它是不是函数。是函数就当成 thenable，调用 `x.then(resolve, reject)` 接管后续；不是函数就当普通值直接兑现。而这次「读 `then` 属性」的动作，恰好命中了 Proxy 的 `get` 拦截器 —— 拦截器打印了键名，然后返回 `undefined`，于是 await 判定它不是 thenable，把整个 Proxy 当普通值返回。

# 面试 12 · 代码陷阱题 > await 一个 Proxy，为什么会打印 then

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/12-code-traps.html#q3

两条路都会触发这次读取，所以这题换个写法输出不变：

# 面试 12 · 代码陷阱题 > await 一个 Proxy，为什么会打印 then

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/12-code-traps.html#q3

前文：两条路都会触发这次读取，所以这题换个写法输出不变：

```js
// A：async 函数 return 对象 —— async 的返回值要 resolve，走 thenable 检测
async function f1() { return proxy; }
await f1();          // 打印 then

// B：直接 await 一个对象 —— await 自己也走 thenable 检测
await proxy;         // 同样打印 then

```

# 面试 12 · 代码陷阱题 > await 一个 Proxy，为什么会打印 then

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/12-code-traps.html#q3

**真实故障是 thenable 劫持**：任何对象只要有一个叫 `then` 的方法，就会被 await 当成 Promise，而对象本身再也拿不到。实测：

# 面试 12 · 代码陷阱题 > await 一个 Proxy，为什么会打印 then

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/12-code-traps.html#q3

前文：**真实故障是 thenable 劫持**：任何对象只要有一个叫 `then` 的方法，就会被 await 当成 Promise，而对象本身再也拿不到。实测：

```js
const user = { name: 'kim', then(resolve) { resolve('NOT THE OBJECT'); } };
await user;                  // 'NOT THE OBJECT'，不是 user
await Promise.all([user]);   // ['NOT THE OBJECT']
await Promise.resolve(user); // 'NOT THE OBJECT'

```

# 面试 12 · 代码陷阱题 > await 一个 Proxy，为什么会打印 then

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/12-code-traps.html#q3

这个坑在两类代码里真的会撞上：一是 ORM / 查询构造器（`knex`、`prisma` 的 builder 就是故意实现 `then` 来支持 `await query`），你把它当普通对象存进缓存或者塞进 `Promise.all`，拿回来的是查询结果而不是 builder；二是**从 LLM 拿到的结构化输出直接反序列化成对象**，如果模型吐出的 JSON 里有个字段叫 `then`，`JSON.parse` 出来是字符串不是函数，暂时安全；但一旦你的代码给它挂了方法（比如用 `Object.assign` 合了一个带 `then` 的默认对象），`await` 这个数据对象就会静默变形。判断依据很简单：**`then` 在 JS 里是保留语义的字段名，业务对象不要用它**。

# 面试 12 · 代码陷阱题 > await 一个 Proxy，为什么会打印 then

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/12-code-traps.html#q3（连续片段 1/2，需结合相邻段阅读）

**追问「如果那个 get 拦截器返回的是一个函数，会发生什么」**：`await` 会**永久挂起**，而且**不报错**。实测过程是这样的：`get` 返回函数 → thenable 检测通过 → 引擎调用 `proxy.then(resolve, reject)` → 那个函数体里既没调 `resolve` 也没调 `reject` → 这个 Promise 永远处于 pending。关键在后果：Node 里事件循环发现没有待处理任务就直接退出，**进程退出码是 0**，`await` 后面的代码一行没执行，也没有任何 unhandled rejection 警告 —— 我实测那个脚本，打印了 `then() called`，然后干净地退出，什么错都没报。在服务端这就是「接口挂住直到网关超时，日志里一片空白」，最难查的那类故障。所以判断依据是**永不 settle 的 Promise 不是异常而是静默失败**，防御手段只有两条：给所有外部驱动的 await 套 `Promise.race` + 超时（`AbortController` 更好，能真的取消底层请求），以及在服务入口设置请求级超时兜底，别指望 try/catch —— 它捕获不到「什么都没发生」。另一种可能是 `get` 直接抛错，那反而是好事：实测 `await` 会以那个错误 reject，try/catch 能抓到（`Error: boom on then`）。

# 面试 12 · 代码陷阱题 > await 一个 Proxy，为什么会打印 then

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/12-code-traps.html#q3（连续片段 2/2，需结合相邻段阅读）

**抛错比挂住好一百倍，能说出这个判断，说明你处理过线上超时**（超时与取消的完整做法见 `05-design-coding.md` 第 6 题）。

# 面试 12 · 代码陷阱题 > 这两段改对象的代码分别输出什么

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/12-code-traps.html#q4

```js
function fn1(obj) { obj = { m: 50 }; console.log(obj.m); }
const o1 = { m: 30 }; fn1(o1); console.log(o1.m);

function fn2(obj) { obj.m = 50; console.log(obj.m); }
const o2 = { m: 30 }; fn2(o2); console.log(o2.m);

```

# 面试 12 · 代码陷阱题 > 这两段改对象的代码分别输出什么

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/12-code-traps.html#q4

实测输出依次是 **50 / 30**，然后 **50 / 50**。

# 面试 12 · 代码陷阱题 > 这两段改对象的代码分别输出什么

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/12-code-traps.html#q4

差别只有一处：`fn1` 里是 `obj = ...`（给参数变量重新赋值），`fn2` 里是 `obj.m = ...`（改参数指向的那个对象的属性）。

# 面试 12 · 代码陷阱题 > 这两段改对象的代码分别输出什么

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/12-code-traps.html#q4

**JS 只有按值传递，没有按引用传递。** 传对象时，「值」是那个引用本身（一个地址），函数拿到的是这个地址的**拷贝**。于是：

# 面试 12 · 代码陷阱题 > 这两段改对象的代码分别输出什么

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/12-code-traps.html#q4

前文：**JS 只有按值传递，没有按引用传递。** 传对象时，「值」是那个引用本身（一个地址），函数拿到的是这个地址的**拷贝**。于是：

- `obj = { m: 50 }` 只是让局部的 `obj` 这个副本指向一个新对象，调用方的 `o1` 还指着原来那个 —— 所以外面是 30
- `obj.m = 50` 是顺着地址找到堆上那个对象改它的属性，两个变量指向同一个对象 —— 所以外面也是 50

# 面试 12 · 代码陷阱题 > 这两段改对象的代码分别输出什么

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/12-code-traps.html#q4

「JS 对象是引用传递」这个说法必须点破：如果真是引用传递（像 C++ 的 `&`），`fn1` 里的重新赋值就应该影响外面的 `o1`。它没有，所以只能是「传了引用的值」。准确的叫法是 **call by sharing**（共享传递）。这不是抠字眼 —— 说错这个词的人通常预测不了 `fn1` 的输出。

# 面试 12 · 代码陷阱题 > 这两段改对象的代码分别输出什么

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/12-code-traps.html#q4

**真实故障是入参被静默改坏**。`fn2` 那种写法在工具函数里非常常见：

# 面试 12 · 代码陷阱题 > 这两段改对象的代码分别输出什么

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/12-code-traps.html#q4

前文：**真实故障是入参被静默改坏**。`fn2` 那种写法在工具函数里非常常见：

```js
// 看起来像纯函数，其实改了调用方的数据
function normalize(user) {
  user.name = user.name.trim();
  return user;
}

```

# 面试 12 · 代码陷阱题 > 这两段改对象的代码分别输出什么

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/12-code-traps.html#q4

调用方看到 `return user` 会以为拿到的是新对象，把原对象也当成没变过继续用（比如留着做「取消编辑时回滚」的原始副本），结果原始副本早就被改了。这类 bug 的症状是「点取消之后表单没恢复」，查起来要翻好几层调用。

# 面试 12 · 代码陷阱题 > 这两段改对象的代码分别输出什么

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/12-code-traps.html#q4

安全的写法只有两条路，二选一并且写进函数名和文档：

# 面试 12 · 代码陷阱题 > 这两段改对象的代码分别输出什么

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/12-code-traps.html#q4

前文：安全的写法只有两条路，二选一并且写进函数名和文档：

```js
// 路线 A：返回新对象，绝不碰入参（推荐）
const normalize = (user) => ({ ...user, name: user.name.trim() });

// 路线 B：明确声明会原地改，函数名用动词表达副作用
function mutateNormalizeInPlace(user) { user.name = user.name.trim(); }

```

# 面试 12 · 代码陷阱题 > 这两段改对象的代码分别输出什么

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/12-code-traps.html#q4

选 A 时要注意**展开是浅拷贝**，实测 `{ ...src }` 之后改 `copy.nested.b`，`src.nested.b` 也变成了 999；要隔离深层得用 `structuredClone`（Node 17.0 起是全局函数，浏览器侧 Chrome 98 / Firefox 94 / Safari 15.4，Baseline 2022；核实于 2026-09）——实测同样的输入用它拷贝后改副本，`src.nested.b` 仍是 2。它比 `JSON.parse(JSON.stringify(x))` 强的地方我也实测了：`Date`、`Map`、`Set` 的类型都保住了，循环引用也能正确复制（`clone.self === clone`）；代价是遇到函数会抛 `DOMException: ... could not be cloned`。

# 面试 12 · 代码陷阱题 > 这两段改对象的代码分别输出什么

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/12-code-traps.html#q4

这直接对上 React 的不可变要求：`setState` 靠 `Object.is` 比较新旧引用决定要不要重渲染，你原地 `state.list.push(x)` 再 `setList(state.list)`，引用没变，**React 直接跳过这次渲染，界面停在旧数据上而且不报错** —— 我在 React 19.2.8 上实测过这个现象，见第 5 题那张表。Vue 相反 —— 它的 Proxy 拦截了属性写入，原地改是能触发更新的。所以同一个「原地修改」的动作，在 Vue 里是常规操作，在 React 里是 bug。从 Vue 转 React 的人最容易在这里翻车（React 侧的完整表现见 `08-react.md` 第 2 题）。

# 面试 12 · 代码陷阱题 > 这两段改对象的代码分别输出什么

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/12-code-traps.html#q4（连续片段 1/2，需结合相邻段阅读）

**追问「Object.freeze 一个对象，然后在函数里改它的属性，会发生什么」**：**取决于严格模式，而且两种结果都很危险**。实测：非严格模式（CommonJS 的 `.js` 文件）下写入**静默失败**，不抛错、不警告，`frozen.m` 仍然是 30 —— 你的代码「改了」但没生效，后面所有基于这个值的逻辑都错，而日志里什么都没有。ESM 或 `'use strict'` 下同样一行代码抛 `TypeError: Cannot assign to read only property 'm' of object`。判断依据是：**冻结不是一种防御手段，它是一种把 bug 从「数据被改坏」转移到「写入被忽略」的手段**，只有在严格模式下抛错时才真的有防御价值。工程上的用法是**只在开发环境冻结**（`if (import.meta.env.DEV) Object.freeze(config)`），让违规在开发期就炸出来，生产环境不冻结以免多一层检查开销和意外抛错。另外 `freeze` 是浅的：实测 `Object.freeze({ nested: {} })` 之后 `obj.nested.x = 1` 完全成功（`Object.isFrozen(obj)` 为 `true` 但 `Object.isFrozen(obj.nested)` 为 `false`），要深冻结得自己递归。

# 面试 12 · 代码陷阱题 > 这两段改对象的代码分别输出什么

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/12-code-traps.html#q4（连续片段 2/2，需结合相邻段阅读）

这也解释了为什么 React 团队选择「文档约定 + Immer 不可变库」而不是「冻结 state」—— 浅冻结挡不住嵌套修改，深冻结在大对象上的成本又不可接受。

# 面试 12 · 代码陷阱题 > AI 用 list.length = 0 清空数组，你会让它改吗

不改。`list.length = 0` 是合法、正确、性能也不差的清空方式 —— `length` 是数组上可写的自有属性（实测描述符 `{writable: true, enumerable: false, configurable: false}`），把它设小会截断数组，多出来的元素连索引一起被删掉。

 

这题真正在问的是另一件事：**你清空的是「那个数组」还是「那个变量」**。这两者的区别决定了别处持有同一引用的代码会不会看到变化。实测：

 

```js
let list = [1, 2, 3, 4, 5];
const alias = list;
list.length = 0;
// list [] · alias [] · alias === list → true    原地修改，所有持有者都看到

let list2 = [1, 2, 3, 4, 5];
const alias2 = list2;
list2 = [];
// list2 [] · alias2 [1,2,3,4,5] · 引用已不同    换引用，别人还拿着旧数组

let list3 = [1, 2, 3, 4, 5];
const alias3 = list3;
const removed = list3.splice(0);
// list3 [] · alias3 [] · removed [1,2,3,4,5]    原地修改，还能拿到被删的元素
```

 

`splice(0)` 和 `length = 0` 在可见性上等价，唯一区别是 `splice` 返回被移除的元素 —— 需要「清空并对旧数据做点什么」（比如取消这些行上的请求）时用它。

 

**框架层的后果是这题的分水岭，我把每种组合都实测了** —— Vue 侧用 `@vue/reactivity` 数 effect 重跑次数（不含初始那次），React 侧用 React 19.2.8 + jsdom 数组件函数执行次数：

 

| 写法 | Vue `reactive` / `ref` | Vue `shallowRef` | React `useState` |
| --- | --- | --- | --- |
| `list.length = 0` 后通知 | 触发更新（+1 次） | **不触发**（+0 次） | **不触发**（+0 次） |
| `list.splice(0)` 后通知 | 触发更新（+1 次） | 不触发 | **不触发**（+0 次） |
| 整体替换成 `[]` | 触发更新（+1 次） | 触发（+1 次） | 触发（+1 次） |

 

React 那一列尤其值得看现象：`list.length = 0; setList(list)` 之后数组真的空了，但组件一次都没重跑，**DOM 里还显示着 `3`**。`setList([])` 之后立刻变成 `0`。

 

所以同一行 `list.length = 0`：在 Vue 的 `reactive`/`ref` 里是标准做法（Proxy 拦截了 `length` 的写入）；在 `shallowRef` 里静默失效；在 React 里也静默失效，因为 `Object.is(oldRef, newRef)` 为真，React 判定没变化直接跳过渲染。**症状完全一样：数据确实清空了，页面没反应，不报错。**

 

还有一个只在 Vue 里出现的坑：把 `reactive` 数组赋给一个 `let` 再整体替换，实测 effect 重跑 **0 次** —— 变量指向了普通数组，Proxy 被丢掉，从此这个变量再也不响应（`07-vue.md` 第 4 题有完整展开）。

 

顺带说，源代码里那个 `console.log(arr)` 是笔误：`arr` 从未声明，实测直接抛 `ReferenceError: arr is not defined`。面试里看到这种明显的未定义变量要主动指出来 —— 面试官经常故意留一个，看你是真读了代码还是只读了题干。

 

**追问「那什么时候必须用 list = \[\] 而不能用 length = 0」**：三种情况，判断依据都是「别人是否还应该看到旧数据」。**一是别处持有这个数组且必须保留快照** —— 比如你把 `list` 传给了一个正在渲染的子组件，或者存进了 undo 栈，原地清空会把历史记录一起清掉，这时必须换引用。**二是 React 及任何靠引用比较的地方**，`setList([])` 是唯一有效写法，原地清空对 React 不存在。**三是数组已被冻结或封闭**：实测 `Object.seal([1,2,3])` 之后 `length = 0` 在非严格模式下静默无效（数组还是 `[1,2,3]`），严格模式下抛错，因为截断要删除元素而 sealed 禁止删除属性 —— 这时只能新建数组。反过来，必须用 `length = 0`（或 `splice`）的场景也存在：**你只拿到这个数组的引用而拿不到持有它的那个变量**，比如函数参数、`props` 里传进来的数组、Vue 里 `reactive` 对象的某个字段被解构出来之后 —— 你没法替换别人的变量，只能原地改。**能把「原地 vs 换引用」和「谁持有引用」连起来讲，就说明你不是在背两种清空写法，而是理解了引用语义**（和第 4 题的按值传递是同一个机制）。

# 面试 12 · 代码陷阱题 > 这个 reduce 去重函数不传初始值会怎样

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/12-code-traps.html#q6

```js
function fn(arr) {
  return arr.reduce((acc, cur) => {
    if (!acc.includes(cur)) acc.push(cur);
    return acc;
  }, []);
}

```

# 面试 12 · 代码陷阱题 > 这个 reduce 去重函数不传初始值会怎样

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/12-code-traps.html#q6

带 `[]` 时它是对的（`[1,1,2]` → `[1,2]`），但有两个问题：**不传初始值会崩**，以及**它是 O(n²)**。

# 面试 12 · 代码陷阱题 > 这个 reduce 去重函数不传初始值会怎样

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/12-code-traps.html#q6

去掉那个 `[]`，`reduce` 就拿 `arr[0]` 当初始的 `acc`，从索引 1 开始迭代。实测五种输入：

# 面试 12 · 代码陷阱题 > 这个 reduce 去重函数不传初始值会怎样

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/12-code-traps.html#q6

前文：去掉那个 `[]`，`reduce` 就拿 `arr[0]` 当初始的 `acc`，从索引 1 开始迭代。实测五种输入：

| 输入 | 结果 |
| --- | --- |
| `[]` | `TypeError: Reduce of empty array with no initial value` |
| `[1, 1, 2]` | `TypeError: acc.includes is not a function`（acc 是数字 1） |
| `['a','b','a']` | `TypeError: acc.push is not a function`（acc 是字符串，有 includes 没 push） |
| `[7]` | 返回 `7` —— 单元素数组不迭代，直接返回 `arr[0]`，类型都变了 |
| `[[1],[2],[1]]` | 返回 `[1,[2],[1]]`，**而且输入的 `arr[0]` 被原地改坏了** |

# 面试 12 · 代码陷阱题 > 这个 reduce 去重函数不传初始值会怎样

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/12-code-traps.html#q6

第三行特别阴：字符串有 `includes` 所以第一个判断通过了，卡在 `push` 上 —— 错误信息指向的不是真正的原因。第四行更阴，它不报错：`[7]` 返回数字 `7`，调用方拿到一个非数组，后面 `.map` 才炸，堆栈里已经看不到 reduce 了。最后一行是最坏的，输入数组的第一个元素被当成累加器原地 push 了三次（实测 `out === arr[0]` 为 `true`），函数污染了自己的入参 —— 这和第 4 题是同一个问题。

# 面试 12 · 代码陷阱题 > 这个 reduce 去重函数不传初始值会怎样

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/12-code-traps.html#q6

**判断依据：`reduce` 只要累加器的类型和数组元素的类型不一样，就必须传初始值。** 求和（number + number）可以不传，聚合成对象或数组时不传就是 bug 等着发生。团队里直接上 lint 规则更省事，ESLint 有 `unicorn/no-array-reduce`（更激进，直接劝退 reduce）或者自己写一条禁止单参数 `reduce`。

# 面试 12 · 代码陷阱题 > 这个 reduce 去重函数不传初始值会怎样

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/12-code-traps.html#q6

性能问题独立于此：`includes` 每次线性扫描已有结果，整体 O(n²)。实测 5 万元素（其中 2.5 万重复），两次跑的结果分别是 577 ms / 3.25 ms 和 578 ms / 2.76 ms：

# 面试 12 · 代码陷阱题 > 这个 reduce 去重函数不传初始值会怎样

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/12-code-traps.html#q6

前文：性能问题独立于此：`includes` 每次线性扫描已有结果，整体 O(n²)。实测 5 万元素（其中 2.5 万重复），两次跑的结果分别是 577 ms / 3.25 ms 和 578 ms / 2.76 ms：

```js
arr.reduce(...)        // ≈ 578 ms
[...new Set(arr)]      // ≈ 3 ms      快约 200 倍

```

# 面试 12 · 代码陷阱题 > 这个 reduce 去重函数不传初始值会怎样

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/12-code-traps.html#q6

数字换成你自己机器上跑的结果，但量级差是稳定的 —— 数组超过几千个元素时这个差别就从「感觉不到」变成「界面卡死」。

# 面试 12 · 代码陷阱题 > 这个 reduce 去重函数不传初始值会怎样

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/12-code-traps.html#q6

去重就用 `Set`，它的边界要能说清（都实测过）：

# 面试 12 · 代码陷阱题 > 这个 reduce 去重函数不传初始值会怎样

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/12-code-traps.html#q6

前文：去重就用 `Set`，它的边界要能说清（都实测过）：

```js
new Set([NaN, NaN]).size   // 1   SameValueZero，NaN 能去重（!== 做不到）
new Set([0, -0]).size      // 1   +0 和 -0 视为同一个
new Set([{}, {}]).size     // 2   对象按引用，内容相同不去重
new Set([1, '1']).size     // 2   不做类型转换

```

# 面试 12 · 代码陷阱题 > 这个 reduce 去重函数不传初始值会怎样

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/12-code-traps.html#q6

`NaN` 那条值得单独记：`[NaN].includes(NaN)` 是 `true` 但 `[NaN].indexOf(NaN)` 是 `-1`，因为前者用 SameValueZero、后者用严格相等。手写去重时用 `indexOf` 判断就漏掉 NaN。

# 面试 12 · 代码陷阱题 > 这个 reduce 去重函数不传初始值会怎样

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/12-code-traps.html#q6

**追问「要按对象的某个字段去重，保留第一条，你怎么写，为什么不用 Set」**：`Set` 用不上，因为它比的是引用，两个内容相同的对象是两个元素。正确做法是 `Map` 以字段值为键：

# 面试 12 · 代码陷阱题 > 这个 reduce 去重函数不传初始值会怎样

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/12-code-traps.html#q6

前文：**追问「要按对象的某个字段去重，保留第一条，你怎么写，为什么不用 Set」**：`Set` 用不上，因为它比的是引用，两个内容相同的对象是两个元素。正确做法是 `Map` 以字段值为键：

```js
const uniqBy = (arr, keyOf) => {
  const m = new Map();
  for (const item of arr) {
    const k = keyOf(item);
    if (!m.has(k)) m.set(k, item);      // has 判断 = 保留第一条
  }
  return [...m.values()];
};

```

# 面试 12 · 代码陷阱题 > 这个 reduce 去重函数不传初始值会怎样

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/12-code-traps.html#q6（连续片段 1/2，需结合相邻段阅读）

实测 `uniqBy([{id:1,v:'a'},{id:2,v:'b'},{id:1,v:'c'}], o => o.id)` 得到 `[{id:1,v:'a'},{id:2,v:'b'}]`。三个判断点决定这题答得好不好：**一是「保留第一条还是最后一条」是业务决策，不是实现细节** —— 去掉 `if (!m.has(k))` 直接 `m.set` 就变成保留最后一条，一行之差，而「同一订单号的两条记录保留哪条」通常有明确要求，写代码前必须问清；一行式 `[...new Map(arr.map(o => [o.id, o])).values()]` 实测保留的是**最后一条**（同样的输入得到 `[{id:1,v:'c'},{id:2,v:'b'}]`），很多人抄了这行却以为保留的是第一条。

# 面试 12 · 代码陷阱题 > 这个 reduce 去重函数不传初始值会怎样

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/12-code-traps.html#q6（连续片段 2/2，需结合相邻段阅读）

**二是 Map 的键用 SameValueZero 比较**，所以 `keyOf` 返回对象就退化成引用比较；多字段去重时拼字符串有真实的撞键风险 —— 实测 `'x|y' + '|' + 'z'` 和 `'x' + '|' + 'y|z'` 是同一个字符串，所以 `{a:'x|y', b:'z'}` 和 `{a:'x', b:'y|z'}` 会被判为重复，更稳的做法是 `JSON.stringify([a, b])`（实测键变成 `'["x|y","z"]'`，带引号和转义，撞不上）。**三是 Map 保留插入顺序**，所以结果的顺序是稳定的、可预测的，这一点在给用户看的列表里是硬需求；用普通对象当字典就不保证（整数样式的键会被引擎排到前面）。

# 面试 12 · 代码陷阱题 > 为什么键名一致的这组对象访问更快

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/12-code-traps.html#q7

```js
// 左：每个对象的键名都不同
const o1 = { name0: 'a' }; const o2 = { name1: 'b' }; const o3 = { name2: 'c' };

// 右：键名相同、结构一致
const o1 = { a: 1 }; const o2 = { a: 1 }; const o3 = { a: 1 };

```

# 面试 12 · 代码陷阱题 > 为什么键名一致的这组对象访问更快

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/12-code-traps.html#q7

差别在 V8 的 **隐藏类（Hidden Class，V8 内部叫 Map）** 和 **内联缓存（Inline Cache，IC）**。

# 面试 12 · 代码陷阱题 > 为什么键名一致的这组对象访问更快

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/12-code-traps.html#q7

V8 给每个对象挂一个隐藏类，它记录「这个形状有哪些属性、各在第几个槽位」。属性访问的编译产物不是「查字典」而是「检查隐藏类是否等于上次那个，是就直接读固定偏移」。右边三个对象结构一致，共享同一个隐藏类，`o.a` 这个访问点只见过一种形状 —— 处于 **单态（monomorphic）**，最快的状态。左边三个对象各有各的隐藏类，同一个访问点见到多种形状，先退化成**多态（polymorphic，V8 里最多缓存 4 种形状，线性比对）**，超过就变 **超态（megamorphic）**，落到全局 stub cache 甚至运行时慢路径。

# 面试 12 · 代码陷阱题 > 为什么键名一致的这组对象访问更快

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/12-code-traps.html#q7

我用 `--allow-natives-syntax` 直接验证了形状是否相同：

# 面试 12 · 代码陷阱题 > 为什么键名一致的这组对象访问更快

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/12-code-traps.html#q7

前文：我用 `--allow-natives-syntax` 直接验证了形状是否相同：

```js
%HaveSameMap({a:1}, {a:1})                       // true
%HaveSameMap({a:1,b:2}, {b:2,a:1})               // false  ← 键相同、顺序不同也是两个隐藏类
%HaveSameMap({a:1}, (()=>{const o={a:1,t:2}; delete o.t; return o})())  // false

```

# 面试 12 · 代码陷阱题 > 为什么键名一致的这组对象访问更快

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/12-code-traps.html#q7

第二行是这题最反直觉的地方：**赋值顺序不同就是不同的形状**。第三行更严重 —— `delete` 之后 `%HasFastProperties` 实测返回 `false`，对象被降级成**字典模式**（哈希表存属性），从此每次属性访问都是哈希查找，而且优化编译器对它的代码基本放弃。删中间的键和删最后一个键实测都会降级。连续加 40 个动态键也一样降级。

# 面试 12 · 代码陷阱题 > 为什么键名一致的这组对象访问更快

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/12-code-traps.html#q7

单纯讲原理没意义，我实测了成本（2000 个对象、一个热循环里读 `.a`、跑 3000 轮，Node v22）：

# 面试 12 · 代码陷阱题 > 为什么键名一致的这组对象访问更快

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/12-code-traps.html#q7

前文：单纯讲原理没意义，我实测了成本（2000 个对象、一个热循环里读 `.a`、跑 3000 轮，Node v22）：

| 构造方式 | 耗时 | 相对单态 |
| --- | --- | --- |
| 全部 `{a:1}`（单态） | 6.2 ms | 1× |
| 每个对象一个独有键（超态） | 276 ms | **44×** |
| 键相同、赋值顺序交替 | 33.9 ms | 5.5× |
| `delete` 过的对象（字典模式） | 50.3 ms | 8.1× |
| 先 `{b:1}` 再动态加 `a` | 33.8 ms | 5.4× |

# 面试 12 · 代码陷阱题 > 为什么键名一致的这组对象访问更快

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/12-code-traps.html#q7

换成你自己机器上的数，倍数关系是稳的。注意这些是**属性读取本身**的开销 —— 循环体里只有一次加法，所以差异被放大到了极限；真实业务代码里每个循环还要做别的事，占比会小很多。

# 面试 12 · 代码陷阱题 > 为什么键名一致的这组对象访问更快

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/12-code-traps.html#q7

工程结论只有一条：**同一批对象要有稳定的字段集合和稳定的赋值顺序，在构造时一次给全**。

# 面试 12 · 代码陷阱题 > 为什么键名一致的这组对象访问更快

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/12-code-traps.html#q7

前文：工程结论只有一条：**同一批对象要有稳定的字段集合和稳定的赋值顺序，在构造时一次给全**。

```js
// 差：字段按条件长出来，同一个数组里出现多种形状
const rows = raw.map(r => {
  const o = {};
  o.id = r.id;
  if (r.name) o.name = r.name;       // 有的对象有 name，有的没有 → 两种隐藏类
  if (r.score != null) o.score = r.score;
  return o;
});

// 好：形状固定，缺失值用显式默认
const rows = raw.map(r => ({
  id: r.id,
  name: r.name ?? '',
  score: r.score ?? null,
}));

```

# 面试 12 · 代码陷阱题 > 为什么键名一致的这组对象访问更快

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/12-code-traps.html#q7（连续片段 1/2，需结合相邻段阅读）

**追问「这个优化什么时候值得关心，什么时候是过早优化」**：判断依据是**这段代码每次请求/每帧要跑多少次**，不是「代码看起来干不干净」。值得关心的只有两类：**一是大批量同类对象的热路径** —— 万行表格的行对象、图表的数据点、把接口结果映射成视图模型的那次 `map`，这些对象会被反复读取，形状不一致的代价是线性累积的。二是**长期存活并反复读写的对象**，比如状态树的节点、缓存条目 —— 一次 `delete` 就让它永久落到字典模式。剩下的全是过早优化：一个组件里的几个配置对象、一次性的请求参数、初始化时跑一次的代码，形状再乱也影响不了任何可测量的指标。更实际的三条判断：**一是先测再改** —— Chrome DevTools 的 Performance 面板里如果 self time 集中在某个读属性的函数上才有必要动；Node 上可以用 `--trace-deopt` 直接看证据，我在上面那个多形状的基准里实测打出了 `bailout (kind: deopt-eager, reason: wrong map) ... deoptimizing JSFunction read`，「wrong map」就是隐藏类不一致导致优化代码被丢弃的原话。凭想象改隐藏类是纯浪费。

# 面试 12 · 代码陷阱题 > 为什么键名一致的这组对象访问更快

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/12-code-traps.html#q7（连续片段 2/2，需结合相邻段阅读）

**二是这个优化和可读性几乎不冲突**，「构造时给全所有字段」本身就是更好的代码风格（TypeScript 的 interface 天然逼你这么写），所以它更应该当成默认习惯而不是优化手段。**三是别把 `delete` 当禁忌** —— 从一个短命的临时对象上删个键无所谓，真正要避免的是从「会被热路径反复访问的长寿对象」上 delete，替代写法是赋 `undefined` 或者重建对象。**能说出「先量后改，而且这条恰好和好代码风格重合」，比背出隐藏类三个字更能证明你真做过性能工作**（前端侧的具体测量方法见 `01-frontend.md` 第 11 题）。

# 面试 12 · 代码陷阱题 > console.log 被第三方代码重写了，怎么还原

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/12-code-traps.html#q8

三条路，按可靠性从高到低。

# 面试 12 · 代码陷阱题 > console.log 被第三方代码重写了，怎么还原

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/12-code-traps.html#q8

**一、事先保存原引用（最稳，也是唯一确定有效的）**

# 面试 12 · 代码陷阱题 > console.log 被第三方代码重写了，怎么还原

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/12-code-traps.html#q8

前文：**一、事先保存原引用（最稳，也是唯一确定有效的）**

```js
const rawLog = console.log.bind(console);   // 在任何第三方脚本执行之前
// 之后无论 console.log 被怎么改，rawLog 都还是原生的

```

# 面试 12 · 代码陷阱题 > console.log 被第三方代码重写了，怎么还原

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/12-code-traps.html#q8

`bind(console)` 那步不能省 —— `console.log` 的实现依赖 `this` 是 console 对象，裸取函数再调用在某些环境会出问题。这条路的前提很硬：**你必须比污染者先执行**，所以它只适用于你自己的入口代码或者最早注入的脚本。

# 面试 12 · 代码陷阱题 > console.log 被第三方代码重写了，怎么还原

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/12-code-traps.html#q8

**二、从一个干净的 realm 取原生实现**

# 面试 12 · 代码陷阱题 > console.log 被第三方代码重写了，怎么还原

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/12-code-traps.html#q8

浏览器里就是那个 iframe 技巧：

# 面试 12 · 代码陷阱题 > console.log 被第三方代码重写了，怎么还原

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/12-code-traps.html#q8

前文：浏览器里就是那个 iframe 技巧：

```js
function getNativeLog() {
  const f = document.createElement('iframe');
  f.style.display = 'none';
  document.body.appendChild(f);
  const log = f.contentWindow.console.log.bind(f.contentWindow.console);
  f.remove();          // 实测移除后这个函数仍可调用（Chrome 151）
  return log;
}

```

# 面试 12 · 代码陷阱题 > console.log 被第三方代码重写了，怎么还原

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/12-code-traps.html#q8

原理是**每个 realm（iframe、Worker、vm context）有自己整套内置对象**，父页面的污染不会传染进去。我在 Chrome 151 headless 里用 CDP 实测了这段：iframe 里取到的 `console.log` 通过 `[native code]` 检测、和父页面被污染的那个不是同一个函数、和父页面原始的 `console.log` 也不是同一个函数（`iframeLog === original` 为 `false`，印证了「两套内置对象」），`f.contentWindow.Array !== Array` 也为 `true`。而且**移除 iframe 之后那个绑定函数仍然能正常调用** —— 实测没有抛错。要求 iframe 同源（`about:blank`、`data:` 或同源空白页），跨域拿不到 `contentWindow`。同一个技巧同样能救被污染的 `Array.prototype.map`、`fetch`、`JSON.parse`。

# 面试 12 · 代码陷阱题 > console.log 被第三方代码重写了，怎么还原

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/12-code-traps.html#q8

Node 里对应的手段我实测过两个，都有效：

# 面试 12 · 代码陷阱题 > console.log 被第三方代码重写了，怎么还原

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/12-code-traps.html#q8

前文：Node 里对应的手段我实测过两个，都有效：

```js
// 拿一个全新的 Console 实例
const { Console } = require('node:console');
const fresh = new Console({ stdout: process.stdout, stderr: process.stderr });
// Function.prototype.toString.call(fresh.log) 含 [native code] → 是原生的

// 或者开一个新的 vm realm，整套内置对象都是新的
const vm = require('node:vm');
const ctx = vm.createContext({});
vm.runInContext('Array', ctx) !== Array                  // true
vm.runInContext('Array.prototype.map', ctx) !== Array.prototype.map   // true

```

# 面试 12 · 代码陷阱题 > console.log 被第三方代码重写了，怎么还原

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/12-code-traps.html#q8

**三、`delete` —— 只在特定条件下有效，多数时候没用**

# 面试 12 · 代码陷阱题 > console.log 被第三方代码重写了，怎么还原

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/12-code-traps.html#q8

`delete` 能救的唯一情况是「污染者在实例上加了一个自有属性，遮住了原型上的方法」。实测对比三种情况：

# 面试 12 · 代码陷阱题 > console.log 被第三方代码重写了，怎么还原

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/12-code-traps.html#q8

前文：`delete` 能救的唯一情况是「污染者在实例上加了一个自有属性，遮住了原型上的方法」。实测对比三种情况：

| 污染方式 | `delete` 之后 |
| --- | --- |
| `arr.sort = fn`（实例遮蔽原型方法） | **恢复**，`arr.sort === Array.prototype.sort` 为 `true` |
| `console.log = fn`（覆盖了自有属性本身） | `typeof console.log` 变成 **`undefined`**，直接删没了 |
| `Array.prototype.map = fn`（改的是原型） | 在实例上 delete 无效，仍然是被改的版本 |
| `Object.defineProperty(..., {configurable: false})` | `delete` 返回 `false`，严格模式抛错，删不掉 |

# 面试 12 · 代码陷阱题 > console.log 被第三方代码重写了，怎么还原

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/12-code-traps.html#q8

第二行是关键：`console.log` **本身就是 console 上的自有属性**（我实测 `hasOwnProperty(console, 'log')` 为 `true`，且原型上没有 `log`），所以 `delete console.log` 不是「揭掉遮盖物露出原生方法」，而是「把这个方法删掉」，之后调用直接 `TypeError: console.log is not a function`。**面试里说「delete console.log 就能还原」是错的，这是这道题的判卷点。**

# 面试 12 · 代码陷阱题 > console.log 被第三方代码重写了，怎么还原

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/12-code-traps.html#q8

背后的通用技巧值得单独说出来：**要拿原生实现，就去一个新的 realm 取**。这在两类工作里是刚需 —— 一是写 SDK / 埋点库，宿主页面可能已经改过 `fetch` 或 `Array.prototype`，你必须拿到干净的版本才能保证上报不被劫持；二是安全沙箱，用新 realm 隔离不受信代码。

# 面试 12 · 代码陷阱题 > console.log 被第三方代码重写了，怎么还原

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/12-code-traps.html#q8（连续片段 1/2，需结合相邻段阅读）

**追问「怎么判断 console.log 到底有没有被改过，你的检测能被绕过吗」**：主检测是看函数源码里有没有 `[native code]`，实测原生的 `Function.prototype.toString.call(console.log)` 命中，被普通函数覆盖后不命中。**但这个检测有两层绕过，第二层是这道题真正的分水岭。** 第一层是伪造 `toString`：污染者给自己的函数定义一个 `toString` 返回 `'function log() { [native code] }'`，`fake.toString()` 就通过检测 —— 这层容易挡，改用 `Function.prototype.toString.call(fn)` 就绕过对象自己的 `toString`，实测伪造失效。**第二层挡不住：只要污染者把自己的函数 `.bind()` 一下，`Function.prototype.toString.call(boundFn)` 实测返回的就是 `function () { [native code] }`，检测直接给出假阴性。** 规范里绑定函数就是当作内置函数处理的，这不是漏洞而是定义，所以「看 native code」这条路从根上就判不了真伪。

# 面试 12 · 代码陷阱题 > console.log 被第三方代码重写了，怎么还原

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/12-code-traps.html#q8（连续片段 2/2，需结合相邻段阅读）

辅助信号也不牢靠：绑定函数的 `name` 实测是 `"bound hijack"`（能看出端倪，但污染者用 `defineProperty` 改掉 `name` 即可），`length` 实测是 0 —— 和原生 `console.log` 的 0 一样，区分不出来；`Object.getOwnPropertyDescriptor(console, 'log')` 实测原生就是 `{writable: true, enumerable: true, configurable: true}`，覆盖后描述符长得一模一样。所以判断依据是**运行期检测只能提高攻击成本，不能证明未被篡改**；真要可靠只有两条：**在污染者之前执行并保存引用**（时间优势），或者**在一个干净 realm 里取一份来对比**（隔离优势）—— 后者能给出确定答案，因为你手上有货真价实的原生函数可以做 `===` 比较。**能主动说出「bind 之后 native code 检测就废了，所以真正的解法是时间优势或 realm 隔离」，这题就答满了**；只说「看 native code」的会被判断成读过八股但没验证过。

# 面试 12 · 代码陷阱题 > 反转字符串有几种写法，哪种在真实文本上是对的

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/12-code-traps.html#q9

先说源代码的问题：

# 面试 12 · 代码陷阱题 > 反转字符串有几种写法，哪种在真实文本上是对的

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/12-code-traps.html#q9

前文：先说源代码的问题：

```js
let str = 'abcde';
const arr = [];
for (let i = 0; i < str.length; i++) arr.unshift(str[i]);
console.log(arr.join(''));   // 'edcba'

```

# 面试 12 · 代码陷阱题 > 反转字符串有几种写法，哪种在真实文本上是对的

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/12-code-traps.html#q9

结果对，但 `unshift` 每次都要把已有元素整体后移一格，整体 O(n²)。实测 6 万字符：`unshift` 循环 **250 ms**，`split('').reverse().join('')` **1.4 ms**。换成 `push` 之后 `reverse`，或者直接用 `reverse()`，都是线性的。

# 面试 12 · 代码陷阱题 > 反转字符串有几种写法，哪种在真实文本上是对的

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/12-code-traps.html#q9

复杂度只是表层问题。**三种「标准写法」在真实文本上全是错的**，只是错的层次不同。我把七种输入全跑了一遍（Node v22.23.2）：

# 面试 12 · 代码陷阱题 > 反转字符串有几种写法，哪种在真实文本上是对的

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/12-code-traps.html#q9

前文：复杂度只是表层问题。**三种「标准写法」在真实文本上全是错的**，只是错的层次不同。我把七种输入全跑了一遍（Node v22.23.2）：

| 输入 | `length` | 码点数 | 字素簇数 | `split('').reverse()` | `[...str].reverse()` | `Intl.Segmenter` |
| --- | --- | --- | --- | --- | --- | --- |
| `'abcde'` | 5 | 5 | 5 | ✅ `edcba` | ✅ | ✅ |
| `'ab𝒳cd'`（非 BMP） | 6 | 5 | 5 | ❌ 代理对被切散 | ✅ `dc𝒳ba` | ✅ |
| `'hi😀'` | 4 | 3 | 3 | ❌ 乱码 | ✅ `😀ih` | ✅ |
| `'cafe\u0301'`（é = e + 组合符） | 5 | 5 | **4** | ❌ `́efac` | ❌ `́efac` | ✅ `éfac` |
| `'👨‍👩‍👧'`（ZWJ 家族） | 8 | 5 | **1** | ❌ 乱码 | ❌ `👧‍👩‍👨` 成员被倒序 | ✅ 原样不变 |
| `'🇨🇳'`（区域指示符） | 4 | 2 | **1** | ❌ 乱码 | ❌ `🇳🇨` **变成另一个国家的旗** | ✅ 原样不变 |
| `'👍🏽'`（肤色修饰符） | 4 | 2 | **1** | ❌ 乱码 | ❌ `🏽👍` 修饰符掉出来 | ✅ 原样不变 |

# 面试 12 · 代码陷阱题 > 反转字符串有几种写法，哪种在真实文本上是对的

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/12-code-traps.html#q9

三层机制对应三种失败：

# 面试 12 · 代码陷阱题 > 反转字符串有几种写法，哪种在真实文本上是对的

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/12-code-traps.html#q9

前文：三层机制对应三种失败：

1. **`split('')` 和 `str[i]` 按 UTF-16 码元切**。非 BMP 字符（emoji、𝒳、部分汉字扩展区）由两个码元的代理对表示，切开就成了两个孤立代理项，实测 `'hi😀'` 反转后 `isWellFormed()` 返回 `false` —— 这不是「显示不好看」，这是一个不合法的 UTF-8 序列，`encodeURI` 会抛 `URIError`，写进数据库或经 `TextEncoder` 会被替换成 `U+FFFD`。
2. **`[...str]` 按码点迭代，能救代理对，但救不了组合序列**。组合字符（`e` + `U+0301`）反转后重音符号跑到了前一个字母上；ZWJ emoji 的成员被逐个倒序（家族的顺序被打乱）；旗帜的两个区域指示符一交换就变成另一个国家。
3. **只有按字素簇（grapheme cluster，用户眼里的「一个字」）切分才对**，这正是 `Intl.Segmenter` 的 `granularity: 'grapheme'`。

# 面试 12 · 代码陷阱题 > 反转字符串有几种写法，哪种在真实文本上是对的

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/12-code-traps.html#q9

上面这张表我在 Node v22.23.2 和 Chrome 151（headless，走 CDP）上各跑了一遍，结果逐格一致 —— 这不是某个运行时的怪癖，是 UTF-16 的定义。

# 面试 12 · 代码陷阱题 > 反转字符串有几种写法，哪种在真实文本上是对的

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/12-code-traps.html#q9

最终实现（实测七种输入全部正确，且双向反转能回到原串）：

# 面试 12 · 代码陷阱题 > 反转字符串有几种写法，哪种在真实文本上是对的

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/12-code-traps.html#q9

前文：最终实现（实测七种输入全部正确，且双向反转能回到原串）：

```js
function reverse(str) {
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    return Array.from(seg.segment(str), s => s.segment).reverse().join('');
  }
  return [...str].reverse().join('');   // 退一步：至少不切散代理对
}

```

# 面试 12 · 代码陷阱题 > 反转字符串有几种写法，哪种在真实文本上是对的

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/12-code-traps.html#q9

`Intl.Segmenter` 的支持情况（**核实于 2026-09**）：MDN 标为 **Baseline「newly available」，起点 2024-04**（三大引擎齐了的时间点）；具体版本是 Chrome/Edge 87、Safari 14.1、**Firefox 125（2024-04，最后一个到位的）**；Node 从 **16.0.0** 起可用。Node 侧有一个部署陷阱要知道：官方构建默认带完整 ICU，但用 `--with-intl=small-icu` 编译的发行版包（典型是 RHEL/Fedora 没装 `nodejs-full-i18n` 的 `nodejs` 包）上，`new Intl.Segmenter()` 能构造成功，第一次调 `.segment()` 直接 **SIGSEGV 段错误**（nodejs/node#51752）。运行时自检的方法是 `process.config.variables.icu_small` —— 我这台机器实测是 `false`（ICU 78），所以安全。

# 面试 12 · 代码陷阱题 > 反转字符串有几种写法，哪种在真实文本上是对的

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/12-code-traps.html#q9

**这题最值得说的一句是：`reverse` 这个需求本身几乎不存在。** 真实业务里需要的从来不是「把字符串倒过来」，而是「数用户看到几个字」和「截断到 N 个字不切坏」，两者都靠同一个字素簇切分。这两个才是流式渲染 LLM 输出时天天遇到的问题：

# 面试 12 · 代码陷阱题 > 反转字符串有几种写法，哪种在真实文本上是对的

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/12-code-traps.html#q9

```js
const graphemes = s => Array.from(
  new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s), x => x.segment);

const visibleLength = s => graphemes(s).length;
const truncate = (s, n) => {
  const g = graphemes(s);
  return g.length <= n ? s : g.slice(0, n).join('') + '…';
};

visibleLength('👨‍👩‍👧ab');        // 3   而 '👨‍👩‍👧ab'.length 是 10
truncate('👨‍👩‍👧ab', 2);          // '👨‍👩‍👧a…'
'👨‍👩‍👧ab'.slice(0, 1);           // 孤立代理项，isWellFormed() 为 false

```

# 面试 12 · 代码陷阱题 > 反转字符串有几种写法，哪种在真实文本上是对的

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/12-code-traps.html#q9

SSE 逐块推送模型输出时，一个 emoji 的两个码元可能落在**两个不同的 chunk 里**，前端拿到半个字符直接渲染就是一个方块（`U+FFFD`）—— 这就是流式输出里 emoji 闪烂码的根因。解法是在 chunk 边界上用 `isWellFormed()` 检查，不完整就把尾部留到下一块再拼（`01-frontend.md` 第 14 题讲的流式 Markdown 渲染是同一类边界问题）。

# 面试 12 · 代码陷阱题 > 反转字符串有几种写法，哪种在真实文本上是对的

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/12-code-traps.html#q9（连续片段 1/2，需结合相邻段阅读）

**追问「那到底该用哪个」**：看输入域，这题没有唯一答案，但有明确的判断顺序。**输入域已知是纯 ASCII**（订单号、hex、base64、协议字段）——用 `split('').reverse().join('')`，最快最简单，引入 `Intl.Segmenter` 是给后人添负担；这时应该做的是**在注释或类型上写清「仅限 ASCII」**，让它成为一个契约而不是巧合。**输入域是用户文本、模型输出、任何可能带 emoji 或非拉丁文字的内容** —— 一律 `Intl.Segmenter`，代价是它比 `split` 慢一个量级（实测 6 万字符 40 ms vs 1.4 ms，因为要跑 ICU 的边界算法），但这个量级在「一次用户输入」的尺度上完全无感，只在批量处理十万条文本时才需要考虑缓存一个 segmenter 实例复用（构造它有固定开销）。**只需要修组合字符不需要修 ZWJ** 的场景可以先 `str.normalize('NFC')` 把 `e + U+0301` 合成单码点的 `é`，实测之后 `[...str].reverse()` 就正确了 —— 但这只对有预组合形式的字符有效，泰文、天城文的组合序列和所有 ZWJ emoji 都合不掉，所以它是权宜之计不是方案。

# 面试 12 · 代码陷阱题 > 反转字符串有几种写法，哪种在真实文本上是对的

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/12-code-traps.html#q9（连续片段 2/2，需结合相邻段阅读）

最后一条是这题的隐藏考点：**这个 bug 用单元测试测不出来，如果你的测试写的是 `expect(reverse(reverse(s))).toBe(s)`**。实测三种坏输入的双向反转全部返回 `true` —— 因为坏掉的码元序列再反转一次又恢复原位了。测试必须断言**单次**反转的结果，或者断言 `reverse(s).isWellFormed()` 为真（`isWellFormed`/`toWellFormed` 是 ES2024 方法，Baseline widely available，2023-10 起三大引擎齐备：Chrome/Edge 111、Firefox 119、Safari 16.4；核实于 2026-09）。**能说出「往返测试会掩盖这个 bug」，比背出 Intl.Segmenter 更能证明你真踩过**。

# 面试 12 · 代码陷阱题 > 这段 6 个 log 的输出顺序是什么

```js
console.log(1)
setTimeout(() => { console.log(2) }, 0)
Promise.resolve().then(() => { console.log(3) })
async function fn () {
  console.log(4)
  await Promise.resolve()
  console.log(5)
}
fn()
console.log(6)
// 实测输出：1 4 6 3 5 2
```

 

**逐步推**（Node v22.23.2 实测，浏览器同）：

 

1. `1` —— 同步。
2. `setTimeout` 注册宏任务，不执行。
3. `.then(...)` 注册微任务 **M1**（打印 3）。
4. `fn()` 是**同步调用**：函数体一路执行到第一个 `await`，所以 `4` 立刻打印。这是最容易答错的一步——很多人以为 `async` 函数整体异步。
5. `await Promise.resolve()` 把 `fn` 的剩余部分（打印 5）挂成微任务 **M2**，然后交还控制权。
6. `6` —— 同步代码的最后一行。
7. 同步栈清空 → 清微任务队列，先进先出：**M1 打印 3**，**M2 打印 5**。
8. 微任务清空后才进宏任务：**打印 2**。

 

一句话总结：**同步 → 微任务全清 → 一个宏任务 →（再清微任务）**。关键是「全清」：微任务队列在执行过程中新加的微任务，也在这一轮一起清完，才会去碰宏任务。所以微任务里写递归调度（`Promise.resolve().then(f)` 里再 `then(f)`）会饿死渲染和定时器——页面表现是彻底卡死，而不是变慢。

 

**三个把「答对顺序」和「真懂」分开的变体**（都在本机实测过）：

 

```js
// 变体 A：await 一个非 Promise 的 thenable，比 await Promise 慢一拍
async function f () { console.log('a'); await { then (r) { console.log('thenable-then'); r() } }; console.log('b') }
f()
Promise.resolve().then(() => console.log('p1')).then(() => console.log('p2')).then(() => console.log('p3'))
// a  thenable-then  p1  b  p2  p3      ← b 落在 p1 之后
```

 

`await` 一个原生 Promise 只花 1 个微任务节拍（ES2019 起的优化）；`await` 一个普通 thenable 要先把它包成 Promise、再排一次 `then` 调用，多花一拍，所以 `b` 被 `p1` 插到了前面。

 

```js
// 变体 B：async 函数 return 一个 Promise，要多等两拍
async function f () { return Promise.resolve('x') }
f().then(v => console.log('resolved', v))
Promise.resolve().then(()=>console.log(1)).then(()=>console.log(2)).then(()=>console.log(3)).then(()=>console.log(4))
// 1  2  resolved x  3  4                ← 不是第 1 拍，是第 3 拍
```

 

`return` 一个 Promise 时，规范要走 `resolve → then → 落地`两个额外节拍。改成 `return await Promise.resolve('x')` 反而只差一拍。这就是「`return await` 是多余的」这条 lint 规则在时序上不成立的地方。

 

```js
// 变体 C：Node 独有的两个队列
setTimeout(()=>console.log('timeout'),0); setImmediate(()=>console.log('immediate'))
process.nextTick(()=>console.log('nextTick')); Promise.resolve().then(()=>console.log('micro'))
console.log('sync')
// sync  nextTick  micro  timeout  immediate
```

 

`process.nextTick` 队列优先级高于 Promise 微任务队列，且同样是「全清」，所以它递归调度能把 Promise 队列一起饿死。`setImmediate` 属于 check 阶段，排在 timers 之后。浏览器没有这两个，这也是 `02-node-java.md` 第 1 题里 Node 与浏览器事件循环差异的落点。

 

**追问「这套顺序在业务里害过你吗」**：最典型的是流式渲染。SSE 每个 chunk 到达都在微任务里 `setState`/`patch` DOM，如果在 chunk 处理里再链一串 `then` 做 Markdown 解析、代码高亮，微任务队列在两个 chunk 之间就没清空过，浏览器拿不到渲染时机，表现是**字看着一顿一顿地成块出现、页面同时点不动**（`01-frontend.md` 第 14 题）。定位方式是 Performance 面板看长任务，修法是把重活挪出微任务：按帧合并（`requestAnimationFrame`）或让出一个宏任务（`setTimeout 0` / `scheduler.yield()`）。第二个是测试里的假通过：`await` 一拍不够，断言跑在 DOM 更新之前，于是 `flushPromises()` 写成 `await Promise.resolve()` 会间歇性失败——正确做法是 `await new Promise(r => setTimeout(r, 0))` 跨一个宏任务。
