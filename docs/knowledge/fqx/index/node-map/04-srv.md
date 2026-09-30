# Node 20 / 22 > HTTP 服务端 > 资料说明

来源：https://fqx.lx.ci/node-map/

主线对齐 Node 20 / 22 LTS，内置 fetch、node:test、--watch、--env-file 等特性的可用版本都单独标注。

# Node 20 / 22 > HTTP 服务端

Node 做服务端的核心不是框架，是 HTTP 语义、错误处理边界、以及「每个请求的资源必须在请求结束时释放」。Fastify 比 Express 快且默认更安全（schema 校验、封装、异步错误能抓到），但坑换了位置：插件封装、content type parser、序列化。这块按你实际在用的栈写。

# Node 20 / 22 > HTTP 服务端 > HTTP 本身：先把协议钉死

**请求进来之后发生的事**（不管什么框架）：

1. TCP 连接建立（或从 keep-alive 池里复用）
2. 读请求行 + headers，到空行结束
3. 根据 `Content-Length` 或 chunked 读 body
4. 你的业务逻辑
5. 写响应行 + headers + body
6. 连接复用或关闭

**几个协议层的坑，框架挡不住**：

**`Content-Length` vs 实际 body 长度不一致**。短了，对端等到超时；长了，下一个请求的头被当成这个请求的尾巴——这是 HTTP 请求走私（request smuggling）的入口。Node 的 `http` 模块对这种错配会报错，但反向代理（nginx）和 Node 对 `Transfer-Encoding` + `Content-Length` 同时出现的处理如果不一致，走私就能成立。**生产上只让一层解析 HTTP**（通常是 nginx），后面用 HTTP/1.1 或 HTTP/2 干净地转发给 Node。

**Keep-alive 是默认的**（HTTP/1.1）。一个 TCP 连接上串行多个请求。好处是省握手，坏处是：**一个慢请求会堵住这条连接上后面的请求**（队头阻塞）。HTTP/2 多路复用解决了这个，但 Node 的 HTTP/2 支持和生态（尤其是反向代理）要单独配。实践上 HTTP/1.1 + 合理的超时更常见。

**超时要分层设**：

```js
server.requestTimeout = 30_000;     // 整个请求（含读 body + 处理）的上限
server.headersTimeout = 10_000;     // 只等 headers
server.keepAliveTimeout = 5_000;    // keep-alive 空闲多久断
server.timeout = 0;                 // socket 超时，0 = 不设（让上面几个管）
```

**不设超时的服务会被慢速攻击打满**：攻击者每个字节隔几秒发一次，占着连接不放。`headersTimeout` 是专门防这个的。

**状态码的语义不要乱用**：

| 码 | 含义 | 不该用的场合 |
|---|---|---|
| 200 | 成功，有 body | 创建资源成功该用 201 |
| 204 | 成功，无 body | 别拿 200 空 body 代替 |
| 400 | 客户端请求本身有问题 | 别把业务失败（余额不足）当成 400 |
| 401 | 没认证 | 和 403 的区别：401 是「你是谁我不知道」，403 是「知道你是谁但不让」 |
| 404 | 资源不存在 | 也用于「不想暴露这个资源存在」 |
| 409 | 冲突 | 唯一键冲突、乐观锁版本不对 |
| 422 | 语义错误 | 语法对但业务校验失败（和 400 的分界有争议，团队定一个就行） |
| 429 | 限流 | 必须带 `Retry-After` |
| 500 | 服务器没料到的错误 | **不要把可预期的业务失败用 500** |
| 502/504 | 网关问题 | 通常是 nginx 报的，Node 自己不该发 |

**HEAD 请求必须和 GET 返回同样的 headers，只是没有 body。** 框架通常自动处理，自己写原生 http 时容易忘。

# Node 20 / 22 > HTTP 服务端 > HTTP 本身：先把协议钉死 > 读 body：大小限制与 Content-Type

**永远不要无限制地读 body**。一个 10GB 的 POST 能把内存打满。

```js
// Fastify 默认 1MB
fastify.addContentTypeParser('application/json', { parseAs: 'string', bodyLimit: 1_048_576 }, ...);

// 原生
if (Number(req.headers['content-length']) > MAX) {
  res.writeHead(413);
  res.end();
  return;
}
```

**`413 Payload Too Large`** 是超限时的正确响应。nginx 也要配 `client_max_body_size`，两层都限，因为 nginx 先收到。

**Content-Type 决定怎么解析**：

| Content-Type | 解析成 | 注意 |
|---|---|---|
| `application/json` | 对象 | 必须 try/catch，非法 JSON 是 400 不是 500 |
| `application/x-www-form-urlencoded` | 对象 | 嵌套和数组的编码各家不同 |
| `multipart/form-data` | 文件 + 字段 | **必须流式写磁盘或对象存储**，不能整段进内存 |
| `text/plain` | 字符串 | 编码呢？看 charset |
| 没有 / 不认识 | — | **不要猜测**，回 415 Unsupported Media Type |

**JSON.parse 非法输入会抛**，不抓就是 500。Fastify 的 schema 校验在 parse 之后，非法 JSON 走的是 content type parser 的错误路径——要自己确认这条路径返回 400。

**multipart 是文件上传的唯一正确方式**，但也是最容易被打的：

- 限制文件大小、文件个数、总大小
- 限制允许的 MIME（不要只看扩展名，看 magic bytes）
- 文件名用自己生成的，不要用用户给的（路径穿越）
- 不要把上传目录放在静态文件服务下面（否则上传一个 .html 就能 XSS，上传一个脚本就更糟）
- 用 `@fastify/multipart` 的流式 API，不要 `parts` 全进内存

**Express 的 `body-parser` / Fastify 的 parser 默认都不处理 multipart**，要单独装插件。忘记装的现象是 `req.body` 是 undefined，前端说「我明明传了」。

# Node 20 / 22 > HTTP 服务端 > Fastify：封装、插件与 schema

**Fastify 的三个核心概念：封装、插件、schema。** 理解这仨，手册剩下的都是 API。

**封装（encapsulation）**：每个插件有自己的上下文。在插件里 `decorate`、注册 hook、加路由，默认不影响父级和其他插件。

```js
fastify.register(async function authScope(app) {
  app.decorateRequest('user', null);
  app.addHook('preHandler', async (req) => {
    req.user = await verify(req.headers.authorization);
  });
  app.get('/me', async (req) => req.user);     // 有 user
});
fastify.get('/health', async () => ({ ok: true }));  // 没有 user，也没有那个 hook
```

**这就是 Fastify 比 Express 中间件干净的地方**：中间件的作用域是显式的，不会「这个 app.use 到底影响哪些路由」靠注册顺序猜。

**想跨封装共享，用 `fastify-plugin` 包一层**，它会打破封装把装饰提升到父级。**鉴权、数据库连接这类基础设施用 `fastify-plugin`，业务路由不用。**

```js
import fp from 'fastify-plugin';
export default fp(async function dbPlugin(app) {
  const db = openDatabase();
  app.decorate('db', db);
  app.addHook('onClose', () => db.close());
});
```

**schema 既是文档也是防护**：

```js
app.post('/orders', {
  schema: {
    body: {
      type: 'object',
      required: ['sku', 'qty'],
      properties: {
        sku: { type: 'string', minLength: 1, maxLength: 64 },
        qty: { type: 'integer', minimum: 1, maximum: 999 },
      },
      additionalProperties: false,          // 关键：丢掉没声明的字段
    },
    response: {
      200: { type: 'object', properties: { id: { type: 'string' } } },
    },
  },
}, async (req, reply) => {
  const { sku, qty } = req.body;            // 到这里已经校验过、类型对过
  return { id: await createOrder(sku, qty) };
});
```

**`additionalProperties: false` 必须开。** 否则客户端多传的字段（`role: 'admin'`）会进业务逻辑。这是质量检查里最容易漏、也最危险的一项。

**response schema 会做序列化过滤**：没列的字段不会出现在响应里。这是防止「把密码哈希返回给前端」的最后一道闸。**有内部字段的对象不要直接 `return user`，要么挑字段要么写 response schema。**

**异步路由可以直接 throw，Fastify 能抓住**：

```js
app.get('/x', async () => {
  throw Object.assign(new Error('没找到'), { statusCode: 404 });
});
```

Express 4 做不到（异步错误要自己 `next(err)`），这是换 Fastify 最实在的收益之一。

# Node 20 / 22 > HTTP 服务端 > Fastify：封装、插件与 schema > Hook 顺序与错误处理

**请求生命周期的 hook 顺序**：

```
onRequest → preParsing → preValidation → preHandler → handler → preSerialization → onSend → onResponse
```

出错走 `onError`，连接断开走 `onTimeout` / `onRequestAbort`。

**常见用法对应的位置**：

| 需求 | hook |
|---|---|
| 鉴权（不需要 body） | `onRequest` 或 `preHandler` |
| 改 raw body | `preParsing` |
| 校验之后、业务之前 | `preHandler`（最常用） |
| 改响应对象 | `preSerialization` |
| 记访问日志 | `onResponse`（这时有 statusCode 和耗时） |
| 统一错误格式 | `setErrorHandler` |

**`onRequest` 里没有 `req.body`**（还没解析）。要读 body 的鉴权（比如签名校验）放 `preHandler`。

**错误处理只设一处**：

```js
app.setErrorHandler((err, req, reply) => {
  const status = err.statusCode || err.status || 500;
  if (status >= 500) {
    req.log.error({ err }, 'unhandled');
    reply.code(500).send({ error: 'internal', requestId: req.id });   // 不把内部信息给客户端
  } else {
    reply.code(status).send({ error: err.message, requestId: req.id });
  }
});
```

**5xx 记完整错误、给客户端只给 requestId**；4xx 可以把 message 给出去（这是客户端能修的）。**绝对不要 `send(err)` 把栈发到生产环境。**

**自定义业务错误用一个基类带 statusCode**，handler 里 `throw new DomainError('库存不足', 409)`，错误处理器按 statusCode 分流。你的 POS 项目就是这么做的。

**`setNotFoundHandler`** 单独处理 404，别让它掉进通用错误处理器变成 500。

**日志用 Fastify 自带的 Pino**，不要再引入 winston。`req.log` 自动带 requestId，这是排障时把一次请求的所有日志串起来的关键。

```js
req.log.info({ orderId }, 'created');     // 结构化，不要拼接字符串
```

**生产开 `pino-pretty` 是错的**——pretty 是给开发看的，生产出 JSON 给采集器。

# Node 20 / 22 > HTTP 服务端 > Fastify：封装、插件与 schema > 启动、关闭与插件加载顺序

**`listen` 之前所有插件必须注册完**。`register` 是异步的，要用 `await app.register(...)` 或把 listen 放 `after` 里：

```js
await app.register(dbPlugin);
await app.register(routes);
await app.listen({ port: 3000, host: '0.0.0.0' });    // 容器里必须 0.0.0.0
```

**`host` 默认是 `localhost`**，容器里不改就外部访问不了——这是 Docker 部署 Node 的第一个坑。

**关闭**：

```js
const shutdown = async () => {
  await app.close();          // 触发 onClose hook，等在途请求
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
```

`app.close()` 会：停收新连接 → 等在途请求结束 → 跑 `onClose` hook（关数据库、关队列）。**数据库连接的关闭放 `onClose`，不要散落在 SIGTERM 处理器里**，否则测试里 `app.close()` 关不干净。

**插件顺序有依赖时显式表达**：

```js
app.register(fp(async (app) => {
  await app.register(dbPlugin);       // 先有 db
  await app.register(userRoutes);     // 路由用 app.db
}));
```

Fastify 4+ 的 `app.ready()` 会等所有插件加载完。测试里常用：`await app.ready(); await app.inject({ method: 'GET', url: '/health' })`。

**`inject` 是 Fastify 测试的正确方式**：不听端口、不走网络，直接调内部 HTTP 处理。比 `supertest` 对着真实端口打更快更稳。**每个测试用独立的 app 实例**（不要共享全局 app），避免测试间状态泄漏。

# Node 20 / 22 > HTTP 服务端 > 和数据库打交道

**连接池大小、事务边界、参数化查询**——这三件事比选 ORM 重要。

**参数化是唯一的注入防线**（见 SQL 导图的注入章）。Node 这边的形态：

```js
// ✗
db.prepare(`SELECT * FROM users WHERE name = '${name}'`).get();
// ✓ better-sqlite3
db.prepare('SELECT * FROM users WHERE name = ?').get(name);
// ✓ pg
await client.query('SELECT * FROM users WHERE name = $1', [name]);
```

**标识符（表名、列名、ORDER BY 字段）不能参数化**，必须白名单。你的 POS 如果有动态排序，这一条必须落地。

**better-sqlite3 是同步的**——这是它的特性不是缺陷。SQLite 本身是嵌入式、同进程、延迟以微秒计，同步 API 更简单且更快。**不要用 `sqlite3` 那个异步包装去「符合 Node 风格」**，那是给自己找麻烦。

**同步的含义**：一次查询会占着事件循环。对 SQLite 通常是几十微秒到几毫秒，可接受。**一旦查询可能扫全表或锁等待，就可能把服务卡住。** 这是选 SQLite 做服务端存储时的核心约束——适合中小规模、写并发不高的场景（POS、单机工具、本地 RAG），不适合高并发写。

**写并发**：SQLite 同一时刻只能一个写者。WAL 模式能让读不被写阻塞，但写还是串行的。

```js
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');          // 默认关的，必须显式开
db.pragma('busy_timeout = 5000');        // 锁等待 5 秒而不是立刻 SQLITE_BUSY
```

**事务里做完所有读写再结束**，不要在事务里 await HTTP 或做重计算——SQLite 的写锁会一直被占着。

```js
const insert = db.transaction((items) => {
  for (const it of items) stmt.run(it);
});
insert(items);        // 要么全成要么全不成
```

**`db.transaction()` 返回的函数是同步且自动 commit/rollback 的。** 函数抛异常就回滚。这是 better-sqlite3 最该用的 API。

**pg / mysql2 是异步的**，连接池是必须的：

```js
import pg from 'pg';
const pool = new pg.Pool({ max: 10, idleTimeoutMillis: 30_000 });
// 每个请求：
const { rows } = await pool.query('SELECT ...', [id]);
// 事务：
const client = await pool.connect();
try {
  await client.query('BEGIN');
  ...
  await client.query('COMMIT');
} catch (e) {
  await client.query('ROLLBACK');
  throw e;
} finally {
  client.release();            // 必须还，否则池子被掏空
}
```

**`finally` 里 release 漏了，是连接池被打满的第一原因。** 跑一段时间后所有请求卡在「等连接」，然后超时。监控 `pool.waitingCount` / `pool.idleCount`。

# Node 20 / 22 > HTTP 服务端 > 和数据库打交道 > 要不要上 ORM

**中小项目、SQL 不多、查询模式固定：不用 ORM。** 你的 POS 用手写 SQL + better-sqlite3 是对的——查询看得懂、性能可预期、出问题能直接 EXPLAIN。

**ORM 真正的价值**：

- 多数据库方言（基本用不到）
- 迁移工具（这个有用，但可以单独用）
- 对象关系映射（复杂对象图时省事）
- schema 即代码（Prisma 这类）

**ORM 真正的代价**：

- **N+1 查询**：`users.map(u => u.orders)` 默认每人一条 SQL。必须懂 `include` / `eager load`，不懂就等线上慢查询
- **生成的 SQL 不可控**：复杂报表、窗口函数、部分索引，ORM 要么不支持要么生成一坨
- **隐式查询**：访问个属性就触发一次 IO，在 Node 里是一次 await，很容易在循环里写出几十次串行查询

**折中是 Query Builder**（Knex、Kysely、Drizzle）：还是写 SQL 的结构，但有组合、有类型、防注入。比 ORM 透明，比字符串拼接安全。**TypeScript 项目现在更推荐 Drizzle / Kysely**。

**迁移必须有**，不管手写还是 ORM：

```
migrations/
  001_init.sql
  002_add_orders_index.sql
```

**正向迁移可重复跑（IF NOT EXISTS），永远不要改已经上线的迁移文件。** 数据和代码一起版本化。SQLite 可以用 `user_version` pragma 记当前版本。

**Prisma 的迁移和类型生成很舒服，但运行时是个 query engine 二进制**——和 Electron 打包、某些 Alpine 镜像会打架。Electron 应用（你的 POS 桌面版）里不要用 Prisma，继续 better-sqlite3。

# Node 20 / 22 > HTTP 服务端 > Web 安全清单

**按出现频率和后果排**：

**1. 注入（SQL / 命令 / 路径）**
SQL 用参数化；`child_process` 用数组形式的 `spawn(cmd, args)` 而不是 `exec(字符串)`；文件路径 `path.join(root, userInput)` 之后必须 `realpath` 再确认还在 root 下。

**2. XSS**
Node 做 API 时自己不渲染 HTML，XSS 是前端的事。但 **API 返回的字段会被前端插进 DOM**——对用户输入做存储时的消毒仍然有意义。Open redirect（`res.redirect(req.query.url)`）也算。

**3. CSRF**
Cookie 带会话时必须防。**API 用 Authorization header 不走 Cookie，天然免疫 CSRF。** 这是 SPA + Token 方案的一个实际好处。如果用 Cookie：SameSite=Lax（或 Strict）+ CSRF token。

**4. 认证与会话**
- 密码：**Argon2id 或 bcrypt**，不要 MD5/SHA。bcrypt 有 72 字节截断问题，超长密码先 hash 一次再 bcrypt
- JWT：存的是声明不是会话。**没法作废单张 token**（除非维护黑名单，那就不如用会话）。过期时间短 + refresh token 是常规补丁
- **Secret 从环境变量读，长度够，轮换有方案**
- 登录接口要限流，否则被喷密码

**5. 授权（IDOR）**
`GET /orders/123` 必须验证 123 属于当前用户，不能只验证「已登录」。**这是实际被打最多的授权问题**，比那些花哨的攻击常见十倍。测试里用两个用户交叉访问对方资源。

**6. 头部**
`helmet` 一把梭能设：`X-Content-Type-Options: nosniff`、`Referrer-Policy`、`Strict-Transport-Security`（HTTPS 时）、关掉 `X-Powered-By`。CSP 主要是前端页面的事。

**7. 限流**
按 IP + 按用户。登录、发短信、导出这类敏感接口单独更严的额度。`@fastify/rate-limit`。**反向代理后面要配 `trustProxy`**，否则所有请求看起来都来自 nginx 的 IP，限流要么没用要么一限全限。

**8. 依赖**
`npm audit --production`，锁文件，见模块章。

**一条总原则：不信任任何来自客户端的数据**，包括 Header、Cookie、隐藏字段、WebSocket 消息。校验放边界上（schema），业务层拿到的已经是干净的。
