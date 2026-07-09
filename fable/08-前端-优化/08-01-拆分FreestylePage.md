---
编号: 08-01
标题: 拆分 1655 行的 FreestylePage 巨型组件为页面壳 + 3 个 hooks + 独立子组件
类型: 优化
范围: 前端
优先级: P0
预估工作量: L（>8h）
依赖文档: 无（可独立执行；若同时执行 08-14 色板迁移，先完成本文档再做 08-14）
状态: 已完成
负责代理: Codex
完成时间: 2026-07-09
---

# 08-01 拆分 FreestylePage

## 1. 原始需求

`apps/web/src/features/freestyle/FreestylePage.tsx` 目前有 1655 行，是全库最大的页面组件。它在单文件里同时承担：信息流加载（自由模式 + 今日训练双模式三路请求）、答题编排（7 种题型的状态更新与上报）、两个设置弹窗、庆祝/里程碑特效、键盘与滚动导航、计时器注册。文件内共 15 处 `useState`（主组件 14 个 + `usePrefersReducedMotion` 内 1 个）、13 个 `useCallback`、9 个 `useEffect`。

好消息是纯逻辑已有归宿：`model/freestyle.ts`（347 行，队列构建/配置持久化）和 `model/today-training.ts`（323 行，今日训练队列/汇总）都已存在且有独立测试 `model/freestyle.test.ts`。同时 `FreestylePage.test.tsx` 有 968 行、27 个测试用例，全部通过组件对外行为（渲染文案、testid、localStorage 副作用）断言，**不依赖内部实现结构**——这是本次拆分的安全网。

目标：页面壳 `FreestylePage.tsx` 降到 300 行以内；数据加载、今日训练、答题流程各自成为独立 hook；展示子组件移入 `components/`。**不改任何行为**。

## 原文件职责分区表（行号范围 → 目标新文件）

行号以当前 `apps/web/src/features/freestyle/FreestylePage.tsx`（1655 行版本）为准，执行前先用编辑器确认代码内容能对上，允许 ±5 行漂移。

| 行号范围 | 现有内容 | 目标新文件 |
|---|---|---|
| 1-116 | import 区 | 留在原文件，拆分后按需精简 |
| 118-180 | 常量映射（CONTENT_TYPE_LABELS、RANGE_LABELS、ORDER_MODE_LABELS、ACTION_FREQUENCY_LABELS、MODE_LABELS、QUESTION_TYPE_DISPLAY、QUESTION_TYPE_ACCENT、QUESTION_TYPE_OPTIONS） | `model/freestyle-labels.ts`（新建） |
| 182-193 | `isQuizCard` / `isActionCard` / `stringListsEqual` | `model/freestyle-cards.ts`（新建） |
| 195-239 | `buildAttemptAnswerPayload` / `buildAttemptHistoryPayload` | `model/freestyle-attempts.ts`（新建） |
| 241-272 | `flattenPalaceOptions` | `model/freestyle-cards.ts` |
| 274-299 | `formatTimer` / `buildFreestyleLoadDiagnosticText` | `model/freestyle-cards.ts` |
| 301-307 | `FreestyleFeedErrorDescription` 小组件 | `components/FreestyleFeedStates.tsx`（新建，第 6 批） |
| 309-326 | `usePrefersReducedMotion` | `hooks/usePrefersReducedMotion.ts`（新建；注意 `GlobalTimerProvider.tsx` 80-97 行有一份重复实现，本文档只搬 freestyle 这份，不动那份） |
| 328-335 | `uniquePalaceContexts` | `model/freestyle-cards.ts` |
| 337-367 | `IconButton` | `components/FreestyleIconButton.tsx`（新建） |
| 369-554 | `FreestyleSettingsDialog` | `components/FreestyleSettingsDialog.tsx`（新建） |
| 556-618 | `TodayTrainingSettingsDialog` | `components/TodayTrainingSettingsDialog.tsx`（新建） |
| 620-650 | `FreestyleActionCardView` | `components/FreestyleActionCardView.tsx`（新建） |
| 652-714 | `FreestyleRoundSummaryCard` | `components/FreestyleRoundSummaryCard.tsx`（新建） |
| 716-800 | `FreestyleQuizCardView` | `components/FreestyleQuizCardView.tsx`（新建） |
| 802-844 | 主组件：state/refs 声明 + timer 注册 | 留在页面壳，部分 state 随 hook 迁走 |
| 846-886 | queue/currentCard/palaceOptions 派生 | `hooks/useTodayTraining.ts` 与页面壳分摊 |
| 888-970 | 持久化 setter + `loadFeed`/`loadTodayFeed`/复制诊断 | `hooks/useFreestyleFeed.ts`（新建） |
| 972-1044 | 加载 effect、palace options effect、进度同步 effect、timer 场景 effect、滚动定位 effect | 分别随 `useFreestyleFeed` / 页面壳 |
| 1046-1109 | 新解题上报 + 里程碑庆祝 effect | `hooks/useFreestyleQuizFlow.ts`（新建） |
| 1111-1351 | goToIndex/清进度/滚动/updateQuestionState/选择题上报/简答 AI 点评/重洗/切模式/键盘 | `hooks/useFreestyleQuizFlow.ts`（答题类）与页面壳（导航类）分摊 |
| 1353-1655 | JSX：弹窗挂载 + 顶部 HUD + 卡片流 + 底部工具条 + 统计条 | 页面壳（卡片流循环留壳，HUD/工具条可在第 6 批酌情抽出） |

## 2. 详细执行清单

总原则（每批都适用）：

- 每批做完必须跑 `cd apps/web && npx vitest run src/features/freestyle/FreestylePage.test.tsx src/features/freestyle/model/freestyle.test.ts`，27 + 17 个用例必须全绿再进下一批。
- 搬移代码时**复制原实现，不做任何"顺手改进"**：不改类名、不改文案、不改依赖数组、不改 localStorage 键。
- 新文件一律放在 `apps/web/src/features/freestyle/` 下的 `model/`、`hooks/`、`components/` 子目录，不要放到 `shared/`。
- 不要动 `model/freestyle.ts`、`model/today-training.ts`、`api/freestyleApi.ts`、`FreestylePage.test.tsx`（测试文件一行都不许改，它是行为基准）。

### 第 1 批：纯常量与纯函数下沉（无 React 依赖，风险最低）

1. 新建 `apps/web/src/features/freestyle/model/freestyle-labels.ts`，把原文件 118-180 行的 8 个常量原样剪切进去，逐个加 `export`。该文件只 import 类型：

```ts
import type { FreestyleContentType, FreestyleQuestionTypeFilter } from '@/shared/api/contracts'
import type { FreestyleConfig, FreestyleOrderMode, FreestyleActionFrequency } from '@/features/freestyle/model/freestyle'
import type { FreestyleMode } from '@/features/freestyle/model/today-training'
```

2. 新建 `apps/web/src/features/freestyle/model/freestyle-cards.ts`，剪切并 export：`isQuizCard`（182-184）、`isActionCard`（186-188）、`stringListsEqual`（190-193）、`flattenPalaceOptions`（241-272）、`formatTimer`（274-278）、`buildFreestyleLoadDiagnosticText`（280-299，注意它引用 `MODE_LABELS`，从 `freestyle-labels.ts` import）、`uniquePalaceContexts`（328-335）。
3. 新建 `apps/web/src/features/freestyle/model/freestyle-attempts.ts`，剪切并 export：`buildAttemptAnswerPayload`（195-218）、`buildAttemptHistoryPayload`（220-239）。
4. 回到 `FreestylePage.tsx`，删除被剪切的代码，在文件顶部补上对应 import。修改前后示意（顶部 import 区）：

修改前：
```tsx
const CONTENT_TYPE_LABELS: Record<FreestyleContentType, string> = { ... }
// ...
function isQuizCard(card: FreestyleCard | null | undefined): card is FreestyleQuizCard { ... }
```

修改后：
```tsx
import {
  ACTION_FREQUENCY_LABELS,
  CONTENT_TYPE_LABELS,
  MODE_LABELS,
  ORDER_MODE_LABELS,
  QUESTION_TYPE_ACCENT,
  QUESTION_TYPE_DISPLAY,
  QUESTION_TYPE_OPTIONS,
  RANGE_LABELS,
} from '@/features/freestyle/model/freestyle-labels'
import {
  buildFreestyleLoadDiagnosticText,
  flattenPalaceOptions,
  formatTimer,
  isActionCard,
  isQuizCard,
  stringListsEqual,
  uniquePalaceContexts,
} from '@/features/freestyle/model/freestyle-cards'
import { buildAttemptHistoryPayload } from '@/features/freestyle/model/freestyle-attempts'
```

- 不要做什么：不要在这一批里改任何组件/hook 代码；不要给纯函数补新测试之外的行为。
- 自查点：`npm run typecheck` 通过；上述 vitest 命令全绿；`FreestylePage.tsx` 行数降到约 1400 行。

### 第 2 批：展示子组件搬到 components/

5. 逐个新建以下文件，每个文件 = 原样剪切的组件 + 其独占的 import（图标、Button、Badge、Dialog 系列、cn 等），并加 `export`：
   - `components/FreestyleIconButton.tsx` ←（337-367 行 `IconButton`，导出名改为 `FreestyleIconButton` 会破坏 grep 对照，**保持原名 `IconButton` 导出**）
   - `components/FreestyleSettingsDialog.tsx` ←（369-554 行）
   - `components/TodayTrainingSettingsDialog.tsx` ←（556-618 行）
   - `components/FreestyleActionCardView.tsx` ←（620-650 行）
   - `components/FreestyleRoundSummaryCard.tsx` ←（652-714 行）
   - `components/FreestyleQuizCardView.tsx` ←（716-800 行）
6. `FreestylePage.tsx` 中补 import，删除原实现。注意 `FreestyleQuizCardView` 依赖 `QUESTION_TYPE_ACCENT`、`QUESTION_TYPE_DISPLAY`（从 `freestyle-labels.ts` import）和 `QuizQuestionInteraction`；`FreestyleRoundSummaryCard` 依赖 `formatTimer`。
- 不要做什么：不要合并这 6 个组件到一个文件（后续按需 lazy 加载时要独立）；不要改任何 className。
- 自查点：vitest 全绿（尤其 `splits mobile freestyle actions into navigation and utility groups`、`shows a today training summary after the fixed round is completed` 两个用例直接覆盖这些组件）；`FreestylePage.tsx` 降到约 950 行。

### 第 3 批：useFreestyleFeed（数据加载 hook）

7. 新建 `apps/web/src/features/freestyle/hooks/useFreestyleFeed.ts`。迁入以下 state 与逻辑（原行号）：`feedCards`/`todaySources`/`feedLoading`/`feedError`/`palaceOptionsData` 五个 useState（807-810、816）、`loadFeed`（909-924）、`loadTodayFeed`（926-960）、`feedDiagnosticText` useMemo（877-886）、`handleCopyFeedDiagnostics`（962-970）、三个加载 effect（972-994）、`updateFeedQuestion`（1193-1201）、`palaceOptions` useMemo（872-876）。签名：

```ts
export function useFreestyleFeed({
  mode,
  config,
  todayConfig,
}: {
  mode: FreestyleMode
  config: FreestyleConfig
  todayConfig: TodayTrainingConfig
}) {
  // ...原实现...
  return {
    feedCards, todaySources, feedLoading, feedError,
    palaceOptions, feedDiagnosticText,
    loadFeed, loadTodayFeed, handleCopyFeedDiagnostics,
    updateFeedQuestion,
    setFeedError, setFeedLoading, // handleReshuffle / switchMode 需要
  }
}
```

8. 页面壳里替换为 `const feed = useFreestyleFeed({ mode, config, todayConfig })`，所有引用点改为 `feed.xxx`。
- 不要做什么：不要把 `loadFeed` 的错误文案（"加载随心队列失败。"/"加载今日训练失败。"）改字；不要调整 `Promise.all` 三路请求的顺序。
- 自查点：vitest 全绿（`shows actionable diagnostics when the mobile PWA feed load fails`、`does not overwrite the saved card index while the freestyle feed is still loading` 直接覆盖此 hook）。

### 第 4 批：useFreestyleQuizFlow（答题状态 + 上报 + 庆祝）

9. 新建 `apps/web/src/features/freestyle/hooks/useFreestyleQuizFlow.ts`。迁入：`progress` useState 与三个 ref（817-824）、`setProgressAndPersist`（896-907）、`updateQuestionState`（1164-1191）、`handleChoiceResolve`（1203-1218）、`handleShortAnswerFeedback`（1220-1265）、`handleClearLocalProgress`（1125-1145）、新解题上报 + 里程碑庆祝 effect（1046-1109）。hook 入参需要 `mode`、`queue`、`timer`、`reducedMotion`、`promptForAiOptions`、`updateFeedQuestion`。
10. 该 hook 返回 `progress`、`setProgress`、`setProgressAndPersist`、`updateQuestionState`、`handleChoiceResolve`、`handleShortAnswerFeedback`、`handleClearLocalProgress`、`answeredQuestionIds`、以及供 `switchMode`/`handleReshuffle` 重置内部 ref 的 `resetRuntimeRefs(nextProgress)`（把原 1141-1142、1302-1304 里对 `previousResolvedQuestionIdsRef`/`queuePriorityResolvedIdsRef`/`emittedMilestonesRef` 的重置收拢为一个函数）。`queuePriorityResolvedIdsRef` 要暴露出来给 queue useMemo 使用（返回 `queuePriorityResolvedIdsRef` 本身即可）。
- 不要做什么：不要改里程碑判断逻辑（`milestoneSteps.includes(currentStreak)`）；不要把 `createFreestyleQuestionAttemptApi` 的 fire-and-forget 改成 await。
- 自查点：vitest 全绿（`emits correct and incorrect result feedback only when a card is first resolved`、`fires milestone confetti once...`、`emits short-answer AI start, success, cancel, and failure feedback` 等 8 个用例直接覆盖）。

### 第 5 批：useTodayTraining（模式与队列派生）+ 页面壳收尾

11. 新建 `apps/web/src/features/freestyle/hooks/useTodayTraining.ts`。迁入：`mode`/`config`/`todayConfig` useState（804-806）、`setConfigAndPersist`/`setTodayConfigAndPersist`（888-894）、queue/queueSignature/summaryVisible/currentIndex/currentCard 派生（846-871）、进度同步 effect（996-1024）、`todaySummary`（1309-1312）、`handleReshuffle`（1267-1295）、`switchMode`（1297-1307）。`handleReshuffle`/`switchMode` 内对答题 ref 的操作改为调用第 4 批暴露的 `resetRuntimeRefs`。
12. 页面壳 `FreestylePage.tsx` 最终只保留：`useRouteResidency`、timer 注册（829-844）、UI 开关 state（settingsOpen/todaySettingsOpen/memoryLookupOpen/explainSheetOpen/historyOpen）、`scrollRef`/`cardRefs`、`goToIndex`/`handleScroll`/`handleKeyDown`、滚动定位 effect（1037-1044）、timer 场景两个 effect（1026-1035）与 JSX。
- 自查点：vitest 全绿（今日训练 8 个用例：`opens in today training mode by default...`、`restores the same today round and card position after reopening` 等）；`wc -l` 确认 `FreestylePage.tsx` ≤ 300 行（若略超，把顶部 HUD 与底部工具条 JSX 抽成 `components/FreestyleHudBar.tsx` 与 `components/FreestyleActionRail.tsx`，作为可选第 6 批）。

### 第 6 批（可选）：HUD 与错误/空状态 JSX 抽离

13. 若第 5 批后页面壳仍 >300 行：把 1398-1455 行（顶部模式切换 + 进度胶囊）抽成 `components/FreestyleHudBar.tsx`；把 1472-1545 行（加载失败/空队列两个 EmptyState 分支）抽成 `components/FreestyleFeedStates.tsx`；把 1591-1643 行（底部按钮组）抽成 `components/FreestyleActionRail.tsx`。props 全部显式传入，不引入 context。
- 自查点：vitest 全绿；`data-testid="freestyle-mobile-actions"` 保留在原 DOM 位置。

## 3. 测试验收标准

```powershell
cd D:\322321\Memory-Anki\apps\web
npx vitest run src/features/freestyle   # 期望：FreestylePage.test（27 用例）+ freestyle.test（17 用例）全绿
npm run typecheck                        # 期望：0 错误
npm run test                             # 期望：97 个测试文件全部通过
npm run lint                             # 期望：无新增错误（boundaries 规则尤其不能报）
npm run build                            # 期望：构建成功
```

行为验收（`npm run dev` 后手动操作）：

- 打开 `/freestyle` → 默认进入"今日训练"模式，顶部胶囊显示 `n/12` 进度与计时。
- 答对一道选择题 → toast"回答正确"，连对计数出现；连答到里程碑步数 → 撒花一次且只一次。
- 点右侧"设置"→ 弹出对应模式的设置弹窗；切换"内容范围"后队列重新加载。
- 切到"自由随心"再切回"今日训练"→ 各自的进度、当前卡片位置互不覆盖。
- 断网加载 → 显示"队列加载失败"+"复制诊断"按钮可复制诊断文本。
- 刷新页面 → 回到之前的卡片位置（localStorage 恢复）。

回归检查：`memory-anki.freestyle.config`、`memory-anki.freestyle.progress`、`memory-anki.freestyle.today.config`、`memory-anki.freestyle.today.progress` 四个 localStorage 键的读写格式不变；全局计时器（GlobalTimerProvider 悬浮面板）在本页仍显示"随心模式"场景。

## 4. 进度记录（交接用）

| 时间 | 执行者 | 动作 | 结果/备注 |
|---|---|---|---|
| - | - | 文档创建 | 分 6 批，每批跑 freestyle 目录测试 |
| 2026-07-09 | Codex | 完成第 1 批：纯常量与纯函数下沉 | 新增 `model/freestyle-labels.ts`、`model/freestyle-cards.ts`、`model/freestyle-attempts.ts`，`FreestylePage.tsx` 降至约 1420 行；Freestyle targeted vitest 通过（41 tests）。`npm run typecheck` 仍失败于范围外 `src/shared/hooks/useTimedSession.ts(528,34): Cannot find name 'formatLocalApiDateTime'`，未修改 session hooks。 |
| 2026-07-09 | Codex | 完成第 2 批：展示子组件搬到 `components/` | 新增 `FreestyleIconButton.tsx`、`FreestyleSettingsDialog.tsx`、`TodayTrainingSettingsDialog.tsx`、`FreestyleActionCardView.tsx`、`FreestyleRoundSummaryCard.tsx`、`FreestyleQuizCardView.tsx`，保持原 props/文案/className；`FreestylePage.tsx` 降至 986 行；指定 vitest 通过（41 tests）。 |
| 2026-07-09 | Codex | 完成第 3 批：抽出 `useFreestyleFeed` | 新增 `hooks/useFreestyleFeed.ts`，迁入 feed state、自由/今日训练加载、诊断复制、宫殿选项加载和 `updateFeedQuestion`；`FreestylePage.tsx` 降至 874 行；指定 vitest 通过（41 tests），`npm run typecheck` 通过。整体仍进行中，下一批为 `useFreestyleQuizFlow`。 |
| 2026-07-09 | Codex | 完成第 4 批：抽出 `useFreestyleQuizFlow` | 新增 `hooks/useFreestyleQuizFlow.ts`，迁入 progress state/ref、持久化 setter、答题状态更新、选择题上报、简答 AI 点评、清进度、新解题上报与里程碑庆祝；指定 vitest 通过（41 tests）。 |
| 2026-07-09 | Codex | 完成第 5 批：抽出 `useTodayTraining` | 新增 `hooks/useTodayTraining.ts`，迁入队列派生、进度同步、配置持久化 setter、重洗、模式切换和今日训练 summary；指定 vitest 通过（41 tests）。 |
| 2026-07-09 | Codex | 完成第 6 批：页面壳收尾 | 新增 `FreestyleHudBar.tsx`、`FreestyleFeedStates.tsx`、`FreestyleActionRail.tsx`、`FreestyleCardScroller.tsx`、`FreestyleDialogsHost.tsx`、`hooks/usePrefersReducedMotion.ts`；`FreestylePage.tsx` 降至 292 行；修复 `timer.status` 包含 `completed` 的 typecheck 类型问题；指定 vitest、`npm run typecheck`、`npm run test -- --run` 均通过。 |
