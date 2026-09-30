# Python 3.11+ > 数据结构与迭代 > 资料说明

来源：https://fqx.lx.ci/python-map/

来源：https://fqx.lx.ci/python-map/

主线对齐 Python 3.11+，涉及 3.7 / 3.10 / 3.12 / 3.13 版本差异的地方单独标注。

# Python 3.11+ > 数据结构与迭代

来源：https://fqx.lx.ci/python-map/

Python 的内置容器很少但够用，关键是知道每种的时间复杂度——用 list 做成员判断和用 set 做，在几万条数据上是几百倍差距。迭代器和生成器是另一半：它们让「处理比内存大的数据」变成可能，也是 Python 处理数据管道的标准姿势。

# Python 3.11+ > 数据结构与迭代 > 四种容器：选哪个

来源：https://fqx.lx.ci/python-map/

| 容器 | 有序 | 可变 | 查成员 | 典型用途 |
|---|---|---|---|---|
| `list` | ✓ | ✓ | **O(n)** | 有序序列、允许重复 |
| `tuple` | ✓ | ✗ | O(n) | 不变的记录、可作字典键 |
| `dict` | ✓（3.7+ 保插入序） | ✓ | **O(1)** | 键值映射 |
| `set` | ✗ | ✓ | **O(1)** | 去重、成员判断、集合运算 |

**最该记住的一条**：`x in list` 是 O(n)，`x in set` / `x in dict` 是 O(1)。

```python
# ✗ 双层遍历，10 万 × 10 万
result = [x for x in a if x in b]          # b 是 list → O(n×m)

# ✓ 先转 set
bset = set(b)
result = [x for x in a if x in bset]       # O(n+m)
```

**这是 Python 性能问题的第一大来源**。现象是数据量小时飞快、上线后卡死，因为 O(n²) 在 1000 条时是 100 万次（无感），10 万条时是 100 亿次（跑不完）。

**list 各操作的复杂度**：

```python
lst[i]              # O(1)   索引
lst.append(x)       # O(1)   均摊
lst.pop()           # O(1)   尾部
lst.insert(0, x)    # O(n)   ← 头部插入要搬移所有元素
lst.pop(0)          # O(n)   ← 同理
x in lst            # O(n)
```

**要在两头进出用 `deque`**：

```python
from collections import deque
q = deque(maxlen=1000)          # 双端队列，两头都是 O(1)
q.appendleft(x); q.popleft()
```

`maxlen` 让它变成自动淘汰的滑动窗口（超出时从另一头挤掉），做「最近 N 条记录」非常合适。

**`tuple` 的两个实际价值**：可哈希（能当字典键、放进 set），以及**表达「这是一条不变的记录」**。返回多个值时用 tuple，但字段超过两三个就该用 `NamedTuple` 或 `dataclass`（见面向对象章）——`result[3]` 这种下标访问三个月后没人看得懂。

# Python 3.11+ > 数据结构与迭代 > 四种容器：选哪个 > dict 的正确用法与 collections 工具

来源：https://fqx.lx.ci/python-map/

**取值的四种写法，语义不同**：

```python
d[k]                    # 没有就抛 KeyError
d.get(k)                # 没有返回 None
d.get(k, default)       # 没有返回 default
d.setdefault(k, [])     # 没有就插入 default 并返回它
```

**`get` 的默认值坑**：`d.get(k, expensive())` 会**无条件求值** `expensive()`，即使键存在。要延迟就用 `if k in d`。

**`defaultdict` 消灭「先检查再初始化」**：

```python
from collections import defaultdict

groups = defaultdict(list)
for item in items:
    groups[item.type].append(item)      # 不用先判断键存不存在
```

**注意 `defaultdict` 的副作用**：读一个不存在的键会**创建**它。`if groups['nonexistent']:` 之后字典里就多了一个空列表。要纯读用 `.get()`。

**`Counter` 做计数和 top-N**：

```python
from collections import Counter
c = Counter(words)
c.most_common(10)          # 前 10 高频，直接给
c['missing']               # 0，不抛异常
c1 + c2, c1 - c2           # 支持加减
```

**遍历时不能改字典大小**：

```python
for k in d:
    if cond(k): del d[k]        # RuntimeError: dictionary changed size

for k in list(d):               # ✓ 先固化键列表
    if cond(k): del d[k]

d = {k: v for k, v in d.items() if not cond(k)}   # ✓ 更清晰
```

同样的规则适用于 list 和 set。**边遍历边删 list 还有个更隐蔽的坑**（不报错但会跳过元素）：

```python
for x in lst:
    if bad(x): lst.remove(x)    # ✗ 静默漏掉元素，索引错位
```

**字典合并**：`{**a, **b}`（3.5+）或 `a | b`（3.9+），后者更清晰。`a |= b` 是原地更新。冲突时后者赢。

# Python 3.11+ > 数据结构与迭代 > 四种容器：选哪个 > set 与集合运算

来源：https://fqx.lx.ci/python-map/

```python
a, b = {1, 2, 3}, {2, 3, 4}
a & b        # {2, 3}      交集
a | b        # {1,2,3,4}   并集
a - b        # {1}         差集
a ^ b        # {1, 4}      对称差（只在一边）
a <= b       # 子集判断
```

**这套运算能替代很多循环**。典型场景是对比两批数据：

```python
# 找出需要新增、删除、更新的记录
old_ids = {r.id for r in db_rows}
new_ids = {r.id for r in incoming}

to_insert = new_ids - old_ids
to_delete = old_ids - new_ids
to_update = old_ids & new_ids
```

这段用集合运算三行写完，用循环要写二十行且容易漏分支。**做数据同步、增量更新时优先想集合运算。**

**去重同时保序**（set 本身无序）：

```python
list(dict.fromkeys(items))      # ✓ 保持首次出现的顺序
list(set(items))                # 顺序不确定
```

利用了 dict 保插入序的特性，是最简洁的保序去重。

**元素必须可哈希**：list、dict、set 本身不能放进 set。要去重字典列表就转成 tuple 或用某个字段：

```python
seen = set()
unique = []
for d in dicts:
    key = d['id']
    if key not in seen:
        seen.add(key)
        unique.append(d)
```

**`frozenset`** 是不可变版本，可以当字典键、放进另一个 set。做「集合的集合」时需要它。

# Python 3.11+ > 数据结构与迭代 > 推导式与内置函数

来源：https://fqx.lx.ci/python-map/

**推导式是 Python 最有辨识度的特性**，比 `for` + `append` 更快（省掉方法查找和调用）也更清晰：

```python
[x * 2 for x in nums if x > 0]           # list
{x: x**2 for x in nums}                  # dict
{x % 5 for x in nums}                    # set
(x * 2 for x in nums)                    # 生成器（不是 tuple！）
```

**圆括号给的是生成器不是元组**，这是个常见误解。要元组用 `tuple(...)`。

**嵌套的顺序和 for 循环一致**，从左到右读：

```python
[y for row in matrix for y in row]        # 展平
# 等价于：
# for row in matrix:
#     for y in row:
#         yield y
```

**什么时候不该用推导式**：超过两层嵌套、或者条件复杂到要换行时，写成普通循环更好读。推导式的价值是简洁，不简洁了就失去意义。

**海象运算符 `:=`（3.8+）避免重复计算**：

```python
# ✗ f(x) 算两次
[f(x) for x in items if f(x) > 0]
# ✓ 算一次
[y for x in items if (y := f(x)) > 0]
```

**必须掌握的内置函数**：

```python
enumerate(items, start=1)        # 同时拿索引和值，别用 range(len())
zip(a, b)                        # 并行遍历，长度取最短
zip(a, b, strict=True)           # 3.10+，长度不等直接报错
sorted(items, key=lambda x: x.age, reverse=True)
any(...) / all(...)              # 短路求值
sum(nums, start=0)
min(items, key=len) / max(...)
reversed(seq)
```

**`zip` 静默截断是个隐患**：两个列表长度不一致时它不报错，直接按短的来，数据就悄悄丢了。**3.10+ 一律加 `strict=True`**。

**`sorted` 的 key 技巧**：

```python
# 多级排序：先按 dept 升，再按 salary 降
sorted(emps, key=lambda e: (e.dept, -e.salary))
# 非数值的多级降序用 operator + 两次稳定排序
from operator import attrgetter
emps.sort(key=attrgetter('name'))          # 次要键先排
emps.sort(key=attrgetter('dept'))          # 主键后排（稳定排序保证）
```

Python 的排序是**稳定的**（相等元素保持原顺序），所以「多次排序、次要键先排」这个技巧成立。

**`sort()` 原地改并返回 None，`sorted()` 返回新列表**。`lst = lst.sort()` 是个常见错误，结果是 None。

# Python 3.11+ > 数据结构与迭代 > 迭代器与生成器

来源：https://fqx.lx.ci/python-map/

**可迭代对象（iterable）** 是能用 `for` 遍历的（有 `__iter__`）；**迭代器（iterator）** 是有 `__next__` 的、会耗尽的一次性对象。

```python
lst = [1, 2, 3]         # iterable，可以反复遍历
it = iter(lst)          # iterator
next(it)                # 1
list(it)                # [2, 3]  ← 从当前位置继续
list(it)                # []      ← 已耗尽
```

**「迭代器只能用一次」是最常踩的坑**：

```python
gen = (x*2 for x in range(3))
print(sum(gen))     # 6
print(sum(gen))     # 0  ← 空了

# map / filter / zip 在 Python 3 里都返回迭代器
m = map(str, [1,2,3])
list(m)             # ['1','2','3']
list(m)             # []
```

现象：函数里先 `sum()` 算个总数、再遍历一遍处理，第二遍什么都没有。**需要多次遍历就先 `list()` 固化。**

**生成器：用 `yield` 写迭代器**：

```python
def read_large(path):
    with open(path, encoding='utf-8') as f:
        for line in f:              # 文件对象本身就是迭代器，逐行读
            yield line.strip()

for line in read_large('10GB.log'):  # 内存占用是常数
    process(line)
```

**这是生成器的核心价值**：处理比内存大的数据。对比 `f.readlines()`（整个文件进内存），生成器版本处理 10GB 日志只占几 KB。

**生成器管道**，每一层都是懒的：

```python
lines = read_large('access.log')
parsed = (parse(l) for l in lines)
errors = (p for p in parsed if p.status >= 500)
top = itertools.islice(errors, 100)      # 只取前 100
# 到这里一行都没读！for 循环开始才真正流动，且读到 100 条就停
```

**`yield from` 委托给另一个可迭代对象**：

```python
def flatten(nested):
    for item in nested:
        if isinstance(item, list):
            yield from flatten(item)      # 递归展平
        else:
            yield item
```

**生成器函数调用时不执行任何代码**，只返回生成器对象。函数体到第一次 `next()` 才开始跑。所以生成器里的参数校验不会立即生效——想立即校验就拆成「普通函数校验 + 内部生成器」两层。

# Python 3.11+ > 数据结构与迭代 > 迭代器与生成器 > itertools：值得记住的几个

来源：https://fqx.lx.ci/python-map/

```python
import itertools as it

it.chain(a, b, c)                # 串联多个可迭代，不建中间列表
it.islice(gen, 10)               # 切片，但对迭代器有效（迭代器不能用 [:10]）
it.groupby(sorted(data), key=f)  # 分组，注意必须先排序！
it.product(a, b)                 # 笛卡尔积，替代嵌套循环
it.combinations(items, 2)        # 组合
it.permutations(items, 2)        # 排列
it.count(start=1)                # 无限计数器
it.cycle(items)                  # 无限循环
it.repeat(x, 3)                  # 重复
it.takewhile(pred, gen)          # 条件成立时一直取，失败就停
it.dropwhile(pred, gen)          # 反之
it.tee(gen, 2)                   # 把一个迭代器复制成 n 个
```

**`groupby` 必须先排序**，这是最容易出错的一个。它只把**相邻的**相同键分到一组：

```python
data = [('a',1), ('b',2), ('a',3)]
# ✗ 不排序 → 'a' 分成两组
for k, g in it.groupby(data, key=lambda x: x[0]): ...
# ✓
for k, g in it.groupby(sorted(data, key=lambda x: x[0]), key=lambda x: x[0]): ...
```

还有一个坑：**`groupby` 返回的组是迭代器，且在移到下一组时就失效**。要保留就当场 `list(g)`。

**`batched`（3.12+）分批**，之前要自己写：

```python
for batch in it.batched(range(10), 3):
    print(batch)      # (0,1,2) (3,4,5) (6,7,8) (9,)

# 3.12 之前的等价实现
def batched(iterable, n):
    it_ = iter(iterable)
    while batch := tuple(it.islice(it_, n)):
        yield batch
```

**分批是实际最常用的**：批量插数据库、批量调 API（每次 100 条）、限制并发量，都要它。

**`tee` 的代价**：它内部缓存已产出的元素，两个分支进度差得远时缓存会很大。需要多次完整遍历还是 `list()` 更直接。

# Python 3.11+ > 数据结构与迭代 > 迭代器与生成器 > 内存与性能：什么时候该换工具

来源：https://fqx.lx.ci/python-map/

**先量再优化**：

```python
import sys, timeit, tracemalloc

sys.getsizeof([1,2,3])           # 浅层大小，不含元素本身
timeit.timeit('...', number=1000)

tracemalloc.start()
# ... 跑一段
snap = tracemalloc.take_snapshot()
for s in snap.statistics('lineno')[:10]:
    print(s)                      # 按行显示内存分配 top 10
```

`tracemalloc` 是查内存泄漏的标准工具，能定位到具体行。查 CPU 用 `cProfile`：

```bash
python -m cProfile -s cumtime script.py | head -30
```

**几个具体的优化点**：

**`__slots__` 省内存**。普通实例每个都带一个 `__dict__`，几百字节起。声明 `__slots__` 后用固定槽位存属性：

```python
class Point:
    __slots__ = ('x', 'y')       # 内存降一半以上，属性访问也略快
    def __init__(self, x, y):
        self.x, self.y = x, y
```

代价是不能动态加属性、不能多重继承两个都有 slots 的类。**百万级实例时值得，几千个不用管。**

**`array` / numpy 存同类型数值**。`list` 里每个 int 都是完整的 Python 对象（28 字节起）+ 指针。百万个数字用 list 是几十 MB，用 numpy 是 8 MB。

**字符串拼接用 `join`**，见语言内核章。

**什么时候该跳出纯 Python**：CPU 密集的数值计算，numpy 的向量化操作比 Python 循环快 10~100 倍（因为循环在 C 层跑，且没有解释器开销）。做 AI 应用会大量遇到——**「能不能改成数组运算」是优化 Python 数值代码的第一个问题**，而不是「怎么把循环写快点」。

**最后一条判断**：真正的性能问题里，绝大多数是「用错了数据结构」或「O(n²) 算法」，而不是「Python 太慢」。先 profile 找到热点，再看是不是复杂度问题，最后才考虑换语言或加 C 扩展。
