# SQL（MySQL 8.0 / InnoDB） > 执行计划与调优 > 资料说明

来源：https://fqx.lx.ci/sql-map/

主线对齐 MySQL 8.0 / InnoDB，涉及 PostgreSQL 差异的地方单独标注。标着「版本敏感」的是老资料最容易过时的部分。

# SQL（MySQL 8.0 / InnoDB） > 执行计划与调优

前面三块是原理，这块是干活。核心是一条固定流程：慢查询日志找出慢的语句 → EXPLAIN 看它为什么慢 → 改 SQL 或改索引 → 再验证。凭感觉调参数、盲目加索引是最常见的弯路。

# SQL（MySQL 8.0 / InnoDB） > 执行计划与调优 > EXPLAIN 每一列怎么读

`EXPLAIN SELECT ...` 输出一行代表一个「表的访问方式」。真正要看的是五列：**type、key、rows、filtered、Extra**。

**type —— 访问类型，从好到坏**：

| type | 含义 |
|---|---|
| `system` / `const` | 主键或唯一索引等值命中，最多一行 |
| `eq_ref` | JOIN 时用主键/唯一索引关联，每行匹配一行 |
| `ref` | 用非唯一索引等值查找，可能多行 |
| `range` | 索引范围扫描（`>` `BETWEEN` `IN`） |
| `index` | 扫**整个索引**，比 ALL 好一点（索引小） |
| `ALL` | **全表扫描** |

**实践标准**：达到 `range` 及以上算可接受，出现 `ALL` 或 `index` 就要看是不是漏了索引。小表上 `ALL` 是正常的，不用管。

**key** —— 实际用的索引。这是最先看的一列：**是 NULL 说明没走索引**；不是你预期的那个索引，说明优化器选了别的（见下一节）。`possible_keys` 是候选，`key` 才是实际用的。

**rows** —— 优化器**估算**要扫多少行。是估算不是精确值，来自统计信息。它和实际返回行数差距很大时（比如 rows=50 万、实际返回 20 行），说明过滤发生在扫完之后，索引设计有问题。

**filtered** —— 估计有多少百分比的行能通过 WHERE 剩下的条件。`rows × filtered` 才是估计的最终行数。filtered 很低（比如 5%）意味着扫了很多白扫的行。

**key_len** —— 用了索引的多少字节。这一列能判断**联合索引用到了第几列**：`(a INT, b INT)` 各 4 字节（可空再加 1），key_len=4 说明只用了 a，=8 说明 a、b 都用上了。排查最左前缀问题时很有用。

**`EXPLAIN ANALYZE`（MySQL 8.0.18+）会真正执行并给出实际耗时和实际行数**，比估算准得多。排查「估算和实际差很远」的问题时直接用它。代价是会真的跑一遍，生产上对写操作要小心。

# SQL（MySQL 8.0 / InnoDB） > 执行计划与调优 > EXPLAIN 每一列怎么读 > Extra 列的几个关键值

Extra 信息量最大，几个必须认识的：

**`Using index`** —— **覆盖索引**，不用回表。这是好事，看到它说明索引设计得好。

**`Using index condition`** —— 索引下推（ICP），在索引层过滤掉一部分再回表。比不下推好，但还是要回表。注意和上一个区分。

**`Using where`** —— 存储引擎返回数据后，server 层还要过滤。单独出现不一定是问题，配合 rows 很大、filtered 很低就是问题。

**`Using filesort`** —— **需要额外排序**。名字里有 file 但不一定用磁盘，小结果集在内存里排（sort buffer）。它意味着索引顺序没能满足 `ORDER BY`。修法是调整索引让排序列在正确位置（见索引章）。大结果集的 filesort 会用临时文件，是慢查询的常见原因。

**`Using temporary`** —— **需要临时表**。常见于 `GROUP BY` 的列上没索引、`DISTINCT` 加 `ORDER BY`、或者 UNION。临时表如果超过 `tmp_table_size` 会落到磁盘，性能断崖式下降。监控 `Created_tmp_disk_tables` 这个状态变量能看到有多少临时表落盘了。

**`Using join buffer (Block Nested Loop)`** —— JOIN 的关联列上没索引，退化成块嵌套循环。基本等于「这个 JOIN 该加索引了」。MySQL 8.0.20+ 换成了 hash join，Extra 里显示 `Using join buffer (hash join)`，比 BNL 快很多，但仍然说明缺索引。

**`Impossible WHERE`** —— 条件永远为假，优化器直接返回空。看到它检查一下条件是不是写错了（比如 `WHERE 1=0` 或者矛盾条件）。

**优先级**：`Using temporary` + `Using filesort` 同时出现的查询是最该优化的。

# SQL（MySQL 8.0 / InnoDB） > 执行计划与调优 > 慢查询定位流程

**前提是先把日志开着**，出事后再开就错过了现场：

```sql
SET GLOBAL slow_query_log = ON;
SET GLOBAL long_query_time = 1;              -- 超过 1 秒记录
SET GLOBAL log_queries_not_using_indexes = ON; -- 未走索引的也记（量可能很大，酌情）
```

配置文件里写 `slow_query_log`、`slow_query_log_file`、`long_query_time` 才能重启后保留。

**分析日志用 `mysqldumpslow` 或 `pt-query-digest`**（后者强得多）：

```bash
# 按总耗时排序，找出最该优化的语句模板
pt-query-digest /var/log/mysql/slow.log | head -50
```

**关键是按「总耗时」排序而不是「单次耗时」**：一条 5 秒的报表查询一天跑一次，和一条 50 毫秒的查询一天跑一百万次，后者才是主要负载。pt-query-digest 默认就按总耗时排。

**MySQL 8 也可以直接查 performance_schema**，不用翻日志：

```sql
-- 按总耗时排前 10 的语句模板
SELECT digest_text, count_star, avg_timer_wait/1e9 AS avg_ms,
       sum_timer_wait/1e12 AS total_s
FROM performance_schema.events_statements_summary_by_digest
ORDER BY sum_timer_wait DESC LIMIT 10;
```

**完整流程**：

1. 找出慢语句（按总耗时排）
2. `EXPLAIN` 看 type / key / rows / Extra
3. 判断是缺索引、索引失效、还是 SQL 写法问题
4. 改完**再 EXPLAIN 一次**确认，然后在真实数据量上测耗时
5. 上线后看那条语句的总耗时有没有降下来

第 4 步经常被跳过。**改完不验证，很容易「加了索引但优化器没用」**——加了索引不等于走了索引。

# SQL（MySQL 8.0 / InnoDB） > 执行计划与调优 > 常见慢查询形态与修法

**一、深分页 `LIMIT 100000, 20`。**

问题：MySQL 要扫过前 100020 行再丢掉前 100000 行。翻到第 5000 页时几乎是全表扫描。

```sql
-- ✗ 越翻越慢
SELECT * FROM orders ORDER BY id LIMIT 100000, 20;

-- ✓ 游标分页：记住上一页最后一个 id
SELECT * FROM orders WHERE id > 100000 ORDER BY id LIMIT 20;

-- ✓ 必须支持跳页时：先在索引上取主键，再回表（延迟关联）
SELECT o.* FROM orders o
JOIN (SELECT id FROM orders ORDER BY id LIMIT 100000, 20) t ON t.id = o.id;
```

游标分页是最优解，代价是**不能跳页**（只能上一页/下一页）。产品上能接受「加载更多」就用它。

**二、`SELECT *`。** 三个代价：多传无用数据、可能让覆盖索引失效（见索引章）、大字段（TEXT/BLOB）拖慢整个查询。只取需要的列。

**三、隐式类型转换。** 见索引章。排查慢查询时**优先检查每个条件的类型是否匹配**，这条命中率很高且极易被忽略。

**四、`count(*)` 慢。** InnoDB 没有行数缓存（因为 MVCC 下每个事务看到的行数可能不同），`COUNT(*)` 要真扫。优化手段：

- 有二级索引时 `COUNT(*)` 会走最小的那个索引，比扫聚簇索引快
- 不需要精确值时用 `SHOW TABLE STATUS` 的 `Rows`（估算值）或 `information_schema.tables`
- 需要精确且高频时，单独维护一张计数表

**五、大 `IN` 列表。** `IN` 里几千个值时优化器可能放弃索引。改成临时表 JOIN，或者分批查。

**六、`ORDER BY` + `LIMIT` 但排序列没索引。** 现象是 Extra 里 `Using filesort`，且 rows 很大。加上能满足排序的索引，让「排完取前 N」变成「顺着索引取前 N 就停」。

**七、JOIN 的关联列没索引。** Extra 里 `Using join buffer`。给被驱动表的关联列加索引，这通常是几十倍的提升。

# SQL（MySQL 8.0 / InnoDB） > 执行计划与调优 > JOIN 的算法与驱动表

MySQL 的 JOIN 本质是嵌套循环：拿驱动表的每一行，去被驱动表里找匹配。

**三种算法**：

**Nested Loop Join（NLJ）** —— 被驱动表的关联列**有索引**时用。驱动表每行触发一次索引查找。成本约等于「驱动表行数 × 一次索引查找」，是理想情况。

**Block Nested Loop（BNL）** —— 被驱动表关联列**没索引**时用。把驱动表一批行放进 join buffer，然后扫一遍被驱动表和 buffer 里所有行比。驱动表 1000 行、被驱动表 10 万行，就是 10 万次扫描比对。这是 JOIN 慢的主要形态。

**Hash Join（MySQL 8.0.18+）** —— 等值 JOIN 且没索引时替代 BNL。用小表建哈希表，扫大表探测。比 BNL 快很多，8.0.20 起还能用于有索引的场景（优化器判断更划算时）。

**这也是为什么「JOIN 慢就加索引」有效**：把 BNL 变成 NLJ。

**驱动表选择**：优化器倾向选**结果集小的表**当驱动表——因为循环次数由驱动表决定。`LEFT JOIN` 语义上要求左表当驱动表（否则补 NULL 的语义就错了），`INNER JOIN` 优化器可以自由选择。

**`STRAIGHT_JOIN` 能强制按书写顺序**，但和 `FORCE INDEX` 一样是最后手段——数据分布变了它就成了枷锁。

**关于 JOIN 表数量**：MySQL 优化器对多表 JOIN 用穷举 + 剪枝找最优顺序，表数量多时（超过七八张）优化本身就有成本，`optimizer_search_depth` 控制搜索深度。实践上**超过五张表的 JOIN 就该考虑拆成多次查询或加汇总表**——不是绝对不能写，是可维护性和稳定性都会下降。

# SQL（MySQL 8.0 / InnoDB） > 执行计划与调优 > 优化器为什么选错索引

优化器是**基于成本估算**选执行计划的，估算依赖统计信息。选错通常有三个原因：

**一、统计信息过期。** InnoDB 的索引基数（cardinality）是采样估算的，大量增删后可能严重偏离实际。

```sql
-- 重新采样统计信息（很快，只读元数据，一般不锁表）
ANALYZE TABLE orders;
-- 看当前统计
SHOW INDEX FROM orders;    -- Cardinality 列
```

**这是选错索引时第一个该试的动作**，成本极低。

**二、采样精度不够。** `innodb_stats_persistent_sample_pages`（默认 20 页）决定采样多少页。数据分布很不均匀的大表可以调大，代价是 ANALYZE 变慢。

**三、成本模型的偏好和实际不符。** 典型场景：一个索引能满足 `ORDER BY` 避免排序，另一个能更好地过滤。优化器可能算出「用排序那个更划算」，但实际数据分布下反了。

**干预手段，按副作用从小到大**：

```sql
-- 1. 先试重建统计
ANALYZE TABLE t;

-- 2. 告诉优化器「优先考虑这个」，它仍可自主判断（副作用小）
SELECT * FROM t USE INDEX (idx_a) WHERE ...;

-- 3. 排除某个索引
SELECT * FROM t IGNORE INDEX (idx_b) WHERE ...;

-- 4. 强制（优化器无法拒绝，副作用最大）
SELECT * FROM t FORCE INDEX (idx_a) WHERE ...;
```

**`FORCE INDEX` 的代价必须讲清楚**：它把执行计划钉死在代码里。数据量增长、数据分布变化、加了更好的索引之后，这条 hint 会变成累赘，而且没人记得当初为什么加。**用之前先确认不是统计信息的问题，用之后在代码里写注释说明原因和验证日期。**

MySQL 8 还有 `optimizer_hints`（`/*+ INDEX(t idx_a) */` 这种注释式 hint）和**不可见索引**（`ALTER TABLE t ALTER INDEX idx INVISIBLE`）。后者很实用：想删一个索引但不确定有没有人用，先设为不可见观察一段时间，出问题立刻改回可见——比直接 DROP 再重建安全得多（大表重建索引很贵）。

# SQL（MySQL 8.0 / InnoDB） > 执行计划与调优 > 该改 SQL、改索引、还是改表结构

拿到一条慢查询，判断顺序：

**先改 SQL** —— 成本最低，不影响其他查询：

- 有隐式类型转换、对列做函数运算 → 改写条件
- `SELECT *` → 只取需要的列
- 深分页 → 游标分页或延迟关联
- `NOT IN` 子查询 → `NOT EXISTS`
- 一对多 JOIN 后聚合导致数值放大 → 先聚合再 JOIN

**再改索引** —— 影响这张表的所有写入，但通常收益最大：

- `type: ALL` 且表不小 → 缺索引
- `Using filesort` 且排序列固定 → 调整索引让排序走索引
- 回表次数多、SELECT 列少 → 考虑覆盖索引
- 走了索引但 rows 远大于实际返回 → 索引列顺序不对

加索引前检查：会不会和已有索引重复、这张表写入频率高不高、大表加索引要用在线方案（见工程实践章）。

**最后才改表结构** —— 成本最高，要迁移数据、改代码：

- 字段类型选错（用 `VARCHAR` 存日期、用 `DOUBLE` 存金额）
- 单表数据量过大且查询模式固定 → 归档历史数据或分区
- 反复 JOIN 同几张表的固定字段 → 适度反范式冗余
- 真正到了单机瓶颈 → 分库分表（这是最后手段，见工程实践章）

**一条经验**：绝大多数慢查询在前两步就解决了。跳到第三步之前，先确认前两步已经做尽——分库分表带来的复杂度（跨片查询、分布式事务、扩容）远超它解决的问题。
