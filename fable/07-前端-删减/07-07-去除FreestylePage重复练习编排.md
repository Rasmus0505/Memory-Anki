---
编号: 07-07
标题: 去除 FreestylePage 与 usePalaceQuizPractice 重复的答题编排逻辑，下沉为共享 hook
类型: 删减
范围: 前端
优先级: P1
预估工作量: L（>8h）
依赖文档: 08-01（拆分 FreestylePage）必须先行
状态: 已完成
负责代理: Codex
完成时间: 2026-07-09
---

# 07-07 去除 FreestylePage 重复练习编排

## 1. 原始需求

`apps/web/src/features/freestyle/FreestylePage.tsx`（实测 1575 行，任务原描述 1655 行略有出入）直接 import 了 palace-quiz 的三件套——`QuizQuestionInteraction`（第 68~70 行，第 787 行使用）、`PalaceQuizMemoryLookupDialog`（第 64 行，第 1378 行使用）、`emitQuizResultFeedback`（第 71 行，第 1065 行使用）——并在页面内**重写了一遍**答题 attempt 编排，与 `apps/web/src/features/palace-quiz/hooks/usePalaceQuizPractice.ts`（169 行）大面积重复：

| 编排环节 | usePalaceQuizPractice.ts | FreestylePage.tsx | 差异 |
|---|---|---|---|
| 题目运行时状态 | `useState<Record<number, QuizRuntimeState>>`（第 27 行，内存态） | `updateQuestionState`（第 1164~1191 行，写入 progress 并 localStorage 持久化，额外维护 correctStreak/resolvedQuestionIds） | 状态容器不同 |
| 选择题提交 | `handleChoiceSelect`（第 79~101 行）：调 `recordPalaceQuizChoiceAttemptApi` → 更新题目 → `emitQuizResultFeedback` | `handleChoiceResolve`（第 1203~1218 行）：同一 API → `updateFeedQuestion` → toast | freestyle 的对错反馈改在 effect 里发 |
| 结果反馈 | 提交回调内同步发 | 第 1046~1109 行的 useEffect 监听 resolvedQuestionIds 变化统一发（还叠加连击里程碑 confetti、`createFreestyleQuestionAttemptApi` 历史记录） | 触发时机不同 |
| 简答题 AI 点评 | `handleShortAnswerFeedback`（第 114~157 行） | `handleShortAnswerFeedback`（第 1220~1265 行） | **几乎逐行相同**，仅 entrypointKey（`quiz-short-answer-feedback` vs `freestyle-short-answer-feedback`）与状态写入函数不同 |

两处编排各自演化已出现行为漂移风险（例如错误文案、feedback 事件序列）。目标：把编排逻辑下沉为一个参数化共享 hook，FreestylePage 删除重复实现。

**前置依赖**：`fable/08-前端-优化/08-01`（拆分 FreestylePage）必须先完成——在 1575 行的巨型组件里做逻辑抽取极易改坏；拆分后本文档的改动面会缩小到一个练习编排子模块。若 08-01 未完成，本文档保持"已阻塞"。

## 2. 详细执行清单

### 步骤 1：改动前安全检查——核实重复面与消费者

```powershell
cd D:\322321\Memory-Anki\apps\web
rg -n "usePalaceQuizPractice" src
rg -n "recordPalaceQuizChoiceAttemptApi|requestPalaceShortAnswerFeedbackApi" src --glob "!*.test.*"
rg -n "emitQuizResultFeedback" src --glob "!*.test.*"
```

期望：`usePalaceQuizPractice` 只被 `PalaceQuizPage.tsx`（第 74 行）消费；两个 attempt API 的非测试调用方只有 `usePalaceQuizPractice.ts` 与 `FreestylePage.tsx`（08-01 拆分后可能变成 freestyle 的某个 hook 文件，按实际为准）；`emitQuizResultFeedback` 调用方只有这两处。

- **自查点**：重复面与上表一致；若 08-01 已把 freestyle 编排移进独立 hook 文件，把下文所有"FreestylePage.tsx"替换为该文件。

### 步骤 2：设计共享 hook（放 features/palace-quiz 公共导出，不放 entities）

新建 `apps/web/src/features/palace-quiz/hooks/useQuizAttemptOrchestration.ts`。放这里而不放 `entities/quiz` 的理由：编排依赖 `QuizRuntimeState`（palace-quiz 的组件类型）与全局 feedback 语义，属 feature 层；freestyle 本来就已依赖 palace-quiz 的组件（QuizQuestionInteraction 等），不新增依赖方向。

hook 签名（关键点是**把状态读写抽象成注入的 adapter**，兼容两种状态容器）：

```ts
export interface QuizAttemptStateAdapter {
  getState: (questionId: number) => QuizRuntimeState | undefined
  updateState: (questionId: number, updater: (s: QuizRuntimeState) => QuizRuntimeState) => void
}

export function useQuizAttemptOrchestration(options: {
  adapter: QuizAttemptStateAdapter
  /** AI 点评弹窗入口标识：palace-quiz 传 'quiz-short-answer-feedback'，freestyle 传 'freestyle-short-answer-feedback' */
  shortAnswerEntrypointKey: string
  promptForAiOptions: (o: { scenarioKey: string; entrypointKey: string; title: string }) => Promise<AiRuntimeOptions | null | undefined>
  /** 选择题 API 成功后如何回写题目（palace-quiz 更新 questions 数组，freestyle 更新 feed 卡片） */
  onQuestionUpdated: (question: PalaceQuizQuestion) => void
  /** 结果反馈发射策略：'immediate'（palace-quiz，API 回调里发）| 'external'（freestyle，由页面 effect 统一发） */
  resultFeedbackMode: 'immediate' | 'external'
  registerActivity?: (source: string) => void
  emitFeedback?: (...) => void
}): {
  handleChoiceSelect: (question: PalaceQuizQuestion, optionId: string) => void
  handleShortAnswerSubmit: (questionId: number) => void
  handleShortAnswerFeedback: (question: PalaceQuizQuestion) => Promise<void>
}
```

实现内容以 `usePalaceQuizPractice.ts` 第 79~157 行为蓝本，把差异点全部走 options。`emitQuizResultFeedback` 只在 `resultFeedbackMode === 'immediate'` 时调用。

- 不要在共享 hook 里引入 localStorage/持久化——那是 freestyle adapter 的职责。
- **自查点**：新 hook 文件不 import 任何 freestyle 代码；`npm run typecheck` 通过。

### 步骤 3：usePalaceQuizPractice 改为基于共享 hook 的薄封装

保留 `usePalaceQuizPractice.ts` 的对外签名不变（`PalaceQuizPage.tsx` 无需改动），内部：保留 `useState` 状态容器与 `resetQuestionState`/`removeQuestionStates`/`handleResetQuestionState`（这些是 palace-quiz 特有），把 `handleChoiceSelect`/`handleShortAnswerSubmit`/`handleShortAnswerFeedback` 三个函数体删掉，改为调用 `useQuizAttemptOrchestration`（adapter 用本地 useState 实现，`resultFeedbackMode: 'immediate'`，entrypointKey `'quiz-short-answer-feedback'`）。

- **自查点**：`npx vitest run src/features/palace-quiz` 全绿；`PalaceQuizPage.tsx` 零改动。

### 步骤 4：freestyle 侧删除重复实现

在 freestyle 的编排文件（08-01 拆分后的 hook，或 FreestylePage.tsx）中：

4a. 删除 `handleChoiceResolve`（原第 1203~1218 行）与 `handleShortAnswerFeedback`（原第 1220~1265 行）的函数体，改为调用 `useQuizAttemptOrchestration`：adapter 的 `updateState` 直接绑到现有 `updateQuestionState`（保持 localStorage 持久化与 streak 逻辑不动），`onQuestionUpdated` 绑 `updateFeedQuestion`，`resultFeedbackMode: 'external'`，entrypointKey `'freestyle-short-answer-feedback'`。

4b. **保留** 第 1046~1109 行的结果反馈 effect（含 `createFreestyleQuestionAttemptApi` 历史记录、里程碑 confetti）——这是 freestyle 特有行为，不属于重复面，**不要删**。

4c. 核对被删代码里的每个副作用是否在共享 hook 中有对应（toast 文案 `'统计刷新失败。'`、`timer.registerActivity('practice_interaction', ...)`、`dispatchGlobalFeedback` 各事件），缺了就通过 options 注入，禁止悄悄丢行为。

- 不要动 `QuizQuestionInteraction`、`PalaceQuizMemoryLookupDialog` 的 JSX 使用处。
- **自查点**：freestyle 文件中不再出现 `recordPalaceQuizChoiceAttemptApi`/`requestPalaceShortAnswerFeedbackApi` 的直接调用；`npx vitest run src/features/freestyle` 全绿（`FreestylePage.test.tsx` 的 `vi.mock('@/features/palace-quiz/api')` 需按新调用路径调整）。

### 回滚方式

```powershell
cd D:\322321\Memory-Anki
git checkout -- apps/web/src/features/palace-quiz apps/web/src/features/freestyle
```

（分小 commit 执行：步骤 2、3、4 各一个 commit，出问题 revert 对应 commit。）

## 3. 测试验收标准

```powershell
cd D:\322321\Memory-Anki\apps\web
npm run test        # 期望：全部通过，重点 palace-quiz 与 freestyle 两组
npm run typecheck   # 期望：0 错误
npm run lint        # 期望：0 错误
npm run build       # 期望：构建成功
```

行为验收（两条链路逐一对照，行为必须与改动前一致）：

- `/palaces/:id/quiz`：答对选择题 → 立即出现"揭晓"反馈与统计刷新；答错 → 错误反馈；简答题写答案 → 提交 → AI 点评弹窗（标题"简答题 AI 点评配置"）→ 点评返回。
- `/freestyle`：答对选择题 → toast"回答正确" + 结果反馈（effect 发出）+ 连击里程碑正常触发 confetti；刷新页面 → 已做题目状态从 localStorage 恢复；简答题 AI 点评走 freestyle 自己的 entrypointKey。
- 断网状态答题 → 两处都出现"统计刷新失败。"类错误 toast，页面不崩。

回归检查：freestyle 的做题历史记录（createFreestyleQuestionAttemptApi）仍在题目 resolved 时写入；palace-quiz 的重做（reset）功能不变。

## 4. 进度记录（交接用）

| 时间 | 执行者 | 动作 | 结果/备注 |
|---|---|---|---|
| - | - | 文档创建 | 实测 FreestylePage 1575 行（非 1655）；已阻塞等待 08-01 |
| 2026-07-09 | Codex | 完成共享编排抽取 | 已确认 08-01 状态为已完成，`FreestylePage.tsx` 已拆至约 292 行；真实 freestyle 做题编排位于 `apps/web/src/features/freestyle/hooks/useFreestyleQuizFlow.ts`，卡片组件位于 `components/FreestyleQuizCardView.tsx`。新增 `apps/web/src/features/palace-quiz/hooks/useQuizAttemptOrchestration.ts`，由 adapter 注入状态读写与题目回写；共享 hook 不 import freestyle。`usePalaceQuizPractice.ts` 保留内存态与 reset/remove 私有逻辑，选择题 immediate feedback 不变；`useFreestyleQuizFlow.ts` 复用共享 hook，freestyle 的外部结果 feedback effect、toast、持久化、历史记录与连击里程碑逻辑保留。功能代码中 `recordPalaceQuizChoiceAttemptApi` / `requestPalaceShortAnswerFeedbackApi` 的 feature 直接调用已收敛到共享 hook。 |
| 2026-07-09 | Codex | 测试验收 | `cd apps/web && npm run test -- src/features/palace-quiz src/features/freestyle` 通过：8 files / 75 tests passed。`cd apps/web && npm run typecheck` 未通过，但失败点在 05-03 generation recovery 相关的 `PalaceQuizPage.tsx` props 缺口：`canRetryLastGeneration`、`onRetryLastGeneration`、`onRecoverFromLog`、`onRecoverGenerationHistoryPreview` 缺失；该范围已有其他 worker 处理，本任务未修改。 |
