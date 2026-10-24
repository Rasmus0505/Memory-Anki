# 为什么没有替换这三处「手写轮子」（C5 调查结论）

> 背景：一次外部审计把 `unit_scheduler.py`、`core/time.py`、`manual_text_quiz_parser.py`
> 列为「应改用成熟方案」的手写实现。本文记录实测结论：**三处都不应替换**，其中一处
> 的目标内容根本不是已提交代码。
>
> 结论以代码注释与测试就地固化，此处只做索引与理由汇总。

## 1. `core/time.py` — 目标内容是你自己的未提交工作，不是历史包袱

审计读到的是**工作区**版本（205 行，含 `resolve_local_timezone` / `parse_client_datetime`
/ `local_calendar_day_*`）。但该文件在 `HEAD` 只有 77 行，这些加固**尚未提交**：

| | 行数 | `resolve_local_timezone` |
|---|---|---|
| `HEAD`（本 worktree 的基点） | 77 | 不存在 |
| 主工作区（未提交） | 205 | 存在 |

主工作区还带着配套的回归守卫 `apps/api/tests/test_local_timezone_resolution.py`
（未跟踪），其 docstring 写明了它防的是什么事故：

> Regression guard for the mixed convention where SQLite's `'localtime'` modifier
> followed the server process zone while the UTC-aware ledger path resolved the zone
> in Python. The two silently disagreed off the China host.

也就是说：**「需要替换的老旧时区实现」在提交历史里并不存在**。要按审计执行，第一步得先把
这 139 行加固搬进 worktree，再去替换它——这自相矛盾。而在 worktree 里另写一套时区逻辑，
只会与主工作区那份**产生冲突**。

处理：不替换。本 worktree 保持 `HEAD` 的 77 行版本不动，等主工作区那份提交后再评估。

## 2. `unit_scheduler.py` — 已被 FSRS 取代（2026-10-24）

> 本节最初记录的是「为什么当时不替换固定阶梯」。结论已经执行：**FSRS 现在是唯一的
> 生产排期器**。阶梯只剩 `stage_index` 这个兼容投影，界面改为显示每个单元的真实间隔。
> 当前契约见 [review-boundary.md](./review-boundary.md)；当初的取舍记录见
> [proposal-fsrs-unification.md](./proposal-fsrs-unification.md)。

替换不是把旧规则丢掉，而是把它们留在适配器里：

1. **`rate_unit` 仍是纯函数入口**，undo（`_undo_one_rating_operation`）与快照重放
   （`_restore_snapshot`）依赖它。适配器只在内部构造 `Card` 并调用 `Scheduler`，
   快照里额外存 FSRS 载荷；没有载荷的旧快照会清空列后按历史重放。
2. **预览必须等于提交**。FSRS 自带的 fuzz 是随机的，适配器关闭它并复用同一套
   `blake2b` 确定性偏移（按单元 id，7 天以上才生效）。
3. **`schedule_locked` 仍由产品层实现**：提前复习（填充卡）只记录、不推进排期，
   且这次通过根本不喂给 FSRS，避免填充卡把间隔越推越长。
4. **schema 已迁移**：`ReviewUnitState` 增加了 `fsrs_stability` / `fsrs_difficulty` /
   `fsrs_state` / `fsrs_step` / `fsrs_due_at` / `fsrs_last_review` /
   `fsrs_scheduler_version`（迁移 `0077`），并由启动时的一次性回放按真实评分历史
   重算所有活跃单元；撤回与改分仍然从快照与评分账本重建。
5. **用户可见文案已改**：不再出现「N天级」，`ratingEffectLabels` 显示
   `${n}天后复习`，进度条按真实间隔分段，单元面板直接使用 `due_date` 排期。

## 3. `manual_text_quiz_parser.py` — 换成 grammar 会拒绝它要抢救的输入

该解析器的价值不在解析机制，而在**领域启发式**：中文题号（`^\s*(\d+)[\.\．、]`）、
`【答案】`/`【参考答案】` 约定、章节/题型上下文，以及**四级降级匹配**
（严格 5 元组 → 宽松 4 元组 → (section, type-family, number) → (section, number)）。

输入是 OCR / 复制粘贴的畸形教材文本，不是形式语言。`lark` / `pyparsing` 会把它的正则
表达得更啰嗦，却**拒绝**它专门要救回的脏输入。测试覆盖仅 4 个用例，也不足以支撑替换。

## 附：C3 的同类结论

审计还建议把 `infrastructure/llm/openai_compatible.py` 换成 `openai` SDK。评估后同样不采用：
`openai` 在本机只是 `paddlex` / `transformers` 的 extra 传递依赖，从未被项目声明；声明它会额外
引入 `jiter`、`distro`、`tqdm`；而 SDK 不暴露本项目依赖的扩展点（`reasoning_content`、
`output_text`/`text_delta` 内容数组变体、`finish_reason=length` → `output_truncated` 映射、
`partial_response` 诊断）。改为**在文件内消除真实重复**：抽出 `_open_chat_completion` 与
`_run_with_retries`，统一流式/非流式的重试判定，保留「流开始前可重试、流开始后绝不重试」语义。
