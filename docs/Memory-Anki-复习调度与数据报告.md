# Memory Anki 复习调度与数据报告

> 专项报告。总览见《[技术报告](Memory-Anki-技术报告.md)》。
> 本文是**实现口径**，不是产品宣传：写的是代码现在真正在做什么。
> 产品语言版本见《[复习间隔与评分规则（用户视角）](复习排期-用户视角.md)》。

---

## 1. 调度单位与身份

- 调度单位是**复习单元**，不是节点、不是题目、不是宫殿。
- 复习单元由脑图上的**永久标记**划分：一个标记节点及其下游内容。
- 单元身份是 `(anchor_uid, unit_kind)`：
  - 普通标记：`unit_kind = mindmap_branch`；
  - 标记根节点：`unit_kind = palace`，整座宫殿算一个单元。
- 内容编辑会提升 `unit_revision`，但**身份不变**；评分、重练计数和排期都跟着单元走，不跟着修订号走。
- 删除最后一个标记会让单元行停用，但保留历史；重新标记会复活原行（同一 unit id、同一评分历史），不会从「第一次学」重来。
- 旧版节点级复习历史、节点掌握度投影、子树继承评分都已退役，不得重建。

---

## 2. 定锚期（`early_step = 0`）

新单元只有两个固定闹钟：

| 当前状态 | 评分 | 下一次 |
|---|---|---|
| 第一次学 | 记得 / 困难 | 当天 **20 分钟**后复查 |
| 第一次学 | 轻松 | **+3 天**，定锚期结束（免复查、免隔夜） |
| 20 分钟复查 | 记得 / 困难 | **明天**（第 2 天隔夜检验） |
| 20 分钟复查 | 轻松 | **+3 天**，定锚期结束 |
| 第 2 天隔夜检验 | 记得 | **+3 天**，移交 FSRS |
| 第 2 天隔夜检验 | 轻松 | **+5 天**，移交 FSRS |
| 第 2 天隔夜检验 | 困难 | **+1 天**，留在定锚期再检验一次 |
| 任意定锚状态 | 忘记 | 当天重练；过后 **+1 天** |

补充规则：

- 定锚期只有**一次** 20 分钟复查；
- 重练通过**不再**叠一次 20 分钟复查；
- 重练通过后：从未通过过的单元排明天做隔夜检验；此前已通过过的单元直接按 FSRS 的 1 天间隔继续；
- 「轻松」是逃生门：首次学或复查时点轻松都可以提前毕业；
- 定锚期靠 `early_step` 计数器判断（0 = 定锚期，1 = 已移交 FSRS）；旧数据没有该值时按旧 0–3 四轮计数推断一次。

---

## 3. FSRS 期（`early_step = 1`）的三条护栏

设上一次实际排到的间隔为 `p = 到期日 − 上次评分的学习日`：

| 评分 | 新间隔 |
|---|---|
| 忘记 | 当天重练；重练通过后 **+1 天**确认隔夜 |
| 困难 | `clamp(FSRS, 0.8p, p)`，最少 1 天；**绝不拉长**。`p = 0` 时固定 1 天 |
| 记得 | `p < 10` 时 `min(FSRS, floor(2.5p))`；`p >= 10` 时完全不设限 |
| 轻松 | `p < 10` 时 `min(FSRS, floor(3.5p))`；`p >= 10` 时完全不设限 |

另外：

- 任何「通过」至少排到次日；
- 间隔 `>= 7` 天时，按单元 ID 加一个确定性的 **±5%** 抖动，避免同一天学的卡永远同一天到期；
- FSRS 目标保持率 `0.9`，基准最长 `365` 天；
- 项目自己的 ±5% 抖动是在 365 天上再叠加的，因此**实际最长约 383 天**（365 + 18）；手动改期同样按这个上限；
- FSRS 自身的 fuzz 关闭，避免与项目抖动叠加成不可解释的结果。

### 3.1 成熟卡忘记的「复活甲」

- 只有 `p >= 14` 才记录原间隔（`lapse_original_interval_days`）；
- 记下原间隔的学习日（`lapse_started_on`）；
- 隔夜确认（次日及以后任一通过）按评分恢复：
  - 困难 25%
  - 记得 30%
  - 轻松 35%
- 恢复后清除该状态；
- `p < 14` 不走恢复，按正常护栏重建。

---

## 4. 当天内间隔（分钟/小时级）

| 场景 | 间隔 |
|---|---|
| 首次通过后的复查 | **20 分钟**，只一次 |
| 重练通过 | 不复查，直接排明天 |
| 忘记后第 1 次重练 | **10 分钟** |
| 第 2 次重练 | **1 小时** |
| 第 3 次重练 | **3 小时**（当天最后一次） |
| 一天最多重练 | **3 次**，之后排明天 |
| 学习日只剩不到 15 分钟 | 直接排明天，不再塞回当天 |

实现常量在 `unit_intraday.py`：

- `STEP_DELAY`；
- `RETRY_DELAYS`；
- `MAX_RETRIES_PER_DAY`；
- `DAY_END_MARGIN`。

重练在到点前保持 `pending` + `available_at`；服务端读取时由 `publish_ready_retries` 放上轨道，位置在学习者当前游标处。前端**不自己插卡**。

---

## 5. 学习日与到期集合

- 学习日以本地 **03:00** 翻页：0:00–3:00 算前一天；
- 到期集合是**一整个**：没有每日限额、没有积压释放、没有每轮切片；
- 队列装的是「到期日 ≤ 今天」的活跃单元；
- 排序默认：新学优先 → 宫殿自身深度优先的结构顺序；
- 重练不占固定位置，到点后紧跟当前卡出现；
- 轮次跨过 03:00 时，重建会先重新接纳再次到期的单元（按知识点身份匹配，不按卡片 id），避免 1 天阶段悄悄停止复习。

---

## 6. 考试冲刺

- 只把超出考期的日期**拉近**，绝不延长；
- 落点是 `last_due - 0..7` 天，即考前 **1–8 天**，不是严格的「最后 7 天」；
- 打开开关时会把已经排到考后的日期一次性拉回；
- 失败仍然当天重练。

---

## 7. 睡前复习

- 右侧月亮按钮触发；
- 范围是当前工作区内**今天至少有一次活跃评分**的宫殿；
- **每座宫殿一张卡**，整座宫殿一个评分；
- 评分只写入轮次计划的 `bedtime_ratings`，**不写复习账本、不改到期日、不改 FSRS 状态**；
- 已经追加过的宫殿不会重复追加；
- 跨过 03:00 后由下一次轮次重建惰性清理，不是定时删除；
- 常规评分端点会拒绝睡前复习卡。

---

## 8. 数据模型

### 8.1 排期核心表

| 表 | 作用 |
|---|---|
| `review_unit_states` | 每个复习单元的当前状态：阶段、到期日、间隔、`early_step`、`has_passed`、FSRS 状态、版本 |
| `review_unit_encounters` | 每次「打开一次复习浏览」的 encounter；评分挂在 encounter 上 |
| `review_unit_rating_operations` | 评分操作账本：改分、撤销、冻结基线 |
| `review_unit_schedule_batches` | 批量改期/降级批次，可撤销 |
| `review_session_units` | 会话与单元的关联 |
| `study_sessions` | 学习会话 |
| `unit_fsrs_shadow_*` | FSRS 只读影子对比（迁移/策略验证） |

关键列：

- `early_step`：0 = 定锚期，1 = 已移交 FSRS，NULL = 未记录；
- `lapse_original_interval_days` / `lapse_started_on`：成熟卡忘记恢复；
- `is_favorite`：单元收藏（迁移 0084，后端已就绪，前端星标尚未接入）；
- `fsrs_scheduler_version`：策略版本。

### 8.2 随心轮次表

| 表 | 作用 |
|---|---|
| `freestyle_round_states` | 轮次计划权威：`round_id`、配置快照、`plan_version`、卡片顺序、游标、完成/排除、重练 occurrence、结算分组 |
| `freestyle_round_operation_receipts` | 轮次写入的幂等回执 |
| `freestyle_rating_intents` | 评分意图（点击即记录，确认后结算） |
| `freestyle_quiz_attempts` | 随心做题的作答归属 |

### 8.3 题目证据表

- `palace_quiz_questions`：题目；
- `palace_quiz_question_node_bindings`：题目 ↔ 节点绑定；
- `quiz_attempt_events`：跨场景作答事实来源；
- `quiz_practice_progress` / `quiz_practice_progress_clears`：共享题目进度与清除墓碑。

题目作答是题目自己的证据，不会写进 `review_unit_states`。

### 8.4 规模

- 当前 **70 张表**；
- **85 个 Alembic 迁移文件**（最新编号 `0084_review_unit_favorite`）；
- 迁移由 `infrastructure/db/migrations.py` 调 Alembic 执行，启动前有 binding guard。

---

## 9. 写入路径与幂等

### 9.1 一次评分

1. 前端打开/复用一个 `encounter`；
2. 点击评分 → 本地立即上屏，发 `card_id + occurrence_id + encounter_id + plan_version`；
3. 服务端校验 `expected_version` 和 `operation_id`；
4. 评分写入 encounter；
5. 排期从**评分前基线**重新计算（改分不会叠加两次效果）；
6. 返回新 `plan_version`，前端采用；
7. 如果后续已有真实练习，旧 encounter 变为只读，写入返回 `superseded_attempt`。

### 9.2 改分与撤销

- 离开卡片前再点另一个评分：整体替换，不是追加；
- 再次点击已选中的评分：清回未评分；
- 撤销是后进先出，仅在 encounter 仍打开时可用；
- 只能改**最近一次**真实练习。

### 9.3 幂等与冲突

- 写请求带 `X-Memory-Anki-Mutation-ID`；
- 服务端 mutation replay store 保存已接受响应；
- 同一 operation 的重复终态写入返回已接受结果；
- 过期设备收到 `conflict: true` + 最新计划，不得覆盖新进度；
- 评分回调携带 `plan_version`，下一次评分不会成为过期冲突。

### 9.4 轮次命令

评分、移动游标、离开卡片、结算压缩、到期重练投影都经 `practice.domain.round_commands` 门面；事务和版本由应用层负责。

---

## 10. 读取路径与投影

- 队列构建只读活跃的到期 `ReviewUnitState` 行和宫殿标题，**不在关键路径解析每份 `editor_doc`**；
- 打开单元时才对该宫殿做对账；
- 冷启动可能返回一个 `study_window` 前缀（`tail_pending`），让首屏先画；尾部随后静默加载；
- 该前缀是同一有序队列的前缀，不是重新洗牌，也不是投放排期；
- 已存轮次的首屏来自已存计划，卡片一出现，加载不得覆盖信息流；
- 读取投影不修改业务状态；对账是显式命令。

---

## 11. 迁移、回填与策略版本

- `SCHEDULER_POLICY_VERSION = "anchor2-bands-1"`；
- 启动回填（`review_scheduler_switch.py`）：
  - 有 FSRS 快照：旧 `early_step 0 → 0`、`1/2/3 → 1`；不移动到期日，只盖版本号；
  - 没有 FSRS 快照：重放评分历史（会按新规则重算到期日，这是现有行为）；
- 策略升级只补齐内部计数，**不移动**已经排好的日期；新规则从下一次评分开始生效；
- FSRS 影子对比脚本：

```bash
python tools/review_fsrs_shadow.py
```

---

## 12. 存储与运行环境

### 12.1 三个根目录

```text
学习数据/    memory_palace.db、语言学习媒体、词表、语音教练
学科附件/    学科 PDF、资料库
日志缓存/    备份、AI 日志、OCR 缓存、导入/生成工作区、runtime 锁
```

根目录来自 `local-config/memory-anki.local.json` 的 `local_app_home`，回退到 `MEMORY_ANKI_HOME` 或 `%LOCALAPPDATA%\MemoryAnki`。代码里不写死盘符。

### 12.2 SQLite

- WAL 模式、`synchronous=NORMAL`、`foreign_keys=ON`；
- `busy_timeout=10s`；
- 连接池 10 + 20 overflow，`pool_timeout=5s`；
- `cache_size=-64000`（约 64MB）、`temp_store=MEMORY`、`mmap_size=256MB`；
- 同一时间只允许一个写者；
- 锁等待超过预算会返回可重试错误，而不是无限挂起。

### 12.3 备份

- full / rolling / rescue 三类；
- 启动、关闭、周期性备份；
- 备份校验报告；
- 宫殿版本快照约 5 分钟节流，最多 50 条；
- 恢复是显式操作，不会自动用备份覆盖当前库。

### 12.4 跨设备

- 应用不实现文件同步；
- 切换设备前：停服务 → 等 WAL/SHM 静止 → 等两边同步完成 → 再启动；
- 不要用冲突副本直接覆盖主库；
- 数据库、附件、上传目录都不要加入同步忽略规则。

---

## 13. 不变量与常见故障

### 13.1 必须守住的不变量

1. 评分只作用于复习单元，题目不能评分；
2. 一个单元同一时间只有一个当前评分；
3. 改分从评分前基线重算，不叠加；
4. 「困难」绝不拉长间隔；
5. 提前复习不改期；
6. 睡前复习不改任何排期；
7. 轮次刷新/重启不铸造新 `round_id`；
8. 评分不重建队列；
9. 重练方向是源 → 重练，重练不继承源完成；
10. 到期集合是一整个，不切片、不限额；
11. 读取不写状态；
12. 学习日 03:00 翻页，禁止 `date.today()` 口径。

### 13.2 常见故障与定位

| 现象 | 常见原因 | 定位 |
|---|---|---|
| `database is locked` | 另一个写者未释放 | 查请求日志、busy_timeout、是否有第二个设备/进程 |
| 评分后卡片消失/自动翻页 | occurrence 被错误结算/取消 | 查 `publish_ready_retries`、occurrence 状态、`fresh_due_ids` |
| 跨天后 1 天阶段不再复习 | 轮次未重新接纳再次到期单元 | 查 `_reopen_due_again` 与知识点身份匹配 |
| 提前评分改了到期日 | 走了非「提前复习」分支 | 查 encounter 的 due 判断 |
| 冲刺把卡推远 | 落点计算错误 | 查 `last_due - 0..7` |
| 双设备进度互相覆盖 | 没走 expected_version/operation_id | 查 conflict 响应与 mutation replay |
| 备份恢复后数据旧 | 恢复的是旧快照 | 查备份时间、WAL、版本快照 |

---

## 14. 参数改动地图

| 想改什么 | 文件 | 常量 |
|---|---|---|
| 定锚期节点与天数 | `unit_fsrs_adapter.py` | `ANCHOR_STEP_DAYS`、`ANCHOR_PASS_DAYS`、`ANCHOR_EASY_DAYS`、`ANCHOR_HARD_DAYS`、`ANCHOR_FIRST_EASY_DAYS` |
| 困难/记得/轻松护栏 | `unit_fsrs_adapter.py` | `HARD_RATIO_MIN/MAX`、`GOOD_CAP_RATIO`、`EASY_CAP_RATIO`、`CAP_MAX_PREVIOUS_DAYS` |
| 忘记恢复 | `unit_fsrs_adapter.py` | `LAPSE_MIN_PREVIOUS_DAYS`、`LAPSE_RECOVERY_RATIO` |
| 目标保持率 / 最长间隔 | `unit_fsrs_adapter.py` | `build_unit_scheduler(...)` 参数 |
| 当天复查/重练 | `unit_intraday.py` | `STEP_DELAY`、`RETRY_DELAYS`、`MAX_RETRIES_PER_DAY`、`DAY_END_MARGIN` |
| 抖动 | `unit_fsrs_adapter.py` | `FUZZ_MIN_INTERVAL_DAYS`、`FUZZ_RATIO` |

改完规则后 `SCHEDULER_VERSION` 会变化，后端下次启动会对所有单元补写定锚计数器并盖版本号；已生效的排期原样保留。
