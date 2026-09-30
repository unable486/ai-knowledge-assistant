# 面试 13 · Python > 说明

来源：https://fqx.lx.ci/interview-prep/13-python.html

Python

答案默认折叠。先自己答一遍，再点开核对。每题末尾的**追问**是面试官顺着你的答案往下挖的那一层 —— 只答得出主问题、答不出追问，通常判定为「背过，没做过」。

- 🔴 必答 — 答不出直接掉档

- 🟡 加分 — 能拉开差距

- ⚪ 可以坦白不会 — 说清边界比硬编好

# 面试 13 · Python > 可变默认参数为什么是坑

来源：https://fqx.lx.ci/interview-prep/13-python.html#q1

默认参数在**函数定义时求值一次**，不是每次调用都新建。所以 `def f(items=[])` 里那个列表在整个进程生命周期内是同一个对象，被反复复用。

 

```python
def add(item, bucket=[]):
    bucket.append(item)
    return bucket

add('a')   # ['a']
add('b')   # ['a', 'b']  ← 不是 ['b']
```

 

现象是「第二个请求带上了第一个请求的数据」，在 Web 服务里表现为串数据，而且单元测试跑单次调用永远发现不了。

 

正确写法是用 `None` 当哨兵，函数体里再新建：

 

```python
def add(item, bucket=None):
    if bucket is None:
        bucket = []
    bucket.append(item)
    return bucket
```

 

同类问题不只列表 —— 字典、集合、以及任何在定义时执行的表达式（比如 `timestamp=time.time()` 会永远是导入那一刻的时间）都一样。

 

**追问「这和 JS 的默认参数有什么区别」**：JS 的默认值是每次调用时求值的，`function f(a = [])` 每次都拿到新数组，所以从 TS 转过来的人天然不设防。说得出这个差异，比单纯背「用 None」更能证明你踩过。

# 面试 13 · Python > 深拷贝和浅拷贝的区别

来源：https://fqx.lx.ci/interview-prep/13-python.html#q2

浅拷贝只复制最外层容器，内部元素还是同一批引用；深拷贝递归复制所有层级。

 

```python
import copy
a = {'cfg': {'retry': 3}}
b = a.copy()                 # 浅：b['cfg'] is a['cfg'] → True
c = copy.deepcopy(a)         # 深：c['cfg'] is a['cfg'] → False

b['cfg']['retry'] = 99
a['cfg']['retry']            # 99 ← 改 b 影响了 a
```

 

`list(x)`、`x[:]`、`dict(x)`、`x.copy()` 全是浅拷贝。事故通常出在「拿一份默认配置改一改」这种代码里 —— 改的其实是全局默认值，后面所有请求都被污染。

 

`deepcopy` 的代价要知道：它慢，而且遇到循环引用靠 memo 表处理、遇到文件句柄/连接池这类不可复制的对象会报错。所以配置类数据用 deepcopy，业务对象通常更适合显式构造一个新对象。

 

**追问「deepcopy 一个 10 万条的 DataFrame 会怎样」**：会很慢并且内存翻倍。这题在考你是否只知道概念不知道成本 —— 大数据结构应该改成不可变风格或只拷需要改的那一小部分。

# 面试 13 · Python > 装饰器怎么写，functools.wraps 为什么必须加

来源：https://fqx.lx.ci/interview-prep/13-python.html#q3

装饰器就是「接收函数、返回函数」的函数，`@deco` 只是 `f = deco(f)` 的语法糖。

 

```python
import functools, time

def timed(fn):
    @functools.wraps(fn)           # ← 关键
    def wrapper(*args, **kwargs):
        t0 = time.perf_counter()
        try:
            return fn(*args, **kwargs)
        finally:
            print(f'{fn.__name__} {time.perf_counter()-t0:.3f}s')
    return wrapper
```

 

不加 `functools.wraps`，返回的 `wrapper` 会顶替原函数的身份：`__name__` 变成 `'wrapper'`、`__doc__` 丢失、`__module__` 和签名也不对。后果是实际的：

 

- 日志和监控里所有函数名都显示 `wrapper`，无法定位
- FastAPI / pydantic 靠签名和类型注解生成校验和文档，签名丢了路由直接不工作
- `pytest` 收集用例、`inspect.signature` 反射全部失效

 

要带参数的装饰器就再套一层（`deco(arg)` 返回真正的装饰器）。异步函数要用 `async def wrapper` 并 `await fn(...)`，用同步 wrapper 包 async 函数会返回一个没人 await 的协程对象 —— 函数体根本不执行，且只在运行时警告。

 

**追问「你写过的装饰器里，哪个如果漏了 wraps 会立刻炸」**：答得出「FastAPI 的依赖注入靠签名」这类具体依赖关系，说明你在框架里用过而不只是写过 demo。

# 面试 13 · Python > 生成器解决什么问题

来源：https://fqx.lx.ci/interview-prep/13-python.html#q4

惰性求值：不把全部结果先算出来放内存，而是要一个算一个。函数里出现 `yield`，调用它就返回生成器对象，函数体到第一次 `next()` 才开始执行，执行到 `yield` 就挂起并保留局部状态。

 

对比就是内存差异：

 

```python
sum([i*i for i in range(10**7)])    # 先建一个千万元素的列表
sum(i*i for i in range(10**7))      # 逐个产出，内存常数级
```

 

真实场景里三类地方必须用：读大文件（逐行而非 `readlines()`）、分页拉取远端数据（拉一页处理一页）、流式处理 LLM 输出（token 到达即产出，而不是等整段生成完）。

 

代价也要说清：生成器**只能遍历一次**，遍历完就空了。所以「先算长度再遍历」的代码在生成器上会静默拿到空结果 —— 这是最常见的踩坑。需要多次遍历就得物化成 list，或者每次重新创建生成器。

 

**追问「生成器和 async 生成器什么时候各用哪个」**：普通生成器挂起的是「产出值」，async 生成器（`async def` + `yield`，用 `async for` 消费）挂起的还可以是「等 IO」。流式转发 LLM 响应必须用后者，因为每个 chunk 之间要 await 网络。

# 面试 13 · Python > 闭包在循环里为什么拿到的都是最后一个值

来源：https://fqx.lx.ci/interview-prep/13-python.html#q5

闭包捕获的是**变量本身，不是当时的值**。循环变量在循环结束后停在最后一个值，所有闭包共享它，所以调用时全都读到最后那个。

 

```python
fns = [lambda: i for i in range(3)]
[f() for f in fns]        # [2, 2, 2]  不是 [0, 1, 2]
```

 

修法是用默认参数在定义时把值固定下来（默认参数定义时求值，正好利用了第 1 题那个特性）：

 

```python
fns = [lambda i=i: i for i in range(3)]
[f() for f in fns]        # [0, 1, 2]
```

 

或者用 `functools.partial(func, i)`。

 

实际事故场景是循环里注册回调、注册路由、或者批量创建定时任务 —— 所有任务最后都在处理同一条数据。

 

**追问「JS 里 let 和 var 的差别和这个一样吗」**：不一样，值得说清。JS 用 `let` 每次迭代创建新绑定，所以天然是 `[0,1,2]`；`var` 才会出现全是最后值的问题。Python 没有块级作用域，函数作用域内的循环变量只有一个绑定，所以必须显式固定。从 TS 转过来会以为「现代语言都修好了」，这里是差异点。

# 面试 13 · Python > is 和 == 有什么区别

来源：https://fqx.lx.ci/interview-prep/13-python.html#q6

`==` 比较值（走 `__eq__`），`is` 比较是不是同一个对象（比 `id()`）。

 

容易出事的是小对象缓存：CPython 会缓存 `-5..256` 的整数和部分短字符串，导致 `is` 在小值上「碰巧为真」。要看清这件事必须让值在**运行时**产生，否则同一段代码里的字面量会被编译器折叠成同一个常量：

 

```python
a, b = 256, 256
a is b                      # True  ← 被缓存

x, y = int('257'), int('257')
x is y                      # False ← 运行时构造，两个不同对象
x == y                      # True
```

 

（直接写 `a, b = 257, 257` 反而是 `True`，因为同一代码对象里的相同字面量共用常量池 —— 这也是为什么这个坑在交互式环境和脚本里表现不一致。）

 

所以用 `is` 比较数字或字符串是错的，只是错得不明显 —— 小数据、字面量下测试全过，值改成运行时读进来的就挂。

 

`is` 只用于单例判断：`is None`、`is True/False`、以及自定义哨兵对象（`_MISSING = object()`，用来区分「没传」和「传了 None」）。

 

反过来 `== None` 也不该写：`None` 是单例，`is None` 更快，而且如果对象重载了 `__eq__`，`== None` 可能返回意外结果（numpy 数组的 `== None` 返回的是数组不是布尔值）。

 

**追问「pandas / numpy 里 `if x == None` 会怎样」**：会抛 `ValueError: truth value of an array is ambiguous`，因为比较结果是逐元素的数组，`if` 不知道怎么取真假。这题在考你有没有在数据栈里写过代码。

# 面试 13 · Python > with 语句背后是什么

来源：https://fqx.lx.ci/interview-prep/13-python.html#q7

上下文管理器协议：`__enter__` 返回的东西绑给 `as` 后面的名字，代码块结束（正常或异常）时一定调 `__exit__`。等价于 try/finally，但把清理逻辑收进对象里，调用方不会忘。

 

自己写最省事的是 `contextlib.contextmanager`：

 

```python
from contextlib import contextmanager

@contextmanager
def span(name):
    t0 = time.perf_counter()
    try:
        yield                       # yield 之前是 enter，之后是 exit
    finally:
        log.info('%s took %.3fs', name, time.perf_counter() - t0)
```

 

`__exit__` 收到异常信息三元组，**返回 True 会吞掉异常** —— 这是个容易误用的点，不小心写了 `return True` 会让错误静默消失。

 

AI 服务里的典型用途：数据库事务（异常回滚）、限流信号量的获取释放、临时切换配置、以及给一段调用打埋点。异步版本是 `__aenter__`/`__aexit__` 配 `async with`，`aiohttp`/`httpx` 的连接都靠它归还连接池。

 

**追问「with 打开的文件在块内抛异常，文件关了吗」**：关了，`__exit__` 一定执行。但要补一句：如果块内起了后台线程或协程还在用这个文件，`with` 结束照样关，那才是真 bug —— 生命周期管理不能只靠语法。

# 面试 13 · Python > finally 里 return 会发生什么

来源：https://fqx.lx.ci/interview-prep/13-python.html#q8

`finally` 里的 `return` 会**覆盖 try/except 里的 return，并且吞掉正在传播的异常**。

 

```python
def f():
    try:
        raise ValueError('boom')
    finally:
        return 'ok'      # 异常消失了，函数正常返回 'ok'

f()   # 'ok'，没有任何异常
```

 

这是真实事故的来源：清理逻辑里顺手写了 return，上游永远收不到错误，问题被静默掩盖，日志里只看到「成功」。`break`/`continue` 在 `finally` 里同样有吞异常的效果。

 

相关的两条：

 

- `try` 里 return 后 `finally` 仍会执行，且执行在返回值确定之后 —— 所以 `finally` 里改可变对象会影响返回结果，改局部变量不会。
- `except` 的顺序是从上到下第一个匹配，把 `except Exception` 写在具体异常前面会让后面的分支永远不执行。

 

`finally` 里只该做清理，不该有控制流。要在清理时改变返回值，说明设计有问题。

 

**追问「你怎么发现这类被吞掉的异常」**：答案是可观测性 —— 关键路径上比对「调用次数」和「成功次数」，或者在 `finally` 里显式记录 `sys.exc_info()`。靠读代码发现不了，因为它长得很正常。

 

## 并发与异步

# 面试 13 · Python > GIL 是什么，现在还存在吗

来源：https://fqx.lx.ci/interview-prep/13-python.html#q9

GIL 是 CPython 解释器里的一把全局锁，保证同一时刻只有一个线程在执行 Python 字节码。后果是**多线程跑 CPU 密集任务没有加速**，跑 IO 密集任务有加速（等 IO 时会释放 GIL）。

 

本机 Python 3.11 实测（两个纯计算任务 vs 两个 `sleep`）：

 

```
CPU密集  串行=0.79s  双线程=0.78s  加速比 1.02x   ← 完全没加速
IO密集   串行=0.60s  双线程=0.30s  加速比 2.00x   ← 线性加速
```

 

「现在还存在吗」是 2026 年该答清楚的部分，也是这题的实际考点：

 

- **Python 3.13** 首次提供 free-threaded（无 GIL）构建，标记为**实验性**。
- **Python 3.14**（2025-10）通过 PEP 779 把 free-threaded 构建转为**正式支持**，但**仍不是默认构建** —— 要用得装带 `t` 后缀的解释器（`python3.14t`）。单线程性能损失从 3.13 的约 40% 收窄到 5–10%。
- **Phase III（无 GIL 成为默认）尚未确定版本**，取决于生态适配进度。

 

怎么判断当前解释器：`python -VV` 和 `sys.version` 里会出现 `free-threading build`，运行时用 `sys._is_gil_enabled()`，构建期用 `sysconfig.get_config_var('Py_GIL_DISABLED')`（推荐用这个做条件判断）。

 

有个坑值得单独说：free-threaded 构建下**导入一个没声明线程安全的 C 扩展，解释器会静默把 GIL 重新打开**（只打一条警告）。所以「装了无 GIL 版」不等于「真的在无 GIL 下跑」，得实测。

 

**追问「那你现在的服务要不要上无 GIL」**：诚实答案是「不上，除非依赖栈里的 C 扩展都声明了支持」。理由说得出具体的：默认构建仍带 GIL、C 扩展会导致 GIL 回落、单线程还有 5–10% 损失。回答「上，性能好」的候选人没看过依赖适配表。

# 面试 13 · Python > 多线程、多进程、协程怎么选

来源：https://fqx.lx.ci/interview-prep/13-python.html#q10

按任务性质，不按「哪个先进」：

 

| 任务 | 选择 | 原因 |
| --- | --- | --- |
| 网络 IO（调 API、查库） | **协程 asyncio** | 单线程内并发上千，开销最小 |
| CPU 密集（编解码、数值计算） | **多进程** | 绕开 GIL，每个进程有独立解释器 |
| 阻塞且无异步接口的库 | **线程池** | 把阻塞调用扔出事件循环 |

 

AI 服务几乎全是第一类 —— 调 LLM 的时间 99% 在等网络，所以 asyncio 是主线，`httpx.AsyncClient` 而不是 `requests`。

 

三者的成本差异要说得出量级：协程切换在用户态，一个协程几 KB；线程有内核调度和 GIL 争抢，几百个就开始明显退化；进程有独立内存和 IPC 序列化开销，通常按 CPU 核数开。

 

混用的标准形态是：主体 asyncio，遇到没有异步版本的库用 `asyncio.to_thread(...)`（3.9+）或 `loop.run_in_executor`，遇到 CPU 密集用 `ProcessPoolExecutor`。**不要在协程里直接调阻塞函数** —— 见下一题。

 

**追问「多进程为什么在 Windows 和 Linux 上行为不一样」**：Linux 默认 `fork`（子进程继承内存，快但和线程/锁混用容易死锁），Windows 和 macOS 默认 `spawn`（重新导入模块，所以顶层代码必须放在 `if __name__ == '__main__':` 里，否则无限递归创建进程）。踩过这个坑的人一定记得那个报错。

# 面试 13 · Python > asyncio 里混进一个阻塞调用会怎样

来源：https://fqx.lx.ci/interview-prep/13-python.html#q11

**整个事件循环停摆** —— 不只是当前这个协程，是同一个 loop 上所有任务一起被冻住。因为协程是协作式调度，只在 `await` 处交出控制权，同步阻塞调用不给这个机会。

 

本机实测最直观：起一个每 50ms 跳一次的心跳协程，然后用两种方式各占用 0.5 秒：

 

```
阻塞 time.sleep      0.5s 内心跳次数 = 0     ← 整个 loop 卡死
asyncio.to_thread    0.5s 内心跳次数 = 10    ← loop 正常运转
```

 

心跳 0 次意味着这 0.5 秒里所有并发请求全部无响应。在 Web 服务里表现为「偶发的整体延迟尖刺」，而且和请求量无关 —— 一个用户触发了阻塞路径，所有人一起卡。

 

常见的意外阻塞源，按踩坑频率：

 

- `requests` / `time.sleep` / 同步数据库驱动（该用 `httpx.AsyncClient` / `asyncio.sleep` / 异步驱动）
- 大文件读写、`json.dumps` 一个巨大对象、正则回溯
- 忘记 `await` 直接调用 async 函数 —— 不阻塞，但函数体根本不执行，只留一个 `coroutine was never awaited` 警告

 

排查手段是 `asyncio` 的 debug 模式（`PYTHONASYNCIODEBUG=1` 或 `asyncio.run(..., debug=True)`），它会对超过 100ms 没让出控制权的回调打警告，直接指出是哪一行。

 

**追问「你在哪个具体调用上踩过」**：这题必须有实例。典型是「用了同步的 SDK，压测时 QPS 上不去且延迟随并发线性恶化」，修法是换异步客户端或包 `to_thread`。答不出具体库名，说明只写过单请求脚本。

# 面试 13 · Python > asyncio 和 Node 事件循环有什么不同

来源：https://fqx.lx.ci/interview-prep/13-python.html#q12

相同的是核心模型：单线程 + 事件循环 + 非阻塞 IO。差异在**默认行为和心智负担**，从 TS 转过来最容易想当然的就是这块。

 

**异步是不是默认的**。Node 的标准库天生异步，`fs.readFile` 不阻塞。Python 的标准库默认是同步的，`open()`、`requests`、多数数据库驱动都会阻塞 loop —— 你必须主动选异步版本。这是最大的实际差异：Node 里「不小心写出阻塞代码」很难，Python 里很容易。

 

**loop 要显式启动**。Node 进程本身就是事件循环，顶层 `await` 直接能用。Python 需要 `asyncio.run()` 进入 loop，async 函数只能在 loop 里跑；在同步上下文里调 async 函数只会拿到一个协程对象。

 

**颜色问题更明显**。Python 里同一个功能常有同步和异步两套 API（`redis` / `redis.asyncio`），选错就阻塞。

 

**Promise 立即执行 vs 协程延迟执行**。`Promise` 一创建就开始跑；Python 的协程对象直到被 await 或包成 Task 才启动。所以「先创建一批再一起 await」在 Python 里需要 `asyncio.create_task()` 显式启动，否则它们是串行的：

 

```python
# 串行 —— 每个 await 都等前一个完成
for url in urls:
    await fetch(url)

# 并发 —— gather 会把协程包成 Task
await asyncio.gather(*(fetch(u) for u in urls))
```

 

**追问「gather 里有一个任务失败会怎样」**：默认第一个异常立刻向上抛，其余任务的结果全部丢失（任务本身还在后台跑）。要收集所有结果必须 `return_exceptions=True`，此时异常对象作为结果返回。本机实测：默认抛 `ValueError`，加参数后返回 `[1, ValueError, 2]`。这个默认行为和 `Promise.all` 一致，但 Python 没有 `allSettled` 的语法糖，只有这个参数。

# 面试 13 · Python > 怎么并发发起 100 个 LLM 请求并限流

来源：https://fqx.lx.ci/interview-prep/13-python.html#q13

`asyncio.Semaphore` 控制并发上限，`gather` 收集结果。这是 AI 服务里最常写的一段代码。

 

```python
import asyncio, httpx

async def call_llm(client, prompt, sem):
    async with sem:                          # 超过上限就在这里排队
        r = await client.post('/v1/chat/completions',
                              json={'model': 'x', 'messages': [...]},
                              timeout=60)
        r.raise_for_status()
        return r.json()

async def main(prompts, limit=5):
    sem = asyncio.Semaphore(limit)
    async with httpx.AsyncClient(base_url=BASE) as client:
        return await asyncio.gather(
            *(call_llm(client, p, sem) for p in prompts),
            return_exceptions=True,          # 一个失败不拖垮全部
        )
```

 

本机实测 100 个任务、上限 5、每个 50ms：峰值并发确实是 5，总耗时 1.01 秒（= 100/5 × 50ms，符合预期）。

 

几个必须处理的点：

 

- **`return_exceptions=True`** 否则第一个失败就丢掉其余 99 个的结果。
- **客户端要复用**。每个请求新建 `AsyncClient` 会丢掉连接池，TLS 握手开销吃掉大部分收益。
- **上限不是拍脑袋**。取决于对方的速率限制（RPM/TPM），超了会拿 429 —— 限流的目的是别把自己打成限流。
- **重试要带退避和抖动**，见下一题。
- **信号量限的是并发数，不是速率**。如果对方按「每分钟 token 数」计费，还需要一个 token 桶按 token 消耗限流。

 

想要「谁先完成先处理」而不是等全部完成，用 `asyncio.as_completed`；想要任一失败就取消其余，用 `asyncio.TaskGroup`（3.11+，异常时自动取消同组任务）。

 

**追问「上限设多少，怎么定的」**：要答出依据 —— 对方文档的 RPM 限制、实测 429 出现的阈值、以及你留的余量。答「设了 10」但说不出为什么是 10，等于没调过。

 

## 类型与数据

# 面试 13 · Python > 类型注解在运行时起作用吗

来源：https://fqx.lx.ci/interview-prep/13-python.html#q14

**不起作用。** 注解只是元数据，解释器不做任何检查。本机实测：

 

```python
@dataclass
class Plain:
    n: int

Plain(n='not an int').n      # 'not an int'，类型是 str，没有任何报错

def f(x: int) -> int: return x
f('abc')                     # 'abc'，照样返回
```

 

注解存在 `__annotations__` 里，供三类消费者使用：静态检查器（mypy / pyright，在 CI 里跑）、运行时校验库（pydantic 读注解生成校验逻辑）、以及框架（FastAPI 靠它生成参数解析和 OpenAPI 文档）。

 

所以「加了类型注解」和「有类型安全」是两件事：注解只在你真的跑了 mypy 或用了 pydantic 时才有约束力。光写注解不接检查工具，等于写了注释。

 

这一点和 TypeScript 一致 —— TS 也是编译期擦除、运行时无检查。差别在于 TS 的编译步骤绕不过去（不过 `tsc` 就没有可运行的产物），而 Python 可以完全跳过类型检查直接跑，所以更容易出现「注解和实际类型长期不一致」还没人发现的代码。

 

**追问「那边界数据怎么保证类型」**：答案是在入口做运行时校验 —— HTTP 请求体、LLM 返回的 JSON、外部配置文件，这三处必须用 pydantic 之类的实际校验，内部函数间靠 mypy 静态保证。分不清「哪里需要运行时校验」的候选人，通常会在所有地方写 `isinstance` 或者干脆不校验。

# 面试 13 · Python > pydantic 和 dataclass 怎么选

来源：https://fqx.lx.ci/interview-prep/13-python.html#q15

`dataclass` 是标准库的样板代码生成器（自动写 `__init__`/`__repr__`/`__eq__`），**不校验类型**。pydantic 做真正的运行时校验和类型转换。

 

分界线是**数据从哪来**：内部构造的对象用 dataclass，外部进来的数据用 pydantic。外部包括 HTTP 请求体、LLM 返回的 JSON、配置文件、消息队列 —— 任何你不能保证形状的地方。

 

本机 pydantic 2.13.4 实测行为：

 

```python
class Req(BaseModel):
    n: int
    name: str = Field(min_length=1)

Req(n='42', name='x').n        # 42 —— 字符串被转成 int（默认宽松模式）
Req(n='abc', name='x')         # ValidationError: int_parsing at ('n',)
Req(n=1, name='')              # ValidationError: string_too_short
```

 

默认的**类型强制转换**要知道，它是双刃剑：`'42'` 变成 `42` 在解析表单时很方便，但会掩盖上游的类型错误。要严格拒绝就开 `strict=True`，实测此时 `n='42'` 报 `int_type` 而不再转换。

 

在 AI 服务里最有价值的用法是校验 LLM 的输出。模型返回的 JSON 语法合法不代表业务合法：

 

```python
class LLMOut(BaseModel):
    answer: str
    confidence: float = Field(ge=0, le=1)

LLMOut.model_validate_json('{"answer":"yes","confidence":1.7}')
# ValidationError: less_than_equal at ('confidence',)
```

 

`confidence: 1.7` 是合法 JSON 但不合法业务数据 —— 这正是 `04-ai.md` 第 2 题（structured output 保证 JSON 合法还需要校验吗）的答案在代码层的落点。而且 `ValidationError` 的报错结构化（含 `loc` 定位到具体字段），可以直接回灌给模型让它重新生成。

 

代价是 pydantic 有性能开销和一个第三方依赖。热路径上每秒校验几十万个小对象时，dataclass 明显更快。

 

**追问「pydantic v1 和 v2 有什么区别，迁移踩过什么」**：v2 核心用 Rust 重写（pydantic-core），校验快 5–50 倍；API 改名很多（`parse_obj`→`model_validate`、`dict()`→`model_dump`、`Config` 类→`model_config`）、校验器装饰器换成 `field_validator`/`model_validator`。答不出具体改名，说明只写过新项目没做过迁移 —— 这题不答出来不致命，但答出来能证明真在生产里用过。

# 面试 13 · Python > __slots__ 有什么用

来源：https://fqx.lx.ci/interview-prep/13-python.html#q16

告诉解释器这个类只有固定几个属性，从而不为每个实例创建 `__dict__`，省内存也稍微快一点。

 

本机实测 10 万个两字段实例：

 

```
普通类（有 __dict__）: 12.2 MB
加 __slots__        :  8.4 MB     ← 省约 31%
```

 

代价是失去灵活性：不能动态加属性（实测 `obj.c = 3` 抛 `AttributeError`）、不能用 `__dict__`、多继承时多个父类都定义 slots 会冲突、也不能直接和 `functools.cached_property` 之类依赖 `__dict__` 的东西配合（除非把 `'__dict__'` 加进 slots，那就白做了）。

 

什么时候值得用：同一个类要创建**几十万个以上**实例的场景 —— 比如把一整个数据集加载成对象、或者高频交易/日志处理里的记录对象。几百几千个实例时省下的内存毫无意义，反而牺牲了可维护性。

 

标记是 ⚪ 因为它属于「知道有这个东西就够」的优化手段。面试里说清「省内存、代价是不能动态加属性、只在海量实例时才划算」就足够，答不出精确百分比不掉分。真要处理海量结构化数据，实际更常见的选择是 `NamedTuple`、`array`、或者干脆用 numpy / pyarrow 换成列式存储。

 

**追问「dataclass 能用 slots 吗」**：能，`@dataclass(slots=True)`（3.10+）。注意它是**新建一个类**而不是原地修改，所以在装饰器链里的位置会影响其他基于类引用的逻辑。

 

## 工程与服务

# 面试 13 · Python > FastAPI 路由用 def 还是 async def

来源：https://fqx.lx.ci/interview-prep/13-python.html#q17

看函数体里有没有阻塞调用，选错两种方向都会出问题。

 

- **`async def`**：在事件循环里执行。函数体必须全程非阻塞，任何同步阻塞调用都会卡住整个 loop 和所有并发请求（第 11 题实测：心跳 0 次）。
- **`def`**（同步）：FastAPI 自动扔到线程池执行，不会阻塞 loop。代价是受线程池大小限制（Starlette 默认 40），高并发时请求在池外排队。

 

判断规则很简单：**函数体里全是 `await` 的异步调用就用 `async def`；含同步阻塞调用（同步 ORM、`requests`、CPU 计算）就用 `def`。**

 

最糟的组合是 `async def` 里写同步阻塞调用 —— 这是 FastAPI 最常见的性能事故，而且单请求测试完全正常，只在并发时暴露。次糟的是 `def` 里跑长时间 CPU 任务，把线程池占满。

 

```python
@app.post('/chat')                    # 正确：全异步
async def chat(req: ChatReq):
    r = await client.post(...)        # httpx.AsyncClient
    return r.json()

@app.post('/report')                  # 正确：同步 ORM 用 def
def report(req: ReportReq):
    return db.query(Model).all()      # 同步 SQLAlchemy
```

 

需要在 async 路由里做一次阻塞操作，用 `await asyncio.to_thread(fn, ...)` 局部逃逸，而不是把整个路由改成同步。

 

**追问「怎么验证你没选错」**：压测时对比「单请求延迟」和「并发下的 p99」。如果并发起来 p99 恶化远超线性，通常就是 async 路由里藏了阻塞调用。也可以开 asyncio debug 模式看有没有「回调执行过久」的警告。答「看代码检查」不够 —— 依赖调用链深处的阻塞看不出来。

# 面试 13 · Python > 流式返回 LLM 输出怎么实现

来源：https://fqx.lx.ci/interview-prep/13-python.html#q18

服务端用 SSE（`text/event-stream`），配 async 生成器逐块产出。整条链路必须全程不缓冲，任何一环攒完再发都会让流式失效。

 

```python
from fastapi import FastAPI
from fastapi.responses import StreamingResponse

async def gen(prompt: str):
    async with client.stream('POST', '/v1/chat/completions',
                             json={'model': M, 'messages': [...], 'stream': True}) as r:
        async for line in r.aiter_lines():
            if line.startswith('data: '):
                yield f'{line}\n\n'          # SSE 要求空行分隔
        yield 'data: [DONE]\n\n'

@app.post('/chat')
async def chat(req: ChatReq):
    return StreamingResponse(gen(req.prompt), media_type='text/event-stream')
```

 

实际会踩的四个地方：

 

- **反向代理缓冲**。nginx 默认 `proxy_buffering on`，会把整个响应攒完再转发 —— 后端流得很好，浏览器一次性收到全部。必须关掉（`proxy_buffering off`）或加 `X-Accel-Buffering: no` 响应头。这是「本地正常、线上不流」的头号原因。
- **客户端断开**。用户关页面时生成器会收到 `asyncio.CancelledError`，要在这里终止上游 LLM 调用，否则 token 继续烧钱。
- **中间出错**。响应头已经发出去了，没法再改状态码，只能在流里塞一个错误事件让前端处理。
- **超时**。整体超时不能按普通请求设，长回答可能几十秒；要设的是「首字节超时」和「块间空闲超时」。

 

前端用 `EventSource`（只支持 GET）或者 `fetch` + `ReadableStream`（支持 POST，实际更常用）。

 

**追问「流式下怎么统计 token 消耗」**：流式响应通常不在中途给 usage，要么在最后一个 chunk 里（部分供应商支持 `stream_options: {include_usage: true}`），要么自己按累计的 token 数估算。答不出这点，说明没做过成本核算 —— 这也是流式改造最容易漏的一环。

# 面试 13 · Python > LLM 调用的超时和重试怎么写

来源：https://fqx.lx.ci/interview-prep/13-python.html#q19

关键是**区分该重试和不该重试的错误**，无脑重试会放大故障也会烧钱。

 

```python
import asyncio, random, httpx

RETRYABLE = {408, 429, 500, 502, 503, 504}

async def call(client, payload, tries=3):
    for attempt in range(tries):
        try:
            r = await client.post('/v1/chat/completions', json=payload,
                                  timeout=httpx.Timeout(60.0, connect=5.0))
            if r.status_code in RETRYABLE:
                raise httpx.HTTPStatusError('retryable', request=r.request, response=r)
            r.raise_for_status()          # 4xx 直接抛，不重试
            return r.json()
        except (httpx.TimeoutException, httpx.HTTPStatusError, httpx.TransportError):
            if attempt == tries - 1:
                raise
            wait = min(2 ** attempt, 8) + random.uniform(0, 1)   # 指数退避 + 抖动
            await asyncio.sleep(wait)
```

 

要说清的几点：

 

- **超时要分层**。连接超时短（几秒，连不上就该快速失败），读取超时长（LLM 生成慢，60 秒不算异常）。只设一个总超时会把正常的长回答误杀。
- **抖动是必需的**。没有随机抖动，一批请求会同步退避、同步重发，把尖峰原样搬到下一个时间点。
- **429 要看 `Retry-After`**。对方明确告诉你等多久时，按它的值等，别用自己的退避公式。
- **4xx 不重试**。参数错误、认证失败重试一万次也是错，只有 408/429 例外。
- **重试必须有幂等性考虑**。LLM 调用本身无副作用可以重试，但如果这个调用会写库或触发下游动作，重试就会重复执行。

 

有个坑值得单独说：**HTTP 200 但流是空的**（`EmptyStreamError`）不属于任何标准错误类别，不会触发上面任何一条重试逻辑，请求会一直挂着。要单独处理「拿到 200 但没有内容」这个情况。

 

生产上通常不手写，用 `tenacity`（`@retry(stop=stop_after_attempt(3), wait=wait_exponential_jitter())`）。但要能说出它替你做了什么，否则配错参数照样出事。

 

**追问「你的重试有没有全局预算」**：单请求重试 3 次，1000 个并发同时失败就是 3000 次请求打向一个已经过载的服务。成熟做法是加熔断器（连续失败到阈值就直接快速失败一段时间），或者用全局重试预算限制「重试量占总量的比例」。答不出这层，说明只在单请求维度想过问题。

# 面试 13 · Python > 处理大文件怎么不把内存打满

来源：https://fqx.lx.ci/interview-prep/13-python.html#q20

核心是流式处理，别把整个文件读进内存。

 

```python
# 错：一次性读入
data = open('big.jsonl').readlines()       # 10GB 文件 → 内存爆

# 对：逐行迭代，文件对象本身是迭代器
with open('big.jsonl') as f:
    for line in f:                          # 每次只驻留一行
        handle(json.loads(line))
```

 

按场景的具体做法：

 

- **文本按行**：直接迭代文件对象。
- **二进制按块**：`while chunk := f.read(8192)`（海象运算符，3.8+）。
- **大 JSON 数组**：标准库 `json.load` 必须读全量，用 `ijson` 流式解析，或者上游改成 JSONL（每行一个对象）—— 后者是更根本的解法。
- **CSV / 表格**：`pandas.read_csv(chunksize=...)` 分块，或者换 `pyarrow` / `polars` 用列式 + 内存映射。
- **上传下载**：`httpx` 用 `client.stream()` 逐块写盘，别 `r.content`。

 

在 RAG 的文档入库场景里，正确形态是「读一块 → 切分 → 嵌入 → 写库」的流水线，每一环都是生成器，全程内存恒定。写成「先全部读完、再全部切分、再全部嵌入」在文档量大时必然 OOM，而且中途失败要从头再来。

 

配套要知道 `generator` + `itertools.islice` 做批处理：嵌入模型通常按批调用，需要把逐条的流攒成固定大小的批，但不能把整个流攒起来。

 

**追问「怎么确认你的处理真是常数内存」**：用 `tracemalloc` 或 `memory_profiler` 实测峰值，而不是看代码猜。常见的隐藏泄漏是「流式读进来但把结果全 append 到一个 list」—— 输入是流式的，输出把内存吃光了。

# 面试 13 · Python > 依赖怎么管、怎么保证可复现

来源：https://fqx.lx.ci/interview-prep/13-python.html#q21

现代做法是**声明与锁定分离**：`pyproject.toml` 写你要什么（带版本范围），锁文件记录实际解析出的完整依赖树和哈希，部署时只按锁文件装。

 

工具选择（2026 年的实际格局）：

 

- **uv** —— Rust 写的，装包和解析比 pip 快一到两个数量级，能同时管虚拟环境和 Python 版本本身，生成 `uv.lock`。新项目的默认选择。
- **Poetry / PDM** —— 成熟，`poetry.lock`，功能全但慢。
- **pip + requirements.txt** —— 最通用，但 `pip freeze` 出来的不是真正的锁文件：它记录了当前环境的所有包（包括你手动装的无关包），也不含哈希。`pip-tools` 的 `pip-compile` 才算补上这块。

 

必须做到的三件事：

 

- **虚拟环境隔离**。别往系统 Python 装东西。很多发行版现在启用了 PEP 668，直接 `pip install` 会被拒（`externally-managed-environment`）—— 这个报错就是在强制你用 venv。
- **锁文件进版本库**。锁文件不提交等于没锁。
- **区分运行时依赖和开发依赖**。生产镜像不该装 pytest、ruff。

 

Docker 里的额外一条：先只拷依赖声明文件、装依赖，再拷源码。顺序反了会让每次改代码都重装全部依赖，构建缓存完全失效。

 

**追问「Node 的 package-lock 和 Python 的锁文件有什么区别」**：Node 的 `node_modules` 允许同一个包的多个版本并存（嵌套），Python 一个环境里同一个包只能有一个版本 —— 所以 Python 的依赖冲突是硬冲突，解决不了就装不上。这个差异解释了为什么 Python 项目更容易遇到「两个库要求互斥的版本」的死局。

# 面试 13 · Python > 怎么给带 LLM 调用的代码写测试

来源：https://fqx.lx.ci/interview-prep/13-python.html#q22

分层：业务逻辑用 mock 测（快、确定、进 CI），模型输出质量用 eval 测（慢、有波动、单独跑）。把两者混在一起是最常见的错误 —— 会得到一套随机失败的测试，然后大家开始忽略红灯。

 

**单元测试 mock 掉调用**，验的是你的代码而不是模型：

 

```python
import pytest
from unittest.mock import AsyncMock

@pytest.mark.asyncio
async def test_retries_on_429(monkeypatch):
    calls = []
    async def fake_post(*a, **k):
        calls.append(1)
        return Resp(429) if len(calls) < 3 else Resp(200, {'choices': [...]})
    monkeypatch.setattr(client, 'post', fake_post)

    out = await call(client, payload)
    assert len(calls) == 3          # 重试确实发生了
    assert out['choices']
```

 

这类测试要覆盖的是**代码路径**：超时重试、429 退避、JSON 解析失败、schema 校验不通过、流式中途断开、并发限流生效。这些全都不需要真实模型。

 

**契约测试**用录制的真实响应（VCR / 自己存的 fixture），保证解析逻辑能处理供应商的实际返回格式。供应商改字段时这层会先红。

 

**eval 单独跑**：固定测试集 + 评分函数，输出的是分数不是通过/失败，进 CI 也只做「分数跌破阈值就告警」，不做门禁。因为模型输出天生有波动，让它当门禁会导致重跑到过为止。

 

几个技术细节：`pytest-asyncio` 跑 async 测试（记得 `asyncio_mode = auto` 免得每个用例都加装饰器）；mock 异步函数要用 `AsyncMock` 而不是 `MagicMock`（后者返回的不是可 await 对象，报错信息很难懂）；`temperature=0` 能减少波动但不保证确定性，别指望它让 LLM 测试变可复现。

 

**追问「你的 CI 里跑不跑真实 LLM 调用」**：正确答案是不跑或极少跑，理由要具体：慢（一个用例几秒到几十秒）、贵（每次 push 都烧钱）、不稳定（供应商 429 或抖动会让 CI 随机变红，团队很快开始无脑重跑）。要跑就单独一条流水线、定时触发、失败只告警不阻塞合并。答「跑，这样才真实」的人没维护过 CI。
