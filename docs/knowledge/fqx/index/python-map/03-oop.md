# Python 3.11+ > 面向对象 > 资料说明

来源：https://fqx.lx.ci/python-map/

主线对齐 Python 3.11+，涉及 3.7 / 3.10 / 3.12 / 3.13 版本差异的地方单独标注。

# Python 3.11+ > 面向对象

Python 的面向对象是「约定大于强制」。没有真正的 private、没有接口关键字、没有编译期多态检查。真正该理解的是查找顺序（MRO）、属性访问的描述符协议、以及 duck typing 怎么替代继承。dataclass 和 ABC 都是这套机制上的工具，不是新概念。

# Python 3.11+ > 面向对象 > 类、实例与属性查找

**类是造实例的模板，也是对象本身**（元类那一层日常可以不碰）。实例的属性存在 `__dict__` 里，是一个普通字典。

```python
class User:
    species = 'human'          # 类属性，所有实例共享
    def __init__(self, name):
        self.name = name       # 实例属性，每个实例一份

u = User('a')
u.age = 20                     # 可以随时加属性，没有声明环节
```

**查找顺序**：实例 `__dict__` → 类 `__dict__` → 父类（按 MRO）。所以 `u.species` 能拿到类属性；`u.name = 'b'` 写的是实例自己的，不影响其他实例。

**可变类属性的坑**（语言内核章也提过）：

```python
class Cart:
    items = []                 # ✗ 所有购物车共享一个列表
    def add(self, x):
        self.items.append(x)   # 改的是类属性那个列表
```

**方法是描述符**：`u.hello()` 实际是 `User.hello(u)`。`self` 就是那个被自动传入的实例。

**三种方法**：

```python
class C:
    def inst(self): ...            # 实例方法，第一个参数是实例
    @classmethod
    def cls(cls): ...              # 类方法，第一个参数是类本身
    @staticmethod
    def st(): ...                  # 静态方法，没有自动参数，就是放在类里的函数
```

**`@classmethod` 的真正用途是替代构造函数**：

```python
class Date:
    def __init__(self, y, m, d):
        self.y, self.m, self.d = y, m, d

    @classmethod
    def from_iso(cls, s):
        y, m, d = s.split('-')
        return cls(int(y), int(m), int(d))   # 用 cls 而不是 Date，子类也能用
```

**`@staticmethod` 多数时候没必要**——如果一个方法既不用 self 也不用 cls，它也许不该在这个类里。用模块级函数更 Python。留在类里的理由是「命名空间上它属于这个概念」。

**命名约定，不是访问控制**：

```python
self.public          # 公开
self._internal       # 约定：内部使用，外部不该碰（但碰得了）
self.__mangled       # 名字改写成 _ClassName__mangled，防子类意外覆盖
```

**没有真正的 private。** 双下划线不是 private，是**名字改写**，目的是避免子类定义同名属性时覆盖父类的。外部仍然能通过 `_ClassName__mangled` 访问。**不要用双下划线当封装手段**，用单下划线 + 文档约定。

# Python 3.11+ > 面向对象 > 类、实例与属性查找 > 继承、MRO 与 super()

**MRO（Method Resolution Order）决定了多继承时方法从哪找**。C3 线性化算法保证：子类在父类前、声明顺序保留、单调（子类的 MRO 是父类 MRO 的扩展）。

```python
class A: pass
class B(A): pass
class C(A): pass
class D(B, C): pass
print(D.__mro__)
# (D, B, C, A, object)
```

**看不懂就打印 `__mro__`**，这是排查「为什么调的不是我以为的那个方法」的第一动作。

**菱形继承**（B 和 C 都继承 A，D 继承 B 和 C）在 Python 里是合法且常见的，因为 `super()` 按 MRO 走，每个类只被调用一次：

```python
class A:
    def f(self):
        print('A')

class B(A):
    def f(self):
        print('B'); super().f()     # 下一个是 C，不是 A

class C(A):
    def f(self):
        print('C'); super().f()     # 下一个是 A

class D(B, C):
    def f(self):
        print('D'); super().f()     # 下一个是 B

D().f()    # D B C A
```

**`super()` 不是「调用父类」**，是「调用 MRO 里的下一个」。这是最重要的认知纠正。在单继承里两者碰巧等价，在多继承里差很远。

**协作式多继承要求所有类都用 `super()` 且签名兼容**（通常 `*args, **kwargs` 一路传下去）。任何一层写成 `Parent.f(self)` 硬编码调用，链就断了。

**实践判断**：日常业务代码**尽量单继承**。多继承只用于 mixin（无状态的功能片段，比如 `JsonMixin`、`TimestampMixin`）。**mixin 不要定义 `__init__`**，或者必须用 `super().__init__(**kwargs)` 把参数传下去。

**Python 3 的 `super()` 不需要参数**（`super()` 即可），Python 2 要写 `super(D, self)`。现在看到带参数的 `super` 多半是遗留代码。

# Python 3.11+ > 面向对象 > 描述符与 @property

**描述符是 Python 属性访问的底层协议**：一个对象实现了 `__get__` / `__set__` / `__delete__` 中的任意一个，它就是描述符。放在类上时，实例访问这个属性会走描述符协议而不是 `__dict__`。

**`@property` 就是描述符**：

```python
class Circle:
    def __init__(self, r):
        self._r = r

    @property
    def r(self):
        return self._r

    @r.setter
    def r(self, v):
        if v <= 0:
            raise ValueError('半径必须为正')
        self._r = v

    @property
    def area(self):
        return 3.1416 * self._r ** 2
```

`c.r` 看起来像属性，实际走 getter；赋值走 setter。**好处是以后给已有属性加校验不需要改调用方**——这是「先暴露成公开属性、需要时再改成 property」这个 Python 风格的基础。

**和 Java 的对比**：Java 一上来就写 getter/setter，Python 反过来——先直接用公开属性，真需要拦截访问时再改成 property，调用方代码一行都不用改（都是 `obj.x`）。

**只读属性只定义 getter 不定义 setter**。试图赋值会 `AttributeError`。

**计算属性每次访问都重新算**。贵的计算用 `functools.cached_property`（3.8+），第一次算完缓存到实例上：

```python
from functools import cached_property

class Report:
    @cached_property
    def summary(self):
        return expensive_compute(self.data)
```

**注意它是一次性的**：数据变了缓存不会自动失效。要能失效就自己管缓存，或者用普通方法。

**数据描述符 vs 非数据描述符**：有 `__set__` 的是数据描述符，**优先级高于实例 `__dict__`**。`@property` 是数据描述符，所以即使实例 `__dict__` 里有同名键也走 property。普通方法只有 `__get__`，是非数据描述符，所以你可以 `u.hello = 1` 把方法覆盖成普通属性。

日常写业务几乎不需要自己实现描述符。**知道 property 是描述符、方法是描述符，就够理解属性查找的各种「奇怪」行为了。**

# Python 3.11+ > 面向对象 > 魔术方法：让对象表现得像内置类型

**Python 的运算符和内置函数都通过魔术方法（dunder）转发**：

```python
len(x)        → x.__len__()
x + y         → x.__add__(y)
x == y        → x.__eq__(y)
x[k]          → x.__getitem__(k)
x[k] = v      → x.__setitem__(k, v)
k in x        → x.__contains__(k)
for i in x    → iter(x) → x.__iter__()
bool(x)       → x.__bool__() 或 x.__len__()
str(x)        → x.__str__()
repr(x)       → x.__repr__()
hash(x)       → x.__hash__()
with x        → x.__enter__() / x.__exit__()
```

**`__repr__` 和 `__str__` 的约定**：`repr` 给开发者看（理想情况能 `eval` 还原），`str` 给用户看。只实现一个的话实现 `__repr__`，`str()` 会回退到它。

```python
def __repr__(self):
    return f'Date({self.y}, {self.m}, {self.d})'
def __str__(self):
    return f'{self.y:04d}-{self.m:02d}-{self.d:02d}'
```

**实现 `__eq__` 必须同时处理 `__hash__`**：

```python
class Point:
    def __init__(self, x, y):
        self.x, self.y = x, y
    def __eq__(self, other):
        if not isinstance(other, Point):
            return NotImplemented
        return self.x == other.x and self.y == other.y
    # 可变对象：显式禁止哈希
    __hash__ = None
```

**规则**：可变对象（改了属性后 hash 会变）**不能**做哈希——否则放进 set / 当 dict 键之后改属性，对象就「丢了」（按新 hash 找不到，按旧 hash 对不上）。不可变对象两个相等的实例必须有相同的 hash。**默认情况下自定义了 `__eq__` 会让对象不可哈希**（Python 自动把 `__hash__` 设为 None），这是保护。

**返回 `NotImplemented` 而不是 `False`**：让 Python 去试对方的 `__eq__`（反向操作）。两边都 NotImplemented 才是 TypeError。这让 `Point == ColoredPoint` 有机会由子类决定怎么比。

**上下文管理器 `__enter__` / `__exit__`** 见异常章。**可调用对象 `__call__`** 让实例能当函数用，装饰器类、策略对象常用。

# Python 3.11+ > 面向对象 > dataclass 与 NamedTuple

**日常写的「数据类」90% 不该手写 `__init__` / `__repr__` / `__eq__`**。`@dataclass`（3.7+）自动生成它们：

```python
from dataclasses import dataclass, field, replace

@dataclass
class User:
    name: str
    age: int = 0
    tags: list = field(default_factory=list)    # 不能 tags: list = []
    password: str = field(repr=False)           # repr 里隐藏
```

**`default_factory` 解决可变默认值问题**——每个实例调用一次 factory，得到独立的列表。写成 `tags: list = []` 会在定义时就报错（dataclass 专门拦这个）。

**几个常用参数**：

```python
@dataclass(frozen=True, slots=True, kw_only=True, order=True)
class Point:
    x: float
    y: float
```

- `frozen=True` —— 不可变，自动可哈希（能当 dict 键）。属性赋值抛 FrozenInstanceError
- `slots=True`（3.10+）—— 用 `__slots__`，省内存、防拼写错误（`p.z = 1` 直接报错而不是悄悄加属性）
- `kw_only=True`（3.10+）—— 构造只能用关键字，避免位置参数对不上
- `order=True` —— 生成 `<` `>` 比较，按字段声明顺序

**`replace` 造修改过的副本**（frozen 时的标准改法）：

```python
p2 = replace(p, x=10)
```

**和 NamedTuple 的选择**：

| | dataclass | NamedTuple |
|---|---|---|
| 可变 | 默认可变 | 不可变 |
| 继承 | 灵活 | 受限 |
| 内存 | slots=True 后接近 | 更省（tuple 存储） |
| 默认值 | 灵活 | 有，但所有有默认值的字段必须在后面 |

**新代码优先 dataclass**。NamedTuple 适合「就是个有名字的元组」这种轻量场景，或者要当元组解包（`x, y = point`）。

**pydantic 是 dataclass 的运行时加强版**：按类型注解做校验、转换、序列化。FastAPI 的请求/响应模型就是它。做 API 和配置加载时用 pydantic，纯内部数据结构用 dataclass——前者贵在校验，后者贵在零运行时开销。

# Python 3.11+ > 面向对象 > 协议、ABC 与 duck typing

**Duck typing：不关心你是什么类型，关心你有没有需要的方法。** `for x in obj` 不要求 obj 继承 Iterable，只要有 `__iter__`。这是 Python 多态的默认方式。

**代价是错误发现得晚**——运行到那一行才 `AttributeError`。两个工具把检查提前：

**一、ABC（抽象基类）——「必须实现这些方法」**：

```python
from abc import ABC, abstractmethod

class Repository(ABC):
    @abstractmethod
    def get(self, id): ...
    @abstractmethod
    def save(self, entity): ...

class SqlRepo(Repository):
    def get(self, id): ...
    # 漏了 save → 实例化时 TypeError，而不是调用时 AttributeError
```

**ABC 的价值是把「接口约定」从文档变成运行时检查**。实例化抽象类或漏实现抽象方法会立刻失败。`collections.abc` 里有现成的：`Iterable`、`Sequence`、`Mapping`、`Awaitable` 等，`isinstance(x, Iterable)` 比自己查 `__iter__` 更靠谱（它还认 `__getitem__` 这种老式迭代）。

**二、Protocol（3.8+，typing）——静态 duck typing**：

```python
from typing import Protocol

class Closeable(Protocol):
    def close(self) -> None: ...

def shutdown(x: Closeable):
    x.close()
```

**Protocol 不需要继承**。任何有 `close()` 方法的对象都满足 Closeable，mypy 能检查出来。这才是和 Go interface、TypeScript 结构类型对等的东西。

**怎么选**：

- 运行时要拦「漏实现」→ ABC
- 只给类型检查器用、不想强迫继承 → Protocol
- 调用处只关心一个方法 → 直接调用，什么都不定义（纯 duck typing）

**多重继承 + ABC 是 mixin 的常见形态**：`class SqlRepo(Repository, LoggingMixin):`。记住 mixin 无状态、`super()` 传参，见 MRO 那节。

**`isinstance` vs duck typing**：对你自己定义的类型层次用 `isinstance` 合理；对外部对象（文件、socket、自定义类）用 `hasattr` 或直接调用 + 捕获 `AttributeError`。**不要用 `type(x) is list`**，用 `isinstance(x, list)`——前者拒绝子类。更宽的判断用 `isinstance(x, collections.abc.Sequence)`。
