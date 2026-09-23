---
feature: freestyle-unit-progress
status: delivered
updated: 2026-09-23
branch: main
commits: 26fa2171..working-tree
---

# 随心评分状态统一内核

## Report

**What was built**

落地唯一评分内核 `apps/web/src/modules/practice/domain/unitProgressState.ts`：occurrence 级本轮分（`occurrenceScore` / `isOccurrenceScored` / `isOccurrencePassed` / `findEarliestUnscoredIndex`），**禁止** source↔重练 `lastRating` 继承。产品语义按你的选择：完成 = 队列序最早**未评分**（谁最早看谁）；进度条 = **已评分就填实心**（含忘记/困难）；重练再评后 leave 递增 `retry_attempt` 并**清空该 occurrence 评分**，下一跳空白可再 seek。完成 seek、进度条填色、宫殿清空、轮次完成、`getFreestyleRated/Passed` 包装全部改读内核。后端 `apply_rating` 不再把 重练 glance 写到 source；`applyServerRatingsToRoundPlan` 在 `ownsGlance` 时不回落 source。架构门禁 `check_freestyle_unit_progress_kernel` 与契约测试锁死语义，避免再分叉。

**Verification**

- `npx tsc -b --noEmit` → PASS
- eslint 改动文件 `--max-warnings 0` → PASS（`useImmersiveQueue` 的 `questionIds` lint 为 PRE-EXISTING）
- vitest：kernel/serverRoundPlan/palaceClearance/roundCompletion/progressSegments → 100 PASS
- `npx vitest run src/modules/practice` → 514 PASS / 1 FAIL（PRE-EXISTING `feedConfig.test.ts` effectiveSeconds）
- `pytest test_freestyle_round_plan.py test_freestyle_round_api.py` → 54 PASS
- `pytest tools/test_check_architecture.py` → 114 PASS
- `python tools/check_architecture.py` → 仅 3 个 PRE-EXISTING 超大文件
- 独立审查 REQUEST CHANGES 的 3 个 critical 已修：ownsGlance 不回落 source + 测试；契约测试 5；架构门禁

**Journey log**

- 根因不是单点：本周 seek / 进度条 / 宫殿清空 / serverRoundPlan 各拼一套 scored/handled，`planRecordedRating(id, sourceId)` 回落是「未评被当已评」主因；`leave_card` 递增 attempt 不清分导致下一跳永实心。
- 产品拍板后按「谁最早未评分」+「已评分实心」收束，删掉 family 多级回退，避免再打补丁。
- 重练 glance 必须 occurrence 本地：后端 `apply_rating` 与前端 hydrate 两处都曾写到 source。
- PowerShell 下 `&&` 仍不可用；并行工具易被取消，收尾改为串行短命令。
- 首次审查 REQUEST CHANGES 后只修 critical 再复审，不把 nit 扩成第二轮重构。

## [S1] Problem

本周多条链路（`0717b4ca` 评分覆盖 → `bbac3e1a` 重练进度/完成结算 → `ef062c51` family 化 unhandled → complete-seek 补丁）各自定义「已评 / 未评 / 已过 / 待重练」：

| 消费方 | 判定依据 | 问题 |
|---|---|---|
| 完成 seek | `getFreestyleRatedCardIds` + `isHandled`/`familyHasPass` | `planRecordedRating` 回落到 source 的 `lastRating`，未评重练被当成已评 |
| 进度条填色 | `visualPlanStatus` + `planCardStatus`（几乎不看 lastRating） | 同一张卡 seek 说已评、进度条却空心 |
| 宫殿清空 | 另一套 `isHandled` | 与 seek/进度条再次分叉 |
| 轮次完成 | `isHandled` + family | 规则最严，但输入仍是多源 |

用户现象：完成跳到已评困难的重练；或**前面明明有更早未评分卡却不跳过去**（进度条空心、逻辑已评）。反复改一处、坏另一处。

产品偏好（已确认）：

1. **完成**：按队列顺序，**谁最早未评分看谁**（唯一排序标准，不再多级优先）。
2. **进度条**：**已评分就填实心**（忘记/困难/记得/轻松一视同仁）。
3. **范围**：前后端一起对齐。

## [S2] Design

### 2.1 唯一真相：occurrence 级本轮得分

新模块 `apps/web/src/modules/practice/domain/unitProgressState.ts`，**禁止**其它文件再拼 scored/handled/passed 条件。

```ts
/** 仅本 occurrence 的本轮分；绝不从 source 继承 */
score(cardId): 1|2|3|4 | null

/** score != null，或 completedIds 含本 id（quiz/结算压缩） */
isScored(cardId): boolean

/** score >= 3，或 completedIds 含本 id */
isPassed(cardId): boolean
```

**得分优先级（occurrence 本地，无 source 回落）：**

1. `encounters[cardId].selectedRating`（本轮 live glance）
2. 否则若 `completedIds` 含 `cardId` → 按已通过处理（quiz / 结算）
3. 否则 `roundPlan.cardsById[cardId].lastRating`（空 amend 保留）
4. 否则 `null`（未评）

**明确禁止：** `planRecordedRating(id, sourceId)` 那种 `lastRating` 回落 source；重练 id 与 source id 分属两个 occurrence，各有各的分。

### 2.2 派生规则（全部只读 2.1）

| 概念 | 定义 |
|---|---|
| 进度条实心 | `isScored` |
| 进度条空心 | `!isScored` |
| 完成 seek | **队列序**上第一个 `!isScored && !excluded` 的 card |
| 轮次完成 | 每个 unit family 至少有一个 `isPassed` occurrence（或 completedIds），且无 excluded 未完 |
| 宫殿清空 | 同 family `isPassed`，pending restudy 未插入时算未完 |

完成按钮：

1. `roundComplete` → 结算槽（现行为）
2. 否则 → 队列序第一个 `!isScored`（含跳着做的、含空白新一跳重练）
3. 无未评但轮次未完（全是弱评、下一跳还没插入）→ **null，按钮禁用**；leave 插入空白重练后按钮恢复
4. 已在目标上 → null

文案：未完成时「定位到最早还没评分的单元」。

### 2.3 进度条

`buildFreestyleProgressSummary` / `visualPlanStatus` / `segmentTone` 改为读 `isScored`：

- `scored` → `done` 实心（弱评与通过同色，产品已定）
- `!scored` → `pending` 空心
- 重练圆点：`scored` 实心琥珀 / `!scored` 淡琥珀（形状仍区分 occurrence_kind）
- viewing 播放头与填色仍独立（架构已有约束）
- 不再用 plan `status==='retry'` 把「已评分弱评」画成未完成

### 2.4 后端 / 写入对齐

同一 occurrence 在「下一跳」时必须回到未评：

- `stampRestudyPlan`：父卡 忘记/困难 **不得** 写入 retry 的 `lastRating`（已部分约束，补测试锁死）。
- 同一 retry occurrence 因再次 忘记/困难 递增 `retry_attempt` 并 leave 重排时：**清空**该 occurrence 的 `lastRating` 与 encounter `selectedRating`（新一跳空白）。
- `applyServerRatingsToRoundPlan`：仅当 occurrence **自己** 的 glance 拥有评分（`retryGlanceOwnsRating` / source 自身）才写 `lastRating`；取消 `unratedRetries` 以外的 source 回落写入。
- 后端 `round_plan.apply_rating` / occurrence 字段语义与上表一致：`rating` 属 occurrence，不跨 id 继承。

### 2.5 兼容迁移

- `getFreestyleRatedCardIds` / `findEarliestUnratedIndex` / `getFreestylePassedCardIds` 保留导出名，内部改调 2.1，避免一轮改穿全部调用方。
- `findEarliestCompleteSeekIndex` = 队列序第一个未评（删掉 family 回退层）。
- `freestylePalaceClearance` 的 `isHandled` 改为 `isScored/isPassed` + pendingRestudy。

**测试契约（锁语义，防再分叉）：**

1. source 弱评、retry 无 glance：source `isScored`，retry `!isScored`，完成 → retry
2. retry 自己评困难：retry `isScored`；后面空白卡 `!isScored`，完成 → 后者（不是 retry）
3. 同一 retry attempt++ 重排后：score 清空，完成可再次落到它
4. 空 amend（encounter 空、completedIds 有）：`isScored` 且进度条实心
5. 进度条 fill 与 `isScored` 对同一 fixture 逐卡相等（契约测试）

## [S3] Out of Scope

- 不改评分 HTTP API 形状、SRS 间隔公式、测验交互。
- 不回滚进度条动画 CSS / motion WIP（可共存）。
- 不做三档进度条（产品已选「已评分就填实心」）。

## Tasks

- [x] T1: `unitProgressState.ts` 单一内核 + 导出 — acceptance: 纯函数测试覆盖 score/isScored/isPassed 优先级 (covers: S2.1)
- [x] T2: seek / 进度条 / 宫殿清空改读内核 — acceptance: 契约测试 1–5 全过；进度条与 seek 对同一 fixture 一致 (covers: S2.2 S2.3 S2.5; depends: T1)
- [x] T3: 后端写入对齐（retry 下一跳清分、禁止 source 继承） — acceptance: 后端 pytest + 前端 serverRoundPlan 测试锁 (covers: S2.4; depends: T1)
- [x] T4: 架构文档与门禁 — acceptance: freestyle-immersive-feed 写明唯一内核；check_architecture 禁止新的 scored 条件拼装 (covers: S2; depends: T2)
