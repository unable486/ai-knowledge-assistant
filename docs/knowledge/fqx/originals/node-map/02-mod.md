# Node 20 / 22 > 模块系统与依赖 > 资料说明

来源：https://fqx.lx.ci/node-map/

来源：https://fqx.lx.ci/node-map/

主线对齐 Node 20 / 22 LTS，内置 fetch、node:test、--watch、--env-file 等特性的可用版本都单独标注。

# Node 20 / 22 > 模块系统与依赖

来源：https://fqx.lx.ci/node-map/

Node 有两套模块系统：CommonJS（require，同步）和 ESM（import，异步、静态分析）。它们的加载时机、循环依赖行为、可用的全局变量都不同，混用时的报错信息又很难懂。这块把差异和互操作规则钉死，能省掉大量「为什么 require 不能用」的时间。

# Node 20 / 22 > 模块系统与依赖 > CJS 与 ESM 的本质差异

来源：https://fqx.lx.ci/node-map/

| | CommonJS | ESM |
|---|---|---|
| 语法 | `require` / `module.exports` | `import` / `export` |
| 加载 | **运行时同步**加载 | **静态分析** + 异步加载 |
| 绑定 | 拷贝值（导出对象的引用） | **活绑定**（live binding） |
| 顶层 await | 不支持 | **支持** |
| 文件扩展名 | 可省略（`require('./a')`） | **必须写全**（`import './a.js'`） |
| `__dirname` | 有 | **没有** |
| 循环依赖 | 拿到半成品对象 | 提升 + TDZ 报错 |

**「静态分析」的含义**：ESM 的 import 语句在代码执行前就被解析，所以打包器能做 tree-shaking，也所以 **import 不能写在条件里**：

```js
if (cond) import './a.js';           // ✗ 语法错误
const m = await import('./a.js');    // ✓ 动态导入，返回 Promise
```

**动态 `import()` 在 CJS 里也能用**，这是从 CJS 加载 ESM 的唯一办法。

**活绑定的实际差别**：

```js
// counter.mjs
export let count = 0;
export function inc() { count++; }

// main.mjs
import { count, inc } from './counter.mjs';
inc();
console.log(count);        // 1  ← ESM 看到最新值

// CJS 版本
const { count, inc } = require('./counter.js');
inc();
console.log(count);        // 0  ← 解构时就拷了一份
```

**怎么声明用哪套**：

```json
// package.json
{ "type": "module" }        // .js 文件按 ESM 解析
{ "type": "commonjs" }      // 或不写，.js 按 CJS（默认）
```

**扩展名强制覆盖 type**：`.mjs` 永远是 ESM，`.cjs` 永远是 CJS。混合项目里用扩展名区分最不容易出错。

**新项目直接上 ESM**。理由：这是标准、和前端一致、支持顶层 await、生态在迁移（很多新库只发 ESM）。代价是要处理老依赖的互操作。

# Node 20 / 22 > 模块系统与依赖 > CJS 与 ESM 的本质差异 > 互操作：谁能加载谁

来源：https://fqx.lx.ci/node-map/

**ESM 可以加载 CJS**（Node 会把 `module.exports` 包成 default）：

```js
import express from 'express';         // ✓ CJS 包，拿到 module.exports
import { Router } from 'express';      // ⚠ 有时能用（Node 做了静态分析猜命名导出），
                                       //   但不可靠，尤其是动态生成 exports 的包
// 稳妥写法：
import express from 'express';
const { Router } = express;
```

**「Named export not found」这个报错**几乎都是这个原因：Node 的 cjs-module-lexer 猜不出命名导出。**修法就是改成 default 导入再解构。**

**CJS 加载 ESM 只能用动态 import**：

```js
// CJS 文件里
const mod = await import('./esm-only.mjs');    // ✗ CJS 顶层不能 await
// 只能：
(async () => { const mod = await import('./esm-only.mjs'); })();
// 或者
import('./esm-only.mjs').then(mod => { ... });
```

**Node 22.12+ 起支持 `require()` 加载同步的 ESM**（`require(esm)`），这是个重要缓解——但条件是那个 ESM 不能有顶层 await。**跨版本部署时不要依赖这个特性。**

**ESM 里没有 `__dirname` / `__filename`**：

```js
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Node 20.11+ / 21.2+ 有更短的写法
const __dirname = import.meta.dirname;
const __filename = import.meta.filename;
```

**ESM 里没有 `require`**，要用就自己造：

```js
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const pkg = require('./package.json');    // 读 JSON 的老办法
```

**ESM 导入 JSON** 现在要加类型标注：

```js
import pkg from './package.json' with { type: 'json' };    // Node 20.10+
```

**判断「是不是主模块」**：

```js
// CJS
if (require.main === module) { main(); }
// ESM
if (import.meta.url === `file://${process.argv[1]}`) { main(); }   // 粗糙
// Node 20.11+ 更可靠
if (import.meta.filename === process.argv[1]) { main(); }
```

# Node 20 / 22 > 模块系统与依赖 > CJS 与 ESM 的本质差异 > 循环依赖的两种行为

来源：https://fqx.lx.ci/node-map/

**CJS：拿到半成品，不报错**

```js
// a.js
const b = require('./b');
console.log('a 拿到的 b:', b.value);      // undefined
module.exports.value = 'A';

// b.js
const a = require('./a');
console.log('b 拿到的 a:', a.value);      // undefined（a 还没执行到 exports）
module.exports.value = 'B';
```

CJS 的模块缓存在开始执行前就放进去了（一个空的 `exports` 对象）。循环时第二次 require 拿到的是**当时还没填完的那个对象**。所以不报错，但值是 undefined——**这类 bug 极难定位**，因为它只在特定导入顺序下出现。

**CJS 循环依赖的缓解**：延迟到用的时候再取属性，而不是在顶层解构：

```js
// ✗ 顶层解构，此刻可能还是 undefined
const { helper } = require('./b');
// ✓ 用的时候才取
const b = require('./b');
function f() { return b.helper(); }
```

**ESM：会报 TDZ 错误，更早暴露**

```js
// a.mjs
import { bVal } from './b.mjs';
export const aVal = 'A';
console.log(bVal);

// b.mjs
import { aVal } from './a.mjs';
export const bVal = 'B';
console.log(aVal);      // ReferenceError: Cannot access 'aVal' before initialization
```

ESM 先做链接（把所有 import 的名字绑定好），再执行。函数声明会提升所以能循环调用，但 `const`/`let` 在 TDZ 里，提前访问直接报错。

**报错比静默 undefined 好**——至少你知道有问题。

**根本解法是消除循环**，不是绕过它：

1. **抽出共享部分到第三个模块** —— A 和 B 都依赖 C，而不是互相依赖
2. **依赖倒置** —— 把 A 需要的东西作为参数传进去，而不是 import
3. **检查是不是分层错了** —— 循环依赖常常说明「这两个模块其实是一个模块」，或者「领域层引用了应用层」

**检测工具**：`madge --circular src/` 能画出循环依赖图。加进 CI 能防住新增的循环。

# Node 20 / 22 > 模块系统与依赖 > 模块解析与 package.json 字段

来源：https://fqx.lx.ci/node-map/

**`import 'foo'` 的查找顺序**：从当前目录的 `node_modules` 开始，逐级往上找到根。所以同一个包可能在不同层级有多份不同版本——这是 `node_modules` 体积大和「为什么有两个 React 实例」的原因。

**关键字段**：

```json
{
  "name": "mypkg",
  "type": "module",
  "main": "./dist/index.cjs",          // 老字段，CJS 入口
  "module": "./dist/index.mjs",        // 打包器约定，非 Node 标准
  "types": "./dist/index.d.ts",        // TS 类型
  "exports": {                          // 现代标准，优先级最高
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.mjs",
      "require": "./dist/index.cjs"
    },
    "./utils": "./dist/utils.mjs"
  },
  "engines": { "node": ">=20" },
  "sideEffects": false                  // 告诉打包器可以 tree-shake
}
```

**`exports` 一旦声明就是封闭的**：没列在里面的路径**不能被导入**。

```js
import 'mypkg/internal/secret.js';    // ✗ ERR_PACKAGE_PATH_NOT_EXPORTED
```

这是个特性不是 bug——它让包作者能真正隐藏内部实现。但也是「升级依赖后突然导入失败」的常见原因：那个包加了 `exports`，你之前用的深层路径被封了。看它的 exports 字段找对应的公开入口。

**条件导出的顺序有意义**，从上到下匹配第一个：`types` 要放最前，`import` 在 `require` 前，`default` 兜底放最后。

**`imports` 字段做内部别名**（不用配打包器）：

```json
{ "imports": { "#config": "./src/config.js" } }
```

```js
import cfg from '#config';        // ✓ 原生支持，不需要 tsconfig paths
```

**双包危险（dual package hazard）**：一个包同时提供 CJS 和 ESM 入口，如果依赖树里两条路径都被加载，**同一个类会有两份**，`instanceof` 失败、单例失效。所以库最好只发一种格式（现在推荐纯 ESM），或者确保状态在两份之间共享。

# Node 20 / 22 > 模块系统与依赖 > 依赖管理与安全

来源：https://fqx.lx.ci/node-map/

**`package.json` 声明意图，`package-lock.json` 记录事实。** 两个都要提交。

```bash
npm install       # 按 package.json 装，可能更新 lock
npm ci            # 严格按 lock 装，lock 和 package.json 不一致就报错
```

**CI 里必须用 `npm ci`**。用 `npm install` 的话，CI 装的版本可能和你本地不同——「本地能跑线上崩」的经典来源。

**版本范围符号**：

```
"^1.2.3"    →  >=1.2.3 <2.0.0   允许次版本和补丁更新（默认）
"~1.2.3"    →  >=1.2.3 <1.3.0   只允许补丁更新
"1.2.3"     →  精确
```

**`^` 依赖别人遵守语义化版本**。实践中不是所有包都严格遵守，所以 lock 文件才是真正的保障。

**`dependencies` vs `devDependencies`**：运行时需要的进前者，只在开发/构建用的进后者。生产安装用 `npm ci --omit=dev` 跳过 dev 依赖，镜像小很多。**类型包（`@types/*`）属于 dev**，除非你的包对外导出类型。

**`overrides` 强制统一间接依赖的版本**（修安全漏洞时很实用）：

```json
{ "overrides": { "lodash": "4.17.21" } }
```

**安全审计**：

```bash
npm audit                  # 查已知漏洞
npm audit fix              # 自动修（能在 semver 范围内解决的）
npm audit --production     # 只看生产依赖，噪音少很多
```

**`npm audit` 的信噪比不高**：很多告警是 devDependencies 里的传递依赖，实际不上生产。**先看 `--production` 的结果**，再决定要不要处理 dev 侧的。

**供应链风险的具体防线**：

- **锁文件 + `npm ci`** —— 防止安装时被替换成新版本
- **`--ignore-scripts`** —— 安装时不跑包的 postinstall 脚本（恶意包最常用的入口）。CI 里可以开，但某些包（原生模块）需要它，要挑
- **看清包名** —— typosquatting（`crossenv` vs `cross-env`）是真实攻击手法。装之前确认名字、周下载量、仓库地址
- **`npm ls <pkg>`** —— 查一个包为什么在依赖树里、被谁引入
- **锁定 registry**，企业内网用私有源代理

**保持依赖少**。每个依赖都是攻击面和维护负担。一个 `left-pad` 级别的功能自己写十行，比引入一个包 + 它的十个传递依赖更划算。
