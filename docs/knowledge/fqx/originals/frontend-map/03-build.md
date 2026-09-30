# 前端 > 模块化与构建工具 > 资料说明

来源：https://fqx.lx.ci/frontend-map/

来源：https://fqx.lx.ci/frontend-map/

主线对齐 2026 年的实际工程状况：Vite 6+ / Vue 3.5+ / React 19 / TypeScript 5.7+。INP 已取代 FID，X-XSS-Protection 已废弃，涉及版本差异处单独标注。

# 前端 > 模块化与构建工具

来源：https://fqx.lx.ci/frontend-map/

模块化的历史是一串补丁：没有模块 → CommonJS（Node，运行时同步）→ AMD（浏览器，异步）→ ESM（语言级，静态可分析）。**ESM 的静态结构是 tree-shaking 和 Vite 免打包 dev server 的前提**，这条因果关系是这块的主线。

# 前端 > 模块化与构建工具 > CommonJS 与 ESM：差异不只是语法

来源：https://fqx.lx.ci/frontend-map/

| | CommonJS | ESM |
|---|---|---|
| 加载时机 | 运行时同步 `require()` | 编译时静态分析 |
| 导出的是 | 值的**拷贝** | 值的**引用（live binding）** |
| 循环依赖 | 拿到未完成的部分对象 | 靠 hoisting 处理，TDZ 报错 |
| 能否 tree-shake | 难（动态） | 能（静态） |
| `this` 顶层 | `module.exports` | `undefined` |

**live binding 的实际差别**：

```js
// counter.mjs
export let n = 0;
export const inc = () => n++;

// main.mjs
import { n, inc } from './counter.mjs';
inc();
console.log(n);    // 1  ← ESM 拿到的是引用，能看到变化

// CommonJS 版本里，解构出来的 n 永远是 0
const { n, inc } = require('./counter');
inc();
console.log(n);    // 0  ← 拷贝
```

**这就是为什么 CJS 常见写法是 `exports.foo` 而不是解构导入**——保留对 `module.exports` 对象的引用才能看到更新。

**双包地狱（dual package hazard）是真实的坑**：同一个包同时提供 CJS 和 ESM 两份产物，如果依赖图里两条路径分别引入了两份，模块内的单例状态（缓存、计数器、Symbol 注册）会有两份。表现是「明明是单例，却有两个实例」。

**package.json 的 `exports` 字段**决定入口，比老的 `main`/`module` 优先：

```json
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.mjs",
      "require": "./dist/index.cjs"
    }
  }
}
```

**顺序有意义**——先匹配先用，`types` 必须放最前面否则 TS 找不到类型。

**`import()` 动态导入**返回 Promise，是代码分割的基础，也是 CJS 里加载 ESM 的唯一方式（`require` 不能加载 ESM）。

# 前端 > 模块化与构建工具 > Vite vs Webpack：dev 和 build 是两套逻辑

来源：https://fqx.lx.ci/frontend-map/

**Webpack 的模型**：无论 dev 还是 build，都先构建完整依赖图，把所有模块打成 bundle。dev server 提供的是打好的 bundle + HMR。

```
入口 → 递归解析所有 import → 全部转译 → 打成 bundle → 交给浏览器
（项目越大，启动越慢，因为要等全图构建完）
```

**Vite 的模型**：dev 和 build 用完全不同的两套工具。

```
dev:   浏览器直接请求 ESM，Vite 按需转译单个文件（esbuild，Go 写的，快 10-100x）
       第三方依赖用 esbuild 预打包成单文件（避免上百个 HTTP 请求）
build: 用 Rollup 打包（生产还是需要打包 —— 否则请求数太多）
```

**「Vite 快」的准确原因有三个**，别只说「因为不打包」：
1. **dev 不做全量打包**——只转译当前请求的文件，启动时间和项目规模脱钩
2. **esbuild 比 babel 快一到两个数量级**——Go + 并行 + 无 AST 中间层
3. **依赖预构建有缓存**——`node_modules/.vite`，只在依赖变化时重跑

**Vite 的代价（面试加分点，说明你真用过）**：
- **dev 和 prod 行为不一致**——dev 是原生 ESM，prod 是 Rollup 打包，偶尔有只在生产出现的 bug
- **首次冷启动仍需依赖预构建**，大项目也要几十秒
- **不支持 CJS-only 的老依赖**，需要 `optimizeDeps.include` 手工处理
- **循环依赖在 dev 下可能正常，build 后出错**

**HMR 的原理差异**：Webpack 需要在依赖图里找到受影响的模块边界；Vite 因为是原生 ESM，直接失效那一个模块的 URL 让浏览器重新请求，所以 HMR 的速度也和项目大小无关。

**什么时候还该用 Webpack**：需要复杂的 loader 链、要支持古老浏览器、依赖大量 Webpack 特有插件的老项目。新项目基本没理由不用 Vite。

**Rspack / Turbopack** 是 Rust 重写的 Webpack / Next 打包器，API 兼容 Webpack，适合老项目迁移提速。

# 前端 > 模块化与构建工具 > Tree-shaking 为什么经常不生效

来源：https://fqx.lx.ci/frontend-map/

**前提**：ESM 的静态结构 + 无副作用。两个条件缺一个就 shake 不掉。

**最常见的三个失效原因**：

**1. 包里有副作用，打包器不敢删**

```js
// 这个文件被 import 就会执行 —— 打包器无法证明删掉安全
import './polyfill.js';
window.myGlobal = 1;
```

解法是在 package.json 声明：

```json
{ "sideEffects": false }
// 或者指明哪些有副作用
{ "sideEffects": ["./src/polyfill.js", "*.css"] }
```

**注意 CSS**——如果写了 `sideEffects: false` 但项目里有 `import './style.css'`，样式会被摇掉，页面变成裸 HTML。这个坑很隐蔽，因为 dev 模式不 shake，只有生产构建才出现。

**2. 用了 CJS 依赖**。CJS 的 `require` 是运行时的，无法静态分析。`import _ from 'lodash'` 会打进整个 lodash；要用 `lodash-es` 或者 `import debounce from 'lodash/debounce'`。

**3. 类的方法摇不掉**。打包器无法证明某个方法没被动态调用（`obj[key]()`），所以类的方法一般全保留。这也是为什么工具库倾向导出独立函数而不是类。

**验证手段**：`vite build --mode production` 后用 `rollup-plugin-visualizer` 或 `webpack-bundle-analyzer` 看产物构成。**不要凭感觉说「我们做了 tree-shaking」——面试官会问你怎么验证的。**

# 前端 > 模块化与构建工具 > TypeScript：类型系统的关键点

来源：https://fqx.lx.ci/frontend-map/

**`type` vs `interface`**——实际差别只有几条，别背成长篇：

| | interface | type |
|---|---|---|
| 声明合并 | 支持（同名自动合并） | 不支持（重复报错） |
| 联合/交叉/条件类型 | 不能 | 能 |
| 映射类型、模板字面量 | 不能 | 能 |
| extends | 支持 | 用 `&` 交叉 |

**选择建议**：对外的公共 API 用 `interface`（可被使用方扩展），内部类型运算用 `type`。

**四个高频工具类型，要能手写**：

```ts
type MyPartial<T>  = { [K in keyof T]?: T[K] };
type MyRequired<T> = { [K in keyof T]-?: T[K] };
type MyPick<T, K extends keyof T> = { [P in K]: T[P] };
type MyOmit<T, K extends keyof any> = MyPick<T, Exclude<keyof T, K>>;
```

**`unknown` vs `any` vs `never`**：
- `any` —— 关闭类型检查，会污染下游（`any` 的属性也是 `any`）
- `unknown` —— 安全的顶层类型，用之前必须收窄。**接外部数据（API 响应、JSON.parse）应该用它**
- `never` —— 底层类型，不可能有值。用于穷尽性检查

**穷尽性检查是实战里最有价值的技巧**：

```ts
type Status = 'idle' | 'loading' | 'done';

function label(s: Status): string {
  switch (s) {
    case 'idle': return '空闲';
    case 'loading': return '加载中';
    case 'done': return '完成';
    default:
      const _exhaustive: never = s;   // 以后加了新状态，这里编译报错
      return _exhaustive;
  }
}
```

**类型收窄的几种方式**：`typeof`、`instanceof`、`in`、字面量比较、自定义类型守卫（`x is T`）、可辨识联合（用一个字面量字段区分）。

**`satisfies`（TS 4.9）解决了一个真实痛点**：

```ts
// ✗ 用 : 标注会丢掉具体字面量类型
const config: Record<string, string> = { host: 'a', port: '80' };
config.host;   // string，不知道具体有哪些 key

// ✓ satisfies 既检查又保留推断
const config = { host: 'a', port: '80' } satisfies Record<string, string>;
config.host;   // 'a'，且拼错 key 会报错
```

**类型只在编译期存在**——运行时校验外部数据要用 zod / valibot 这类库，TS 类型不会帮你拦住一个返回了错误结构的 API。这一点在面试里说出来，比只讲语法更能体现你写过生产代码。
