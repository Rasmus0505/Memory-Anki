---
编号: 07-07
标题: 抽取共享做题编排逻辑，去除 FreestylePage 与 usePalaceQuizPractice 的重复 attempt 流程
类型: 删减
范围: 前端
优先级: P1
预估工作量: M（2-8h）
依赖文档: 08-01（拆分 FreestylePage）需先行
状态: 已完成
负责代理: Codex
完成时间: 2026-07-09
---

## 1. 原始需求

`apps/web/src/features/freestyle/FreestylePage.tsx`（1652 行）直接 import 了 palace-quiz 的三件套——`QuizQuestionInteraction`（第 67-70 行）、`PalaceQuizMemoryLookupDialog`（第 64 行）、`emitQuizResultFeedback`（第 71 行）——组件层复用了，但**编排层（attempt 流程）整段重写**，与 `apps/web/src/features/palace-quiz/hooks/usePalaceQuizPractice.ts`（169 行）重复。已逐段比对，两处逻辑差异如下：

| 逻辑 | usePalaceQuizPractice.ts | FreestylePage.tsx | 差异实质 |
|---|---|---|---|
| 选择题作答上报 | `handleChoiceSelect`（79-101 行）：调 `recordPalaceQuizChoiceAttemptApi` → 更新题目列表 → `emitQuizResultFeedback` | `handleChoiceResolve`(1203-1218 行)：同一 API → `updateFeedQuestion` → `toast.success`；对错反馈另由 1046-1069 行的 effect 统一发 `emitQuizResultFeedback` | 反馈触发时机不同（内联 vs 副作用集中），API 调用与错误 toast 完全相同 |
| 简答题 AI 点评 | `handleShortAnswerFeedback`（114-157 行） | `handleShortAnswerFeedback`（1220-1265 行） | **近乎逐行相同**：同一 `promptForAiOptions({ scenarioKey: 'quiz_short_answer_feedback', ... })`、同一 `requestPalaceShortAnswerFeedbackApi`、同一四种 dispatchGlobalFeedback 事件序列；仅 `entrypointKey`（`'quiz-short-answer-feedback'` vs `'freestyle-short-answer-feedback'`）与状态写入函数不同 |
| 题目运行时状态 | 组件内 `useState<Record<number, QuizRuntimeState>>`（27 行） | `updateQuestionState`（1164-1191 行）写入 localStorage 持久化进度并维护连对 streak | **真实分叉点**：状态存储介质与副作用不同 |

结论：状态存储属合理分叉，但"作答上报 + AI 点评"两段编排是复制粘贴，任何一处改 API 签名或反馈事件序列，另一处都会被漏改（现状已出现漂移：freestyle 一侧 choice 正确时多了 `toast.success('回答正确')`，palace-quiz 一侧没有）。目标是抽取一个参数化的共享编排 hook，两侧仅注入各自的状态适配器。

**依赖说明：08-01（拆分 FreestylePage）必须先完成。** 1652 行的 FreestylePage 内 attempt 逻辑与 feed、进度持久化、里程碑彩带等强耦合，先拆分再抽取共享 hook 才能保证 diff 可审查。本文档执行时若 08-01 未完成，状态改"已阻塞"。

## 2. 详细执行清单

> 不要做什么：不要合并两侧的状态存储（palace-quiz 的内存态与 freestyle 的 localStorage 持久化保持各自现状）；不要改 `QuizQuestionInteraction` 组件的 props 协议；不要动 1046-1109 行 freestyle 的里程碑/彩带 effect（那是 freestyle 独有功能）；不要在本次顺手做 08-01 的拆分。

1. 前置确认：查看 fable 08-01 文档状态为"已完成"，且 `FreestylePage.tsx` 已拆出独立的做题相关 hook/组件文件。若未完成，停止并在进度记录标"已阻塞（等待 08-01）"。
2. 新建 `apps/web/src/features/palace-quiz/hooks/useQuizAttemptOrchestration.ts`，抽取两段共享编排。签名设计（以核实过的两侧现状为准，落地时按 08-01 拆分后的实际文件微调）：

   ```ts
   import { toast } from '@/shared/feedback/toast'
   import type { PalaceQuizQuestion, AiRuntimeOptions } from '@/shared/api/contracts'
   import type { QuizRuntimeState } from '@/features/palace-quiz/QuizQuestionInteraction'
   import {
     recordPalaceQuizChoiceAttemptApi,
     requestPalaceShortAnswerFeedbackApi,
   } from '@/entities/quiz/api'

   export interface QuizAttemptAdapter {
     /** 把服务端返回的最新题目写回列表（两侧实现不同：setQuestions vs updateFeedQuestion）。 */
     applyUpdatedQuestion: (question: PalaceQuizQuestion) => void
     /** 更新单题运行时状态（两侧实现不同：useState vs localStorage 持久化）。 */
     updateQuestionState: (
       questionId: number,
       updater: (current: QuizRuntimeState) => QuizRuntimeState,
     ) => void
     readQuestionState: (questionId: number) => QuizRuntimeState
     /** 全局反馈出口（palace-quiz 用 emitQuizFeedback 包装，freestyle 直接 dispatchGlobalFeedback）。 */
     emitFeedback: (event: string, options?: { label?: string; audioScope?: 'local' | 'global'; screenPulse?: null }) => void
     promptForAiOptions: (options: {
       scenarioKey: string
       entrypointKey: string
       title: string
     }) => Promise<AiRuntimeOptions | null | undefined>
     /** AI 点评弹窗的入口标识，两侧唯一的文案级差异。 */
     shortAnswerEntrypointKey: string
   }

   export function useQuizAttemptOrchestration(adapter: QuizAttemptAdapter) {
     const submitChoiceAttempt = (questionId: number, optionId: string) =>
       recordPalaceQuizChoiceAttemptApi(questionId, optionId)
         .then((response) => {
           adapter.applyUpdatedQuestion(response.question)
           return response
         })
         .catch((error) => {
           adapter.emitFeedback('quiz_error_stat_failed', { label: '统计失败', audioScope: 'local' })
           toast.error(error instanceof Error ? error.message : '统计刷新失败。')
           return null
         })

     const requestShortAnswerFeedback = async (question: PalaceQuizQuestion) => {
       const userAnswer = adapter.readQuestionState(question.id).shortAnswerText?.trim() || ''
       if (!userAnswer) {
         adapter.emitFeedback('quiz_error_missing_input', { label: '先写答案', audioScope: 'local' })
         toast.error('请先填写你的答案。')
         return
       }
       adapter.emitFeedback('quiz_generate_start', { label: 'AI点评', audioScope: 'global' })
       adapter.updateQuestionState(question.id, (s) => ({ ...s, shortAnswerFeedbackLoading: true }))
       try {
         const aiOptions = await adapter.promptForAiOptions({
           scenarioKey: 'quiz_short_answer_feedback',
           entrypointKey: adapter.shortAnswerEntrypointKey,
           title: '简答题 AI 点评配置',
         })
         if (!aiOptions) {
           adapter.updateQuestionState(question.id, (s) => ({ ...s, shortAnswerFeedbackLoading: false }))
           adapter.emitFeedback('quiz_generate_cancel', { label: '取消AI', audioScope: 'global' })
           return
         }
         const feedback = await requestPalaceShortAnswerFeedbackApi(question.id, userAnswer, aiOptions)
         adapter.updateQuestionState(question.id, (s) => ({
           ...s,
           shortAnswerFeedback: feedback,
           shortAnswerFeedbackLoading: false,
         }))
         adapter.emitFeedback('quiz_result_ai_feedback_ready', { label: 'AI完成', audioScope: 'global' })
       } catch (error) {
         adapter.updateQuestionState(question.id, (s) => ({ ...s, shortAnswerFeedbackLoading: false }))
         adapter.emitFeedback('quiz_error_ai_failed', { label: 'AI失败', audioScope: 'global' })
         toast.error(error instanceof Error ? error.message : 'AI 点评失败。')
       }
     }

     return { submitChoiceAttempt, requestShortAnswerFeedback }
   }
   ```

   - 自查点：新文件只依赖 entities/shared 与 palace-quiz 自身类型，不 import freestyle（方向必须是 freestyle → palace-quiz，与现状一致，boundaries 不报错）。
3. 改造 `usePalaceQuizPractice.ts`：
   - `handleChoiceSelect` 内把 79-101 行的 API 调用/错误处理替换为 `submitChoiceAttempt(question.id, optionId).then((response) => { if (response) { emitQuizResultFeedback({ correct: isCorrect }); emitQuizFeedback('quiz_result_reveal', ...) } })`——保留其"内联揭晓反馈"的现状时序；
   - `handleShortAnswerFeedback` 整段（114-157 行）删除，改为调 `requestShortAnswerFeedback(question)`，adapter 的 `shortAnswerEntrypointKey` 传 `'quiz-short-answer-feedback'`；
   - `registerQuizActivity` 调用保留在包装层（编排 hook 不感知计时器）。
   - 自查点：`npx vitest run src/features/palace-quiz` 全绿。
4. 改造 freestyle 一侧（08-01 拆分后的做题 hook 文件；若仍在 FreestylePage.tsx 则对应 1203-1218 与 1220-1265 行）：
   - `handleChoiceResolve` 替换为 `submitChoiceAttempt(card.question.id, optionId)`，保留 `timer.registerActivity` 与 `isCorrect && toast.success('回答正确')` 在包装层；
   - `handleShortAnswerFeedback` 整段删除，改为调 `requestShortAnswerFeedback(card.question)`，`shortAnswerEntrypointKey` 传 `'freestyle-short-answer-feedback'`；
   - 1046-1069 行 effect 中的 `emitQuizResultFeedback` 集中触发**保持不动**。
   - 自查点：`npx vitest run src/features/freestyle` 全绿。
5. 删除安全检查（确认旧的重复段已无残留）：
   - 命令：`cd apps/web && rg -n "requestPalaceShortAnswerFeedbackApi" src/features`
   - 期望结果：只剩 `useQuizAttemptOrchestration.ts` 一处（entities 层定义处不在 src/features 下，不会命中）。
6. 同步检查测试 mock：`cd apps/web && rg -n "requestPalaceShortAnswerFeedbackApi|recordPalaceQuizChoiceAttemptApi" src --glob "*test*"`，把命中的 mock 目标模块改为与新 import 来源一致（参照 07-02 第 12 步的做法）。

## 3. 测试验收标准

- `cd apps/web && npm run typecheck && npm run test && npm run lint && npm run build` → 全部通过。
- 行为验收：
  - `/palaces/{id}/quiz`：作答一道选择题 → 选项揭晓、对错音效/反馈出现、题目统计数字刷新；简答题填写后点"AI 点评" → loading → 点评内容渲染；点"重做" → 状态清空。
  - `/freestyle`：作答一道选择题 → 答对出 `回答正确` toast、进度持久化（刷新页面后已答题保持）；连对达到里程碑步数 → 彩带动画仍触发；简答题 AI 点评流程同上。
  - 断网状态作答选择题 → 出现"统计刷新失败"错误 toast（两页一致）。
- 回归检查：`FreestylePage.test.tsx`、`QuizQuestionInteraction.test.tsx`、`PalaceQuizPage.core.test.tsx` 全绿；freestyle 的 localStorage 进度键值结构不变（老进度可无损读回）。

## 4. 进度记录（交接用）

| 时间 | 执行者 | 动作 | 结果/备注 |
|---|---|---|---|
| 2026-07-08 22:30 | 文档撰写代理 | 文档创建 | 已比对两侧 attempt 流程逐段差异（见第 1 节表格）；确认依赖 08-01 先行 |
| 2026-07-09 | Codex | 完成共享编排抽取 | 已确认 08-01 状态为已完成，`FreestylePage.tsx` 已拆至约 292 行；真实 freestyle 做题编排位于 `apps/web/src/features/freestyle/hooks/useFreestyleQuizFlow.ts`，卡片组件位于 `components/FreestyleQuizCardView.tsx`。新增 `apps/web/src/features/palace-quiz/hooks/useQuizAttemptOrchestration.ts`，通过 adapter 注入状态读写与题目回写；共享 hook 不 import freestyle。`usePalaceQuizPractice.ts` 保留内存态与 reset/remove 私有逻辑，选择题 immediate feedback 不变；`useFreestyleQuizFlow.ts` 复用共享 hook，freestyle 的外部结果 feedback effect、toast、持久化、历史记录与连击里程碑逻辑保留。功能代码中 `recordPalaceQuizChoiceAttemptApi` / `requestPalaceShortAnswerFeedbackApi` 的 feature 直接调用已收敛到共享 hook。 |
| 2026-07-09 | Codex | 测试验收 | `cd apps/web && npm run test -- src/features/palace-quiz src/features/freestyle` 通过：8 files / 75 tests passed。`cd apps/web && npm run typecheck` 未通过，但失败点在 05-03 generation recovery 相关的 `PalaceQuizPage.tsx` props 缺口：`canRetryLastGeneration`、`onRetryLastGeneration`、`onRecoverFromLog`、`onRecoverGenerationHistoryPreview` 缺失；该范围已有其他 worker 处理，本任务未修改。 |
