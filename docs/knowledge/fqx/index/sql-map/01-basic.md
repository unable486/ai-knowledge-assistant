# SQL（MySQL 8.0 / InnoDB） > 关系模型与查询基础 > 资料说明

来源：https://fqx.lx.ci/sql-map/

主线对齐 MySQL 8.0 / InnoDB，涉及 PostgreSQL 差异的地方单独标注。标着「版本敏感」的是老资料最容易过时的部分。

这份导图按「写对 → 写快 → 不出事」的顺序排：**查询基础**是每天都写的，**索引**和**执行计划**决定快慢，**事务与锁**是并发下出问题时才用但一用就救命的，**工程实践**是表设计和上线动作。

每个节点讲三件事：是什么、为什么这么设计、你会踩的坑。坑那部分是重点——SQL 的大多数事故不是不会写语句，是不知道语句在什么数据量和并发下会变样。

# SQL（MySQL 8.0 / InnoDB） > 关系模型与查询基础

SQL 看起来像英文，实际按一套固定的逻辑顺序执行。这条顺序解释了绝大多数「明明写了别名却报错」「JOIN 之后行数翻倍」「WHERE 里用聚合函数报错」的现象。先把顺序钉死，再往下看 JOIN、NULL、窗口函数。

# SQL（MySQL 8.0 / InnoDB） > 关系模型与查询基础 > 关系模型：表在解决什么问题

关系模型把数据拆成**二维表**：行是一条记录，列是一个属性。主键唯一标识一行，外键把表和表连起来。这个设计解决的是「一份数据只存一次」——客户姓名改了，不需要去订单表里改 N 处。

**主键的两条硬要求**：非空、唯一。InnoDB 里主键同时还是**聚簇索引**（数据按主键顺序物理存放），所以主键选择会直接影响插入性能和二级索引的体积——这层放到索引那一章展开。这里先记住一句：**能用自增整数就别用 UUID 当主键**。

**外键**在业务上表达「必须存在」：订单必须对应一个真实客户。MySQL 里外键约束默认开启，但很多团队关掉它，理由是批量导入和分库分表时外键会绊脚。关掉之后「必须存在」就要应用层保证，漏一次就是脏数据。判断依据：**单库、写入不极端时留着外键；一旦开始分库或有大批量灌数，再考虑挪到应用层**。

**范式**是拆表的原则：1NF 原子值、2NF 非主键列完全依赖主键、3NF 非主键列不互相依赖。实践中 3NF 是起点，**读多写少、查询总要 JOIN 三四张表时才反范式**——把高频字段冗余过去，用空间换 JOIN。反范式的代价是更新要改多处，漏一处数据就不一致。

# SQL（MySQL 8.0 / InnoDB） > 关系模型与查询基础 > SELECT 的逻辑执行顺序

写的顺序是 `SELECT ... FROM ... WHERE ... GROUP BY ... HAVING ... ORDER BY ... LIMIT`，**执行的逻辑顺序不是这个**。MySQL 的逻辑顺序是：

```
FROM / JOIN  →  WHERE  →  GROUP BY  →  HAVING  →  SELECT  →  DISTINCT  →  ORDER BY  →  LIMIT
```

这条顺序直接解释三个高频报错：

**一、WHERE 里不能用 SELECT 的别名。** `SELECT price * qty AS amount FROM t WHERE amount > 100` 会报 `Unknown column 'amount'`——WHERE 跑的时候 SELECT 还没执行，别名还不存在。要么把表达式在 WHERE 里再写一遍，要么包一层子查询。

**二、WHERE 里不能用聚合函数。** `WHERE SUM(amount) > 100` 非法，因为聚合发生在 GROUP BY 之后。过滤聚合结果用 HAVING。

**三、ORDER BY 可以使用 SELECT 的别名。** 因为它在 SELECT 之后。所以 `SELECT price * qty AS amount FROM t ORDER BY amount` 是合法的。

**LIMIT 在最后**，所以 `ORDER BY created_at DESC LIMIT 20` 是「排完再切」；没有 ORDER BY 的 LIMIT 返回哪些行是未定义的，跑两次可能不一样。深分页（`LIMIT 100000, 20`）的问题在执行计划那一章。

物理执行顺序（优化器实际怎么跑）可能跟逻辑顺序不同——比如把 WHERE 条件下推到存储引擎。但**写 SQL 时按逻辑顺序想**就不会写出错位的语句。

# SQL（MySQL 8.0 / InnoDB） > 关系模型与查询基础 > JOIN：行数为什么会翻倍

JOIN 把两张表按条件拼在一起。类型决定「对不上的那些行怎么办」：

| 类型 | 左表没匹配 | 右表没匹配 |
|---|---|---|
| `INNER JOIN` | 丢 | 丢 |
| `LEFT JOIN` | 留，右表列填 NULL | 丢 |
| `RIGHT JOIN` | 丢 | 留，左表列填 NULL |
| `CROSS JOIN` | 笛卡尔积，行数是两边相乘 | 同左 |

**最常见的事故不是类型选错，是一对多把行撑爆。** 订单表 1000 行 LEFT JOIN 订单明细（一单平均 5 行），结果 5000 行。再 `SUM(order.amount)` 就会把每单金额加五遍。现象：合计对不上、比报表多好几倍，SQL 看起来完全正确。

修法：聚合先做完再 JOIN，或者用子查询把「一对多」那一侧收成一行。

```sql
-- ✗ 一对多撑爆后再 SUM，金额被放大
SELECT c.id, SUM(o.amount) FROM customer c LEFT JOIN orders o ON o.cid = c.id GROUP BY c.id;

-- ✓ 先按客户聚合，再 JOIN 回客户表
SELECT c.id, COALESCE(s.total, 0)
FROM customer c
LEFT JOIN (SELECT cid, SUM(amount) AS total FROM orders GROUP BY cid) s ON s.cid = c.id;
```

**JOIN 条件写在 ON 还是 WHERE 里，对 LEFT JOIN 结果不同**：ON 里的过滤在补 NULL 之前，WHERE 里的过滤在补 NULL 之后。`LEFT JOIN t ON t.id = a.id AND t.status = 1` 会保留左表所有行；写成 `WHERE t.status = 1` 会把没匹配上的行（status 是 NULL）丢掉，LEFT JOIN 退化成 INNER JOIN。这个区别是 LEFT JOIN「怎么写都少行」的第一排查点。

# SQL（MySQL 8.0 / InnoDB） > 关系模型与查询基础 > JOIN：行数为什么会翻倍 > 笛卡尔积怎么产生、怎么发现

**漏写 ON 条件**（或 `FROM a, b` 不写 WHERE）就是笛卡尔积：每行和另一表的每一行配对。两张 1 万行的表 JOIN 出来 1 亿行，查询从毫秒变成分钟，临时表把磁盘打满。

发现手段：

- `EXPLAIN` 里 `rows` 是两表行数的乘积，`type` 经常是 `ALL`
- 结果行数远超你对业务的预期（「客户最多也就几千，怎么返回了几百万」）
- 服务器 `Created_tmp_disk_tables` 在涨、磁盘 IO 打满

`JOIN` 关键字本身不要求 ON（这是 SQL 标准的历史包袱），所以漏写能过语法检查。**写的时候养成「每个 JOIN 后面立刻写 ON」的习惯**，比事后用 EXPLAIN 抓更有效。多表 JOIN 时每加一张表就在心里估一下结果行数：一对一大致不变，一对多按倍数涨，没把握就先 `SELECT COUNT(*)` 看中间结果。

# SQL（MySQL 8.0 / InnoDB） > 关系模型与查询基础 > NULL 的三值逻辑

SQL 的逻辑不是真/假两值，是**真 / 假 / 未知**。`NULL` 表示「没有值」，任何跟 `NULL` 的比较结果都是未知：

```sql
SELECT NULL = NULL;          -- 结果是 NULL，不是 TRUE
SELECT NULL <> 1;            -- 也是 NULL
SELECT * FROM t WHERE name = NULL;     -- 永远返回空，该用 IS NULL
SELECT * FROM t WHERE name != 'a';     -- name 为 NULL 的行不会出现
```

**`NOT IN` 遇到 NULL 是最阴的一个。** `WHERE id NOT IN (1, 2, NULL)` 整个谓词变成未知，**结果集为空**。子查询里只要有一行是 NULL，NOT IN 就整表丢数据，不报错。`IN` 遇到 NULL 只是 NULL 那一项匹配不上，没有这么严重。所以「排除某些值」用 `NOT EXISTS` 或 `LEFT JOIN ... WHERE right.id IS NULL`，不要用 `NOT IN (SELECT ...)`。

**聚合对 NULL 的处理不一致**，写报表时经常踩：

| 函数 | 遇到 NULL |
|---|---|
| `COUNT(*)` | 计行，NULL 也算 |
| `COUNT(col)` | 忽略 NULL |
| `SUM` / `AVG` | 忽略 NULL |
| `SUM` 全是 NULL | 返回 NULL，不是 0 |

`COUNT(*)` 和 `COUNT(col)` 对不上，通常就是 col 有 NULL。`SUM` 可能返回 NULL，前端拿到 null 当 0 用会出问题，用 `COALESCE(SUM(amount), 0)`。

**`COALESCE(a, b, c)`** 返回第一个非 NULL 的参数，是处理 NULL 的常规手段。`IFNULL` 是 MySQL 特有、只接受两个参数。比较两个可能为 NULL 的值是否「业务上相等」，用 `<=>`（NULL-safe equal）：`NULL <=> NULL` 是 TRUE。

# SQL（MySQL 8.0 / InnoDB） > 关系模型与查询基础 > GROUP BY 与 HAVING

GROUP BY 把行收成组，每组产出一行。SELECT 列表里出现的非聚合列**必须出现在 GROUP BY 里**（MySQL 5.7 起 `ONLY_FULL_GROUP_BY` 默认开启）。违反这条的老写法：

```sql
-- ✗ MySQL 5.7+ 报错；老版本会从每组里随便挑一个 name，结果不确定
SELECT user_id, name, COUNT(*) FROM orders GROUP BY user_id;
```

「随便挑一个」在单测数据里恰好对，生产上多了几行就错——又是一个本地对线上错。

**WHERE 过滤行，HAVING 过滤组**：WHERE 在分组前，HAVING 在分组后。`HAVING COUNT(*) > 5` 是「只留行数超过 5 的组」；把 COUNT 写在 WHERE 里会直接语法错误。能用 WHERE 的条件不要放到 HAVING——WHERE 可以走索引，HAVING 必须先分组。

**`SELECT DISTINCT` 和 `GROUP BY` 都能去重**，但 DISTINCT 不能带聚合。只去重用 DISTINCT，要计数或求和才 GROUP BY。`COUNT(DISTINCT col)` 是「去重之后数有多少个」，和 `COUNT(col)` 不是一回事。

分组之前想清楚「按什么收」：按天 `DATE(created_at)` 会**用到函数，索引失效**（见索引章）。MySQL 8 可以用 `created_at >= '2026-01-01' AND created_at < '2026-01-02'` 把范围条件留给索引，再 GROUP BY 生成的日期列。

# SQL（MySQL 8.0 / InnoDB） > 关系模型与查询基础 > 子查询、EXISTS、IN

子查询出现的位置决定它的语义：

- **FROM 里**（派生表）——必须起别名。优化器会物化成临时表，大结果集时有成本
- **WHERE 里** —— 分成标量子查询（返回一个值）和 IN / EXISTS（返回一组）
- **SELECT 列表里** —— 对每一行执行一次，容易变成 N+1，能改写成 JOIN 就改

**`EXISTS` vs `IN` 的选择**：

```sql
-- 找下过单的客户
SELECT * FROM customer c WHERE EXISTS (SELECT 1 FROM orders o WHERE o.cid = c.id);
SELECT * FROM customer c WHERE c.id IN (SELECT cid FROM orders);
```

两者在现代 MySQL 里优化器经常能转成半连接，性能接近。真正的差别在 **NULL 和「有没有」语义**：EXISTS 只关心「至少有一行」，找到就停；IN 在子查询含 NULL 时有三值逻辑问题（见上一节）。**「排除」一律用 NOT EXISTS，不要用 NOT IN。**

相关子查询（内部引用了外层的列）对每一行都跑一遍，数据量大时很慢。能改写成 JOIN 或派生表就改。判断依据：EXPLAIN 里子查询的 `select_type` 是 `DEPENDENT SUBQUERY` 就要警惕。

# SQL（MySQL 8.0 / InnoDB） > 关系模型与查询基础 > 窗口函数：GROUP BY 做不到的事

窗口函数给每一行附加一个「从某组行算出来的值」，**不把行收拢**。这是它和 GROUP BY 的本质差别：GROUP BY 10 行变 2 行，窗口函数 10 行还是 10 行，只是多了几列。

**MySQL 8.0 才有**（MariaDB 10.2+ 也有）。5.7 及以前要用变量或自连接硬模拟，又慢又容易写错。

```sql
-- 每个用户最近 3 笔订单（GROUP BY 做不到「组内留多行」）
SELECT * FROM (
  SELECT o.*, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC) AS rn
  FROM orders o
) t WHERE rn <= 3;
```

常用几个：

| 函数 | 做什么 |
|---|---|
| `ROW_NUMBER()` | 组内编号，从 1 开始，不并列 |
| `RANK()` / `DENSE_RANK()` | 并列排名，RANK 会跳号 |
| `LAG` / `LEAD` | 取上一行 / 下一行的值 |
| `SUM() OVER (...)` | 累计和、组内合计（行还在） |

**`PARTITION BY` 是分组，`ORDER BY` 是组内顺序**，两者都在 OVER 子句里，跟外层的 GROUP BY / ORDER BY 无关。窗口在 WHERE 之后、SELECT 列表求值时计算，所以 **WHERE 里不能引用窗口结果**，要包一层子查询——又回到执行顺序那条规则。

窗口函数要排序，大表上可能 filesort。PARTITION 列上有索引能减轻，但不要假设它一定走索引，用 EXPLAIN 看。

# SQL（MySQL 8.0 / InnoDB） > 关系模型与查询基础 > 窗口函数：GROUP BY 做不到的事 > 什么时候用窗口，什么时候用 GROUP BY

判断依据就一句：**要不要保留明细行**。

- 只要合计 / 计数 / 每组一行 → GROUP BY
- 要明细，同时要组内排名、累计、对比上一行 → 窗口函数
- 「每组取 Top N」是窗口函数的经典场景，GROUP BY + JOIN 回去能做但更绕

一个反例：只是想给每行带上「该用户订单总数」，用窗口 `COUNT(*) OVER (PARTITION BY user_id)` 可以，用派生表 GROUP BY 再 JOIN 回去也可以。数据量不大时窗口更短；数据量大、这个合计还要在多处用，物化成一张汇总表更稳。

`RANK` 和 `ROW_NUMBER` 选错的后果很具体：并列第一时 RANK 给出两个 1、下一个是 3；ROW_NUMBER 强制 1、2，并列被任意拆开。「每人只留一条」用 ROW_NUMBER；「前三名可能超过三人」用 RANK。
