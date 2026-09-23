---
feature: freestyle-complete-seek
status: delivered
updated: 2026-09-23
branch: perf/freestyle-load
commits: 2656ddb7..working-tree
---

# 随心完成按钮跳到最早未评分单元

## Report

**What was built**

随心右侧「完成」在轮次未结束时改为两级定位：先跳**最早未评分**单元（含跳着做的）；若全部已评，再回退到未完成项，但**已再次评为忘记/困难的重练不再作为目标**（返回 null，按钮禁用）。源卡在重练尚未插入时仍可打开（保持架构约定）。`getFreestyleRatedCardIds` 同时把 occurrence id 与 source id 记入已评集合，避免已困难的重练被当成未评分。未完成时按钮文案改为「定位到最早还没评分的单元」。轮次完整时仍进结算槽；leave 重排、一单元一活重练、结算规则未改。

**Verification**

- `cd apps/web && npm run typecheck` → PASS
- `npx eslint`（roundCompletion / queueState / ImmersiveFreestylePage 等改动文件，`--max-warnings 0`）→ PASS
- `npx vitest run` roundCompletion + palace-navigation + layout + FeedPager → PASS（54 tests）
- `npx vitest run src/modules/practice/ui/freestyle src/modules/practice/domain` → 471 passed / 1 failed。失败为 PRE-EXISTING：`feedConfig.test.ts` “persists one stable unit encounter…”（`effectiveSeconds` 字段），与本改动无关
- `python tools/check_architecture.py` → 失败于 4 个超大文件（`feedConfig.test.ts`、`round_state_service.py`、`round_plan.py`、`unit_review_projection.py`），均未被本改动触及，PRE-EXISTING
- `python -m pytest tools/test_check_architecture.py -q` → PASS（114）
- 独立审查（general-1）：**APPROVE**，S2 全表 + T1–T3 合规，无 critical

**Journey log**

- 用户澄清：完成曾跳到「已再次评困难的重练」；期望是最早**未评分**，且已困难重练对定位应算本回合已评。
- 根因有两层：`findEarliestUnhandledIndex` 把弱评分重练当未完成；`getFreestyleRatedCardIds` 只把 encounter 记到 source，已困难的重练本身不在已评集合里。
- 本环境拒绝 `git worktree add`（共享 ref store），在 `perf/freestyle-load` 当前工作区实现，不回滚同分支上的进度条动画 WIP。
- `queueState.ts` 编辑时误删文件头 BOM，已恢复，避免无关 diff。

## [S1] Problem

随心模式右侧「完成」在轮次未结束时应跳到**最早尚未评分**的单元。实际会跳到**已经再次评为忘记/困难的重练卡**：该卡本轮已有评分，只是还没通过（或还在等 leave 重排），被 `findEarliestUnhandledIndex` 当成最早「未处理」目标，排在后面真正未评分的单元之前。

期望（用户）：

1. 完成 → 最早**没有评分**的单元（含跳着做的）。
2. 重练再评忘记/困难后，这张卡对完成定位而言应算「本回合已评」，不再作为目标；系统仍按既有规则在 leave 后重排/递增同一重练，不额外堆第二张副本。

## [S2] Design

完成定位分两级，写在 `resolveFreestyleCompleteSeek` 一侧的纯函数（建议 `findFreestyleCompleteSeekIndex` 或扩展 `resolveFreestyleCompleteSeek` 的输入），页面只传 cards / encounters / completedIds / roundPlan / visualIndex / roundComplete：

1. **轮次已处理**（`isFreestyleRoundComplete` / 传入 `roundComplete`）→ 结算槽 `cardCount`（保持现行为）。
2. **未结束 → 最早未评分**：用已有 `findEarliestUnratedIndex`（弱评分、已进 completed、plan `lastRating` 均算已评）。找到则作为 seek 目标。
3. **没有未评分卡 → 回退** `findEarliestUnhandledIndex`，但：
   - 若该卡**已评分且是重练 occurrence** → **不跳**（返回 null；按钮可点性由「是否存在可 seek 目标」决定）。已评困难的重练不是完成目标；下一跳应等 leave 重排后的未评分状态，或轮次里其它未评分卡（第 2 步已覆盖）。
   - 若该卡是**未进 feed 的困难/忘记源卡**（已评分、非重练、无未完成重练副本）→ 仍可跳（架构：重练未插入时完成打开源卡）。
   - 其它未处理且未评分的卡 → 跳。

页面接线：

- `earliestUnhandledIndex` 改为「完成 seek 序列」（未评分优先 + 上述回退），或直接 `completeSeekIndex = resolve(...)` 吃完整状态。
- `completeTitle` 未完成时文案改为「定位到最早还没评分的单元」。
- `handleCompleteRound` 仍只 `navigateToIndex(completeSeekIndex, { skipHistory: true })`；`completeSeekIndex == null` 时按钮 `disabled`。

**不改**：重练插入时机（源卡立即插、重练 leave 重排）、一单元一活重练、`isFreestyleRoundComplete` / 结算规则、进度条动画 WIP。

**契约摘要**：

| 输入态 | 完成目标 |
|---|---|
| 轮次完整 | 结算槽 |
| 存在未评分卡 | 最早未评分 index |
| 全部已评，仅剩未完成源卡（重练未插入） | 该源卡 index |
| 全部已评，仅剩已评困难的重练 | null（不跳到该重练） |
| 已在目标上 | null（按钮禁用） |

架构文档 `freestyle-immersive-feed.md` 中完成按钮一段改为：未评分优先；重练已评忘记/困难后不再是目标；源卡仅在重练未插入时仍可作为目标。`check_architecture` 若断言旧措辞「earliest unfinished unit」，同步为「earliest unrated unit」类表述（保持 `resolveFreestyleCompleteSeek` + `onComplete={handleCompleteRound}` 仍被引用）。

## [S3] Out of Scope

- 不改评分 API、SRS、宫殿清空门槛。
- 不合并/回滚 `perf/freestyle-load` 上未提交的进度条动画改动。
- 不新建 worktree（本环境拒绝 `git worktree add`；在当前分支实现）。

## Tasks

- [x] T1: 纯函数：完成 seek 未评分优先，已评重练回退为不跳 — acceptance: `roundCompletion` 单测覆盖 S2 表四行 + 已在目标为 null (covers: S2)
- [x] T2: 页面与文案接线 — acceptance: ImmersiveFreestyle 使用新 seek；title 为「还没评分」；layout 测试仍通过 (covers: S2; depends: T1)
- [x] T3: 架构文档与门禁措辞 — acceptance: feed 文档与 check_architecture 一致描述未评分优先 (covers: S2; depends: T1)
