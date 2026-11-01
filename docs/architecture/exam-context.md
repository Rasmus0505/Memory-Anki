# 考试上下文

只读考试层：星级权重、倒计时、遗忘估计、作战室。

## 归属

- 后端 `apps/api/src/memory_anki/modules/exam`（公共入口 `memory_anki.modules.exam.api`）。
- 前端 `apps/web/src/modules/exam`（公共入口 `src/modules/exam/public.ts`），页面 `pages/exam/ExamWarRoomPage.tsx`，路径 `/exam`。
- 数据：`chapters.exam_stars/_source`、`palaces.exam_stars/_source`、`subjects.exam_share`（迁移 `0064`），考试设置位于 `config` 键 `exam_settings` 中。

## 星级解析（首个命中生效）

1. 宫殿 `exam_stars`（在复习书架/作战室手动设置，或由本地 AI 以来源 `ai` 写入）。
2. 沿宫殿主章节链向上最近的带 `exam_stars` 的章节。
3. 推导：`score = question_count + 2 × subjective_count`（`short_answer` = 主观题）；`≥12` → 3，`≥5` → 2，否则 1。

## 遗忘估计

`R(t) = 0.9 ^ (t / S)`，`S` = 由单元的 `stage_index` 投影出的间隔（真实 FSRS 间隔的兼容性投影），`t` = 距上次通过的天数；未学习单元的回忆度为 0。
它从不改变排期。`memory/application/unit_fsrs_adapter.py` 中的 FSRS 适配器仍是唯一的调度器。

## 使用方

- `practice` 队列：`palace_order = exam_priority` 会按 `star_weight × (0.35 + forgetting) × share_factor` 对宫殿预排序，然后顺序遍历；每张卡片都会带上 `exam_stars`。
- 随心信息流：星级角标、三星金色边框、倒计时标签、轮次结束考试总结。
- 复习书架（`PalaceShelfPage`）、仪表盘区块（`ExamCountdownBlock` / `ExamTodayBlock` / `ExamRecentBlock` / `ExamWeakBlock`，由 `InsightsPage` 单独放置）、作战室（知识地图、保持曲线、星级分布、薄弱列表、回忆训练）。

## 规则（由 `check_exam_context_boundaries` 强制执行）

- `exam/domain` 不导入任何框架、基础设施或其他模块。
- 任何考试文件都不写入 `due_date`、`stage_index`、`has_passed` 或 `last_passed_at`。
- 星级编辑以实体 id 为键；UI 按实体丢弃过期响应。

## 冲刺模式（考试时间界限）

`exam_settings.sprint_mode` 是开关；`exam_settings.exam_date` 是时间界限。策略是纯函数并共享在 `core/exam_horizon.py`（`resolve_sprint_horizon`、`SprintHorizon.schedule`）中，因此考试拥有配置，记忆拥有排期。

时间界限只做一件事：**它绝不在 `exam_date - 1` 之后安排复习。**

- 已经能放进窗口的间隔完全按阶梯安排。阶梯仍拥有节奏；时间界限只对它设限。
- 会超出窗口的间隔会被拉进考试前的最后一周，并按单元 id 确定性地分散（`SprintHorizon.schedule(..., seed=<unit id>)`），这样一批成熟的单元不会全部落在考试前夜。
- 当没有空间时（在考试前几天内复习过），该单元保留正常间隔并安排在之后。它刚刚复习过；把它压回今天会导致最后每天都重新发放同一张卡片。
- 在考试当天及之后不生效。
- `clamp_due_dates_for_sprint`（一个记忆命令，从练习队列构建中调用）会把已安排到考试之后的单元拉进同一个最后一周。考试从不写到期日。

先尝试了按时间界限比例设置上限（剩余天数的 `10-20%`，来自 Cepeda 等人），但被否决：每天重新计算会在最后几周坍缩成“每天都复习所有内容”，大约让卡片数量翻倍（真实数据上每天 39 张对 21 张），并把每个单元同步到同一节奏。在 2026-10-23 计划（286 个单元，考试 12-20）上测量：关闭时 1 039 次复习 / 每天 17.9 次；开启时 1 236 次 / 每天 21.3 次，最后两周从涓涓细流变成每天约 50 次。落地阶段、名义间隔和工具栏直方图从不改变。

## 里程碑

`config` 键 `study_milestones` 保存计划检查点的 JSON 列表（`date`、`title`、`category`、`detail`、`notify_days_before`、`enabled`、`done`）。`DEFAULT_MILESTONES` 在首次读取时一次性播种 2027 考研冲刺计划；每个字段都可编辑。里程碑从不移动到期日，也从不门控复习——它们回答“到现在本该完成什么”。状态在每次读取时推导：`done` / `overdue` / `due_soon`（在 `notify_days_before` 之内）/ `upcoming`。

提醒仅在应用内。没有推送通道：service worker 只有一个 `notificationclick` 处理器，因此任何内容都无法到达已关闭的应用。

两个界面，刻意不同：

- **进度页面**（`MilestonePanel`）——完整的可编辑列表。每行状态：
  `done` / `overdue`（红色，保持到勾选或重新定日期为止；绝不自动移位，
  因为计划规定检查点不移动）/ `due_soon` / `upcoming`。
- **开始页概览**（`GET /freestyle/overview` → `milestones`，只读，从不播种）——
  仅作一眼概览：**最近的两个里程碑日期**，每个日期携带当天的*每一项*。带日期的检查点会聚集（10/31 同时有中教史和马原），所以“下一个里程碑”会隐藏同日的兄弟项；而两个日期正是一眼概览的意义所在。考试倒计时已来自 `ExamCountdownChip`，因此该条带自身不持有倒计时。

路由：`GET|PUT /api/v1/exam/milestones`；响应还携带 `sprint`（active、`days_left`、`max_interval_days`、`last_due`），因此进度页只需一次调用。UI：`modules/exam/ui/MilestonePanel.tsx`，挂载在 `LearningProgressPage`（进度）上。
