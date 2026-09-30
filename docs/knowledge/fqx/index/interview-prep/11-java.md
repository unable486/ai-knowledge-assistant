# 面试 11 · Java > 说明

Java

答案默认折叠。先自己答一遍，再点开核对。每题末尾的**追问**是面试官顺着你的答案往下挖的那一层 —— 只答得出主问题、答不出追问，通常判定为「背过，没做过」。

- 🔴 必答 — 答不出直接掉档

- 🟡 加分 — 能拉开差距

- ⚪ 可以坦白不会 — 说清边界比硬编好

# 面试 11 · Java > Spring 的 IoC 和 DI 解决了什么问题

控制反转是说对象不自己 `new` 依赖，而是由容器把依赖创建好再交给它；依赖注入是实现这件事的手段，有构造器、setter、字段三种写法。收益是解耦和可测：业务类只声明「我需要一个 `UserRepository`」，不关心是哪个实现，测试时能塞一个假的进去。

 

三种注入方式里**优先构造器注入**，理由是可观察的：

 

```java
// 构造器注入：依赖是 final，编译期就保证不为 null
@Service
public class OrderService {
    private final OrderRepository repo;
    private final PricingClient pricing;

    public OrderService(OrderRepository repo, PricingClient pricing) {
        this.repo = repo;
        this.pricing = pricing;
    }
}

// 单测里不需要 Spring 容器
OrderService svc = new OrderService(fakeRepo, fakePricing);
```

 

换成字段注入（`@Autowired` 直接写在私有字段上）会具体错成这样：单测里 `new OrderService()` 之后调方法，第一行就 NPE——字段没人注入，值是 null。于是测试要么被迫起整个 Spring 容器（几秒变几十秒），要么用反射把假对象塞进去。而且依赖被藏在字段里，从构造签名上看不出这个类要几个协作者。

 

构造器参数太多会显得很丑，这是**好事**：它在提醒你这个类职责过多。字段注入把这个信号消掉了，类膨胀到十几个依赖也没有任何视觉压力。

 

**追问「循环依赖怎么解决」**：先分清哪种循环。setter/字段注入的循环依赖，Spring 靠三级缓存能解——先把还没填完属性的半成品对象引用暴露出去，让对方先拿到引用；构造器注入的循环依赖**解决不了**，因为构造时依赖必须已经存在，会直接抛 `BeanCurrentlyInCreationException` 启动失败。更重要的是版本事实：**Spring Boot 2.6（2021 年底）起默认禁止循环依赖**，`spring.main.allow-circular-references` 默认 `false`，官方态度是「循环依赖是设计问题，应该重构而不是绕过」。所以线上遇到这个报错，正确动作是把公共逻辑抽到第三个 Bean，或者把其中一个方向改成事件/回调；把那个开关打开是把问题留在原地，而且它对构造器注入的循环依然无效。

# 面试 11 · Java > @Transactional 为什么会失效，怎么确认它真的生效了

失效场景的完整清单在 `02-node-java.md` 第 10 题，这里只补两件那边没写的：失效的判定方法，以及怎么在不改业务逻辑的前提下证明事务生效了。

 

根因只有一句：Spring 的事务是**代理**加上去的，调用没经过代理，注解就是一行注释。所以最经典的自调用长这样：

 

```java
@Service
public class OrderService {

    public void handle(Long id) {
        this.doWrite(id);   // 走的是原始对象，不是代理 → 没有事务
    }

    @Transactional
    public void doWrite(Long id) { /* 两条 update */ }
}
```

 

现象是「第一条 update 成功、第二条抛异常，第一条却没回滚」，而且日志里一句异常都不缺，只是少了事务的痕迹。凭肉眼读代码永远发现不了，因为注解明明写着。

 

判定手段三个，从轻到重：

 

```java
// 1. 运行时直接问：当前有没有真实事务
boolean active = TransactionSynchronizationManager.isActualTransactionActive();
```

 

```properties
# 2. 打开事务日志，生效时每次调用都会打印 Getting transaction for [...]
logging.level.org.springframework.transaction.interceptor=TRACE
logging.level.org.springframework.jdbc.datasource.DataSourceTransactionManager=DEBUG
```

 

第三个是看注入进来的 Bean 到底是不是代理：调试时打印 `bean.getClass().getName()`，是代理的话类名里会带 CGLIB 的标记（Spring Framework 6 起的命名是 `$$SpringCGLIB$$`，5.x 时代是 `$$EnhancerBySpringCGLIB$$`），或者用 `AopUtils.isAopProxy(bean)` 判断。类名是干净的原始类名，说明这个类压根没被代理，加什么注解都没用。

 

自调用的修法有三种（抽到另一个 Bean、`@Lazy` 注入自己、`AopContext.currentProxy()`），**抽到另一个 Bean 最干净**——需要独立事务边界的方法，本来就该是一个独立的服务职责，另外两种是在给绕过代理打补丁。

 

事务边界在 AI 应用里有个具体的雷：**模型调用绝对不能放在事务里**，一次几十秒会把连接池占满、把行锁持住，拖垮整个服务。这个划法在 `02-node-java.md` 第 10 题的追问里有完整方案，面试里主动提一句能把 Java 八股接回你自己的领域。

 

**追问「日志里明明打了 rollback，数据库里数据还在，接着往哪查」**：这时候事务是生效的，问题在「回滚的那个事务和写数据的那个连接不是一回事」。按概率查四处：**一是多数据源**——事务管理器管的 `DataSource` 和 MyBatis/JdbcTemplate 实际拿到的不是同一个，回滚的是一个没写过数据的连接；判断依据是把 `DataSourceTransactionManager` 的 DEBUG 日志和 SQL 日志摆在一起，对比 `Acquired Connection [HikariProxyConnection@...]` 的对象标识是不是同一个。**二是异步写**——方法里 `new Thread` 或 `CompletableFuture.runAsync` 执行的写操作跑在别的线程上，事务绑在 `ThreadLocal` 上传不过去（见 `02-node-java.md` 第 12 题的编排写法），主线程回滚它照样提交。**三是表引擎**——MyISAM 不支持事务，回滚是空操作。**四是 DDL 隐式提交**——事务中间执行了建表/改表语句，MySQL 会先把前面的事务提交掉。这四条的共同点是「事务生效」和「你的写操作在这个事务里」是两件独立的事，只查前者会一直查不出来。

# 面试 11 · Java > AOP 是什么，Spring 用什么实现

面向切面是把日志、事务、权限这些**横切关注点**从业务代码里抽出来，用「在什么时机、对哪些方法、做什么」三段式声明。Spring 的实现是运行时**动态代理**：目标类有接口时可以用 JDK 动态代理，没接口就用 CGLIB 生成子类。

 

代理方式决定了一条硬边界：**CGLIB 靠继承生成子类，所以 `final` 类和 `final` 方法代理不了**，`static` 方法和 `private` 方法同样拦不到。`@Transactional` 加在 `final` 方法上不生效就是这个原因——不是注解写错了，是这个方法在字节码层面没法被覆写。现象上表现为「注解在，事务没有」，和第 2 题的自调用同一类问题，只是原因在另一头。

 

补一条容易过时的：**Spring Boot 从 2.0 起默认强制 CGLIB**（`spring.aop.proxy-target-class` 默认 `true`），即使你的类实现了接口也走子类代理。所以「有接口就是 JDK 代理」这句话在 Spring Boot 项目里是错的，能顺手指出来这层会显得你确实调试过代理对象。

 

五种通知的取舍写成表更清楚：

 

| 通知 | 时机 | 典型用途 |
| --- | --- | --- |
| `@Before` | 方法前 | 参数校验、埋点开始 |
| `@AfterReturning` | 正常返回后 | 记录返回值 |
| `@AfterThrowing` | 抛异常后 | 异常告警 |
| `@After` | 无论如何都执行 | 释放资源 |
| `@Around` | 包住整个调用 | 事务、重试、缓存、限流 |

 

`@Around` 最强，能决定是否执行原方法、能改参数和返回值，代价是必须手动调 `joinPoint.proceed()`：

 

```java
@Around("@annotation(com.example.Retryable)")
public Object retry(ProceedingJoinPoint pjp) throws Throwable {
    for (int i = 0; i < 3; i++) {
        try {
            return pjp.proceed();          // 忘了这行 → 原方法永远不执行
        } catch (Exception e) {
            if (i == 2) throw e;
            Thread.sleep(200L << i);
        }
    }
    throw new IllegalStateException("unreachable");
}
```

 

漏掉 `proceed()` 的现象特别阴：方法返回 `null`、不报任何错、业务像是「静默失败」了。查的时候会一路怀疑业务代码，因为切面通常不在你正在看的那个文件里。

 

**追问「事务和 AOP 是什么关系」**：`@Transactional` 就是 Spring 内置的一个 AOP 切面——`TransactionInterceptor` 是一个 `@Around` 型的通知，在方法前开事务、正常返回后提交、抛指定异常时回滚。理解这层之后，第 2 题所有失效场景都不用单独记了，它们全是「这次调用没走到代理」的推论：自调用没走代理、`final` 方法没法生成代理、自己 `new` 的对象没有代理、非 public 方法不在切点范围内。再往下一层是同一个方法上叠多个切面时的执行顺序——用 `@Order` 或实现 `Ordered` 控制，数值小的先进后出（像洋葱一样包起来），事务切面的默认 order 是 `Ordered.LOWEST_PRECEDENCE`，所以自定义切面默认在事务**外面**：这意味着你在自定义切面里 catch 掉异常，事务照样会回滚（异常已经穿过事务切面了），而在自定义切面里做的日志能看到事务提交前的状态。**顺序这一层能说出来，基本可以确认你真的写过切面而不只是用过注解。**

 

## 集合与并发

# 面试 11 · Java > HashMap 的原理和它为什么线程不安全

结构是数组 + 链表：key 的 hash 决定落在哪个桶，同一个桶里的冲突元素挂成链表。链表**长度超过 8 且数组长度 ≥ 64 时转成红黑树**，避免大量冲突时查找退化成 O(n)；数组长度不到 64 时只扩容不树化，因为小表冲突多半是容量不够而不是 hash 分布差。默认容量 16、负载因子 0.75，元素数超过 `容量 × 0.75` 就扩容成两倍并 rehash。

 

key 必须正确实现 `hashCode` 和 `equals`，否则第 12 题那些现象都会出现。

 

线程不安全的表现分版本，这点要说准：

 

| 版本 | 并发写的后果 | 现象 |
| --- | --- | --- |
| JDK 7 | 头插法在并发扩容时形成**循环链表** | 之后任何 `get` 死循环，单核 CPU 打满，线程栈停在 `HashMap.getEntry` |
| JDK 8+ | 尾插法解决了死循环，但仍会**丢数据** | 两个线程写同一个桶，后者覆盖前者；`size` 也不准 |

 

JDK 8 之后的丢数据比死循环更难查：不报错、不卡住，只是缓存里少了几条，量小的时候根本发现不了，直到某天有人对账。

 

要线程安全用 `ConcurrentHashMap`：JDK 8 里它用 CAS 加 `synchronized` 锁**单个桶**，比 JDK 7 的分段锁粒度更细。`Hashtable` 是全表加锁，没有使用理由了。

 

有个容易忽略的点：`ConcurrentHashMap` 保证的是**单个操作**原子，组合操作仍然要自己保证：

 

```java
// 错的：get 和 put 之间别的线程可能已经写了
if (map.get(k) == null) map.put(k, v);

// 对的：一次原子操作
map.putIfAbsent(k, v);
map.computeIfAbsent(k, key -> expensiveLoad(key));
```

 

`computeIfAbsent` 还有一条硬约束：**它的 lambda 里不能再操作同一个 map**，因为计算过程是在持有桶锁的情况下跑的，同一个桶上递归写会直接死锁（JDK 9 起会抛 `IllegalStateException` 提示递归更新，但跨桶的死锁仍然可能）。缓存加载函数里顺手写一句 `map.put` 就能踩到。

 

**追问「为什么容量必须是 2 的幂」**：为了让取模变成位运算。`hash & (n - 1)` 只在 `n` 是 2 的幂时等价于 `hash % n`，位运算快得多，而且 hash 表的定位是最热的路径。第二个收益在扩容：容量翻倍后，判断元素去哪只看 hash 多出来的那一位——是 0 就留在原位，是 1 就移到「原位 + 旧容量」，**不用重新计算 hash**。所以即使你传 `new HashMap<>(1000)`，实际容量也会被 `tableSizeFor` 调整成 1024。顺带一个实际影响：**初始容量该按「预期元素数 / 0.75 + 1」算**，直接传预期元素数（比如 1000）会在放到第 768 个元素时触发一次扩容和全表 rehash，大 map 上这是一次可观的停顿。这题答出来说明你真读过源码而不是看过示意图。

# 面试 11 · Java > 线程池为什么先进队列再扩线程

参数怎么配、拒绝策略怎么选在 `02-node-java.md` 第 8 题，这里补的是那道题没展开的一层：**执行顺序**，以及由它导出的两个反直觉后果。

 

顺序是死的：核心线程没满 → 建核心线程；核心满了 → **进队列**；队列也满了 → 建非核心线程直到 `maximumPoolSize`；还满 → 触发拒绝策略。

 

注意是「先进队列，再扩线程」，于是有两个后果：

 

第一个是**无界队列让 `maximumPoolSize` 彻底失效**。`new LinkedBlockingQueue<>()` 不传容量，容量就是 `Integer.MAX_VALUE`，队列永远不会满，所以第三步永远不会发生——你配了 `max=200`，实际永远只有 `core` 个线程在跑，任务在队列里无限堆积直到 OOM。现象是「CPU 不高、线程数不涨、响应时间线性变长，最后堆内存被一堆待执行任务撑爆」，堆转储里看到的最大对象是 `LinkedBlockingQueue$Node` 的链条。

 

第二个是**突发流量下扩容比你想的晚**。`core=10, queue=1000, max=200` 这套配置里，第 11 到 1010 个任务全在排队，第 1011 个任务才会让池子扩线程。如果这是个接口的处理池，前 1000 个请求已经在队列里等超时了。想让它优先扩线程就得把队列改小，或者用 `SynchronousQueue`（不存储，直接交给线程）配大 `max`。

 

```java
ThreadPoolExecutor pool = new ThreadPoolExecutor(
        8, 64, 60L, TimeUnit.SECONDS,
        new ArrayBlockingQueue<>(200),                 // 有界，必须显式给容量
        new ThreadFactoryBuilder().setNameFormat("llm-call-%d").build(),
        new ThreadPoolExecutor.CallerRunsPolicy());    // 天然背压
```

 

线程名一定要设，这是排障成本的分水岭：`jstack` 里全是 `pool-1-thread-7` 时你不知道这是哪个池，设成 `llm-call-3` 就能一眼定位（第 8 题的排查流程直接依赖这个）。

 

配置公式（CPU 密集 `核数 + 1`、IO 密集远大于核数）只给起点，**真正该做的是压测**：AI 应用里一次模型调用几秒到几十秒，阻塞比例接近 1，按公式算出来的线程数会大得离谱，实际约束往往是下游的 QPS 配额和连接数上限，不是本机 CPU。

 

**追问「一个请求要并发调 5 个下游，用同一个线程池处理请求和下游调用，会出什么问题」**：会死锁，而且是那种压测到一定并发才复现的死锁。请求任务占着核心线程，它提交 5 个子任务后阻塞等结果；当所有核心线程都被请求任务占满、子任务全在队列里排队时，**没有线程能执行子任务，而占着线程的请求任务永远等不到结果**——池子完全冻住，队列只增不减，`jstack` 里能看到所有池线程都停在 `Future.get` 或 `CountDownLatch.await`。这叫线程池饥饿死锁。修法是**父任务和子任务用不同的池**（最简单也最有效），或者子任务不阻塞父线程（`CompletableFuture` 链式编排，见 `02-node-java.md` 第 12 题），或者用 `CallerRunsPolicy` 让提交方自己跑掉子任务作为兜底。**「同一个池里不能既跑父任务又跑它依赖的子任务」是压测才会暴露的坑，答得出来说明你排过而不是读过。**

 

## JVM 与排障

# 面试 11 · Java > JVM 内存结构，哪些线程私有，各自怎么 OOM

分区清单在 `02-node-java.md` 第 7 题，这里补两层那边没写的：私有/共享的界线，以及**每块区域各自的报错长什么样**——这是把「背过分区图」和「排过内存问题」分开的地方。

 

线程**共享**的是堆（对象实例，GC 的主战场，分新生代和老年代）和方法区/元空间（类信息、常量池、静态变量）。线程**私有**的是虚拟机栈（每个方法一个栈帧，存局部变量和操作数栈）、本地方法栈、程序计数器（记录当前执行到哪条字节码）。判断依据很直观：**私有的那三块都和「当前执行到哪、局部变量是什么」有关，天生不能共享**。

 

各区域的失败现象：

 

| 区域 | 报错 | 典型原因 |
| --- | --- | --- |
| 堆 | `OutOfMemoryError: Java heap space` | 集合只增不减、一次查太多数据 |
| 元空间 | `OutOfMemoryError: Metaspace` | 动态生成类（CGLIB、脚本引擎、反复热加载） |
| 虚拟机栈 | `StackOverflowError` | 递归没有出口、循环引用的 `toString` |
| 虚拟机栈（建线程时） | `OutOfMemoryError: unable to create new native thread` | 线程数失控，或栈太大挤占了本地内存 |
| 直接内存 | `OutOfMemoryError: Direct buffer memory` | NIO/Netty 的 `DirectByteBuffer` 没释放 |

 

JDK 8 起方法区的实现从永久代换成**元空间**，放在本地内存里，所以 `PermGen space` 那个经典报错在 JDK 8+ 已经不存在了——面试里说漏这点会被判断成「知识停在 Java 7」。元空间默认不设上限（受本机内存约束），生产上建议显式给 `-XX:MaxMetaspaceSize`，否则它能一路吃到把容器打到 OOMKilled，而这时候你的堆监控完全正常。

 

新生代的细分要能顺出来：Eden 加两个 Survivor（S0/S1），默认比例 8:1:1。新对象在 Eden，Minor GC 后活着的挪到 Survivor，年龄超过阈值（`-XX:MaxTenuringThreshold`，默认 15）晋升老年代；大对象直接进老年代，避免在两个 Survivor 之间反复拷贝。**为什么要两个 Survivor**：为了用复制算法且不产生碎片——每次把存活对象复制到空的那一个，然后整块清空原来那个。

 

**追问「容器里堆没满，Pod 却被 OOMKilled，为什么」**：因为容器的内存上限管的是**整个进程的物理内存**，堆只是其中一块。`-Xmx4g` 只承诺堆不超过 4G，进程还要额外吃：元空间、线程栈（`线程数 × 1MB`，几百个线程就是几百 MB）、代码缓存和 JIT、GC 自身的数据结构、直接内存、以及各种本地库的分配。所以「limit 设 4G、`-Xmx` 也设 4G」是必崩的配置：堆还没满，进程 RSS 已经超了，被内核直接 kill —— 而且**这种死法不产生堆转储、不打 `OutOfMemoryError`**，日志里干干净净，只有 `kubectl describe` 里一行 `OOMKilled`，这是它最容易查错方向的地方。排查手段是开 **Native Memory Tracking**（`-XX:NativeMemoryTracking=summary`，再用 `jcmd <pid> VM.native_memory summary` 看各部分占用），确认是哪块非堆内存在涨。配置上现在不该手写 `-Xmx`，而是用 `-XX:MaxRAMPercentage=70`（JDK 10+ 起 JVM 能感知 cgroup 限额，容器里默认按容器内存算而不是宿主机），把剩下的 30% 留给非堆。**答出「堆 ≠ 进程内存」并给出 NMT，比背 8:1:1 有用得多。**

# 面试 11 · Java > GC 怎么判断对象该回收，收集器怎么选

判断用**可达性分析**而不是引用计数：从 GC Roots（栈里的局部变量、静态变量、常量、JNI 引用、活跃线程）出发遍历对象图，遍历不到的就是垃圾。为什么不用引用计数——它解决不了循环引用，两个互相引用的对象计数永远不为 0。这也解释了一个常见误解：**Java 里的「内存泄漏」不是回收算法漏了，而是你的对象还被某个 GC Root 引用着**（静态集合、缓存、`ThreadLocal`、监听器没摘），算法判它「可达」完全正确。

 

三种基础算法和它们的适用位置：

 

| 算法 | 代价 | 用在哪 |
| --- | --- | --- |
| 标记-清除 | 产生碎片 | 老年代（早期收集器） |
| 复制 | 浪费一半空间 | 新生代——大部分对象很快死，存活的少，复制成本低 |
| 标记-整理 | 移动对象，停顿长 | 老年代，清理后压缩消除碎片 |

 

收集器的演进线和版本事实（这几条是最容易说过时的地方，都核实过）：

 

- **CMS 已经在 JDK 14 被移除**（JEP 363），不是「不推荐」而是**代码删了**，JDK 14+ 加 `-XX:+UseConcMarkSweepGC` 直接启动失败。说「CMS 有碎片问题所以少用」会显得停在 JDK 8。
- **G1 从 JDK 9 起是服务端默认**（JEP 248），把堆切成很多 region，可以用 `-XX:MaxGCPauseMillis` 给停顿目标。JEP 523 进一步把 G1 变成**所有环境**的默认（小机器和受限容器不再回退到 Serial），JEP 页面标的目标版本是 JDK 27，而 JDK 27 计划 2026-09 发布——截至 2026-09 初还没 GA，说的时候讲「即将随 JDK 27 落地」比说「已经是」稳。
- **ZGC 的分代模式在 JDK 23 成为默认**（JEP 474），**非分代模式在 JDK 24 被移除**（JEP 490，`ZGenerational` 参数已废弃）。所以现在说「ZGC」默认就指分代 ZGC，「ZGC 吞吐比 G1 差很多」这个老结论在分代之后已经不成立。
- 当前的 LTS 是 **JDK 25（2025-09-16 发布）**，JDK 26 于 2026-03-17 发布。回答涉及版本时对齐到这两个，比笼统说「新版本」可信。

 

核心矛盾始终是**吞吐和停顿的权衡**：批处理要吞吐（Parallel 仍然是吞吐最高的），接口服务要低停顿（G1 起步，堆特别大或延迟要求特别严再上 ZGC）。堆在 4G 到 32G、又没有明确的 P99 停顿要求时，G1 默认值就是正确答案——不要为了「用上新收集器」去换。

 

**追问「什么是 Stop The World，Full GC 频繁在生产上什么表现」**：STW 是 GC 的某些阶段必须暂停所有业务线程，因为对象引用关系在变化中，边改边标记的结果不可靠；现代收集器的努力方向就是把可以并发的阶段挪出 STW、把必须 STW 的阶段做短（G1 的 STW 是「暂停一小会儿回收几个 region」，ZGC 把 STW 压到不随堆大小增长的常数级）。生产上 Full GC 频繁的表现很有特征：**接口周期性整体卡顿**——不是某个接口慢，是所有接口在同一时刻一起变慢再一起恢复，监控上是锯齿状的响应时间尖刺，间隔往往规整（每隔几十秒一次）。伴随特征是 CPU 高但业务线程栈看起来在闲着，因为吃 CPU 的是 GC 线程。判断只要一条命令：`jstat -gcutil <pid> 1000`，看 `FGC`（Full GC 次数）在几秒内涨了几次、`O`（老年代使用率）在 Full GC 之后有没有降下来——**回收后老年代仍然居高不下就是有对象该死没死**（往内存泄漏方向查，见第 8 题），降得很多说明是晋升太快（新生代太小或有大对象）。**先用 `jstat` 排除 GC 再看业务线程，顺序反了会绕很远。**

# 面试 11 · Java > 线上 OOM 和 CPU 飙高的排查顺序

这题问的不是原理，是命令和顺序。答不出具体命令基本等于承认没排过。

 

**OOM 的前提是先留证据**，启动参数里就该有：

 

```bash
-XX:+HeapDumpOnOutOfMemoryError
-XX:HeapDumpPath=/data/dump/
-Xlog:gc*:file=/data/log/gc.log:time,uptime:filecount=10,filesize=50M
```

 

没有这两个参数，OOM 之后进程一重启现场就没了，只能等下一次——所以这是上线前该配的，不是出事后再加。JDK 9 起 GC 日志统一成 `-Xlog:gc*`，老的 `-XX:+PrintGCDetails` 系列参数已经废弃。

 

出事后的顺序：

 

```bash
# 1. 先看是不是 GC 问题（最便宜的一步）
jstat -gcutil <pid> 1000 10        # FGC 次数在涨？回收后 O 降不下来？

# 2. 不用 dump 也能看的实例数排行
jmap -histo:live <pid> | head -30  # 注意 :live 会触发一次 Full GC，谨慎用

# 3. 有 dump 就用 MAT 打开，看 Dominator Tree 找最大的持有者，
#    再顺 incoming references 找到是谁在引用它
```

 

CPU 飙高是另一条固定路径，四步：

 

```bash
top                                   # 1. 找到进程
top -Hp <pid>                         # 2. 找到最耗 CPU 的线程（TID 是十进制）
printf '%x\n' <tid>                   # 3. 转十六进制
jstack <pid> | grep -A 30 '<nid>'     # 4. 在 nid=0x... 处看它卡在哪个方法
```

 

`jstack` 打不出来或者进程假死时，用 `jcmd <pid> Thread.print`（有 JFR 时更该用 `jcmd <pid> JFR.start`，抓一段时间的采样比一张瞬时快照准确）。

 

结论的分布是有规律的，可以直接按概率排查：OOM 多半是**集合只增不减**（缓存没设淘汰、静态 map 一直塞）或**一次查太多数据进内存**（没分页的全表查询、把大文件整个读成 String）；CPU 飙高多半是**死循环**、**正则回溯**，或者**频繁 Full GC**——第三种最常被误判，因为吃 CPU 的是 GC 线程而业务线程栈看起来正常，所以第一步永远是 `jstat` 而不是 `jstack`。

 

AI 应用有两个自己的高发形态，值得单独记：一是**把整篇文档的分块结果和向量一起攒在内存里做批量入库**，一个几十 MB 的 PDF 能膨胀成几个 G 的 float 数组（`float[]` 按 4 字节算，1536 维一条就 6KB，十万条就是 600MB，加上对象头和列表开销更多）；二是**流式响应的缓冲没有上限**，模型一直吐、你一直 append，慢客户端读得慢就在服务端堆成大 String（背压问题见 `02-node-java.md` 第 2 题）。

 

**追问「dump 文件 8G，本地打不开，怎么办」**：这是真实排查里第一个卡住人的地方，有三条路。**一是别在本地开**——把 MAT 的命令行版（`ParseHeapDump.sh`）放到一台大内存机器上跑，生成 `_Leak_Suspects.zip` 和索引文件，只把报告拉回来看；MAT 自身的 `-vmargs -Xmx` 要给到 dump 大小的 1.5 倍左右。**二是根本不取全量 dump**——`jmap -histo:live` 只给「类 → 实例数 → 占用字节」的排行，几秒出结果，绝大多数「集合只增不减」型泄漏看这张表就定位了；或者用 JFR 的 `old-object-sample` 事件（`jcmd <pid> JFR.start settings=profile`）采样存活对象的分配栈，直接告诉你是哪行代码分配的。**三是取 dump 本身有代价要预告**——`jmap -dump:live` 会 STW 整个进程，8G 堆写盘期间服务基本不可用（几十秒量级），所以生产上要么先摘流量再 dump，要么只在已经挂掉的实例上做。**答出「取 dump 会停服务」这条，比会用 MAT 更能说明是在生产上干过的。**

 

## 并发细节

# 面试 11 · Java > synchronized 的锁升级还在吗，什么时候必须换 ReentrantLock

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/11-java.html#q9

选型依据在 `02-node-java.md` 第 9 题（需要可中断、超时、公平、多条件队列这四种能力才换 `ReentrantLock`，否则默认 `synchronized`）。这里补的是两条**已经变了的版本事实**，背老八股的人一定会说错：

# 面试 11 · Java > synchronized 的锁升级还在吗，什么时候必须换 ReentrantLock

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/11-java.html#q9

**第一条：偏向锁没了。** 「`synchronized` 有偏向锁 → 轻量级锁 → 重量级锁的锁升级优化」是所有八股文的标准答案，但偏向锁在 **JDK 15 已默认关闭**（JEP 374），并在 **JDK 18 彻底移除**（相关 `-XX:+UseBiasedLocking` 等参数一起删掉）。原因是它的收益主要来自早期同步集合（`Hashtable`、`Vector`），而撤销偏向的代价在现代线程池型应用里往往是负收益。所以现在准确的说法是：**无竞争时走轻量级锁（CAS 加对象头标记），竞争后膨胀成重量级锁（操作系统互斥量）**，没有偏向这一级了。能主动说「JDK 15 之后偏向锁已经关掉」，比把三级升级背得更流利更有说服力。

# 面试 11 · Java > synchronized 的锁升级还在吗，什么时候必须换 ReentrantLock

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/11-java.html#q9

**第二条：虚拟线程下的选择理由变了。** JDK 21 刚出虚拟线程时有一条硬约束：虚拟线程在 `synchronized` 块里阻塞会**钉住（pin）** 承载它的平台线程，等于白用虚拟线程，所以当时的建议是把 `synchronized` 换成 `ReentrantLock`。**JDK 24 的 JEP 491 修掉了这个问题**（`synchronized` 里阻塞也能让出平台线程），`jdk.tracePinnedThreads` 这个诊断开关随之移除。所以「用虚拟线程就得把 synchronized 全改成 ReentrantLock」在 JDK 24+ 已经不成立；仍会 pin 的只剩本地方法/FFM 回调这类场景，用 JFR 的 `jdk.VirtualThreadPinned` 事件能看到。

# 面试 11 · Java > synchronized 的锁升级还在吗，什么时候必须换 ReentrantLock

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/11-java.html#q9

`ReentrantLock` 唯一必须写对的地方是释放：

# 面试 11 · Java > synchronized 的锁升级还在吗，什么时候必须换 ReentrantLock

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/11-java.html#q9

前文：`ReentrantLock` 唯一必须写对的地方是释放：

```java
lock.lock();
try {
    // ...
} finally {
    lock.unlock();     // 不放 finally，一次异常就是永久死锁
}

// 需要降级路径时用 tryLock
if (lock.tryLock(200, TimeUnit.MILLISECONDS)) {
    try { doWork(); } finally { lock.unlock(); }
} else {
    return Result.busy();     // 拿不到锁必须有出路，否则 tryLock 没意义
}

```

# 面试 11 · Java > synchronized 的锁升级还在吗，什么时候必须换 ReentrantLock

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/11-java.html#q9

忘了 `unlock` 的现象是**这把锁之后永远拿不到**：后续请求全部卡在 `lock()` 上，线程数一路涨到池满，`jstack` 里一堆线程停在 `AbstractQueuedSynchronizer` 的 park 上、而持锁线程早就跑完了。这类故障不会自愈，只能重启。

# 面试 11 · Java > synchronized 的锁升级还在吗，什么时候必须换 ReentrantLock

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/11-java.html#q9（连续片段 1/2，需结合相邻段阅读）

**追问「这段计数在压测下就是不准，你怎么定位是哪种并发问题」**：先分清是**丢更新**还是**可见性**，两者的现象不同、修法不同。丢更新的特征是**结果总是偏小且随并发升高越偏越多**——典型是 `count++` 这种「读-改-写」被交错，`volatile` 挡不住（见第 10 题），修法是 `AtomicInteger`/`LongAdder` 或者加锁；可见性问题的特征是**某个线程读到的值长期不更新**（比如循环退出标志改了但线程不停），只在没加 `volatile`、又被 JIT 优化成读寄存器副本时出现。定位手段按成本排：一是**把并发从 1 降到 2**，单线程正确、两线程就错说明是竞态而不是算法错；二是给可疑的临界区加锁跑一遍，加了就对说明就是这段；三是上 `-XX:+UseThreadPriorities` 之外的真办法——用 `jcstress` 之类的并发压力工具或者在读写之间插 `Thread.yield()` 放大交错窗口，让偶发变成必现。**最容易被忽略的一点是「锁的对象不对」**：两个线程各自 `synchronized(this)` 但拿的是不同实例，或者锁了一个会被重新赋值的字段，代码看起来加了锁、实际互不排斥——这类 bug 只能靠「打印锁对象的 `System.identityHashCode`」确认。

# 面试 11 · Java > synchronized 的锁升级还在吗，什么时候必须换 ReentrantLock

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/11-java.html#q9（连续片段 2/2，需结合相邻段阅读）

**能说出「先降并发确认是竞态，再确认锁的是不是同一个对象」这套顺序，说明你真调过并发问题。**

# 面试 11 · Java > volatile 保证什么，不保证什么

保证两件事：**可见性**（一个线程写了，其他线程立刻能读到——读写直接对主内存生效，不停留在线程的工作副本里）和**禁止指令重排**（读写两侧插内存屏障）。

 

**不保证原子性**，这是最常被答错的一半。`i++` 是「读、加、写」三步，`volatile` 只保证每一步读到的是最新值，挡不住两个线程读到同一个值再各写一次：

 

```java
volatile int count = 0;      // 并发 ++ 之后，count 总是小于实际次数
count++;

AtomicInteger c = new AtomicInteger();   // 要计数用这个（CAS）
c.incrementAndGet();

LongAdder adder = new LongAdder();       // 高并发计数用这个，分段累加，竞争下比 Atomic 快
adder.increment();
```

 

现象很好认：**结果稳定偏小，并发越高偏得越多**，而且不报错。压测时「请求数 10000、计数器 9873」基本就是这个。

 

两个经典用法，能说出来说明真用过：

 

第一个是**状态标志位**。`volatile boolean running = true`，另一个线程改成 `false` 来终止循环。不加 `volatile` 的话循环可能永远看不到这次修改——JIT 判断循环体内没人改它，就把它提升成寄存器里的副本（这个优化叫 hoisting），线程于是永远转下去。现象是「停止指令发了、线程还在跑、CPU 一直占着」，重启才能停。

 

第二个是**双重检查锁的单例**，`instance` 必须是 `volatile`：

 

```java
private static volatile Singleton instance;

public static Singleton getInstance() {
    if (instance == null) {                    // 第一次检查，不加锁
        synchronized (Singleton.class) {
            if (instance == null) {            // 第二次检查
                instance = new Singleton();    // 没有 volatile → 可能被重排
            }
        }
    }
    return instance;
}
```

 

`new` 实际是「分配内存、初始化字段、把引用赋给变量」三步，后两步可以被重排。重排之后，另一个线程在第一次检查处看到 `instance != null` 就直接返回了一个**字段还没初始化完的半成品对象**，用它的时候某个字段是 null。这个 bug 的恶劣之处是它依赖时序和 CPU 架构，本地跑一万次不出，上线偶发一次。

 

**追问「既然要写 volatile 这么绕，DCL 单例还有必要吗」**：在 Java 里基本没必要了，有两个更难写错的写法。**一是静态内部类持有者**——`private static class Holder { static final Singleton INSTANCE = new Singleton(); }`，靠 JVM 的类初始化锁保证唯一性和可见性，天生延迟加载，一行 `volatile` 都不需要；**二是在 Spring 项目里干脆别自己写单例**，容器管的 Bean 默认就是单例（生命周期见第 15 题），自己造一个反而绕过了依赖注入和测试替换。DCL 值得知道的原因不是它好用，而是它把「重排序会让别人看到半成品对象」这个模型讲清楚了——同样的道理适用于任何「先发布引用、后填字段」的代码，比如把一个 `new` 出来的配置对象放进静态 map、或者把还在初始化的缓存实例暴露给别的线程。判断依据是一句话：**一个对象的引用一旦对其他线程可见，它的字段就必须已经全部写完**，做不到就用 `final` 字段、`volatile` 引用，或者在锁里完成整个发布过程。

# 面试 11 · Java > ArrayList 和 LinkedList 实际怎么选

理论复杂度是这样：

 

|  | 按下标访问 | 中间插入/删除 | 头部插入 | 额外开销 |
| --- | --- | --- | --- | --- |
| `ArrayList` | O(1) | O(n)，要移动后面所有元素 | O(n) | 扩容时拷贝整个数组（增长约 1.5 倍） |
| `LinkedList` | O(n)，要遍历 | 找到位置后 O(1)，但找位置是 O(n) | O(1) | 每个节点一个对象 + 两个指针 |

 

但**实际结论几乎总是偏向 `ArrayList`**，包括很多「频繁中间插入」的场景。原因是 CPU 缓存：数组是连续内存，一次缓存行加载能带进来十几个元素，`System.arraycopy` 又是高度优化的批量内存移动；`LinkedList` 每个节点是独立分配的对象，遍历时到处跳内存，几乎每步都是一次缓存未命中，而且节点对象本身的内存开销是元素的好几倍。

 

所以判断依据是：**默认 `ArrayList`；真的需要频繁在头部进出（队列语义）时用 `ArrayDeque` 而不是 `LinkedList`**——`ArrayDeque` 是环形数组，头尾操作都是 O(1) 且缓存友好。`LinkedList` 剩下的合理用途基本只有「需要在遍历过程中用迭代器频繁增删」这一种，而这种需求往往说明数据结构选错了。

 

「知道理论复杂度，也知道实测和它不一样」是这题的加分点。想在面试里说得更实，用一句可验证的话：`LinkedList` 的每个节点在 64 位 JVM 上要多花 40 字节左右（对象头 + 两个引用 + 元素引用），存一千万个整数时这部分开销比数据本身还大。

 

预分配容量也值得提一句：`new ArrayList<>(expectedSize)` 能省掉多次扩容和数组拷贝。已知要装几万条检索结果时这是免费的优化。

 

**追问「遍历时删除元素会怎样」**：抛 `ConcurrentModificationException`，而且和多线程无关——单线程 for-each 里删就会。原因是 for-each 编译成迭代器，迭代器记了一份创建时的 `modCount`，每次 `next()` 都比对，集合结构一变（`add`/`remove` 都算）就快速失败。危险的是它**不保证一定抛**：删掉倒数第二个元素时，`hasNext()` 恰好判定为 false，循环静默提前结束，一条都不报错，只是少处理了一个元素——比抛异常难查得多。正确做法是用 `iterator.remove()`（它会同步 `modCount` 和 `expectedModCount`），或者直接 `list.removeIf(predicate)`。

 

```java
// 错：可能抛 CME，也可能静默漏一个
for (String s : list) if (s.isEmpty()) list.remove(s);

// 对
list.removeIf(String::isEmpty);
```

 

要在并发下边读边改，换 `CopyOnWriteArrayList`（迭代器基于快照，永不抛 CME，代价是每次写都复制整个数组，只适合读多写极少）。**「快速失败不是保证，还有静默漏元素这种更坏的情况」这层能说出来，说明你被它坑过而不是只在教程里见过。**

# 面试 11 · Java > equals 和 hashCode 为什么必须一起重写

契约是单向的：**`equals` 相等的两个对象，`hashCode` 必须相等**；反过来不要求（hash 冲突是允许的）。只重写 `equals` 不重写 `hashCode` 就违反了这条，后果非常具体：

 

```java
class User {
    final Long id;
    User(Long id) { this.id = id; }
    @Override public boolean equals(Object o) {
        return o instanceof User u && Objects.equals(id, u.id);
    }
    // 忘了 hashCode
}

Set<User> set = new HashSet<>();
set.add(new User(1L));
set.add(new User(1L));
System.out.println(set.size());              // 2，去重失效
System.out.println(set.contains(new User(1L)));  // false，明明刚放进去
```

 

原因是 `HashMap`/`HashSet` 先用 `hashCode` 定位桶，再在桶内用 `equals` 比较。两个「业务上相等」的对象 hash 不同 → 落到不同的桶 → 根本不会走到 `equals` 那一步。所以现象是「Set 里出现重复元素」「用等值的 key 去 `get` 拿到 null」，而单元测试里 `a.equals(b)` 明明返回 true——这个割裂让人第一反应会去怀疑 `equals` 写错了。

 

正确写法直接用 `Objects`，或者让 IDE/Lombok 生成：

 

```java
@Override public int hashCode() { return Objects.hash(id); }
```

 

第二条同样重要：**作为 map key 的对象应该是不可变的**。如果 key 放进 map 之后又改了参与 `hashCode` 计算的字段，它的桶位置就错了——**这个对象在 map 里再也找不回来，也删不掉**，`containsKey` 返回 false 而 `size()` 里还算着它，等于一次内存泄漏。所以 key 优先用 `String`、包装类型、枚举，或者自己写的不可变类（字段全 `final`，不给 setter）。

 

Java 16 起的 `record` 天生解决这两件事：它自动生成基于所有组件的 `equals`/`hashCode`/`toString`，字段全是 final。做 DTO 和 map key 时用 `record` 比手写省掉一整类 bug：

 

```java
record DocChunk(String docId, int seq) { }   // equals/hashCode 自动且正确
```

 

**追问「同一个类的对象，两次运行 JVM 得到的 hashCode 不一样，会有什么后果」**：只要你没重写 `hashCode`，`Object` 的默认实现就和对象的身份（identity）相关，重启后完全变了；即使重写了，`String.hashCode` 虽然算法固定跨 JVM 稳定，但**枚举的 `hashCode` 是身份哈希，跨 JVM 不稳定**。后果出现在三个地方：**一是把 hashCode 持久化或跨进程传输**——用它当数据库主键、当缓存 key 的一部分、当分片键，重启或换实例后就全对不上，缓存命中率突然掉到 0 而代码一行没改；**二是分布式一致性哈希**里直接用 `Object.hashCode` 做路由，各节点算出的目标节点不一致；**三是把枚举放进 `HashSet` 后依赖迭代顺序**，同一份代码两次运行的遍历顺序不同，于是「本地跑对了、线上顺序不对」（这也是该用 `EnumSet`/`EnumMap` 的理由，它们按声明顺序）。判断依据是一句：**hashCode 只在单个 JVM 生命周期内有意义，任何跨进程、跨重启的场景都要用显式定义的稳定摘要**（业务 id、`String` 的内容哈希、或者 MD5/SHA 之类明确规定过算法的函数）。

 

## 框架与语言特性

# 面试 11 · Java > MyBatis 的 #{} 和 ${} 有什么区别

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/11-java.html#q13

`#{}` 是**预编译参数**：MyBatis 把它换成 JDBC 的 `?` 占位符，再通过 `PreparedStatement` 绑定值。所以参数永远被当成一个值，不参与 SQL 语法解析——这既防了注入，也让数据库能复用执行计划。

# 面试 11 · Java > MyBatis 的 #{} 和 ${} 有什么区别

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/11-java.html#q13

`${}` 是**字符串直接拼接**，拼进 SQL 文本里。有注入风险，只在少数语法上不能用占位符的位置才需要：表名、列名、`order by` 的字段名、`asc/desc`。

# 面试 11 · Java > MyBatis 的 #{} 和 ${} 有什么区别

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/11-java.html#q13

前文：`${}` 是**字符串直接拼接**，拼进 SQL 文本里。有注入风险，只在少数语法上不能用占位符的位置才需要：表名、列名、`order by` 的字段名、`asc/desc`。

```xml
<!-- 对：值用 #{} -->
select * from doc where tenant_id = #{tenantId} and status = #{status}

<!-- 不得不用 ${} 的位置，必须先白名单校验 -->
order by ${sortField} ${sortDir}

```

# 面试 11 · Java > MyBatis 的 #{} 和 ${} 有什么区别

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/11-java.html#q13

用 `${}` 的硬要求是**白名单**，不是转义：

# 面试 11 · Java > MyBatis 的 #{} 和 ${} 有什么区别

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/11-java.html#q13

前文：用 `${}` 的硬要求是**白名单**，不是转义：

```java
private static final Set<String> SORTABLE = Set.of("created_at", "updated_at", "score");

String sortField = SORTABLE.contains(req.getSort()) ? req.getSort() : "created_at";
String sortDir = "desc".equalsIgnoreCase(req.getDir()) ? "desc" : "asc";

```

# 面试 11 · Java > MyBatis 的 #{} 和 ${} 有什么区别

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/11-java.html#q13

直接把用户输入拼进 `order by` 的后果不只是「读到别人的数据」——MySQL 里 `order by` 位置可以塞子查询，攻击者能用它做布尔盲注，一次一位地把整张表读出来，而你的日志里看到的只是一堆正常的查询。

# 面试 11 · Java > MyBatis 的 #{} 和 ${} 有什么区别

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/11-java.html#q13

还有一个不涉及注入但很常见的坑：**`like` 拼接**。`like '%${keyword}%'` 是注入口，正确写法是 `like concat('%', #{keyword}, '%')`，把拼接交给数据库函数。

# 面试 11 · Java > MyBatis 的 #{} 和 ${} 有什么区别

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/11-java.html#q13

顺带说缓存，因为面试常连着问：MyBatis 有一级缓存（`SqlSession` 级，默认开）和二级缓存（Mapper 级，跨 session）。**二级缓存在生产上一般关掉**——多实例部署时各自缓存不同步，别人直接改库或另一个服务写入时读到脏数据，而且失效粒度是整个 namespace，一次写就把这个 Mapper 的全部缓存清掉，命中率很难看。要缓存就用 Redis 显式管，key 和过期策略都在自己手里。一级缓存也有个具体现象要知道：**同一个事务里两次查同一条记录，第二次不会打到数据库**，如果中间有别人提交了修改（或者你自己用另一条 SQL 改了），读到的是旧值；`flushCache="true"` 或换 session 可以绕开。

# 面试 11 · Java > MyBatis 的 #{} 和 ${} 有什么区别

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/11-java.html#q13

**追问「你怎么在代码合并前就发现有人写了危险的 `${}`」**：靠评审看不住，要让它在流水线上失败。三层做法：**一是静态扫描**——`${` 在 XML mapper 里出现的位置是有限且可枚举的，用 CI 里一条 grep 规则或 ast-grep/Semgrep 规则拦住「`${}` 出现在 `where`/`like`/`in` 上下文」的写法，白名单化允许的行（配上注释说明原因）；SonarQube 和 IDEA 自带的 MyBatis 检查也能报这类问题。**二是集中化排序参数**——不让每个 mapper 自己接收排序字段，而是统一走一个 `SortField` 枚举或校验方法，代码里根本没有「裸字符串拼进 SQL」的入口，评审时只需要盯那一个类。**三是上线后验证**——在测试环境跑一遍带引号、注释符、`union select` 的畸形排序参数，看接口是返回 400 还是返回数据，这一步是唯一能证明防线真的生效的动作。**答出「靠工具而不是靠自觉」是这题的分水岭**，因为注入这类问题一次疏漏就是全表泄漏，靠人盯的方案在概率上必输。

# 面试 11 · Java > Spring Boot 的自动配置是怎么实现的

核心是 `@SpringBootApplication` 里的 `@EnableAutoConfiguration`：启动时扫描所有依赖 jar 包里的自动配置清单，把里面列出的配置类加载进来，每个配置类上带**条件注解**，条件不满足就整块跳过。

 

清单文件的位置换过，这是版本敏感点：**Spring Boot 2.7 起改用 `META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports`**（一行一个全限定类名），老的 `META-INF/spring.factories` 里的 `EnableAutoConfiguration` 键在 **Spring Boot 3.0 已被移除**。所以现在写自定义 starter 只能用 `.imports` 文件，回答里说「扫描 spring.factories」在 Boot 3 项目里就是错的。顺带一个时间坐标：**Spring Boot 4.0 已于 2025-11-20 发布**，基于 Spring Framework 7 和 Java 25，`@AutoConfiguration` 注解是现在标注自动配置类的推荐写法。

 

常用条件注解就四个：

 

| 注解 | 语义 | 典型用途 |
| --- | --- | --- |
| `@ConditionalOnClass` | classpath 里有这个类才生效 | 引了 Redis 客户端才配 Redis |
| `@ConditionalOnMissingBean` | 你没自己定义同类型 Bean 才生效 | 给默认实现让位 |
| `@ConditionalOnProperty` | 配置项达到指定值才生效 | 功能开关 |
| `@ConditionalOnWebApplication` | 是 web 应用才生效 | 只在 servlet 环境注册 |

 

「约定优于配置」的实现就是这一堆带条件的默认配置：你没提供的它给默认值，你提供了它自动退让。这个机制解释了两个日常现象——**引入一个 starter 就自动能用**（它带了自动配置类和默认 Bean）；**自己定义了一个同类型 Bean 之后默认行为就消失了**（`@ConditionalOnMissingBean` 不再满足）。

 

排查「自动配置为什么没生效」有专门的工具：用 `--debug` 启动（或 `application.properties` 里 `debug=true`），Spring Boot 会打印 **Condition Evaluation Report**，分成 Positive matches（生效了，附匹配原因）、Negative matches（没生效，附具体哪个条件不满足）、Exclusions、Unconditional classes。这份报告直接告诉你「因为 classpath 里没有 X 类」或「因为你已经定义了 Y Bean」，比猜快一个数量级。有 Actuator 的话访问 `/actuator/conditions` 拿同样的信息。

 

**追问「同一个类型有两个候选 Bean，启动直接失败，怎么修才对」**：报错是 `NoUniqueBeanDefinitionException`，修法有优劣之分。**最好的是 `@Primary`**——语义是「默认用这个」，其他注入点不用改一个字；**次之是注入点上加 `@Qualifier("beanName")`**，适合「不同场景确实要用不同实现」（比如两个 `RestClient`，一个连内部服务一个连模型供应商），它把选择显式写在使用处；**再次是按名字匹配**——字段名/参数名恰好等于 Bean 名时 Spring 会用它来消歧，但这是隐式规则，改个变量名就坏，不该依赖。**要避免的是 `@ConditionalOnMissingBean` 用在业务 Bean 上**：它是写库/starter 用的机制，用在业务代码里会让「哪个 Bean 生效」取决于类加载和配置顺序，出问题时极难复现。写 starter 时反过来——你提供的所有默认 Bean 都该加 `@ConditionalOnMissingBean`，否则使用方无法覆盖你的实现，只能靠 `exclude` 把整个自动配置关掉。判断依据一句话：**框架侧用条件注解让位，应用侧用 `@Primary`/`@Qualifier` 显式选择。**

# 面试 11 · Java > Bean 的作用域和生命周期，单例最容易出什么 bug

作用域常用两个：`singleton`（默认，容器里只有一个实例）和 `prototype`（每次获取都新建）。Web 环境还有 `request` 和 `session`。

 

生命周期的顺序要能顺出来，因为后面的追问全靠它：实例化 → 属性注入 → `BeanPostProcessor` 前置处理 → `@PostConstruct` / `afterPropertiesSet` → `BeanPostProcessor` 后置处理（**AOP 代理就是在这一步生成的**）→ 使用 → `@PreDestroy`。

 

「代理在初始化之后生成」这一条有个直接后果：**在 `@PostConstruct` 里调用自己的 `@Transactional`/`@Async` 方法不生效**，因为那时你手上还是原始对象，代理还没造出来。现象和第 2 题的自调用一样，但更隐蔽——初始化逻辑通常只在启动时跑一次，出错了也没人盯着。

 

最容易出线上事故的一点是**单例 Bean 不能有可变的成员状态**。`@Controller`、`@Service` 默认是单例，多个请求并发跑在同一个实例上，往字段里存请求相关的数据就会串数据：

 

```java
@Service
public class ChatService {
    private String currentUserId;          // 事故源头

    public String reply(String userId, String q) {
        this.currentUserId = userId;       // A 请求刚写完
        String ctx = loadContext();        // B 请求把它覆盖成 B 的 id
        return llm.call(ctx, q);           // A 拿到了 B 的上下文
    }
}
```

 

后果是 **A 用户看到 B 用户的内容**，而且低并发下几乎测不出来——它需要两个请求的时间窗口重叠。AI 应用里这类 bug 的代价特别高：串的往往是对话历史或检索到的私有文档，等于一次越权。请求级状态要放方法局部变量，或者放 `ThreadLocal`（泄漏风险见 `02-node-java.md` 第 11 题）。

 

一个能证明你排查过的检验手段：单例里有可变字段这件事是**可以静态查出来的**——`@Service`/`@Controller` 类里出现非 `final`、非配置类型的实例字段，基本都值得复查一遍。

 

**追问「单例 Bean 里注入 prototype Bean 会怎样」**：`prototype` 的语义直接失效。注入只在单例初始化时发生一次，之后这个字段永远指向同一个实例，「每次获取都新建」的承诺被吃掉了——现象是你以为每次拿到干净对象，实际在复用一个带着上次状态的对象，于是又回到上面那个串数据的坑。要每次拿新的有三条路：注入 `ObjectProvider<T>`（`provider.getObject()` 每次返回新实例，最推荐，因为它是显式的）、用 `@Lookup` 注解让 Spring 重写方法、或者注入 `ApplicationContext` 手动 `getBean`（可用但把容器 API 侵入了业务代码，最不好）。判断依据是：**`prototype` 的正确用法是「按需获取」而不是「注入持有」**，一旦被单例持有，它和单例就没区别了。顺带一条容易忘的：**`prototype` Bean 的销毁回调 Spring 不管**——容器创建完就不再持有引用，`@PreDestroy` 永远不会被调用，所以 `prototype` 里放需要关闭的资源（连接、文件句柄）会泄漏，必须自己关。

# 面试 11 · Java > Stream 和 Optional 什么时候不该用

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/11-java.html#q16

`Stream` 是声明式集合处理，**惰性求值**：中间操作（`filter`、`map`、`sorted`）不会立即执行，直到遇到终端操作（`collect`、`forEach`、`reduce`）才真正跑，而且整条链只遍历一次。`Optional` 是把「可能为 null」变成类型上显式的东西，用 `map`/`orElse` 链式处理。

# 面试 11 · Java > Stream 和 Optional 什么时候不该用

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/11-java.html#q16

两个使用判断，比背 API 更值钱：

# 面试 11 · Java > Stream 和 Optional 什么时候不该用

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/11-java.html#q16

**一、`Stream` 不总是更好。** 简单循环用 `for` 更快也更好调试——`Stream` 有 lambda 调用和自动装箱的开销，断点调试要在 lambda 里下断点、栈帧里全是框架方法。它的价值在于**复杂链式转换的可读性**（一串 filter/map/groupingBy 比嵌套循环清楚得多）。处理基本类型时用 `IntStream`/`LongStream` 避免装箱。

# 面试 11 · Java > Stream 和 Optional 什么时候不该用

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/11-java.html#q16

**二、`parallelStream` 要格外小心。** 它默认用**公共的 `ForkJoinPool.commonPool()`**，全 JVM 共享，线程数默认是「核数 - 1」。所以在里面做 IO（调模型 API、查库）会有两个后果：一是线程被阻塞占着，池子里其他并行任务全排队——**你的一个批量调用能拖慢应用里所有用到 parallel stream 的地方**；二是并行度受核数限制，8 核机器上最多 8 个并发请求，比你自己开线程池慢得多。它只适合纯 CPU 计算且数据量足够大的场景。要并发做 IO 就用显式线程池（见第 5 题）或 `CompletableFuture`（`02-node-java.md` 第 12 题）。

# 面试 11 · Java > Stream 和 Optional 什么时候不该用

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/11-java.html#q16

```java
// 错：IO 放进 parallelStream，污染公共池且并发度受核数限制
List<String> results = docs.parallelStream().map(this::callLlm).toList();

// 对：显式池，并发度自己定，失败和超时可控
ExecutorService pool = Executors.newFixedThreadPool(16);
List<CompletableFuture<String>> futures = docs.stream()
        .map(d -> CompletableFuture.supplyAsync(() -> callLlm(d), pool))
        .toList();

```

# 面试 11 · Java > Stream 和 Optional 什么时候不该用

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/11-java.html#q16

`Optional` 有一条明确的适用边界：**只用作返回值，不要用在字段和参数上**。它的设计目的是「明确表达这个方法可能没有结果」；放在字段上会多一层包装对象且不可序列化，放在参数上则是把判空责任推给调用方（重载或者传 null 更清楚）。另外 `optional.get()` 不做检查就调等于换个姿势抛 NPE，该用 `orElseThrow(() -> new BizException(...))` 给出有信息的异常。

# 面试 11 · Java > Stream 和 Optional 什么时候不该用

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/11-java.html#q16

**追问「一个 Stream 能重复消费吗，不能的话你怎么发现的」**：不能。`Stream` 是一次性的，终端操作执行后这个流就消费掉了，再用它会抛 `IllegalStateException: stream has already been operated upon or closed`。这个限制在两个地方会真的咬人：**一是把 `Stream` 当返回值或字段传递**——方法返回 `Stream<T>`，调用方先 `count()` 再 `collect()`，第二次直接炸；正确做法是返回 `List` 或者返回一个能重新创建流的 `Supplier<Stream<T>>`。**二是 `Files.lines()` 这类流还必须关闭**（它持有文件句柄），不放在 try-with-resources 里就是句柄泄漏，现象是跑一段时间后 `Too many open files`。判断依据是：**`Stream` 是「一次遍历的管道」而不是「集合的另一种表示」**——集合可以反复读，管道只能过一次。所以对外的 API 边界上传集合，`Stream` 只在方法内部当处理过程用。

# 面试 11 · Java > Java 的线程模型和 Node 差在哪，虚拟线程改变了什么

两种模型的差别是**形态不同**，不是快慢不同。这题最大的坑是笼统比较性能——说「Java 性能更好」或「Node 更快」都会显得没真理解。

 

Java 是真多线程，一个请求一个线程，阻塞式代码符合直觉：遇到 IO 就让线程等着，调度交给操作系统。代价是每个平台线程的固定开销（默认栈 1MB，`-Xss` 可调），几千并发就要几 GB，所以必须靠线程池限制数量，池满了排队（第 5 题）。

 

Node 是单线程加事件循环：不为每个请求分配线程，靠回调/Promise 在等待时让出执行权，所以几万个「都在等上游响应」的连接开销很低。代价是任何 CPU 密集操作会堵住所有请求（细节见 `02-node-java.md` 第 1 题和第 3 题）。

 

**虚拟线程（JEP 444，JDK 21 正式）** 改的是「线程等 IO 太贵」这一条：虚拟线程由 JVM 调度，遇到阻塞操作时自动把底层平台线程让出去，于是**用同步阻塞的写法拿到了接近异步的并发能力**——不用写回调地狱，也不用「async 传染」整个调用链。

 

三条必须说准的边界，否则容易吹过头：

 

- **不提高 CPU 密集任务的性能。** 它只解决等待的成本，计算还是要占 CPU。
- **用了虚拟线程，线程池的概念基本不需要了。** 直接一个请求一个虚拟线程，`Executors.newVirtualThreadPerTaskExecutor()`。但**限流不能一起丢掉**——原来线程池顺带承担了「最多同时打多少下游请求」的限流职责，换成虚拟线程后这个限制消失了，得用信号量或显式限流器补上，否则下游被打爆。
- **`synchronized` 的钉住问题已经修了。** JDK 21 时代虚拟线程在 `synchronized` 块里阻塞会钉住平台线程，JDK 24 的 JEP 491 解决了它（见第 9 题）。所以「用虚拟线程必须先把 synchronized 全换成 ReentrantLock」这条建议在 JDK 24+ 已经过期。

 

配套 API 的状态也是版本敏感点：**Scoped Values 在 JDK 25 转正式**（JEP 506，用来替代 `ThreadLocal` 在虚拟线程下的上下文传递），而**Structured Concurrency 到 JDK 25 仍是预览**（JEP 505，第五轮预览，用它要加 `--enable-preview`）。把「结构化并发已经稳定」说出去会被当成没实际用过。

 

```java
// 一个请求一个虚拟线程，写法就是普通阻塞代码
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    for (var doc : docs) {
        executor.submit(() -> {
            var vec = embeddingClient.embed(doc.text());   // 阻塞几百毫秒，平台线程被让出
            vectorStore.upsert(doc.id(), vec);
            return null;
        });
    }
}   // close() 等所有任务结束
```

 

Spring Boot 3.2+ 一个开关就能把 web 请求切到虚拟线程：`spring.threads.virtual.enabled=true`。

 

**追问「切到虚拟线程之后，你原来的数据库连接池怎么办」**：这是虚拟线程最容易踩空的一步。原来平台线程池的大小（比如 200）**顺带**限制了同时访问数据库的并发数，连接池 50 个连接完全够用；换成虚拟线程后并发能瞬间涨到几万，这几万个虚拟线程会一起去抢那 50 个连接，**瓶颈从线程数平移到了连接池**，现象是大量请求卡在 `HikariPool.getConnection` 上并在 30 秒后集体抛超时——吞吐没涨，错误率涨了。正确做法是承认「下游能力才是真瓶颈」：在虚拟线程外层用信号量或限流器把访问数据库/模型 API 的并发压到下游能承受的值（`Semaphore` 一行就够），把连接池超时调成业务能接受的失败时间而不是一味加大池子。判断依据是一句：**虚拟线程消除的是线程本身的成本，不是下游的容量**——所有「有限资源」（连接、配额、GPU、供应商 RPM）该有的限流一个都不能省，只是限流的位置从线程池挪到了显式的信号量上。AI 应用尤其明显，模型供应商的 RPM/TPM 配额是硬墙，撤掉线程池等于把限流交给了对方的 429。

# 面试 11 · Java > AI 应用里 Java 和 Node/Python 怎么分工

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/11-java.html#q18

典型分工是三段：**Java 承担业务主链路**（订单、账务、权限这些强事务、强一致、已经有大量存量代码的部分），**Python 做模型侧**（embedding、评测脚本、数据处理，生态在那边），**AI 应用层用 Node 或 Python**（编排、流式输出、工具调用）。关键在最后一句：**AI 能力做成独立服务旁挂**，通过接口和 Java 主链路交互，不改动核心逻辑——这样出问题能一键摘掉，回滚成本接近零。

# 面试 11 · Java > AI 应用里 Java 和 Node/Python 怎么分工

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/11-java.html#q18

这个架构成立不是因为迁就语言偏好，是三个客观差异：

# 面试 11 · Java > AI 应用里 Java 和 Node/Python 怎么分工

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/11-java.html#q18

前文：这个架构成立不是因为迁就语言偏好，是三个客观差异：

| 维度 | Java 主链路 | AI 服务 |
| --- | --- | --- |
| 迭代频率 | 一周一发，改动要评审 | prompt 天天改，改完就想上 |
| 依赖生态 | 稳定的框架依赖 | 模型库、向量库都在 Python |
| 资源特征 | 短请求、连接池、强事务 | 长连接、单请求几十秒、可能要 GPU |

# 面试 11 · Java > AI 应用里 Java 和 Node/Python 怎么分工

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/11-java.html#q18

硬塞进同一个单体里的后果是两边都难升级：为了升一个模型 SDK 要重新发一次核账服务，而为了主链路的稳定性又不敢让 prompt 天天动。

# 面试 11 · Java > AI 应用里 Java 和 Node/Python 怎么分工

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/11-java.html#q18

旁挂之外还要留三个开关，这是这题最能体现工程判断的部分：**功能开关**（能随时把 AI 入口关掉）、**灰度比例**（先 1% 流量）、**降级路径**（AI 挂了走原来的流程），再加一个**成本上限**（按天/按用户的调用配额，超了就降级而不是继续烧）。这四件事不做，AI 功能上线就是给主链路加了一个不可控的依赖。

# 面试 11 · Java > AI 应用里 Java 和 Node/Python 怎么分工

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/11-java.html#q18

关于「为什么不用 Java 做 AI 层」，给一句诚实的判断更可信：Spring AI 这类框架现在已经可用，如果团队全是 Java 人、且只做「调模型 + 简单 RAG」，用 Java 做 AI 层完全合理；真正会把人推向 Python/Node 的是**评测和数据处理**（Python 生态无可替代）以及**流式输出的开发体验**。选型该按团队构成和迭代节奏定，不是按语言优劣定。

# 面试 11 · Java > AI 应用里 Java 和 Node/Python 怎么分工

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/11-java.html#q18

**追问「Java 侧要做什么改动」**：改动量应该很小，具体是三处：**一个调用**（HTTP/gRPC 调 AI 服务，带超时和重试上限，超时值按 AI 服务的 P99 定而不是拍脑袋）、**一个开关判断**（配置中心里的 flag 加灰度比例，判断放在业务逻辑之前，关掉时走原路径）、**把上下文传过去**（用户身份、订单信息这些 AI 服务需要的字段）。第三处藏着这题真正的考点：**鉴权必须由 Java 侧或 AI 服务按当前用户做，不能用服务账号一把梭**。如果 AI 服务拿着一个全权限的服务账号去查数据，那么模型被诱导（prompt 注入）就能跨用户读数据——检索层必须带上当前用户的租户/权限标识并在服务端强制注入，客户端传的一律不信（完整的过滤方案见 `03-sql.md` 第 14 题，注入面的边界见 `04-ai.md` 第 26 题）。还有一处容易漏：**调用 AI 服务不能包在数据库事务里**（第 2 题），几十秒的调用会把连接和行锁一起占住。

# 面试 11 · Java > 你简历上都是前端和 Node，Java 实际写过多少

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/11-java.html#q19

这题一定会被问，对方要判断两件事：你会不会夸大，以及这些 Java 知识是读来的还是练出来的。如实给梯度，然后把话题引向你能兑付的地方。

# 面试 11 · Java > 你简历上都是前端和 Node，Java 实际写过多少

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/11-java.html#q19

可以直接用的说法（数字和项目换成你自己的）：

# 面试 11 · Java > 你简历上都是前端和 Node，Java 实际写过多少

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/11-java.html#q19

> 「我的主要交付是前端和 Node 服务端。Java 我写过，但没有承担过大型 Java 生产系统的主力开发——这个差别我不含糊。我能做的是：读懂存量服务的接口和数据结构、改一个已有的接口、以及判断 AI 能力该怎么和它对接而不侵入主链路。Spring 的事务、AOP、线程池这些机制我清楚，遇到 JVM 内存或 GC 的问题我能按 `jstat` → `jstack`/堆转储这套流程查下去。但真让我从零主导一个 Java 微服务体系，我会说这不是我现在的深度。」

# 面试 11 · Java > 你简历上都是前端和 Node，Java 实际写过多少

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/11-java.html#q19

这么答是最优的，理由是三点：

# 面试 11 · Java > 你简历上都是前端和 Node，Java 实际写过多少

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/11-java.html#q19

一、它给的是**能力边界**而不是模糊的自我评价。「能读能改接口」和「能主导体系」之间划了一条线，对方立刻知道能派你干什么。模糊的「还行」「有一定了解」反而会引来更多试探性追问。

# 面试 11 · Java > 你简历上都是前端和 Node，Java 实际写过多少

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/11-java.html#q19

二、它把话题引向 **AI 与存量系统对接**（第 18 题），那是你真有判断的地方。

# 面试 11 · Java > 你简历上都是前端和 Node，Java 实际写过多少

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/11-java.html#q19

三、主动承认不擅长的部分，会让「Spring 机制我清楚」这句话的可信度大幅提高。**全都说会等于全都不可信。**

# 面试 11 · Java > 你简历上都是前端和 Node，Java 实际写过多少

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/11-java.html#q19

技术题能答就好好答，但遇到真超出边界的追问——G1 的 region 怎么划分、怎么调 GC 参数把停顿从 200ms 压到 50ms、字节码层面的锁优化——别硬撑，用这句收：

# 面试 11 · Java > 你简历上都是前端和 Node，Java 实际写过多少

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/11-java.html#q19

> 「这块我停在能理解和排障的程度。我的深度在把一个 AI 功能从检索到界面整条做完并且能上线。」

# 面试 11 · Java > 你简历上都是前端和 Node，Java 实际写过多少

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/11-java.html#q19

承认边界的成本是这一项没加分，硬撑的成本是整场可信度，两者完全不对等。**这一章所有「承认边界」的句式都不是退让，是拿掉对方追问的动机**——面试官深挖的目标是找出你从哪里开始编，你主动划了线，他就不用找了，剩下的时间会花在你划线之内的地方。

# 面试 11 · Java > 你简历上都是前端和 Node，Java 实际写过多少

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/11-java.html#q19

一条前后一致性的提醒：如果你在前面的自我介绍或叙事里说过「Java 能读能改存量服务」（见 `06-narrative.md` 第 4 题），这里必须配上完整梯度说法（能读能改接口 / 不能主导体系）。单说那半句，被追问「你具体改过什么」时会很被动。

# 面试 11 · Java > 你简历上都是前端和 Node，Java 实际写过多少

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/11-java.html#q19（连续片段 1/2，需结合相邻段阅读）

**追问「那你说说你改过的那个 Java 接口，改之前先看了什么，怎么验证没改坏」**：这是这题真正的杀手追问——前面的梯度话术只要说得顺，对方一定会挑「能改一个已有接口」这句往下钻，答不出细节就等于承认边界也是编的。所以这句话出口之前，你得准备好一个真实的最小案例，包含四层：**改之前看了什么**（这个接口被谁调用——搜调用方或看网关路由、入参出参的 DTO 和校验注解、有没有 `@Transactional` 和事务边界在哪一层、涉及的表和索引）；**改了什么**（一个字段、一个查询条件、一个开关判断，越小越可信）；**怎么验证**（跑了哪些已有单测、自己补了什么测试、在什么环境用什么请求验的、看了哪个日志或监控指标确认没退化）；**回滚方案是什么**（开关关掉还是发版回退，回滚要多久）。这四层里最容易被追问穿的是第三层——**说不出「我怎么知道没改坏」的人，通常是只在本地跑通就交了**。

# 面试 11 · Java > 你简历上都是前端和 Node，Java 实际写过多少

原文节选；完整上下文：https://fqx.lx.ci/interview-prep/11-java.html#q19（连续片段 2/2，需结合相邻段阅读）

如果你确实没改过 Java 接口，正确答法是不要编：直接说「Java 侧的改动我参与的是评审和联调，实际提交在同事那边；我自己独立改过的后端接口是 Node 的，那部分我可以讲得很细」——把战场换到你能兑付的地方，比编一个案例然后在第三层崩掉安全得多。**这道题从来不考 Java 深度，考的是你在压力下会不会开始编。**
