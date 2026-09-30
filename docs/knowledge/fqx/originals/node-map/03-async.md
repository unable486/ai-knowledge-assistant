# Node 20 / 22 > 异步编程与流 > 资料说明

来源：https://fqx.lx.ci/node-map/

来源：https://fqx.lx.ci/node-map/

主线对齐 Node 20 / 22 LTS，内置 fetch、node:test、--watch、--env-file 等特性的可用版本都单独标注。

# Node 20 / 22 > 异步编程与流

来源：https://fqx.lx.ci/node-map/

async/await 让异步代码读起来像同步，但错误处理、并发控制、取消这三件事仍然要显式处理。流（Stream）是另一半：它让「处理比内存大的数据」成为可能，背压机制是它区别于「先全读进内存」的核心。

# Node 20 / 22 > 异步编程与流 > Promise 与 async/await

来源：https://fqx.lx.ci/node-map/

**`async` 函数永远返回 Promise**，即使 return 的是普通值。**`await` 只在 async 函数里能用**（顶层 await 需要 ESM）。

**串行 vs 并发，这是最常见的性能问题**：

```js
// ✗ 串行：总时间 = a + b + c
const a = await fetchA();
const b = await fetchB();
const c = await fetchC();

// ✓ 并发：总时间 = max(a, b, c)
const [a, b, c] = await Promise.all([fetchA(), fetchB(), fetchC()]);
```

**注意 `Promise.all` 的语义**：任何一个 reject，整体立刻 reject，**但其他请求不会被取消**（Promise 没有取消机制），它们继续跑完，结果被丢弃。如果那些请求有副作用（写数据库），这是个隐患。

**四个组合器的区别**：

| 方法 | 行为 |
|---|---|
| `Promise.all` | 全部成功才成功；**第一个失败就整体失败** |
| `Promise.allSettled` | **等全部结束**，返回 `{status, value/reason}` 数组，永不 reject |
| `Promise.race` | 第一个**结算**（成功或失败）的胜出 |
| `Promise.any` | 第一个**成功**的胜出；全失败才 reject（AggregateError） |

**批量处理时用 `allSettled`**——你通常想知道「哪几个失败了」而不是「第一个失败就全放弃」：

```js
const results = await Promise.allSettled(ids.map(fetchOne));
const ok = results.filter(r => r.status === 'fulfilled').map(r => r.value);
const failed = results.filter(r => r.status === 'rejected');
logger.warn({ failedCount: failed.length }, '部分失败');
```

**`Promise.race` 做超时**：

```js
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms)),
  ]);
}
```

**这个实现有个泄漏**：定时器不会被清，且原 promise 继续跑。**更好的是用 `AbortSignal.timeout()`**（见下面取消那节），它能真正中断底层请求。

**并发不能无限**：一次 `Promise.all` 一万个请求会打爆对端和自己的文件句柄。要限流：

```js
// 手写一个简单的并发闸门
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}
const out = await mapLimit(urls, 10, fetchOne);   // 最多 10 个在飞
```

生产上用 `p-limit` / `p-map` 这类库更省事，但知道原理就能自己写十行解决。

# Node 20 / 22 > 异步编程与流 > Promise 与 async/await > 错误处理的边界

来源：https://fqx.lx.ci/node-map/

**`await` 的 reject 能被 try/catch 抓到，回调里的异常不能**：

```js
try {
  await fetchData();                  // ✓ reject 变成异常，能抓
} catch (e) { ... }

try {
  setTimeout(() => { throw new Error('x'); }, 0);   // ✗ 抓不到！
} catch (e) { ... }                   // 这里执行时回调还没跑
```

**回调里的异常会冒到 `uncaughtException`**，直接崩进程。所以**任何回调、任何事件处理器都要自己包 try/catch**。

**忘记 await 是最隐蔽的 bug**：

```js
async function handler(req, res) {
  saveToDb(req.body);        // ✗ 没 await
  res.send('ok');            // 立刻返回 ok，但保存可能失败
}
// 后果：接口报成功，数据没存；失败变成 unhandledRejection
```

**防线是 lint**：`@typescript-eslint/no-floating-promises` 规则专门查这个，值得开成 error。TS 项目一定要开。

**故意不等的情况要显式标注**：

```js
void logAnalytics(event);                        // 明确表示「不关心结果」
logAnalytics(event).catch(err => logger.warn(err));   // 更好：至少记录失败
```

**`unhandledRejection` 现在会崩进程**（Node 15+ 的默认行为）。这是正确的默认值——静默失败比崩溃更危险。

**错误要保留栈和原因**：

```js
try {
  await parseConfig(raw);
} catch (err) {
  throw new Error('配置解析失败', { cause: err });    // ✓ Node 16.9+
}
```

`cause` 是标准的错误链机制，`console.error` 和多数日志库会打印整条链。**不要 `throw new Error(err.message)`**，那样原始栈就丢了。

**async 函数里的错误传播是逐层的**：

```js
async function a() { throw new Error('x'); }
async function b() { await a(); }         // 不 catch 就继续往上抛
async function c() {
  try { await b(); } catch (e) { /* 在这里处理 */ }
}
```

**在哪一层 catch 是个设计决定**：能恢复的地方 catch（重试、用默认值），不能恢复就让它抛到统一的错误中间件（见服务端章）。**最坏的是每一层都 catch 然后只打日志再继续**——调用方以为成功了。

# Node 20 / 22 > 异步编程与流 > Promise 与 async/await > 取消：AbortController

来源：https://fqx.lx.ci/node-map/

**Promise 本身没有取消。** Node 用 `AbortController` / `AbortSignal` 提供协作式取消，和浏览器一致。

```js
const ac = new AbortController();
setTimeout(() => ac.abort(), 3000);

try {
  const res = await fetch(url, { signal: ac.signal });
} catch (e) {
  if (e.name === 'AbortError') console.log('已取消');
}
```

**内置的超时 signal 更简洁**：

```js
await fetch(url, { signal: AbortSignal.timeout(3000) });      // Node 17.3+
```

**组合多个信号**（比如「超时 或 用户取消」都算）：

```js
const signal = AbortSignal.any([ac.signal, AbortSignal.timeout(5000)]);   // Node 20+
```

**支持 signal 的 Node API 比想象的多**：`fetch`、`fs.readFile`、`fs.writeFile`、`stream.pipeline`、`events.once`、`setTimeout`（promisified 版本）、`child_process`、`server.close`。

**自己的函数也应该接受 signal**，这是良好的 API 设计：

```js
async function poll(url, { signal } = {}) {
  while (true) {
    signal?.throwIfAborted();                 // 每轮检查，已取消就抛
    const r = await fetch(url, { signal });
    if (r.ok) return r.json();
    await scheduler.wait(1000, { signal });   // 可取消的 sleep（Node 17+）
  }
}
```

**`throwIfAborted()`** 比手动 `if (signal.aborted) throw` 更规范。**长循环里必须检查**，否则取消信号发出后循环还在跑。

**HTTP 请求场景的实际价值**：客户端断开连接时（用户关了页面），把 signal 传给下游调用，能避免继续做无用的工作。Fastify 里 `request.raw.on('close')` 能感知，Express 类似。

**和 Python 对照**：Python asyncio 的 `task.cancel()` 是往协程里抛 `CancelledError`，更强制；Node 的 AbortSignal 是纯协作——**被调用方不检查 signal，取消就没有效果**。所以 Node 里「取消」实际是「通知对方该停了」。

# Node 20 / 22 > 异步编程与流 > 流与背压

来源：https://fqx.lx.ci/node-map/

**流的价值：处理比内存大的数据，且更快开始产出。**

```js
// ✗ 整个文件进内存，10GB 文件直接 OOM
const data = await fs.promises.readFile('big.csv');
process(data);

// ✓ 流式，内存占用是常数
import { pipeline } from 'node:stream/promises';
await pipeline(
  createReadStream('big.csv'),
  parseCsv(),
  transformRows(),
  createWriteStream('out.csv'),
);
```

**四种流**：

| 类型 | 作用 | 例子 |
|---|---|---|
| Readable | 读出数据 | `fs.createReadStream`、HTTP request |
| Writable | 写入数据 | `fs.createWriteStream`、HTTP response |
| Duplex | 双向独立 | TCP socket |
| Transform | 读入 → 转换 → 写出 | `zlib.createGzip()` |

**背压（backpressure）是流的核心机制**：写入方比读取方快时，需要一个「慢下来」的信号。

```js
// ✗ 手动 pipe 不处理背压，写不动时数据在内存里堆积 → 内存爆掉
readable.on('data', chunk => writable.write(chunk));

// ✓ pipeline 自动处理背压和错误传播
await pipeline(readable, writable);
```

**原理**：`writable.write()` 返回 `false` 表示内部缓冲已超过 `highWaterMark`，此时应该停止写入，等 `'drain'` 事件再继续。`pipeline` / `pipe` 帮你做了这件事。

**永远用 `pipeline` 而不是 `.pipe()`**。区别很实际：`.pipe()` **不转发错误也不清理**——上游出错时下游的文件句柄不会关，是句柄泄漏的常见来源。`pipeline`（尤其是 `stream/promises` 版本）会在任一环节出错时销毁所有流，并 reject。

**异步迭代器让流用起来更顺**：

```js
for await (const chunk of readable) {
  await handle(chunk);          // 自动背压：处理慢了就不会继续读
}
```

**`for await` 的背压是免费的**——循环体没执行完就不会拉下一块。这是处理流最易读的写法。

**Transform 流用生成器写**：

```js
async function* upper(source) {
  for await (const chunk of source) {
    yield chunk.toString().toUpperCase();
  }
}
await pipeline(createReadStream('in.txt'), upper, createWriteStream('out.txt'));
```

**pipeline 直接接受异步生成器**，不用继承 Transform 类。这是现在写流处理最简洁的方式。

# Node 20 / 22 > 异步编程与流 > 流与背压 > Buffer 与编码

来源：https://fqx.lx.ci/node-map/

**`Buffer` 是 Node 的二进制数据容器**（`Uint8Array` 的子类），分配在**堆外**（不算在 `--max-old-space-size` 里，但算 RSS）。

```js
Buffer.from('中文', 'utf8')        // 字符串 → Buffer（6 字节）
buf.toString('utf8')               // Buffer → 字符串
Buffer.alloc(1024)                 // 零填充，安全
Buffer.allocUnsafe(1024)           // 不清零，快，但可能含旧内存的残留数据
```

**`allocUnsafe` 的风险是真实的**：它返回的内存可能包含之前释放的数据（别人的密码、token）。如果不立刻完全覆写就发出去，等于信息泄漏。**默认用 `alloc`**，除非你确定马上会填满整块。

**长度陷阱**：

```js
'中文'.length                       // 2（UTF-16 码元数）
Buffer.byteLength('中文', 'utf8')   // 6（字节数）
```

HTTP `Content-Length`、数据库字段长度都是**字节**。用 `.length` 算会错。

**多字节字符会被 chunk 边界切断**：

```js
// ✗ 一个 UTF-8 字符跨两个 chunk 时，两边都是乱码
for await (const chunk of stream) {
  process(chunk.toString('utf8'));
}

// ✓ 用 StringDecoder 或给流设编码
import { StringDecoder } from 'node:string_decoder';
const decoder = new StringDecoder('utf8');
for await (const chunk of stream) {
  process(decoder.write(chunk));       // 自动缓存不完整的字符
}
process(decoder.end());

// 或者最简单：
stream.setEncoding('utf8');            // 流自己处理边界
```

**这个 bug 在测试小文件时永远不出现**（一个 chunk 装完了），上线遇到大文件才暴露，且只影响某些位置的中文字符。

**拼接 Buffer 用 `Buffer.concat`**，不要 `+`（会转成字符串）：

```js
const chunks = [];
for await (const c of stream) chunks.push(c);
const full = Buffer.concat(chunks);
```

**但这就退化成「全读进内存」了**——只在确定数据小的时候用。有大小上限的话要主动检查并拒绝，否则是内存耗尽攻击的入口。

# Node 20 / 22 > 异步编程与流 > 流与背压 > Web Streams 与互操作

来源：https://fqx.lx.ci/node-map/

Node 18+ 内置了 **Web Streams API**（`ReadableStream`、`WritableStream`、`TransformStream`），和浏览器 / Deno / Cloudflare Workers 一致。

**为什么会有两套**：Node Streams 是 Node 自己的历史实现，Web Streams 是后来的 Web 标准。`fetch` 的 `response.body` 是 Web Stream，`fs.createReadStream` 是 Node Stream。

**互转**：

```js
import { Readable, Writable } from 'node:stream';

// Web → Node
const nodeStream = Readable.fromWeb(webReadable);
// Node → Web
const webStream = Readable.toWeb(nodeReadable);
```

**实际场景：把 fetch 的响应流式写到文件**：

```js
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { createWriteStream } from 'node:fs';

const res = await fetch(url);
await pipeline(Readable.fromWeb(res.body), createWriteStream('out.bin'));
```

**这样下载大文件不占内存**。对比 `await res.arrayBuffer()` 会把整个文件读进内存——下载 2GB 文件时直接 OOM。

**流式处理 LLM 的 SSE 响应**（做 AI 应用一定会遇到）：

```js
const res = await fetch(apiUrl, { method: 'POST', body: JSON.stringify(payload) });
const reader = res.body.getReader();
const decoder = new TextDecoder();
let buf = '';

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buf += decoder.decode(value, { stream: true });   // stream:true 处理跨块字符
  const lines = buf.split('\n');
  buf = lines.pop();                                 // 最后一行可能不完整，留着
  for (const line of lines) {
    if (line.startsWith('data: ')) {
      const data = line.slice(6);
      if (data === '[DONE]') return;
      handleDelta(JSON.parse(data));
    }
  }
}
```

**两个关键点**：`TextDecoder` 的 `{ stream: true }` 处理跨 chunk 的多字节字符；**手动缓存不完整的最后一行**——SSE 的一条消息可能被切成两个 chunk，不缓存就会 JSON.parse 失败。这两个都是实际会踩的坑。

# Node 20 / 22 > 异步编程与流 > EventEmitter 与异步迭代

来源：https://fqx.lx.ci/node-map/

**EventEmitter 是 Node 内部大量使用的模式**（server、socket、stream 都是）。

```js
import { EventEmitter } from 'node:events';

class Job extends EventEmitter {
  async run() {
    this.emit('start');
    try {
      const r = await work();
      this.emit('done', r);
    } catch (e) {
      this.emit('error', e);      // 'error' 是特殊事件名
    }
  }
}
```

**`'error'` 事件没有监听器时会抛异常崩进程**。这是刻意设计（防止静默失败），但意味着**任何可能 emit error 的 emitter 都必须有 error 监听器**。

**`emit` 是同步的**：所有监听器按注册顺序**同步**执行完，`emit()` 才返回。所以监听器里的重计算会阻塞事件循环，监听器里的异步错误不会被 emit 的调用方捕获。

```js
emitter.on('data', async (d) => {
  await save(d);          // ✗ 失败变成 unhandledRejection
});
emitter.on('data', async (d) => {
  try { await save(d); } catch (e) { logger.error(e); }   // ✓
});
```

**内存泄漏警告**：默认监听器上限是 10，超了打 `MaxListenersExceededWarning`。**看到这个警告先查是不是在请求处理函数里 `on()`**——每个请求加一个，永远不移除。

```js
emitter.once('done', fn);                 // 自动移除
emitter.off('done', fn);                  // 手动移除，需要同一个函数引用
emitter.setMaxListeners(50);              // 确实需要更多时才调
```

**把事件转成 Promise / 异步迭代器**：

```js
import { once, on } from 'node:events';

const [result] = await once(emitter, 'done');            // 等一次事件
// 支持 signal，避免永远等下去
const [r] = await once(emitter, 'done', { signal: AbortSignal.timeout(5000) });

for await (const [chunk] of on(emitter, 'data')) {        // 事件流当迭代器
  await handle(chunk);
}
```

**`once` 会自动处理 `'error'`**（转成 reject），比手动注册两个监听器干净。

**什么时候用 EventEmitter，什么时候不用**：一对多通知、生命周期钩子、流式产出用它。**请求-响应式的调用不要用它**——用 async 函数返回值，错误处理和类型都好得多。EventEmitter 的错误处理是最弱的一环。
