# 点击驱动的跨设备计时边界

计时器属于 `modules/session`。应用壳层维护当前 dwell，页面和浮层只提供当前路由、标题和场景信息；计时状态由全局点击适配器和本地 interval ledger 负责。换宫殿或换做法会另起一行；同一处暂停后再学仍是同一行。

## 点击契约

全局使用 `document` capture 监听 `pointerdown`；不支持 `PointerEvent` 的环境使用 `mousedown`/`touchstart`，并做兼容去重。只有学习页的 active attachment 处理事件。设置、备份、宫殿列表、洞察和知识树浏览不接受点击，离开这些页面或进入它们会立刻停表。

学习页包括翻卡、做题、编辑宫殿、查看某一座宫殿、复习和英语。人还停在学习页上时，给 **90000 ms（90 秒）** 想一想；超过后停表，并且缓冲之后的空档整段不计入。锁屏、切走也立刻停，离开后的时间不算。

- `idle` 的学习页首击立即启动记录。
- 换宫殿、换课程或换做法会结束上一笔，下一击另起一笔。标题用学科-章节-宫殿-做法，不再用时钟标题。
- 同一处暂停后再点，仍是同一笔。
- `completed` 收到学习页点击时创建新的记录。

两台设备的日期和钟点都按北京时间（UTC+8）显示和切日。存储仍是带偏移的 UTC。亲手改过时长的记录不自动改写。

## 已确认 UTC interval ledger

前端只上传已经闭合且确认的 UTC interval。正在运行的区间、估算 checkpoint 秒数和未来结束时间不得上传。接口为 `POST /api/v1/study-sessions/time-ledger`，interval 使用稳定的 `interval_id`，重试可安全重复上传。服务端每次上传写入 immutable revision：

```text
学习数据/time-ledger/devices/{device_id}/revisions/{revision_id}.json
```

`device_id` 来自设备自己的 `local-config/memory-anki.local.json`，客户端不能覆盖；各设备拥有独立 UUID。Syncthing 只合并文件，不共享 SQLite 并发写。坏文件、非法 schema、非法 timestamp 或未来 created/ended 时间在读取时整文件跳过。

interval 的 `started_at` / `ended_at` **必须带显式 UTC 偏移**。缺少偏移的裸时间会被拒绝（`TimeLedgerInterval.normalized()` 抛错，接口返回 400）：无法判断的绝对时刻只能靠猜，而猜测会让记录整体偏移一个时区，进而在错误的本地日显示。前端统一用 `new Date(...).toISOString()` 生成。

read model 按 `interval_id` 去重并计算 UTC 时间并集。相同 `session_id + started_at` 的 growing checkpoint 先按最长 `ended_at` 作为该组代表，再和其他 start/pause 区间做并集；跨设备重叠、重复 revision、短 checkpoint 和长 checkpoint 都不能重复增加 total。趋势按**本地日界线**（`split_interval_local_days`）拆分跨午夜区间；kind/source breakdown 使用同一并集分配，所以分项合计不超过 total。

PATCH/DELETE 使用 `/study-sessions/time-ledger/{interval_id}`，列表行 ID 为 `ledger:{interval_id}`；修改和删除写新的 immutable correction/tombstone revision。对一个 growing group 的编辑或删除必须屏蔽同一 `session_id + started_at` 的旧短区间，防止同步后复活；后续 revision 仍受 terminal tombstone 约束。批量删除可同时接收 SQLite ID 和 `ledger:` ID。

列表 ledger 行提供兼容 StudySessionItem 的 `id`、`scene`、`title`、`status`、`started_at`、`ended_at`、`effective_seconds`、`events`、`progress`、`summary`；`summary` 至少包含 `client_source`、`device_id`、`session_id` 及上传 metadata。

## SQLite 兼容边界

ledger 是已确认 interval 的权威来源。旧 SQLite study session 记录只在没有任何 ledger row（包括已删除的 ledger tombstone）匹配其 `session_id` 时纳入 read model；canonical metadata 只用于兼容迁移和显示，不能抑制其他设备的 ledger，也不能让 deleted canonical 记录使 ledger fallback。前端 ledger-only persist 不应再为同一区间额外写等价 SQLite 记录。

analytics、时间列表、summary、kind/source breakdown 和 trend 都从同一个合并 read model 读取，保证统计口径一致。正式复习提交接口仍可产生自己的复习记录，但不得把同一 confirmed interval 再写成普通计时记录。

## 本地日历日归属

存储保持 UTC-naive（`core/time.utc_now_naive`），但"某条记录算哪一天"统一由 `core.time.resolve_local_timezone()` 决定，禁止依赖进程或 SQLite 的隐式本地时区：

- `MEMORY_ANKI_LOCAL_TZ` 可显式指定：IANA 名（`Asia/Shanghai`）、固定偏移（`UTC`、`+08:00`）或 Windows 时区名；未设置时日历固定为北京时间 UTC+8，不跟随进程时区。非法值只告警并回退到北京时间，不抛错。
- `local_calendar_day_bounds_as_utc_naive` / `local_calendar_day_of` 是该规则唯一入口。
- 统计 SQL 不再使用 SQLite 的 `datetime(col, 'localtime')` 修饰符（它跟随**服务进程的 OS 时区**，与 Python 侧的日界线计算可能不一致，换机器或改时区会静默漂移）；改为显式拼出 `datetime(col, '+00:00', '±HH:MM')`。

## 四级归因（学科/章节/单元 + 场景 + 行为）

时间记录必须能回答"这段时间花在**什么**上"。早期 ledger 的 `metadata` 只有 `session_key` + `completion_method`，导致每一行都是 `06:44 学习时段`，无法按学科或章节汇总。

归因是若干正交维度，全部可空——仪表盘停留本来就没有学科，未绑定的宫殿本来就没有章节；**缺失就是缺失，不做猜测**：

| 维度 | 字段 | 来源 |
|---|---|---|
| 学科 | `subject_id` / `subject_name` | 宫殿的 `palace_subjects` 关联 |
| 章节 | `chapter_id` / `chapter_name` | 宫殿的 `chapter_palaces` / `primary_chapter_id` |
| 单元 | `unit_label` / `palace_id` / `palace_segment_id` | 当前宫殿与分段 |
| 场景 | `scene` | `freestyle` / `palace_edit` / `review` / `quiz` / … |
| 行为 | `behavior` | `flip` / `quiz` / `edit` / `lookup` / `reading` / `listening` |

契约定义在 `modules/session/domain/time_record_attribution.py`（后端）与 `.../model/timeRecordAttribution.ts`（前端），键名统一 snake_case，随 interval 写进 ledger `metadata`。`palace_id` 独立成字段而不是并进 `unit_label`，这样宫殿改名不会破坏按宫殿的关联统计。

章节信息由知识侧在加载宫殿目录时写入 `palaceKnowledgeBinding` 缓存（`publishPalaceKnowledgeBindings`）；session 模块在闭合 interval 时同步读取，不反向查询知识模块。没有缓存时只有 `scene` + `palace_id`，仍比完全无归因强。**正常结算和 pagehide/unload 两条写入路径都必须携带归因**——关掉标签页正是过去丢归因的地方。

read model 对每个 ledger interval 输出 `attribution`；早于该契约的旧 revision 回退到 interval 自身的 `palace_id` + `kind`。

## 时长与墙钟必须自洽

同一行记录里有两个时间口径：`started_at`/`ended_at` 是**墙钟区间**，`effective_seconds` 是**实际学习秒数**。两者**不相等是正常的**——暂停、跨天、离开页面都会让墙钟跨度大于有效时长。因此：

- **禁止**把 `effective_seconds` 改成墙钟跨度，或反过来。实测：1505 条正式记录里有 1160 条 `span > eff`（暂停/跨天），若按墙钟改写，总时长会从 **185.6 小时膨胀到 11653 小时（+6180%）**。
- 唯一的不变量是 `effective_seconds <= ended_at - started_at`（未手工编辑时）。任何一行都不应声称学习了比它自己存在更久的时间。
- 防线在 `study_session_duration.normalize_effective_seconds()`：未编辑的时长会被裁剪到墙钟上限。
- `complete_unit_review_session` 曾破坏这条不变量：`effective_seconds` 取"已评分已闭合卡片场次之和"，而 `ended_at` 在最后一张卡已经显示之后才落笔，于是求和可能比跨度多出 1–2 秒。现在写入前裁剪，并把原始值留在 `summary.billed_seconds_before_clamp`。

历史修复见迁移 `0068_clamp_session_duration_span`：只在 `span < effective_seconds` 时裁剪，逐行写入 `summary.duration_span_repair` 审计字段，跳过 `duration_edited` 与软删除行，且 `downgrade()` 可完整还原。实测影响 80 行、共 80 秒（占总量 0.01%）。

迁移 `0069_repair_beijing_offset_study_sessions` 只改自动记录：`started_at` 比服务器 `created_at` 晚大约 8 小时时，视为把北京时间当成了 UTC，整段回拨 8 小时。`duration_edited` 不改。

## 依赖边界

页面和 widgets 只能从 `modules/session/public.ts` 使用会话能力。全局 click、ticker、visibility 适配属于运行时层；UTC interval、union、revision、correction 和 tombstone 属于框架无关 domain/service。服务端负责 schema/timestamp 校验、immutable revision、group correction、terminal deletion 和旧 SQLite 兼容过滤。
