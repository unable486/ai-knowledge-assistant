# Python 3.11+ > 语言内核 > 资料说明

来源：https://fqx.lx.ci/python-map/

来源：https://fqx.lx.ci/python-map/

主线对齐 Python 3.11+，涉及 3.7 / 3.10 / 3.12 / 3.13 版本差异的地方单独标注。

这份导图按「地基 → 常用 → 深水区 → 干活」的顺序排：**语言核心**是对象模型和作用域，**数据结构**是每天都碰的，**函数与面向对象**是写库和读源码要的，**并发与性能**是 GIL 决定的一套取舍，**工程实践**是环境、类型、测试这些落地的部分。

每个节点讲三件事：是什么、为什么这么设计、你会踩的坑。前端过来的人会觉得几处和 JS 很像但行为不同，这些地方都做了对比。

# Python 3.11+ > 语言内核

来源：https://fqx.lx.ci/python-map/

Python 里没有「变量存值」这回事。变量是**名字**，值是**对象**，赋值是把名字绑到对象上。理解这一条，后面那些看起来诡异的行为（默认参数记住了上次的值、改一个列表另一个也变了）都变成必然结果，不用背。

# Python 3.11+ > 语言内核 > 名字绑定：变量不是盒子

来源：https://fqx.lx.ci/python-map/

JS 里说「变量存了一个值」大致能用。Python 里这个比喻会持续骗你，换成**名字 → 对象**的箭头模型：

```python
a = [1, 2, 3]     # 创建列表对象，名字 a 指向它
b = a             # 名字 b 指向同一个对象，没有拷贝
b.append(4)
print(a)          # [1, 2, 3, 4]  ← a 也变了，因为是同一个对象
```

**赋值永远不拷贝**，只是多一个名字指向同一个对象。这和 JS 的对象引用一致，但 Python 里连整数、字符串都是对象，所以模型更统一。

```python
b = b + [5]       # 创建了新列表，b 改指向新对象；a 不变
b += [5]          # 等价于 b.extend([5])，原地修改；a 也变
```

**`+` 和 `+=` 对可变对象的行为不同**：`+` 造新对象，`+=` 原地改。这是「明明只改了 b，a 却变了」的最常见原因。

**判断一个对象是不是同一个用 `id()`**：

```python
a = [1, 2]; b = a
print(id(a) == id(b))   # True，同一对象
print(a is b)           # True，is 就是比较 id
```

**函数参数传递也是名字绑定**。所以「Python 是值传递还是引用传递」这个问题本身问错了——传的是**对象的引用，但绑定到形参这个新名字上**：

```python
def f(lst, n):
    lst.append(1)    # 改的是调用方那个对象 → 外面能看到
    n = 100          # 只是把形参 n 重新绑到新对象 → 外面看不到
    lst = [9, 9]     # 同理，重新绑定，外面看不到

data, num = [], 0
f(data, num)
print(data, num)     # [1] 0
```

**规则**：能不能影响调用方，取决于你是**改对象内部**（可以）还是**重新绑定名字**（不行）。

# Python 3.11+ > 语言内核 > 名字绑定：变量不是盒子 > 可变默认参数：最经典的坑

来源：https://fqx.lx.ci/python-map/

```python
def add(item, target=[]):      # ✗
    target.append(item)
    return target

print(add(1))    # [1]
print(add(2))    # [1, 2]   ← 不是 [2]！
```

**原因**：默认参数的值在**函数定义时求值一次**，之后一直是同一个对象。那个 `[]` 从头到尾只有一个，被所有调用共享。

```python
def add(item, target=None):    # ✓ 标准写法
    if target is None:
        target = []
    target.append(item)
    return target
```

同样的坑在 `dict`、`set`、以及**任何在定义时求值的表达式**上都成立：

```python
def log(msg, ts=datetime.now()):   # ✗ ts 永远是模块导入那一刻的时间
    ...
```

这个 bug 极难发现——它不报错，只是时间戳永远不变。

**判断标准**：默认值只能是**不可变对象**（`None`、数字、字符串、元组）或者字面量常量。任何可变对象、任何函数调用，都要挪到函数体里。

**顺带一提，类属性有一样的问题**：

```python
class Cart:
    items = []          # ✗ 类属性，所有实例共享同一个列表

class Cart:
    def __init__(self):
        self.items = [] # ✓ 实例属性，每个实例一份
```

现象是「我新建了一个购物车，里面却有别人的商品」。这个在 Web 应用里会变成跨用户数据串台，是真实的安全问题。

# Python 3.11+ > 语言内核 > 名字绑定：变量不是盒子 > 浅拷贝与深拷贝

来源：https://fqx.lx.ci/python-map/

```python
import copy

a = [[1, 2], [3, 4]]
b = a                    # 别名：完全同一个对象
c = a.copy()             # 浅拷贝：新的外层列表，内层还是同一批对象
d = copy.deepcopy(a)     # 深拷贝：递归复制所有层

a[0].append(99)
print(b[0])   # [1, 2, 99]  别名，当然变
print(c[0])   # [1, 2, 99]  ← 浅拷贝，内层共享
print(d[0])   # [1, 2]      深拷贝，独立
```

**浅拷贝的几种写法**：`list.copy()`、`list(a)`、`a[:]`、`copy.copy(a)`——都是浅的。字典的 `dict(d)` 和 `{**d}` 也是浅的。

**这个坑的实际形态**：从数据库读出一批记录（字典列表），浅拷贝一份准备改，改完发现原始数据也变了。或者写单元测试时用一个「模板字典」，测试之间互相污染。

**`deepcopy` 的代价**：递归遍历整个对象图，大结构上很慢；它会处理循环引用（内部有备忘表），但遇到不可序列化的对象（文件句柄、锁、数据库连接）会出问题。

**优先考虑不可变数据**：需要一个「改过的版本」时，造新对象而不是拷贝后改。`dataclasses.replace()`、字典的 `{**old, 'k': v}`、`tuple` 代替 `list`，都能绕开拷贝问题。这也是为什么函数式风格在 Python 里同样值得用。

# Python 3.11+ > 语言内核 > 名字绑定：变量不是盒子 > is 与 == ：小整数缓存的陷阱

来源：https://fqx.lx.ci/python-map/

**`==` 比较值（调用 `__eq__`），`is` 比较是不是同一个对象（比较 id）。** 这是两件完全不同的事。

```python
a = 256; b = 256
print(a is b)      # True

a = 257; b = 257
print(a is b)      # False（在 REPL 里）
```

**原因是 CPython 缓存了 -5 到 256 的小整数对象**，这个范围内的相同整数是同一个对象。短字符串也有类似的驻留（interning）。

**这个细节本身不重要，重要的是它揭示的规则**：`is` 的结果依赖解释器实现细节，**不能用它比较值**。

```python
if x is 0:       # ✗ 靠运气，Python 3.8+ 还会给 SyntaxWarning
if x == 0:       # ✓
```

**`is` 只在三个地方该用**：

```python
if x is None: ...        # ✓ None 是单例，这是标准写法
if x is True: ...        # 极少用，通常直接 if x
if a is b: ...           # 明确想知道「是不是同一个对象」
```

**为什么 `None` 必须用 `is`**：`==` 会调用 `__eq__`，而对象可以重载它。numpy 数组的 `== None` 返回的是一个布尔数组，放进 `if` 里直接抛异常。用 `is None` 绕过所有重载，永远可靠。

**和 JS 对比**：JS 的 `===` 对对象比较引用、对原始值比较值，是**合二为一**的。Python 把这两件事彻底分开了：`==` 永远是值语义（可重载），`is` 永远是身份语义（不可重载）。别把 `is` 当 `===` 用。

# Python 3.11+ > 语言内核 > 类型系统与真值判断

来源：https://fqx.lx.ci/python-map/

Python 是**动态强类型**：变量没有声明类型（动态），但对象类型不会自动转换（强）。

```python
1 + '1'          # TypeError，不像 JS 会拼成 '11'
1 + True         # 2   ← 例外：bool 是 int 的子类
```

**`bool` 继承自 `int`**，`True == 1`、`False == 0`。这让 `sum([True, False, True])` 能算出 2（统计满足条件的个数时挺好用），但也意味着 `isinstance(True, int)` 是 `True`——写类型判断时要注意。

**真值判断（truthiness）**，这些是假：

```python
False, None, 0, 0.0, 0j, Decimal(0)
'', [], (), {}, set(), range(0)
# 以及任何 __bool__() 返回 False 或 __len__() 返回 0 的对象
```

**和 JS 的关键差异**：JS 里 `[]` 和 `{}` 都是真值，Python 里空容器是假值。所以 Python 里 `if items:` 就是「非空」的地道写法，不需要 `if items.length > 0`。

**但对可能是 None 的数值要小心**：

```python
def f(count=None):
    if not count:        # ✗ count=0 也走这里
        count = 10
    if count is None:    # ✓ 只有真的没传才走
        count = 10
```

**类型注解（type hints）在运行时不生效**：

```python
def f(x: int) -> str:
    return x        # 运行完全正常，不报错
```

注解只是元数据，存在 `__annotations__` 里。**要靠它发现错误，必须跑静态检查器**（mypy、pyright）。这和 TypeScript 的处境一样——都是编译期/检查期的东西，运行时被擦掉。差别是 TS 有编译步骤强制你过一遍，Python 里不配 CI 的话注解就是纯文档。

**注解的实际价值**：IDE 补全、重构安全、以及 **pydantic / FastAPI 这类库把注解当运行时契约用**（它们主动读注解做校验和序列化）。做 AI 应用会大量接触后者，值得把注解写规范。

# Python 3.11+ > 语言内核 > 类型系统与真值判断 > 数字：int 无限精度、float 有坑、Decimal 用于金额

来源：https://fqx.lx.ci/python-map/

**`int` 是任意精度的**，不会溢出：

```python
2 ** 1000        # 直接算出来，300 多位数字
```

代价是大整数运算比机器整数慢。日常无感，密码学或大数循环里要注意。

**`float` 是 IEEE 754 双精度，和其他语言一样有精度问题**：

```python
0.1 + 0.2 == 0.3          # False
0.1 + 0.2                 # 0.30000000000000004
```

**浮点数比较不能用 `==`**：

```python
import math
math.isclose(0.1 + 0.2, 0.3)      # True，标准做法
```

**金额必须用 `Decimal`**（或整数分）：

```python
from decimal import Decimal, ROUND_HALF_UP

Decimal('0.1') + Decimal('0.2') == Decimal('0.3')   # True

# 必须用字符串构造！
Decimal(0.1)      # Decimal('0.1000000000000000055511151231257827')
Decimal('0.1')    # Decimal('0.1')  ✓
```

**`Decimal(0.1)` 传 float 进去等于把浮点误差原样搬进来**，这是用 Decimal 时最常见的错误。

**四舍五入要显式指定模式**：

```python
round(0.5)     # 0   ← 不是 1
round(1.5)     # 2
round(2.5)     # 2   ← 不是 3
```

内置 `round` 用**银行家舍入**（四舍六入五取偶），统计上无偏但和财务口径不一致。金额计算用：

```python
Decimal('2.5').quantize(Decimal('1'), rounding=ROUND_HALF_UP)   # 3
```

**整除和取模对负数的行为和 C/JS 不同**：

```python
-7 // 2      # -4（向下取整，不是 -3）
-7 % 2       # 1（结果符号跟除数，不是 -1）
```

Python 保证 `a == (a // b) * b + a % b` 且 `a % b` 符号跟 `b`。用取模做循环索引时这个行为反而更好用（`-1 % 5 == 4`）。

# Python 3.11+ > 语言内核 > 类型系统与真值判断 > 字符串与字节：encode/decode 的方向

来源：https://fqx.lx.ci/python-map/

**Python 3 把文本和字节彻底分开**：`str` 是 Unicode 码点序列，`bytes` 是字节序列。两者不能混用。

```python
'中'.encode('utf-8')          # b'\xe4\xb8\xad'  str → bytes
b'\xe4\xb8\xad'.decode('utf-8')  # '中'            bytes → str
```

**方向记法**：encode 是「编码成机器的形式」（str→bytes），decode 是「解码成人读的形式」（bytes→str）。搞反了会报 `AttributeError: 'bytes' object has no attribute 'encode'`。

**`len()` 的单位不同**：

```python
len('中文')                    # 2（字符数）
len('中文'.encode('utf-8'))    # 6（字节数，每个中文 3 字节）
```

数据库字段长度、HTTP Content-Length 都是**字节**，做截断时不能按字符数算。按字节截断还可能切断多字节字符，需要 `errors='ignore'` 或者用 `textwrap` 之类按字符处理。

**`UnicodeDecodeError` 的排查**：读文件不指定编码时用系统默认（Linux 通常 UTF-8，Windows 可能是 GBK/cp1252），这是「代码在我机器上能跑」的经典来源：

```python
open('f.txt')                              # ✗ 依赖系统默认
open('f.txt', encoding='utf-8')            # ✓ 永远显式指定
open('f.txt', encoding='utf-8', errors='replace')  # 容忍脏数据
```

**f-string 是首选格式化方式**（3.6+），比 `%` 和 `.format()` 都快且清晰：

```python
name, n = 'kb', 3
f'{name}: {n}'            # 'kb: 3'
f'{n:.2f}'                # '3.00'  格式规格
f'{n=}'                   # 'n=3'   调试用（3.8+）
f'{name!r}'               # "'kb'"  用 repr
```

**注意 f-string 不能用于日志和 SQL**：

```python
logging.info(f'user {uid} did {action}')    # ✗ 无论日志级别都先格式化
logging.info('user %s did %s', uid, action) # ✓ 级别不够时不格式化

cursor.execute(f'SELECT * FROM t WHERE id={uid}')      # ✗ SQL 注入
cursor.execute('SELECT * FROM t WHERE id=%s', (uid,))  # ✓ 参数化
```

**字符串不可变**，所以循环里 `s += x` 每次都造新对象，n 次拼接是 O(n²)。用 `''.join(parts)`。

# Python 3.11+ > 语言内核 > 函数、作用域与闭包

来源：https://fqx.lx.ci/python-map/

**函数是一等对象**：可以赋值、传参、返回、放进容器。装饰器、回调、策略模式都建在这上面。

**作用域规则是 LEGB**：Local → Enclosing（外层函数）→ Global（模块）→ Builtin。

```python
x = 'global'
def outer():
    x = 'enclosing'
    def inner():
        print(x)      # 'enclosing'，向外找最近的
    inner()
```

**关键规则：函数内对一个名字赋值，它就默认是局部变量**——即使外面有同名的：

```python
count = 0
def bump():
    count += 1        # UnboundLocalError！
```

因为有赋值，`count` 被当成局部变量，而 `+=` 要先读它——读一个还没赋值的局部变量就报错。这和 JS 的行为完全不同（JS 里不加声明就是修改外层）。

```python
def bump():
    global count      # 声明「我要改模块级的那个」
    count += 1

def outer():
    n = 0
    def inner():
        nonlocal n    # 声明「我要改外层函数的那个」
        n += 1
    inner()
    return n          # 1
```

**闭包捕获的是变量而不是值**，这条和 JS 的 `var` 循环问题同源：

```python
fns = [lambda: i for i in range(3)]
print([f() for f in fns])       # [2, 2, 2] ← 不是 [0, 1, 2]

# 修法：用默认参数在定义时固定住值
fns = [lambda i=i: i for i in range(3)]
print([f() for f in fns])       # [0, 1, 2]
```

JS 里用 `let` 就解决了（每次迭代新绑定），Python 没有块级作用域，只能用默认参数或 `functools.partial`。**在循环里创建回调、注册任务时特别容易踩**——所有回调最后都用了同一个（最后一个）值。

# Python 3.11+ > 语言内核 > 函数、作用域与闭包 > 参数：位置、关键字与解包

来源：https://fqx.lx.ci/python-map/

```python
def f(a, b=1, *args, c, d=2, **kwargs):
    ...
```

- `a` —— 位置或关键字
- `b=1` —— 有默认值
- `*args` —— 收集多余的位置参数（元组）
- `c` —— **在 `*args` 后面，只能用关键字传**且必需
- `**kwargs` —— 收集多余的关键字参数（字典）

**强制关键字参数**用一个裸 `*` 分隔：

```python
def create(name, *, force=False, timeout=30):
    ...
create('x', force=True)      # ✓
create('x', True)            # TypeError
```

**这个很值得用**：布尔参数写成位置参数时，调用处 `create('x', True)` 完全看不出 True 是什么意思。强制关键字让调用自解释，且以后加参数不会破坏兼容。

**仅位置参数**用 `/`（3.8+）：`def f(a, b, /, c)` 里 a、b 不能用关键字传。主要给库作者用（保留改参数名的自由）。

**解包**：

```python
args = [1, 2]; kw = {'c': 3}
f(*args, **kw)               # 展开传入

a, *rest = [1, 2, 3]         # a=1, rest=[2, 3]
first, *mid, last = [1,2,3,4]  # first=1, mid=[2,3], last=4

d = {**base, 'k': 'v'}       # 字典合并（3.5+）
d = base | {'k': 'v'}        # 3.9+ 的写法
```

星号解包和 JS 的展开语法很像，但 Python 区分 `*`（可迭代）和 `**`（映射），不像 JS 的 `...` 一符多用。

# Python 3.11+ > 语言内核 > 函数、作用域与闭包 > 装饰器：语法糖背后就是函数替换

来源：https://fqx.lx.ci/python-map/

`@deco` 只是 `f = deco(f)` 的糖：

```python
import functools, time

def timed(fn):
    @functools.wraps(fn)          # 关键，见下
    def wrapper(*args, **kwargs):
        t = time.perf_counter()
        try:
            return fn(*args, **kwargs)
        finally:
            print(f'{fn.__name__}: {time.perf_counter()-t:.3f}s')
    return wrapper

@timed
def work(): ...
```

**`functools.wraps` 不是可选的。** 不加它，被装饰函数的 `__name__`、`__doc__`、`__module__`、类型注解全部变成 wrapper 的。后果很实际：

- 日志里所有函数名都叫 `wrapper`
- Flask/FastAPI 用函数名注册路由 → **多个路由撞名报错**
- pytest 收集测试、sphinx 生成文档全乱
- pickle 序列化失败

**带参数的装饰器要三层**：

```python
def retry(times=3, delay=1):
    def decorator(fn):
        @functools.wraps(fn)
        def wrapper(*args, **kwargs):
            for i in range(times):
                try:
                    return fn(*args, **kwargs)
                except Exception:
                    if i == times - 1:
                        raise
                    time.sleep(delay * 2 ** i)   # 指数退避
        return wrapper
    return decorator

@retry(times=5)
def fetch(): ...
```

外层收装饰器参数，中层收函数，内层是真正的包装。**记不住的时候就展开成 `fetch = retry(times=5)(fetch)` 看**，层数一目了然。

**常用内置装饰器**：

| 装饰器 | 作用 |
|---|---|
| `@functools.cache` | 无限缓存（3.9+），`@lru_cache(maxsize=N)` 是限量版 |
| `@functools.cached_property` | 实例属性级缓存，只算一次 |
| `@property` | 方法当属性访问 |
| `@staticmethod` / `@classmethod` | 见面向对象章 |
| `@contextlib.contextmanager` | 用生成器写上下文管理器 |

**`@cache` 的坑**：参数必须可哈希（不能传 list、dict）；缓存以函数为单位是**进程级全局**的，装在实例方法上会连 `self` 一起缓存住 → **实例永远无法被回收，是内存泄漏**。实例方法要缓存用 `@cached_property` 或者手动在实例上存。

# Python 3.11+ > 语言内核 > 异常与上下文管理

来源：https://fqx.lx.ci/python-map/

**异常是 Python 的正常控制流之一**，不像有些语言里只用于错误。`for` 循环结束靠 `StopIteration`，字典缺键用 `KeyError` 都是常规操作。

**捕获要精确**：

```python
try:
    ...
except Exception:          # ✓ 捕获所有「错误」
    ...
except BaseException:      # ✗ 连 KeyboardInterrupt、SystemExit 都拦
    ...
except:                    # ✗ 同上，且完全看不出意图
    ...
```

**`BaseException` 包含 `KeyboardInterrupt`（Ctrl+C）、`SystemExit`、`GeneratorExit`**。拦住它们的后果是 Ctrl+C 杀不掉进程、`sys.exit()` 失效。**日常永远用 `except Exception`。**

**别静默吞掉异常**：

```python
except Exception:
    pass                    # ✗ 问题消失了，但也永远查不出来

except Exception:
    logger.exception('处理失败')   # ✓ 自动带完整栈
    raise                          # 或者明确决定不再抛
```

`logger.exception()` 只能在 except 块里用，它会自动附上 traceback。`logger.error(str(e))` 会丢掉栈，排查时只剩一行没上下文的消息。

**异常链**：

```python
try:
    parse(raw)
except ValueError as e:
    raise DataError('配置格式错误') from e     # 保留原始异常
```

`from e` 让 traceback 显示「上面这个异常是由下面这个引起的」。不写 `from` 时 Python 也会自动串（显示 "During handling of..."），但显式 `from` 语义更准。要**断开**链用 `from None`（比如不想暴露内部实现细节）。

**`finally` 一定执行**，包括 `return` 之后和异常传播中。但 **`finally` 里 return 会吞掉异常**：

```python
def f():
    try:
        raise ValueError
    finally:
        return 1        # ✗ 异常被丢弃，函数正常返回 1
```

**`else` 子句**（很少人用但有价值）：`try` 没抛异常时才执行，能把「可能抛的代码」缩到最小：

```python
try:
    v = d[k]
except KeyError:
    ...
else:
    use(v)          # 只有取到才用，且 use 抛的 KeyError 不会被误捕
```

# Python 3.11+ > 语言内核 > 异常与上下文管理 > with 与上下文管理器

来源：https://fqx.lx.ci/python-map/

**`with` 保证清理动作一定执行**，比 try/finally 更简洁且不会忘：

```python
with open('f.txt', encoding='utf-8') as f:
    data = f.read()
# 离开时自动 close，即使中间抛异常
```

原理是对象实现了 `__enter__` / `__exit__`：

```python
class Timer:
    def __enter__(self):
        self.t = time.perf_counter()
        return self                      # as 后面拿到的是这个返回值
    def __exit__(self, exc_type, exc_val, tb):
        print(f'{time.perf_counter() - self.t:.3f}s')
        return False    # 返回 True 会「吞掉」异常，通常不要这么做
```

**`__exit__` 返回 True 表示异常已处理**，异常不再传播。这个特性很容易被误用成静默吞异常，除了 `contextlib.suppress` 这种明确意图的场合，都应该返回 False（或不返回）。

**更常用的写法是生成器**：

```python
from contextlib import contextmanager

@contextmanager
def transaction(conn):
    try:
        yield conn            # yield 之前是 __enter__，之后是 __exit__
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

with transaction(conn) as c:
    c.execute(...)
```

**多个上下文**可以并排或用括号分行（3.10+）：

```python
with open('a') as fa, open('b', 'w') as fb:
    fb.write(fa.read())

with (open('a') as fa, open('b', 'w') as fb):   # 3.10+ 可换行
    ...
```

**几个实用工具**：

```python
from contextlib import suppress, ExitStack, closing

with suppress(FileNotFoundError):        # 明确忽略某个异常
    os.remove(path)

with ExitStack() as stack:               # 数量不定的上下文
    files = [stack.enter_context(open(p)) for p in paths]
```

**`ExitStack` 解决「循环里打开 N 个资源」**——写不出 N 个 `with` 时用它，退出时按相反顺序全部清理。
