# Node 20 / 22 > 测试、调试与交付 > 资料说明

来源：https://fqx.lx.ci/node-map/

主线对齐 Node 20 / 22 LTS，内置 fetch、node:test、--watch、--env-file 等特性的可用版本都单独标注。

# Node 20 / 22 > 测试、调试与交付

Node 现在自带测试器和 watch 模式，很多工具可以不装了。这块讲三件事：怎么测（含被测代码的可测性）、线上出问题怎么定位（CPU、内存、事件循环三类）、怎么打包上线（Docker 和 Electron 各有坑）。

# Node 20 / 22 > 测试、调试与交付 > 测试：内置 test runner 就够

**Node 20+ 自带测试器**，不需要 Jest：

```js
// test/core.test.js
import { test, describe, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createOrder } from '../src/core.js';

describe('createOrder', () => {
  test('库存不足时抛 409', async () => {
    await assert.rejects(
      () => createOrder({ sku: 'X', qty: 999 }),
      (err) => err.statusCode === 409,
    );
  });
});
```

```bash
node --test                    # 跑 **/*.test.js
node --test --watch            # 改动重跑
node --test --experimental-test-coverage    # 覆盖率
node --test-name-pattern='库存'  # 按名字过滤
```

**用 `node:assert/strict`** 而不是 `assert`——strict 版本的 `equal` 是 `===`，`deepEqual` 不做类型转换。非 strict 版本的 `==` 语义会让 `'1' == 1` 通过，掩盖真实 bug。

**Jest 还有价值的地方**：庞大的 mock 生态、snapshot 测试、前端项目里已经在用。**纯 Node 后端新项目用内置的**，少一堆依赖和 transform 配置（Jest + ESM 的配置至今是个坑）。

**测试要能测，取决于代码怎么写**。三个具体做法：

```js
// ✗ 依赖藏在模块内部，测试时没法替换
import { db } from './db.js';
export async function createOrder(input) { return db.insert(input); }

// ✓ 依赖作为参数传入
export async function createOrder(deps, input) { return deps.db.insert(input); }

// ✓ 或者工厂函数
export function makeOrderService({ db, clock }) {
  return { createOrder: (input) => db.insert({ ...input, at: clock.now() }) };
}
```

**时间也要注进去**（`clock.now()` 而不是 `Date.now()`），否则「跨月的账期计算」这类逻辑没法测。Node 的 `mock.timers` 也能做：

```js
mock.timers.enable({ apis: ['Date', 'setTimeout'] });
mock.timers.setTime(new Date('2026-01-31').getTime());
```

**HTTP 层测试用框架的 inject**，不要起真端口：

```js
const app = buildApp();          // 每个测试文件建自己的实例
await app.ready();
const res = await app.inject({ method: 'POST', url: '/orders', payload: { sku: 'A', qty: 1 } });
assert.equal(res.statusCode, 201);
assert.deepEqual(res.json(), { id: '...' });
```

**数据库测试用真数据库**（SQLite 内存库 `:memory:` 最理想，Postgres 用 testcontainers），不要 mock 掉 SQL——mock 掉之后你测的是 mock，SQL 写错了测试照样绿。

**测试要能并行、顺序无关、可重复跑。** 共享数据库时每个测试用独立事务并回滚，或者独立 schema。做不到就串行跑（`--test-concurrency=1`），慢但正确。

# Node 20 / 22 > 测试、调试与交付 > 调试与线上排障

**本地调试用 inspector，不要 console.log 打点**：

```bash
node --inspect app.js                 # 启动后可接入
node --inspect-brk app.js             # 第一行就断住，等 debugger 接入
```

然后 Chrome 打开 `chrome://inspect`，或 VS Code 里 attach。**`--inspect-brk` 是调试启动阶段问题的关键**（配置加载、插件注册），普通 `--inspect` 接进去时那些代码早跑完了。

**生产上不要开 `--inspect` 监听公网**：inspector 协议没有认证，能执行任意代码。要用就绑 `127.0.0.1` 然后 SSH 端口转发：

```bash
node --inspect=127.0.0.1:9229 app.js
ssh -L 9229:127.0.0.1:9229 server      # 本地 chrome://inspect 就能连
```

**线上三类问题的三种工具**：

**CPU 高 / 请求慢**：

```bash
node --cpu-prof --cpu-prof-dir=/tmp/prof app.js    # 退出时写 .cpuprofile
# 或者运行中通过 inspector 触发 Profiler
```

拿到 `.cpuprofile` 拖进 Chrome DevTools 的 Performance 面板，看火焰图里最宽的那一块。**要找的是「自己代码里的同步计算」**——JSON 序列化、正则、循环、加密。

**内存涨**：

```bash
node --heapsnapshot-signal=SIGUSR2 app.js
kill -USR2 <pid>                        # 生成堆快照，不用重启
```

**这个信号方式很实用**：线上进程内存在涨，不重启就能取快照。取两次（间隔一段时间），在 DevTools Memory 面板做 Comparison，看哪类对象在增长、Retainers 是谁。

**事件循环卡住**：埋 lag 探针（见运行时章）。lag 高但 CPU 不高 → 可能是同步 IO；lag 高且 CPU 高 → 同步计算。

**结构化日志是排障的基础**：

```js
req.log.info({ orderId, sku, qty, durationMs }, 'order created');
```

**每条日志带 requestId，且下游调用把它透传下去**（`traceparent` header）。没有这个，微服务里一次失败的请求要靠时间戳猜关联。`AsyncLocalStorage` 能自动带上下文：

```js
import { AsyncLocalStorage } from 'node:async_hooks';
const als = new AsyncLocalStorage();

app.addHook('onRequest', (req, reply, done) => {
  als.run({ requestId: req.id }, done);
});
// 任何深处的函数都能拿到，不用一路传参
function log(msg) { logger.info({ ...als.getStore(), msg }); }
```

**`AsyncLocalStorage` 是 Node 独有的好东西**（对应 Python 的 contextvars）。它跨 await 保持上下文，这是「不用把 requestId 传遍所有函数」的正解。有一点开销，但换来的可观测性通常值得。

**错误监控接一个**（Sentry 之类）：`uncaughtException` / `unhandledRejection` 上报 + 手动上报关键失败。**没有错误监控的生产服务，等于用户帮你测试。**

# Node 20 / 22 > 测试、调试与交付 > 性能：先量再改

**顺序永远是：量 → 定位 → 改 → 再量。** 跳过第一步的优化基本都是浪费。

**压测工具**：

```bash
npx autocannon -c 100 -d 30 http://localhost:3000/api/orders
# -c 并发连接数, -d 持续秒数
```

看的是 **P99 延迟**和吞吐，不是平均值。平均值好看但 P99 差的服务，用户体验就是「偶尔卡一下」。

**Node 服务常见的性能瓶颈，按出现频率**：

**1. 串行的 await**（见异步章）。一个接口里五次数据库查询串着来，改成 `Promise.all` 立刻快五倍。这是最常见也最容易修的。

**2. N+1 查询**。列表接口对每一行再查一次。改成一次 `IN` 查询 + 内存里组装。

**3. 同步阻塞**。JSON.parse 大对象、同步文件读、正则回溯。

**4. 没有缓存**。同一份不变的数据每次请求都查。加个内存 LRU（`lru-cache`）通常是最便宜的大提升。**注意多实例部署时内存缓存不一致**，要么接受最终一致，要么用 Redis。

**5. 序列化开销**。返回大 JSON 时 `JSON.stringify` 是纯 CPU。Fastify 的 response schema 会预编译序列化函数，比通用 stringify 快很多——**这是给响应写 schema 的第二个理由**。

**6. 日志太吵**。生产开 debug 级别、日志同步写文件，都能明显拖慢。Pino 默认异步写，别改成同步。

**多核利用**：Node 单进程只用一个核。

```js
// 用 cluster 或者更常见的：容器里跑 N 个副本，让编排层负载均衡
import cluster from 'node:cluster';
import { availableParallelism } from 'node:os';

if (cluster.isPrimary) {
  for (let i = 0; i < availableParallelism(); i++) cluster.fork();
} else {
  startServer();
}
```

**容器化部署时更推荐「一个容器一个 Node 进程 + 多副本」**，而不是容器内 cluster。理由：编排层已经做了负载均衡和健康检查，cluster 多一层复杂度（进程管理、日志混合、内存计算），且单进程崩了整个容器重启的语义更清晰。

**worker_threads 用于 CPU 密集**（不是为了并发 IO）：

```js
import { Worker } from 'node:worker_threads';
const worker = new Worker('./heavy.js', { workerData: { input } });
worker.on('message', (result) => { ... });
```

传数据走结构化克隆（有拷贝成本），大数据用 `SharedArrayBuffer` 或 `transferList` 零拷贝转移。**worker 启动有几十毫秒开销**，要复用（做一个 worker 池），不要每个请求 new 一个。

# Node 20 / 22 > 测试、调试与交付 > Docker 与部署

**多阶段构建，最终镜像不含构建工具**：

```dockerfile
# 构建阶段
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci                              # 含 devDependencies，构建需要
COPY . .
RUN npm run build

# 运行阶段
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]
```

**关键点逐条**：

- **先 COPY package.json 再 npm ci，最后 COPY 源码** —— 依赖没变时这一层走缓存，构建快得多
- **`npm ci` 不是 `npm install`** —— 严格按 lock，可重复
- **`NODE_ENV=production`** —— 很多库据此关掉开发检查，Express 的模板缓存也靠它
- **`USER node`** —— 官方镜像自带 node 用户，不要用 root 跑
- **`CMD ["node", ...]` 不要 `npm start`** —— npm 会多一层进程，**信号（SIGTERM）传不到 Node**，优雅关闭失效。这是「为什么我的 shutdown handler 没执行」的常见答案
- **钉版本** `node:22.11-slim` 而不是 `node:22` 或 `latest`
- **Alpine 要谨慎** —— musl libc 和原生模块（better-sqlite3、sharp）可能要重编译或行为不同。省几十 MB 不值得，用 slim

**内存限制必须显式告诉 Node**（见运行时章的 GC 部分）：

```dockerfile
ENV NODE_OPTIONS="--max-old-space-size=768"     # 容器 limit 1GB 的话
```

**不设的后果**：Node 按宿主机内存推算堆上限，容器 limit 远小于它，于是**堆还没到上限进程就被 OOMKilled**，日志里什么都看不到，只有容器重启记录。

**`.dockerignore` 必须有**：

```
node_modules
.git
.env
*.log
dist
```

**不写的后果**：把本地 `node_modules`（可能是另一个平台编译的原生模块）拷进镜像，以及把 `.env` 里的密钥打进镜像层——**镜像层是可以被任何拿到镜像的人翻出来的**，删掉再提交也没用。

**健康检查**：

```js
app.get('/health', async () => ({ ok: true }));            // 存活：进程还在
app.get('/ready', async () => {
  await db.ping();                                          // 就绪：依赖也好了
  return { ok: true };
});
```

**liveness 和 readiness 要分开**：liveness 失败会重启容器，所以它不该依赖数据库（数据库抖一下不该重启应用）；readiness 失败只是从负载均衡摘掉，它该检查依赖。**混在一起的后果是数据库短暂不可用导致所有应用实例连环重启。**

# Node 20 / 22 > 测试、调试与交付 > Electron：把 Web 应用变桌面端

**架构是两个进程**：主进程（Node 环境，管窗口和系统 API）和渲染进程（Chromium，跑你的页面）。它们通过 IPC 通信。

**安全配置是不能省的**：

```js
new BrowserWindow({
  webPreferences: {
    contextIsolation: true,        // 必须 true（默认）
    nodeIntegration: false,        // 必须 false（默认）
    sandbox: true,
    preload: path.join(__dirname, 'preload.cjs'),
  },
});
```

**`nodeIntegration: true` 等于把 `require` 给了页面**——一旦有 XSS，攻击者能读文件、起进程。老教程里到处是这个配置，都不要照抄。

**preload 是唯一的桥**，用 `contextBridge` 暴露**窄接口**：

```js
// preload.cjs
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  createOrder: (input) => ipcRenderer.invoke('order:create', input),
  // ✗ 不要暴露 ipcRenderer 本身，也不要暴露 (channel, args) => invoke(channel, args)
});
```

**暴露通用的 invoke 等于没有隔离**。每个能力单独一个函数，主进程侧再校验一遍参数——**渲染进程的输入同样不可信**（页面可能加载了第三方内容）。

**几个实际的坑**（这些是踩过才知道的）：

**ESM 主进程不能 `require`**。`"type": "module"` 的项目里主进程是 ESM，preload 却通常需要是 CJS（`.cjs` 扩展名）。混合的项目要小心两边的模块格式。

**自定义协议要在 `app.ready` 之前注册 scheme 特权**：

```js
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);   // 必须在 app.whenReady() 之前调用
app.whenReady().then(() => { protocol.handle('app', handler); });
```

**`file://` 页面 fetch 自定义协议会被 CORS 挡**。用 `app://` 之类的自定义协议加载页面（而不是 `file://`）才能正常发请求。验证的时候可以用 `<img>` 标签绕过 CORS 确认协议本身通了。

**单实例锁会让第二个实例静默退出**：

```js
if (!app.requestSingleInstanceLock()) app.quit();
```

调试时用不同的 `--user-data-dir` 才能开多个实例，否则第二个直接消失，看起来像启动失败。

**原生模块要匹配 Electron 的 ABI**：better-sqlite3 这类需要 `electron-rebuild` 或用 prebuilt。**N-API 模块（better-sqlite3 新版本）跨版本稳定，不需要重编译**——这是选它的一个实际理由。

**headless 验证 Electron**（CI 里跑）：

```bash
xvfb-run electron . --remote-debugging-port=9222 --user-data-dir=/tmp/e1
# 然后用 CDP 连上去检查 DOM、跑断言
```

**打包用 electron-builder**。交叉编译 Windows 包在 Linux 上可行（zip 目标直接可用；NSIS 需要 wine32）。**签名和自动更新要提前规划**——没签名的应用在 Windows 上会被 SmartScreen 拦，macOS 上直接打不开。
