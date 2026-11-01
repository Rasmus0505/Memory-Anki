# 依赖复用审计（2026-10-07）

范围：找出 Memory Anki 手写实现而成熟库或同类项目已经做得更好的地方——
同样重要的是，找出哪些手写代码是刻意的、绝不能替换。

方法：测量每个模块的源码大小，检查实际依赖清单
（`apps/api/pyproject.toml`、`apps/web/package.json`），并阅读可疑实现。
本次会话中网络搜索不可用（缺少 `DEEPSEEK_API_KEY`），因此下面关于库的
事实只在它们是稳定、众所周知的 API 表面时才陈述；关于*本*仓库的每一项
声明都通过阅读代码验证。

## 主要发现

项目**并未**大范围重复造轮子。其依赖选择对 2026 年而言是当前且惯用的：
React 19、TanStack Query 5、Radix UI、Tailwind 4、React Flow (xyflow) 12、
TipTap 3、XState 5、FastAPI + SQLAlchemy 2 + Alembic、Ruff + mypy +
import-linter。两个最大的“可疑”区域其实已经有库支撑：

- **脑图画布（约 9,000 行）**不是手写的画布引擎。平移/缩放与节点/边
  运行时是 `@xyflow/react`，代码是其上的领域层。画布文件从仓库外只导入
  `@xyflow/react` 符号——没有第二个几何引擎。

因此正确的姿态是外科手术式，而非重写。下面按价值排序列出真正重复
现有工作的地方。

## 1. 领域排期：固定阶梯 vs FSRS —— 价值最高的缺口

> 2026-10-24 状态：**完成。** `unit_fsrs_adapter.py` 把四种评分映射到
> FSRS，同时保留产品规则，`unit_scheduler.rate_unit` 现在包装它，
> 迁移 `0077` 添加每单元 FSRS 列。一次性启动重放
> 从真实评分历史重新计算每个活跃单元（抢救备份
> `pre-fsrs-switch`）。阶梯只作为 `stage_index` 显示
> 投影保留。证明切换合理的只读对比是
> `deliverables/2026-10-24-FSRS影子适配基线.md`；影子记录器及其
> 表已退役。见 `review-boundary.md` 与 `proposal-fsrs-unification.md`。

`apps/api/src/memory_anki/modules/memory/application/unit_scheduler.py`（207
行）实现手写的固定间隔阶梯：

```python
INTERVAL_DAYS = (0, 1, 3, 7, 14, 30, 60, 120, 240, 365)
LAPSE_RETENTION = 0.5
FUZZ_RATIO = 0.05
```

带有 `rating -> stage` 算术、确定性抖动偏移，以及一个
`stage_from_legacy_interval_days` 迁移辅助函数。

这是本仓库之外一个真实且已被很好解决的问题。
`open-spaced-repetition` 项目发布了 **FSRS**（Free Spaced Repetition
Scheduler）及官方 Python 实现 `fsrs`（PyPI，“py-fsrs”，MIT）。
其 API 刻意接近本模块已经建模的内容：

- `Rating.Again/Hard/Good/Easy`（= 1–4）—— UI 已经发送的同样四个等级
  （`RATING_LABELS = {1: 忘记, 2: 困难, 3: 记得, 4: 轻松}`）。
- `Card` 状态 Learning/Review/Relearning。
- `Scheduler.review_card(card, rating) -> (card, review_log)`。
- `Scheduler`/`Card`/`ReviewLog` 上的 JSON 序列化。
- `enable_fuzzing` —— 与本模块的 `FUZZ_RATIO` 同一思路，但由
  记忆模型推导，而不是平坦的 ±5%。
- 可选的 `Optimizer`，把记忆模型权重拟合到用户自己的
  `ReviewLog` 历史，外加 `reschedule_card` 来重新间隔现有卡片。

为什么这比其他条目更重要：当前阶梯无法自适应。一个单元的
下一次间隔是常量表上的一个位置，因此排期永远无法学到这个用户
遗忘特定节点比平均更快。FSRS 预测每张卡片的保持率并排期到
目标（默认 0.9），而且可以从**应用已经存储**的复习历史
（`ReviewUnitRatingOperation`、`ReviewUnitState.revision`、`encounter` 记录）
中调参。Anki 本身就把 FSRS 作为默认调度器发布，所以这是
主流做法而不是实验。

**该依赖已经安装，并且已经在本仓库其他地方使用。**
`apps/api/requirements.txt` 固定 `fsrs==6.3.1`，甚至还有一个可选的
`requirements-optimizer.txt` 携带 `fsrs[optimizer]==6.3.1`（并附有注释：
torch/pandas 对主依赖来说太大）。所以项目已经接受 FSRS 作为其调度器，
并支付了依赖成本。

它只接入到**英语学习卡片**
（`modules/english/application/fsrs_runtime.py`，其中导入
`from fsrs import Scheduler`，加上英语表上的
`fsrs_state`/`fsrs_step`/`scheduler_version="fsrs-6.3.1"` 列）。永久标记
复习单元——核心宫殿复习流程，也是截图中的那个——仍在运行
`unit_scheduler.py` 中单独的手写阶梯。

这意味着仓库对**同样的四种评分有两套不同的调度算法**，
`unit_scheduler.py:12` 与 `fsrs_runtime.py:23` 中都重复了
`RATING_LABELS = {1: 忘记, 2: 困难, 3: 记得, 4: 轻松}`。这才是真正的
发现：不是“采用一个库”，而是“完成一个已经做了一半的采用”，
并移除两者之间的分叉。

推荐形态：保留 `unit_scheduler.py` 作为**领域端口**（代码库其余部分
与 UI 契约依赖 `rate_unit`、
`scheduled_interval_days`、`stage_from_legacy_interval_days`），并在该端口之后
用 `fsrs` 实现它——复用 `fsrs_runtime.py` 中已经写好的设置/解析，
而不是添加第二套 FSRS 集成。纯函数
签名使这成为绞杀榕式替换而非重写，现有阶梯可以作为
被测试固定的回退保留。

一个重要警告：不得在用户进行到一半时静默地交换两个调度器。
仓库已经交付过一次旧日期迁移
（`test_realign_legacy_fsrs_due_dates_migration.py`），这表明团队之前
正好碰到过这一类问题。任何切换都需要同样的处理：
逐单元状态迁移，而不是翻一个开关。

提交前需要权衡的注意事项：FSRS 以 **UTC 日期时间**排期，而本模块
以 `date` 工作，并有明确的“通过必须至少落在一天之后”
与“提前日期的填充使用 `schedule_locked`”规则，这些规则编码了产品
决策（见 `MIN_PASSED_STAGE`、`schedule_locked`）。这些规则是产品
语义，不是排期数学，必须保留在 FSRS 之上而不是
丢弃。这是一个触及 SRS 核心的中等规模变更，因此它需要
自己的范围化任务与自己的回归测试——而不是顺手改一下。

## 2. 图布局：手写树布局 vs 布局库

`apps/web/src/shared/ui/mindmap-canvas/layout.ts`（1,018 行）手写实现树
测量（`measureTree`）、子树边界、重叠消解
（`resolveOverlaps`、`hasNodeOverlaps`、`stackNodesWithoutOverlap`）与
拖放目标命中几何。当前没有布局依赖（`package.json` 中没有
dagre/elk/d3）。

有两种解读，诚实的答案是混合的：

- **拖放目标与预览几何**（`resolveDropMode`、
  `resolveStructureDropMode`、`isWithinStructureDropLeaveZone`、
  `DROP_NEAR_THRESHOLD_PX`）是真正的产品行为。没有库提供它。
  保留。
- **分层树布局**正是 `dagre`/`elkjs`/`d3-hierarchy` 的全部用途。
  使用其中一个会消除一大类缺陷（重叠与子树高度的边界情况），
  代价是把库的输出适配到这个 UI 想要的卡片尺寸。

注意此文件有其他工作留下未提交的本地变更（一个
`getNodeSize` memo）。根据 AGENTS.md，这是共享工作：不要回退它，
也不要在不协调的情况下在其之上开始布局重写。

## 3. 小型重复辅助函数（低风险）

已验证的出现位置，并在阅读两份实现后做出一处更正：

- **ID 生成——已完成。** 相同的“`crypto.randomUUID()` 带回退”函数体
  曾在三个模块中复制粘贴（`shared/persistence/mutationQueue.ts`、
  `shared/logs/model/appLogs.ts`、
  `shared/debug/session-recorder/sessionRecorderStore.ts`）。现在三者都调用
  `shared/lib/ids.ts` 中的一个 `generateLocalId()`。没有添加依赖：回退
  只覆盖非安全源，且这些 id 是本地关联句柄，绝不是授权令牌。
- **两个“相等”函数并非重复——不要合并它们。** 较早的一轮
  假设 `isDeeplyEqualPlain`（`mindmap-canvas/layout.ts`）与
  `shallowEqualNodeData`（`mindmap-canvas/mindMapCanvasDisplay.ts`）是同一个
  辅助函数写了两次。它们不是：一个递归进入嵌套对象，另一个
  只按引用比较顶层键。合并它们会静默改变
  边复用行为。刻意保留不动。如果将来确实想要共享相等辅助函数，
  两个调用点需要不同的函数，而不是一个。

## 4. 手写实现是正确的地方——不要“修复”这些

用库替换这些会是倒退：

- **`shared/lib/dateTime.ts`** —— 不是通用日期格式化器。它编码一个
  特定的后端契约（naive datetime 是 UTC，因为后端存储
  `utc_now_naive`；注释记录了它修复的一个真实约 +8 小时缺陷）。日期库
  不会知道那条规则。保留。
- **`shared/persistence/mutationQueue.ts`（486 行）** —— 一个离线写入队列，
  带合并、感知 `Retry-After` 的忙路径、按实体的
  `resourceKey`/`coalesceKey`，以及通过服务器去重的 mutation id 进行
  幂等重放。通用离线库假设一种本应用没有的同步协议（文件同步发生在
  应用之外）。这确实是合理定制的。
- **`platform/events/bus.py`（41 行）** —— 一个同步的进程内 pub/sub，其
  docstring 也这么说。为此引入消息代理只会严格更差。
- **`platform/jobs/registry.py`** —— 已自我说明为未使用的脚手架，
  并附有明确指示：删除它，或用真实消费者实现它，并且特别
  **不要**为单进程 SQLite 应用中的三个小循环添加调度器加
  数据库支持的租约。前作者的推理是合理的；遵循“删除或实现”的
  指示，而不是添加依赖。

## 5. 流程观察

本仓库已经带有异常强大的架构纪律——`pyproject.toml` 中的 import-linter
契约、庞大的 `tools/check_architecture.py`、`docs/architecture/` 下的 ADR，
以及异步的 mutation-id/`operation_id` 约定。因此主要风险不是缺少依赖；
而是*领域*层（排期、布局）已经增长到足够大，值得接受基础设施层
已经得到的同样“用库或者给出理由”的审视。

## 推荐顺序

1. 完成并验证进行中的存储锁争用修复（已在本次会话
   实现；见 `storage-lock-contention.md`）——这是用户可见的痛点，
   也是应用感觉可靠的前提。
2. ~~在现有 `unit_scheduler` 端口之后用 FSRS 替换排期阶梯。~~
   2026-10-24 完成：FSRS 是生产单元调度器，`stage_index` 仅是显示投影。
3. 整合重复的 deep-equal 与 id 生成辅助函数。
4. 仅针对树定位评估布局库，保留拖放目标几何不动。
5. 按照 `platform/jobs/registry.py` 自己的 docstring 处理它（删除或实现）。
