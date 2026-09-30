# Python 3.11+ > 工程实践 > 资料说明

来源：https://fqx.lx.ci/python-map/

来源：https://fqx.lx.ci/python-map/

主线对齐 Python 3.11+，涉及 3.7 / 3.10 / 3.12 / 3.13 版本差异的地方单独标注。

# Python 3.11+ > 工程实践

来源：https://fqx.lx.ci/python-map/

Python 工程上的混乱几乎都来自「环境里装了什么」说不清。虚拟环境、锁文件、src 布局这三件事做对，后面测试、类型检查、打包才能稳。包管理工具这几年变了（pip → poetry → uv），原则没变：隔离、钉死版本、可重复安装。

# Python 3.11+ > 工程实践 > 虚拟环境与包管理

来源：https://fqx.lx.ci/python-map/

**为什么必须用虚拟环境**：Python 包是装到「当前解释器的 site-packages」里的。不用 venv，所有项目共享一套包，A 项目升级 requests 把 B 项目弄崩是日常。**系统 Python 更不能动**——Linux 上 apt 自己依赖它，乱装会把系统工具搞坏（PEP 668 就是为此把系统 Python 锁上的）。

**venv 是标准库，永远可用**：

```bash
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

**激活的本质是改 `PATH` 让 `python` / `pip` 指向 venv 里的。** 没激活时用 `.venv/bin/python` 也能跑，CI 里常用这种写法，更明确。

**锁版本**：

```bash
pip freeze > requirements.txt      # 把当前环境完整钉死
pip install -r requirements.txt    # 另一台机器复现
```

`pip freeze` 的问题是**把间接依赖也写进去**，文件又长又难读，而且你说不清哪些是自己直接需要的。更好的拆法：

```
# requirements.in  —— 只写直接依赖
fastapi>=0.110
httpx>=0.27

# 编译出锁文件（pip-tools）
pip-compile requirements.in -o requirements.txt
```

**uv（现在最推荐的工具）把这些合成一个**：

```bash
uv venv                      # 创建 .venv，比 python -m venv 快得多
uv pip install fastapi       # 快 10~100 倍的 pip
uv add fastapi               # 如果用 uv 的项目模式，写进 pyproject.toml 并锁版本
uv run python app.py         # 自动用项目环境跑
uv sync                      # 按锁文件重建环境
```

**uv 解决了 Python 包管理十年的痛**：快、锁文件默认有、不依赖预装 Python（自己能拉解释器）。新项目用 uv；老项目继续 pip + venv 也能活，不要为了换工具而换。

**`pyproject.toml` 是现代项目的清单**（PEP 518/621），替代 setup.py：

```toml
[project]
name = "myapp"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = ["fastapi>=0.110", "httpx>=0.27"]

[dependency-groups]          # PEP 735，可选依赖
dev = ["pytest", "ruff", "mypy"]
```

**不要混用 conda 和 pip 管同一个环境**。conda 适合数据科学（二进制依赖多，numpy/scipy/cuda），Web 服务用 venv/uv 更干净。混用的后果是包互相覆盖、版本对不上、报错信息指向两个地方。

# Python 3.11+ > 工程实践 > 虚拟环境与包管理 > 模块、包与导入路径

来源：https://fqx.lx.ci/python-map/

**脚本所在目录和当前工作目录都会进 `sys.path`**，这是导入混乱的根源。

```
project/
  src/
    myapp/
      __init__.py
      core.py
      utils.py
  tests/
    test_core.py
  pyproject.toml
```

**`src` 布局的好处**：没安装包时，`import myapp` 会失败——逼你用正确的方式（`pip install -e .` 可编辑安装）把包加到环境里。**扁平布局**（myapp 直接放项目根）的问题是你在项目根跑测试时，Python 会直接找到本地目录，和安装后的包不是同一套逻辑，相对导入行为也不一样。

**相对导入 vs 绝对导入**：

```python
# myapp/core.py
from myapp.utils import helper     # ✓ 绝对，推荐
from .utils import helper          # ✓ 相对，包内可以
from utils import helper           # ✗ 依赖 sys.path 碰巧对
```

**相对导入只能在包内用**，直接 `python myapp/core.py` 会报 `ImportError: attempted relative import with no known parent package`。这就是为什么入口文件应该是：

```bash
python -m myapp.cli          # ✓ 把 myapp 当包跑
python myapp/cli.py          # ✗ 把 cli.py 当独立脚本，包结构丢失
```

**`if __name__ == '__main__'`** 区分「被导入」和「当脚本跑」：

```python
def main():
    ...
if __name__ == '__main__':
    main()
```

被导入时 `__name__` 是模块名，当脚本跑时是 `'__main__'`。**副作用（连数据库、读配置、起服务）不要放模块顶层**，放 `main()` 里，否则一被导入就执行。

**循环导入**：A 导入 B，B 导入 A。Python 允许，但在模块还没执行完时对方的名字还不存在：

```python
# a.py
from b import f     # 如果 b 正在导入 a，这里可能 ImportError 或拿到半成品
```

修法：延迟导入（放到函数里）、把共享的东西抽到第三个模块、或者重新设计依赖方向。**循环导入通常是模块切分有问题的信号**，而不是该用技巧绕过去的。

# Python 3.11+ > 工程实践 > 代码风格与类型检查

来源：https://fqx.lx.ci/python-map/

**格式化不要争论，用 ruff 或 black 一把梭**：

```bash
uv add --dev ruff
ruff check --fix .          # lint + 自动修
ruff format .               # 格式化（替代 black）
```

ruff 用 Rust 写，比 flake8+black+isort 快两个数量级，规则兼容。**配进 pre-commit 和 CI**，不要靠人记 PEP 8。

**几个 ruff 默认不开但值得开的规则**：

- `I` —— import 排序
- `UP` —— pyupgrade，自动用新语法（f-string、`X | None` 代替 `Optional[X]`）
- `N` —— 命名约定
- `B` —— bugbear，常见 bug 模式（可变默认参数就在这里查）
- `SIM` —— 简化

**类型检查用 mypy 或 pyright**：

```bash
uv add --dev mypy
mypy src
```

**渐进启用**：新文件强制有注解，老文件先 `# type: ignore` 或 mypy 的 per-module 配置，不要幻想一天给几万行老代码补完类型。

**注解写法（3.10+）**：

```python
def f(x: int | None) -> list[str]: ...     # 不再需要 Optional、List
from typing import Sequence, Mapping, Iterable   # 参数用抽象类型
def g(xs: Sequence[int]) -> None: ...      # 可接受 list/tuple，不只 list
```

**参数用抽象类型（Sequence/Mapping/Iterable），返回用具体类型（list/dict）**。这样调用方能传 tuple，你返回 list 调用方能当 list 用。

**`TypeVar` 和泛型**日常够用的就这些：

```python
from typing import TypeVar
T = TypeVar('T')
def first(xs: list[T]) -> T | None:
    return xs[0] if xs else None
```

3.12+ 更短：`def first[T](xs: list[T]) -> T | None:`。

**类型检查不是运行时保护**。要运行时校验用 pydantic。两者互补：mypy 查代码逻辑，pydantic 查外部输入（API 请求、配置文件、LLM 输出）。

# Python 3.11+ > 工程实践 > 测试：pytest 就够了

来源：https://fqx.lx.ci/python-map/

**别用 unittest 手写类**，pytest 用函数 + assert，样板代码少一个数量级：

```python
# tests/test_core.py
from myapp.core import add

def test_add():
    assert add(1, 2) == 3

def test_add_raises():
    with pytest.raises(TypeError):
        add('a', 2)
```

**跑测试**：

```bash
pytest                      # 发现 tests/ 下所有 test_*.py
pytest -k add               # 名字匹配
pytest -x                   # 第一个失败就停
pytest --pdb                # 失败时进调试器
pytest -n auto              # pytest-xdist 并行
```

**fixture 是 pytest 的核心**，用来准备和清理：

```python
import pytest

@pytest.fixture
def db():
    conn = create_test_db()
    yield conn                 # yield 之前是 setup，之后是 teardown
    conn.close()

def test_insert(db):
    db.execute('INSERT ...')
    assert db.count() == 1
```

**作用域**：`scope='function'`（默认，每个测试新建）、`module`、`session`。数据库这种贵的资源用 session 级 + 每个测试回滚事务，比每次建库快得多。

**参数化**：

```python
@pytest.mark.parametrize('a,b,expected', [
    (1, 2, 3),
    (0, 0, 0),
    (-1, 1, 0),
])
def test_add(a, b, expected):
    assert add(a, b) == expected
```

比写三个测试函数清晰，失败时报告具体哪一组参数。

**mock 外部依赖**，不要真打 API：

```python
def test_fetch(monkeypatch):
    def fake_get(url):
        return FakeResp(b'{"ok": true}')
    monkeypatch.setattr('myapp.client.httpx.get', fake_get)
    assert fetch('http://x').ok
```

**`monkeypatch` 是 pytest 内置的**，测完自动还原。`unittest.mock.patch` 也能用，但 monkeypatch 更贴 pytest。

**覆盖率**：

```bash
pytest --cov=myapp --cov-report=term-missing
```

**覆盖率是工具不是目标**。100% 覆盖的测试套件仍然可以什么都测不到（只跑过没断言）。先保证**关键路径和边界条件有断言**，再看覆盖率查漏。

**测试要快、要隔离、要确定**：不依赖执行顺序、不依赖外部服务（用 fixture 造）、不依赖当前时间（把 `datetime.now` 注进去）。做不到这三条，CI 就会变成「红了重跑就绿」的赌局。

# Python 3.11+ > 工程实践 > 日志、配置与错误处理

来源：https://fqx.lx.ci/python-map/

**用 `logging` 模块，不要 `print`**。print 没法分级、没法按模块过滤、没法输出 JSON 给采集器。

```python
import logging
log = logging.getLogger(__name__)     # 用模块名，方便过滤

log.debug('细节')
log.info('正常进展')
log.warning('异常但还能继续')
log.error('失败')
log.exception('失败')                 # 只能在 except 里，自动带 traceback
```

**配置一次，在入口做**：

```python
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s %(levelname)s %(name)s: %(message)s',
)
# 生产环境用 JSON 格式（python-json-logger 或 structlog），方便 ELK/Loki 采集
```

**第三方库的日志很吵**，单独调：

```python
logging.getLogger('httpx').setLevel(logging.WARNING)
logging.getLogger('sqlalchemy.engine').setLevel(logging.WARNING)
```

**日志里不要有敏感信息**：token、密码、身份证、完整请求体。结构化日志时显式挑字段，不要 `log.info(f'request={req.__dict__}')`。

**配置从环境变量读**，不要写死，也不要在代码里 `open('config.json')` 还不区分环境：

```python
import os
DATABASE_URL = os.environ['DATABASE_URL']          # 必须有，没有就崩在启动时
DEBUG = os.environ.get('DEBUG', '0') == '1'        # 可选，有默认
```

**必须的配置用 `os.environ[k]`（没有就 KeyError 启动失败）**，可选的才 get + 默认值。启动时失败比运行到一半才发现缺配置好得多。

pydantic-settings 把环境变量映射到类型化的配置类，FastAPI 项目基本都用它：

```python
from pydantic_settings import BaseSettings
class Settings(BaseSettings):
    database_url: str
    debug: bool = False
settings = Settings()     # 自动读环境变量，类型不对直接报错
```

**密钥不进 git**：`.env` 加进 `.gitignore`，示例放 `.env.example`。生产用环境变量或密钥管理服务，不要把 `.env` 拷到镜像里。

# Python 3.11+ > 工程实践 > 打包、发布与 Docker

来源：https://fqx.lx.ci/python-map/

**应用（要跑的服务）和库（要被别人 import 的）打包方式不同。**

**库**：`pyproject.toml` + `hatchling` / `setuptools` 构建，发到 PyPI：

```bash
uv build
uv publish
```

版本号用语义化：破坏兼容升主版本，新功能升次版本，修 bug 升补丁。**一旦发到 PyPI，那个版本号的内容就不能改**（只能 yank 再发新版本）。

**应用**：不需要发 PyPI，Docker 镜像是交付物。

```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN pip install uv && uv sync --frozen --no-dev
COPY src ./src
CMD ["uv", "run", "python", "-m", "myapp"]
```

**`--frozen` 按锁文件装，锁文件没更新就失败**——这是「在我机器上能跑」的克星。`--no-dev` 不装 pytest/ruff，镜像更小。

**镜像里几个注意**：

- **不要用 `latest` 标签当基础镜像**，钉 `python:3.12.7-slim`
- **多阶段构建**：构建阶段装编译工具，运行阶段只拷 venv，镜像能小一半
- **非 root 用户跑**
- **不要把密钥 COPY 进去**，运行时注入
- **`PYTHONUNBUFFERED=1`** 让 print/log 立刻出，否则 Docker 日志里看不到实时输出
- **`PIP_NO_CACHE_DIR=1`** 减小层大小

**健康检查和优雅退出**：容器编排（k8s/compose）靠健康检查判活，靠 SIGTERM 通知进程退出。

```python
import signal, asyncio
stop = asyncio.Event()
def _handle(sig, frame):
    stop.set()
signal.signal(signal.SIGTERM, _handle)
signal.signal(signal.SIGINT, _handle)

async def main():
    server = await start_server()
    await stop.wait()              # 等到信号
    await server.shutdown()        # 停收新请求，把在途请求做完
    await close_db()
```

**缺这一段的后果**：k8s 滚动更新时直接 SIGKILL，在途请求全部失败，数据库连接来不及还。FastAPI/uvicorn 默认处理了 SIGTERM，但**你自己的后台任务、进程池、消息消费循环要自己接**。

**依赖审计**：

```bash
uv pip compile pyproject.toml -o requirements.txt
pip-audit -r requirements.txt          # 查已知 CVE
```

或者 GitHub Dependabot。锁文件让审计有意义——没有锁文件，你不知道生产上实际跑的是哪个版本。
