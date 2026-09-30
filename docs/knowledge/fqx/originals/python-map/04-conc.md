# Python 3.11+ > 并发与异步 > 资料说明

来源：https://fqx.lx.ci/python-map/

来源：https://fqx.lx.ci/python-map/

主线对齐 Python 3.11+，涉及 3.7 / 3.10 / 3.12 / 3.13 版本差异的地方单独标注。

# Python 3.11+ > 并发与异步

来源：https://fqx.lx.ci/python-map/

Python 的并发选择被 GIL 钉死：同一时刻只有一个线程在执行 Python 字节码。所以 IO 等待用线程或协程，CPU 计算用多进程。asyncio 看起来像 Node 的事件循环，但默认是单线程协作式，阻塞一次就卡住整个循环——这是从 Node 转过来最容易踩的坑。

# Python 3.11+ > 并发与异步 > GIL：为什么线程跑不满多核

来源：https://fqx.lx.ci/python-map/

**GIL（Global Interpreter Lock）是 CPython 的一把进程级大锁**：同一时刻只允许一个线程执行 Python 字节码。这不是语言规范，是 CPython 的实现选择——为了让内存管理（引用计数）简单且线程安全。

**直接后果**：

```python
# 两个线程各算 5 秒的纯 Python 循环
# 总耗时 ≈ 10 秒，不是 5 秒
# 多核 CPU 也没用，因为同一时刻只有一个核在跑 Python
```

**GIL 在两种情况下会释放**：

1. **线程进入 IO 等待**（读文件、网络、sleep）——这就是为什么多线程对 IO 密集有效
2. **执行 C 扩展且扩展自己释放了 GIL**（numpy 的矩阵运算、正则、压缩）——所以 numpy 计算能用满多核，即使你只开了一个 Python 线程

**判断用哪种并发，就看任务卡在哪**：

| 任务类型 | 卡在哪 | 用什么 |
|---|---|---|
| 调 API、读数据库、读文件 | IO 等待 | **线程**或 **asyncio** |
| 图片处理、加密、纯 Python 循环 | CPU | **多进程**（multiprocessing） |
| numpy / 调 C 库的数值计算 | C 层（已释放 GIL） | 线程也行，但进程隔离更干净 |
| 既有 IO 又有 CPU | 混合 | 进程池做 CPU，协程做 IO |

**一个具体数字**：用线程池并发打 100 个 HTTP 请求，相对串行能快几十倍（都在等网络）；用线程池并行算 100 个斐波那契，几乎没有加速（GIL 把它们串行化了）。

**「GIL 会被移除吗」**：3.13 开始有官方的 free-threaded 构建（`python3.13t`），3.14 继续推进。**现在写代码不要赌它已经没了**——默认构建仍然有 GIL，且去掉 GIL 后很多 C 扩展要重做线程安全。设计时按「有 GIL」来选模型，将来免费获得加速。

**和其他语言对比**：Java 线程是真正的并行（无 GIL）；Node 是单线程事件循环 + libuv 线程池处理 IO；Python 线程是「能并发等待 IO，不能并行跑 CPU」。从 Node 转过来，**不要假设 `threading.Thread` 能把 CPU 任务分到多核上。**

# Python 3.11+ > 并发与异步 > 线程：IO 并发的基本盘

来源：https://fqx.lx.ci/python-map/

**日常不要自己 `Thread(target=...)` 然后 `join`**，用线程池：

```python
from concurrent.futures import ThreadPoolExecutor, as_completed

def fetch(url):
    return httpx.get(url).text

urls = [...]
with ThreadPoolExecutor(max_workers=20) as pool:
    futs = {pool.submit(fetch, u): u for u in urls}
    for fut in as_completed(futs):
        url = futs[fut]
        try:
            print(url, len(fut.result()))
        except Exception as e:
            print(url, '失败', e)
```

**`as_completed` 按完成顺序取结果**，不用等最慢的那个。`fut.result()` 会重新抛出任务里的异常——**不调用 result() 的话异常会被吞掉**，只在解释器退出时给一句警告。

**`max_workers` 怎么定**：IO 任务可以比 CPU 核数多很多（都在等），但要受对端限制——数据库连接池、API 限流、文件句柄上限。**20 是一个合理起点**，然后看对端的承受力。不要开 500 个线程去打一个 QPS 上限 10 的接口。

**线程安全**：GIL 保证单个字节码指令不会被打断，但**不保证复合操作的原子性**：

```python
counter += 1     # 读-加-写 三步，线程切换可以发生在任何一步之间
d[k] = d.get(k, 0) + 1    # 同样不是原子的
```

**共享可变状态必须加锁**：

```python
from threading import Lock
lock = Lock()
with lock:
    counter += 1
```

**更好的做法是尽量不共享**：每个任务自包含，结果通过返回值收集。`concurrent.futures` 的设计就是这样——任务之间不通信，主线程汇总结果。

**`queue.Queue` 是线程安全的管道**，做生产者-消费者时用它，不要自己用 list + lock：

```python
from queue import Queue, Empty
q = Queue(maxsize=100)     # 有界队列，生产过快会阻塞，形成背压
```

**守护线程 `daemon=True`**：主线程退出时直接被杀掉，**finally 和清理代码不会跑**。用来做可丢弃的后台任务（比如心跳），不要用来写文件或关连接。

**线程的真正限制除了 GIL 还有**：每个线程有独立栈（默认几 MB），几千个线程会把内存打满。要上万级并发 IO，用 asyncio。

# Python 3.11+ > 并发与异步 > 线程：IO 并发的基本盘 > 线程局部存储与常见坑

来源：https://fqx.lx.ci/python-map/

**数据库连接、HTTP session 这类对象通常不是线程安全的**，每个线程要有自己的一份：

```python
import threading
_local = threading.local()

def get_conn():
    if not hasattr(_local, 'conn'):
        _local.conn = make_connection()
    return _local.conn
```

**`threading.local()` 让每个线程看到独立的属性**。Web 框架的请求上下文（Flask 的 `g`、`request`）就是这个机制。

**坑 1：线程池里 local 会「串请求」。** 线程池的线程是复用的，上一个任务留在 local 里的状态，下一个任务能看到。用完必须清，或者每个任务开始时重置。Flask 这类框架在请求结束时会主动 tear down，自己用线程池时要记得做。

**坑 2：捕获了线程但没设异常处理。** `Thread(target=f).start()` 里 f 抛异常只打印到 stderr，主线程完全不知道。用 `ThreadPoolExecutor` + `future.result()` 或自己包一层把异常放进队列。

**坑 3：在已经有事件循环的环境里再用线程。** Jupyter、某些 Web 框架已经在跑 asyncio，再开线程去跑阻塞代码可以，但**不要在线程里再 `asyncio.run()`**——每个线程的事件循环是独立的，跨循环传 coroutine 会报错。

**坑 4：fork + 线程。** 有线程的进程里 `os.fork()` 只复制当前线程，其他线程消失但锁的状态还在——典型后果是死锁。**有线程之后不要 fork**；要用进程就从一开始用 `multiprocessing` 的 spawn 模式（macOS/Windows 默认，Linux 3.14+ 也在迁）。

# Python 3.11+ > 并发与异步 > 多进程：真正的并行

来源：https://fqx.lx.ci/python-map/

**CPU 密集任务用进程，因为每个进程有自己的 Python 解释器和 GIL**：

```python
from concurrent.futures import ProcessPoolExecutor

def heavy(n):
    return sum(i * i for i in range(n))

if __name__ == '__main__':          # Windows/spawn 模式必须
    with ProcessPoolExecutor() as pool:
        results = pool.map(heavy, [10**7] * 8)
        print(list(results))
```

**`if __name__ == '__main__'` 不是风格问题，是必须。** spawn 模式（Windows、macOS 默认）会重新导入主模块来启动子进程，没有这个保护就会无限递归创建进程。

**进程比线程贵得多**：

- 启动：毫秒到几十毫秒（线程是微秒）
- 内存：每个进程复制一份解释器（写时复制能缓解，但 Python 对象引用计数一碰就复制）
- 通信：不能直接共享对象，必须序列化（pickle）传过去

**所以不要把小任务丢给进程池**——任务本身比进程启动 + pickle 还便宜的话，串行更快。经验上任务至少要跑几十毫秒才值得进进程池。

**传给子进程的参数和返回值必须能 pickle**。lambda、局部函数、线程锁、数据库连接、文件句柄都不能。这是「multiprocessing 报 `Can't pickle`」的原因。

```python
# ✗
pool.map(lambda x: x*x, nums)
# ✓ 模块级函数
def square(x): return x * x
pool.map(square, nums)
```

**共享状态用 `multiprocessing.Queue` / `Manager`**，不要自己用全局变量（每个进程一份，改了别的进程看不见）。Manager 背后是一个服务进程 + 代理，**比 Queue 慢很多**，只适合少量共享。大量数据还是「算完返回」的模式好。

**启动方式**：

| 方式 | 平台 | 特点 |
|---|---|---|
| `fork` | Linux 默认（3.14 前） | 快，但有线程时不安全 |
| `spawn` | Win/mac 默认 | 干净，慢，必须 `if __name__` |
| `forkserver` | Linux 可选 | 折中 |

**新代码显式指定 `spawn` 更安全**：

```python
import multiprocessing as mp
mp.set_start_method('spawn', force=True)   # 必须在创建进程之前调一次
```

**和 Node 的 `worker_threads` / `cluster` 对比**：Node 的 worker 之间传数据也要结构化克隆（类似 pickle），cluster 是多进程。概念对应，但 Python 的 pickle 限制更严（很多对象不能传），而 Node 的 postMessage 对内置类型更宽松。

# Python 3.11+ > 并发与异步 > asyncio：单线程并发 IO

来源：https://fqx.lx.ci/python-map/

**asyncio 用协程在单线程里并发等待 IO**。和 Node 的事件循环是同一类东西：一个线程、一个循环、碰到 await 就挂起去干别的。

```python
import asyncio, httpx

async def fetch(url):
    async with httpx.AsyncClient() as c:
        r = await c.get(url)
        return r.text

async def main():
    urls = [...]
    results = await asyncio.gather(*[fetch(u) for u in urls], return_exceptions=True)
    for r in results:
        print(type(r), len(r) if isinstance(r, str) else r)

asyncio.run(main())
```

**几个必须分清的概念**：

- **coroutine object**：调用 `async def` 函数得到的，还没开始跑。`fetch(url)` 本身不执行任何代码
- **Task**：把 coroutine 丢进事件循环，它开始跑。`asyncio.create_task(fetch(url))`
- **await**：当前协程让出线程，等这个 awaitable 完成。只有 await 的位置才会切换

**没 await 的异步函数调用什么都不会发生**：

```python
fetch(url)          # 只创建了 coroutine 对象，立刻被丢弃
                    # Python 3.11+ 会给 RuntimeWarning: coroutine was never awaited
await fetch(url)    # 真正执行
```

**并发要用 Task，不是连续 await**：

```python
# ✗ 串行，总时间是相加
a = await fetch(u1)
b = await fetch(u2)

# ✓ 并发，总时间是最慢的那个
a, b = await asyncio.gather(fetch(u1), fetch(u2))
```

**`gather` vs `TaskGroup`（3.11+）**：

```python
# gather：一个失败默认取消其他，return_exceptions=True 则收集错误不当成异常
results = await asyncio.gather(*coros, return_exceptions=True)

# TaskGroup：结构化并发，一个失败取消所有，退出时保证没有孤儿任务
async with asyncio.TaskGroup() as tg:
    t1 = tg.create_task(fetch(u1))
    t2 = tg.create_task(fetch(u2))
# 离开 with 时两个都完成（或被取消）
```

**新代码优先 TaskGroup**——它解决了 gather 的一个老问题：gather 被取消时，内部还在跑的任务可能变成孤儿。

# Python 3.11+ > 并发与异步 > asyncio：单线程并发 IO > 阻塞事件循环：从 Node 转过来最容易踩的

来源：https://fqx.lx.ci/python-map/

**asyncio 是协作式的：只有 await 才会切换。** 一个协程里跑了阻塞调用，整个循环冻住，所有其他协程都停。

```python
async def bad():
    time.sleep(5)          # ✗ 冻 5 秒，所有请求一起停
    requests.get(url)      # ✗ 同步 HTTP 库，同样冻住
    open('big.txt').read() # ✗ 大文件同步读

async def good():
    await asyncio.sleep(5)             # ✓
    async with httpx.AsyncClient() as c:
        await c.get(url)               # ✓
    async with aiofiles.open(...) as f:
        await f.read()                 # ✓
```

**这和 Node 不一样。** Node 里 `fs.readFileSync` 会阻塞是常识，但 `fs.readFile`（回调/Promise）自动进 libuv 线程池，调用方不用管。Python 的 `open().read()` **没有这个自动分流**——没有 await 的 IO 就是同步的，会占着循环。

**识别阻塞调用的方法**：它不是 async 的，且会等 IO 或跑很久的 CPU。常见元凶：

- `time.sleep`（该用 `asyncio.sleep`）
- `requests` / `urllib`（该用 `httpx` / `aiohttp`）
- 同步数据库驱动（`psycopg2`、`pymysql`；该用 `asyncpg`、`aiomysql` 或 SQLAlchemy asyncio）
- `subprocess.run`（该用 `asyncio.create_subprocess_exec`）
- 重 CPU 计算（该用 `asyncio.to_thread` 或进程池）

**必须调用同步代码时，丢到线程池**：

```python
result = await asyncio.to_thread(blocking_fn, arg)          # 3.9+
result = await loop.run_in_executor(None, blocking_fn, arg) # 更早的写法
```

**CPU 密集不要丢默认线程池**（还是受 GIL 限制），用 `ProcessPoolExecutor`：

```python
pool = ProcessPoolExecutor()
result = await loop.run_in_executor(pool, heavy_fn, arg)
```

**诊断「循环被堵住」**：现象是所有接口一起变慢，CPU 不高，日志时间戳出现几秒的空洞。`asyncio.get_event_loop().slow_callback_duration`（默认 0.1 秒）能让慢回调打警告。3.12+ 的 `asyncio` debug 模式更详细。

# Python 3.11+ > 并发与异步 > asyncio：单线程并发 IO > 取消、超时与生命周期

来源：https://fqx.lx.ci/python-map/

**取消是协作式的**：`task.cancel()` 在下一次 await 时抛 `CancelledError`，任务必须让它传播才能真正停。

```python
async def work():
    try:
        await asyncio.sleep(10)
    except asyncio.CancelledError:
        await cleanup()          # 清理可以 await
        raise                    # 必须重新抛出！吞掉的话任务看起来取消了其实还在跑
```

**吞掉 CancelledError 是个严重 bug**：调用方以为任务停了，实际还在跑，资源泄漏、重复执行都从这里来。3.8 之后 CancelledError 继承 BaseException 而不是 Exception，所以 `except Exception` 拦不住它——这是刻意的保护。**但 `except BaseException` 和裸 `except:` 仍然能吞掉。**

**超时**：

```python
async with asyncio.timeout(2):          # 3.11+，超时抛 TimeoutError
    await fetch(url)

# 3.11 之前
await asyncio.wait_for(fetch(url), timeout=2)
```

`wait_for` 超时会**取消**内部任务。如果内部任务吞了取消，`wait_for` 会等到它自己结束——超时保护失效。又回到上一条：不要吞 CancelledError。

**屏蔽取消**（清理阶段用）：

```python
async def work():
    try:
        await do()
    finally:
        async with asyncio.timeout(1):
            with asyncio.TaskGroup() as tg:     # 简化示意
                pass
        await asyncio.shield(flush())           # flush 不会被外层取消打断
```

**应用生命周期**：

```python
async def main():
    async with asyncio.TaskGroup() as tg:
        tg.create_task(server())
        tg.create_task(consumer())
        tg.create_task(health_check())
    # 收到 SIGINT 时 TaskGroup 取消所有任务，等它们清理完再退出

asyncio.run(main())
```

**`asyncio.run()` 每次创建新循环，结束时清理所有没完成的任务。** 不要在已经有循环的环境（Jupyter、FastAPI 内部）再调用它，用 `await` 直接跑。Jupyter 里用 `await main()` 即可。

**顶层 `await`（3.13+ 的 REPL 和某些环境）** 能直接 await，但脚本文件里还是要 `asyncio.run()`。

# Python 3.11+ > 并发与异步 > 怎么选：一张图定模型

来源：https://fqx.lx.ci/python-map/

**按这个顺序问**：

1. **是 IO 等待为主，还是 CPU 计算为主？**
   - CPU → 进程池。不要犹豫
   - IO → 下一步
2. **并发规模多大？**
   - 几十到一两百 → 线程池就够，API 最简单，同步库能直接用
   - 上千连接（websocket、爬虫、代理）→ asyncio，否则线程栈会把内存吃光
3. **依赖的库有没有异步版本？**
   - 有（httpx、asyncpg、motor、redis.asyncio）→ asyncio 很顺
   - 没有，且改造成本高 → 线程池包同步库，不要为了异步而异步
4. **有没有已经在跑的事件循环？**
   - FastAPI / Jupyter / GUI → 你已经在 asyncio 里了，新的 IO 跟着 await，阻塞的丢 `to_thread`

**混合是正常的**：FastAPI 处理请求用协程，CPU 密集的推理丢进程池，结果再 await 回来。不要追求「全部异步」或「全部多进程」。

**明确不要做的**：

- 用线程做 CPU 密集（GIL，白忙）
- 在 asyncio 里调 `requests` / `time.sleep` / 同步 ORM（冻循环）
- 为 20 个并发请求上 asyncio（线程池三行搞定，异步库还不一定熟）
- 在进程间传巨大对象（pickle 时间和内存可能比计算本身还多，改成共享内存或写文件）

**和 Node 对照着记**：

| | Node | Python |
|---|---|---|
| 默认并发模型 | 单线程事件循环 | 无默认，要自己选 |
| 异步 IO | 原生（Promise/async） | asyncio，库要配套 |
| CPU 并行 | worker_threads / child_process | multiprocessing |
| 阻塞的后果 | 卡死事件循环 | 线程：只卡自己；asyncio：卡死循环 |
| 同步库能不能用 | 会阻塞，尽量不用 | 线程池里能用，asyncio 里不能直接用 |
