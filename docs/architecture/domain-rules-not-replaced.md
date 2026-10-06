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

## 2. `unit_scheduler.py` — 替换会改变用户可见文案，且被测试显式钉住

阶梯 `(0, 1, 3, 7, 14, 30, 60, 120, 240, 365)` **硬编码在 4 处，其中 3 处是前端 UI**：

- `apps/api/.../memory/application/unit_scheduler.py:11` —— 权威定义
- `apps/web/.../review/components/PalaceLadderProgress.tsx:25` —— `DEFAULT_LADDER`，渲染工具栏阶梯条
- `apps/web/.../review/components/PalaceReviewUnitsPanel.tsx:19`
- `apps/web/.../settings/ui/profile/ProfileSettingsPage.tsx:115`

前端把它渲染成**面向用户的文案**（`modules/practice/ui/freestyle/model/ratingEffectLabels.ts:35`）：

```ts
: `${effect.target_interval_days}天级`     // 「14天级」
```

并且 `apps/api/tests/test_unit_scheduler_rules.py` 的第一条用例就是
`test_ladder_shape_is_unchanged`，另有 `test_fuzz_is_deterministic_per_unit_so_preview_matches_commit`
守住「预览与提交必须一致」。

其余不可替换的理由（详见 `unit_scheduler.py` 内注释）：

1. **`rate_unit` 是纯函数**，这正是 undo（`_undo_one_rating_operation`）与快照重放
   （`_restore_snapshot`）成立的前提。FSRS 的 `Scheduler.review_card` 会改写 `Card`
   内部状态，重放快照需要重建其完整记忆状态。
2. **预览必须等于提交**。`fuzz_key` 在预览用 `encounter.unit_id`、提交用 `state.id`，
   二者同值（已核对），配合 `blake2b` 确定性 fuzz 才能让按钮预告的日期与实际写入一致。
   FSRS 的 fuzz 是随机的，无法在不 patch 的情况下保证一致。
3. **`schedule_locked` 是 FSRS 无法表达的产品规则**：提前复习（填充卡）只记录、不推进阶梯。
   缺了它，越勤快清队列、填充卡越多、间隔爬得越快。
4. **持久化 schema 绑定**：`ReviewUnitState` 只有 `stage_index` / `has_passed` / `due_date`，
   没有 stability / difficulty。换 FSRS 需要迁移全部既有单元。

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
