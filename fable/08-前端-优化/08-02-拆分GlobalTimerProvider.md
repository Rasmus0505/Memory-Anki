---
编号: 08-02
标题: 拆分 1404 行的 GlobalTimerProvider——Provider 状态机与悬浮面板 UI 分离，context 值按 state/actions 拆开
类型: 优化
范围: 前端
优先级: P0
预估工作量: L（>8h）
依赖文档: 无（与 08-03 拆 TimerAutomationDialog 相邻但互不依赖；建议先做本篇）
状态: 未开始
负责代理: 无
完成时间: 无
---

# 08-02 拆分 GlobalTimerProvider

## 1. 原始需求

`apps/web/src/shared/components/session/GlobalTimerProvider.tsx` 目前有 1404 行，在单文件里同时承担五种职责：全局计时器注册 Provider、悬浮面板 UI（含胶囊态）、面板拖拽与 8 方向 resize、休息守卫（break guard）状态机（询问→倒计时→到期→延后）、桌面端 Electron 桥接（snapshot 发布 / command 订阅）。文件内共 20 个 `useState`（Overlay 组件 10 个 + Provider 10 个）、约 30 个 `useEffect`/`useCallback`，休息倒计时期间每 250ms 一次 `setBreakTick` 驱动全量重渲染。

配套测试 `GlobalTimerProvider.test.tsx` 有 1651 行，覆盖注册/暂停/休息守卫/桌面桥接等行为，同样只断言对外行为，可作为拆分安全网。纯逻辑此前已部分下沉（`globalTimerModel.ts` 312 行、`breakGuardModel.ts` 68 行、`break-guard-config.ts` 187 行），本次把剩余的"UI / 状态机 / 桥接"三块分开。

## 原文件职责分区表（行号范围 → 目标新文件）

| 行号范围 | 现有内容 | 目标新文件 |
|---|---|---|
| 1-70 | import 区 | 各新文件按需分摊 |
| 72-78 | `GlobalTimerContextValue` 接口 + createContext | `globalTimerContext.ts`（新建） |
| 80-97 | `usePrefersReducedMotion`（与 FreestylePage 309-326 行重复的第二份实现） | 留原地不动（去重属 08-01 可选项，本篇不做） |
| 99-109 | `createBreakLogId` / `formatTimerSnapshotClock` | `timerSnapshotBuilders.ts`（新建） |
| 111-160 | `buildStudyTimerSnapshot` | `timerSnapshotBuilders.ts` |
| 162-241 | `buildBreakTimerSnapshot` | `timerSnapshotBuilders.ts` |
| 243-862 | `GlobalTimerFloatingOverlay`（面板 UI + 拖拽 resize + 庆祝脉冲 + 自动化弹窗挂载 + createPortal） | `GlobalTimerFloatingOverlay.tsx`（新建），其中 400-499 行指针拖拽/resize 逻辑再抽 `useTimerOverlayDrag.ts` |
| 864-1361 | `GlobalTimerProvider`（注册表 + 三套配置订阅 + 休息守卫状态机 + 桌面桥接 + snapshot 计算） | 主文件保留 Provider；1016-1199 行休息守卫抽 `useBreakGuardMachine.ts`；1322-1347 行桌面桥接抽 `useDesktopTimerBridgeSync.ts` |
| 1363-1407 | `useGlobalTimerRegistration` | `globalTimerContext.ts`（与 context 同文件，保持对外 import 路径兼容见下） |

对外 API 现状（不得破坏）：`GlobalTimerProvider`、`useGlobalTimerRegistration` 两个导出被 `AppProviders.tsx` 和 6 个 feature 页面 import，路径均为 `@/shared/components/session/GlobalTimerProvider`。拆分后主文件必须 re-export，调用方一行不改。

## 2. 详细执行清单

每批完成后跑：`cd apps/web && npx vitest run src/shared/components/session/GlobalTimerProvider.test.tsx`，全绿再继续。所有新文件都放 `apps/web/src/shared/components/session/`。不要修改 `GlobalTimerProvider.test.tsx`、`globalTimerModel.ts`、`breakGuardModel.ts`、`desktopTimerBridge.ts`。

### 第 1 批：snapshot 纯函数下沉

1. 新建 `apps/web/src/shared/components/session/timerSnapshotBuilders.ts`，原样剪切 99-241 行的 `createBreakLogId`、`formatTimerSnapshotClock`、`buildStudyTimerSnapshot`、`buildBreakTimerSnapshot`，逐个加 `export`。import 需要：`formatClock/formatPrimaryProgress/formatIdlePrimaryProgress/GlobalTimerRegistration`（来自 `globalTimerModel`）、`getTimerFocusRule/TIMER_FOCUS_SCENE_LABELS/TimerFocusConfig`、`getTimerAutomationRule/TimerAutomationConfig`、`UnifiedTimerSnapshot`（来自 `desktopTimerBridge`）、`BreakGuardConfig`、`BreakGuardState`。
2. 主文件删除原实现并 import。
- 不要做什么：不要改 snapshot 字段名（Electron 桌面悬浮窗 `TimerOverlayPage` 消费同一结构）。
- 自查点：typecheck + 上述 vitest 全绿。

### 第 2 批：context 与注册 hook 独立成文件

3. 新建 `apps/web/src/shared/components/session/globalTimerContext.ts`：

```ts
import * as React from 'react'
import type { GlobalTimerRegistration } from '@/shared/components/session/globalTimerModel'
import type { TimedSessionController } from '@/shared/hooks/useTimedSession'
import type { TimerFocusScene } from '@/shared/components/session/timer-focus-config'

// state 与 actions 分离：actions 引用永远稳定，注册组件不会因 entries 变化而重渲染
export interface GlobalTimerActions {
  upsertTimer: (entry: GlobalTimerRegistration) => void
  removeTimer: (sessionId: string) => void
  notifyStudyActivity: (sessionId: string) => void
}

export const GlobalTimerActionsContext = React.createContext<GlobalTimerActions | null>(null)

export function useGlobalTimerRegistration(entry: { /* 原 1363-1369 行签名原样 */ }) {
  // 原 1370-1407 行实现原样，仅把 useContext(GlobalTimerContext) 改为 useContext(GlobalTimerActionsContext)
}
```

4. 把原 72-78 行接口与 `React.createContext` 删除；原 1363-1407 行 `useGlobalTimerRegistration` 剪切至新文件。主文件末尾加：

```tsx
export { useGlobalTimerRegistration } from '@/shared/components/session/globalTimerContext'
```

5. Provider 内 `contextValue`（原 1201-1208 行）改用 `GlobalTimerActionsContext.Provider`。这一步就是"context 值拆分（state/actions 分离）"的核心：现状 context 只含三个 action（已是稳定引用），**entries 状态本来就没进 context**，所以只需重命名并确保 `upsertTimer`/`removeTimer`/`notifyStudyActivity` 依然全部由 `useCallback([])` 或稳定依赖包裹（现状即是，保持不变）。
- 不要做什么：不要把 `entries` 或 `timerSnapshot` 塞进 context——悬浮面板通过 props 拿，页面通过注册 hook 拿，不需要新的订阅面。
- 自查点：6 个调用方（FreestylePage 等）不需要任何改动即可编译；vitest 全绿。

### 第 3 批：悬浮面板 UI 拆出

6. 新建 `apps/web/src/shared/components/session/GlobalTimerFloatingOverlay.tsx`，原样剪切 243-862 行整个组件（含 `usePrefersReducedMotion` 的本地副本一起搬走，保持 80-97 行那份删除——两处只留一份，放到 Overlay 文件里，因为 Provider 不再用它）。组件签名不变：`{ entries, snapshot, onCommand }`。加 `export`。
7. 在新文件内，把 400-499 行（`beginDrag`/`beginResize`/`handlePointerMove`/`handlePointerMoveEvent`/`stopPointerInteraction`/window pointer 监听 effect/`toggleCollapsed`）抽成同目录 hook `useTimerOverlayDrag.ts`：

```ts
export function useTimerOverlayDrag(layout: TimerOverlayLayout, persistLayout: PersistLayout) {
  // 原实现原样搬入
  return { beginDrag, beginResize, handlePointerMoveEvent, stopPointerInteraction, toggleCollapsed, suppressCapsuleClickRef }
}
```

8. 主文件 import 新组件。渲染处（原 1352-1358 行）不变。
- 不要做什么：不要改 `memory-anki-global-timer-*` 任何 className（index.css 900-1229 行依赖它们，样式共置化由 08-11 处理）；不要动 8 个 resize 手柄按钮的 aria-label。
- 自查点：vitest 全绿（拖拽/折叠/自定义休息分钟等用例直接覆盖 Overlay）；`GlobalTimerProvider.tsx` 降到约 550 行。

### 第 4 批：休息守卫状态机抽成 hook

9. 新建 `apps/web/src/shared/components/session/useBreakGuardMachine.ts`。迁入 Provider 中所有 break 相关内容：8 个 useState（876-881 中 breakConfig/breakState/breakPaused/breakPausedRemainingMs/breakInterruptedSessionId/breakTick）、对应 ref 镜像（884-889）与同步 effect（893-932 中 break 相关部分）、250ms tick effect（996-1003）、prompt 定时器清理（1005-1014）、以及 1016-1199 行的全部回调（`openTarget`/`finishBreak`/`clearPendingBreakPrompt`/`clearPendingBreakPromptAutoStart`/`pauseActiveStudyForBreakGuard`/`resumeInterruptedStudyAfterPromptCancel`/`resumeInterruptedStudyAfterBreak`/`showBreakPrompt`/`scheduleBreakPrompt`/`startBreakCountdown`/`endBreakAndResumeStudy`/`returnToStudy`/`notifyStudyActivity`）、prompting 5 秒自动开始 effect（1308-1320）、到期自动打开 freestyle effect（897-908）。hook 入参：`activeEntryRef`、`entriesRef`。返回：`breakState`、`breakConfig`、`breakPaused`、`breakPausedRemainingMs`、`breakTick`、`notifyStudyActivity`、`returnToStudy`、`startBreakCountdown`、`scheduleBreakPrompt`、`finishBreak`、`openTarget`、`snooze 处理所需的 refs`。
10. Provider 内 `handleTimerCommand`（1210-1286）保留在主文件，改为调用 hook 返回的函数；`timerSnapshot` useMemo（1288-1306）保留在主文件。
- 不要做什么：不要改 250ms 的 tick 间隔；不要改 `snoozeBreakGuard`/`expireBreakGuardIfDue` 的调用方式（它们在 `breakGuardModel.ts`，不许动）；不要改 break 日志（`appendBreakGuardLog`/`updateBreakGuardLog`）的字段。
- 自查点：vitest 全绿（休息守卫相关用例约占测试文件一半）；`GlobalTimerProvider.tsx` 降到约 300 行。

### 第 5 批：桌面桥接订阅抽成 hook

11. 新建 `apps/web/src/shared/components/session/useDesktopTimerBridgeSync.ts`，迁入 1322-1347 行四个 effect（onPauseActiveTimer、publishTimerSnapshot、onTimerCommand、onMainWindowBlur）：

```ts
export function useDesktopTimerBridgeSync({
  timerSnapshot,
  handleTimerCommand,
  activeEntryRef,
  scheduleBreakPrompt,
  breakConfigRef,
  breakStateRef,
}: { /* 按原 effect 依赖列全 */ }) { /* 四个 effect 原样 */ }
```

12. Provider 调用该 hook。最终 `GlobalTimerProvider.tsx` 只含：entries 注册状态与 upsert/remove（867-994 精简后）、三套配置的事件订阅（934-965）、`handleTimerCommand`、`timerSnapshot`、两个 hook 调用、JSX。
- 自查点：vitest 全绿；`GlobalTimerProvider.tsx` ≤ 300 行；全库 `rg "from '@/shared/components/session/GlobalTimerProvider'"` 的调用方 import 均未改动。

## 3. 测试验收标准

```powershell
cd D:\322321\Memory-Anki\apps\web
npx vitest run src/shared/components/session   # 期望：GlobalTimerProvider.test 等全部通过
npm run typecheck && npm run test && npm run lint && npm run build   # 期望：全部通过
```

行为验收（`npm run dev`）：

- 打开 `/freestyle` → 右下悬浮计时面板出现，显示"随心 场景"；点击"折叠为胶囊"→ 变胶囊，再点展开。
- 拖动面板标题栏 → 面板跟随移动，刷新页面后位置保留（`memory-anki-timer-overlay-layout`）。
- 拖动右下角手柄 → 面板尺寸变化且字号随之缩放。
- 面板齿轮按钮 → 打开自动化配置弹窗（TimerAutomationDialog）。
- 触发休息询问（按配置离开学习页）→ 面板变为"要开始休息吗？"，5 秒不操作自动按第一个预设分钟开始倒计时；倒计时结束 → "该回来了"，"+1"延后与"结束"按钮可用。
- 回到学习页产生交互 → 休息自动结束、学习计时恢复（`autoFinishOnStudyReturn` 默认行为）。

回归检查：Electron 桌面计时器（`npm run desktop:timer`）的 snapshot 推送与命令响应不变；`useGlobalTimerRegistration` 的 6 个调用页面无需改代码。

## 4. 进度记录（交接用）

| 时间 | 执行者 | 动作 | 结果/备注 |
|---|---|---|---|
| - | - | 文档创建 | 分 5 批；对外 API 经主文件 re-export 保持不变 |
