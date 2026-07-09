---
编号: 08-03
标题: 拆分 1086 行的 TimerAutomationDialog——三套草稿（自动化/专注/休息）各自成节，编辑器子组件独立成文件
类型: 优化
范围: 前端
优先级: P1
预估工作量: M（2-8h）
依赖文档: 建议在 08-02（拆 GlobalTimerProvider）之后执行，避免同目录冲突
状态: 未开始
负责代理: 无
完成时间: 无
---

# 08-03 拆分 TimerAutomationDialog

## 1. 原始需求

`apps/web/src/shared/components/session/TimerAutomationDialog.tsx` 目前有 1086 行。它是一个"三合一"设置弹窗：同时编辑计时自动化配置（TimerAutomationConfig，8 个场景 × 4 字段）、专注目标配置（TimerFocusConfig，双层目标 + 庆祝反馈）、休息守卫配置（BreakGuardConfig）。主组件 `TimerAutomationDialog`（407-1086 行，共 680 行）持有 3 份草稿 state 和 13 个 `useCallback` 字段更新器，加上 3 个大型 `useMemo` sanitize 块（567-695 行，共 129 行几乎全是逐字段罗列）。

配置模型本身（`timer-automation-config.ts` 316 行、`timer-focus-config.ts` 314 行、`break-guard-config.ts` 187 行）已独立且有测试，问题只在弹窗文件过长、三块职责搅在一起。目标：按"自动化 / 专注 / 休息"三节拆成三个 section 组件 + 一个草稿 hook，主文件降到约 250 行。

## 原文件职责分区表（行号范围 → 目标新文件）

| 行号范围 | 现有内容 | 目标新文件 |
|---|---|---|
| 1-53 | import 区 | 各文件分摊 |
| 54-94 | Props 接口、FieldKey 等 type、`parseMinuteList`、`TIMER_VISUAL_PRESET_LABELS` | `timerAutomationDialogModel.ts`（新建） |
| 96-218 | `toDraft` / `toFocusDraft` / `toBreakDraft`（字符串草稿转换） | `timerAutomationDialogModel.ts` |
| 220-293 | `RuleEditor`（单场景自动化阈值编辑器） | `TimerAutomationRuleEditor.tsx`（新建） |
| 295-341 | `FocusRuleEditor` | `TimerFocusRuleEditor.tsx`（新建） |
| 343-405 | `CelebrationEventEditor` | `TimerCelebrationEventEditor.tsx`（新建） |
| 407-427 | 主组件：3 份草稿 state + open 重置 effect | 主文件保留，或并入 `useTimerConfigDrafts` |
| 429-565 | 13 个字段更新 useCallback | `useTimerConfigDrafts.ts`（新建） |
| 567-695 | `parsedConfig` / `parsedFocusConfig` / `parsedBreakConfig` 三个 sanitize useMemo | `timerAutomationDialogModel.ts`（改成三个纯函数 `parseAutomationDraft`/`parseFocusDraft`/`parseBreakDraft`） |
| 697-720 | sceneRuleEditors / focusRuleEditors 列表构造 | 各 section 组件内部 |
| 722-838 | JSX：头部 + 配置模式切换 + 活动判定 4 个 checkbox + 全局/分场景 RuleEditor | `TimerAutomationSection.tsx`（新建） |
| 839-932 | JSX：专注目标配置节（强度三选一 + FocusRuleEditor + 2 个 CelebrationEventEditor + 预览行） | `TimerFocusSection.tsx`（新建） |
| 934-1037 | JSX：休息守护配置节 | `TimerBreakGuardSection.tsx`（新建） |
| 1040-1082 | JSX：底部 恢复默认/取消/保存 | 主文件保留 |

## 2. 详细执行清单

所有新文件放 `apps/web/src/shared/components/session/`。每批后跑 `cd apps/web && npx vitest run src/shared/components/session`（GlobalTimerProvider.test 通过面板齿轮打开此弹窗并保存，覆盖了主要交互路径）。不要修改 `timer-automation-config.ts`、`timer-focus-config.ts`、`break-guard-config.ts` 及其测试。

### 第 1 批：模型层（类型 + 草稿转换 + 解析纯函数）

1. 新建 `apps/web/src/shared/components/session/timerAutomationDialogModel.ts`，剪切并 export：54-94 行的全部 type 与 `parseMinuteList`、`TIMER_VISUAL_PRESET_LABELS`，以及 96-218 行的 `toDraft`/`toFocusDraft`/`toBreakDraft`。补充导出草稿类型（现在是推断类型，显式化）：

```ts
export type AutomationDraft = ReturnType<typeof toDraft>
export type FocusDraft = ReturnType<typeof toFocusDraft>
export type BreakDraft = ReturnType<typeof toBreakDraft>
```

2. 把 567-695 行三个 useMemo 的函数体改写为纯函数放进同文件：

```ts
export function parseAutomationDraft(draft: AutomationDraft): TimerAutomationConfig {
  return sanitizeTimerAutomationConfig({ /* 原 569-625 行对象字面量原样 */ })
}
export function parseFocusDraft(draft: FocusDraft): TimerFocusConfig { /* 原 631-676 */ }
export function parseBreakDraft(draft: BreakDraft): BreakGuardConfig { /* 原 682-693 */ }
```

主组件中三个 useMemo 改为 `React.useMemo(() => parseAutomationDraft(draft), [draft])` 等一行调用。
- 不要做什么：不要在纯函数化时"顺手"消除 8 个场景的逐字段罗列（那是 sanitize 输入契约，改了行为可能变）。
- 自查点：typecheck 通过；vitest 全绿。

### 第 2 批：三个编辑器子组件独立成文件

3. 剪切 220-293 行 `RuleEditor` → `TimerAutomationRuleEditor.tsx`（导出名保持 `RuleEditor`）；295-341 行 `FocusRuleEditor` → `TimerFocusRuleEditor.tsx`；343-405 行 `CelebrationEventEditor` → `TimerCelebrationEventEditor.tsx`。各自补齐 import（Input、cn、模型类型、`TIMER_VISUAL_PRESET_LABELS`）。
4. 主文件 import 三个组件。
- 自查点：vitest 全绿；`TimerAutomationDialog.tsx` 降到约 700 行。

### 第 3 批：草稿更新 hook

5. 新建 `useTimerConfigDrafts.ts`，迁入 418-427 行三份 useState 与 open 重置 effect、429-565 行全部 13 个 handler：

```ts
export function useTimerConfigDrafts({ open, config, focusConfig, breakConfig }: {
  open: boolean
  config: TimerAutomationConfig
  focusConfig: TimerFocusConfig
  breakConfig: BreakGuardConfig
}) {
  // ...原实现...
  return {
    draft, focusDraft, breakDraft,
    setFocusDraft, setBreakDraft, // 底部"恢复默认"按钮需要
    handleModeChange, handleFieldChange, handleAutoStartChange, handleActionChange,
    handleFocusModeChange, handleFocusFieldChange, handleFeedbackIntensityChange,
    handleCelebrationBooleanChange, handleCelebrationVolumeChange, handleCelebrationPresetChange,
    handleBreakBooleanChange, handleBreakNumberChange, handleBreakTextChange, handleBreakAlertStrengthChange,
    parsedConfig, parsedFocusConfig, parsedBreakConfig,
  }
}
```

- 自查点：vitest 全绿；主文件降到约 450 行。

### 第 4 批：三个 section 组件

6. 新建 `TimerAutomationSection.tsx`：迁入 744-837 行（配置模式切换、4 个活动判定 checkbox、全局/分场景 RuleEditor 分支，含 697-709 行 sceneRuleEditors 构造）。props：`draft`、`onModeChange`、`onFieldChange`、`onAutoStartChange`、`onActionChange`。
7. 新建 `TimerFocusSection.tsx`：迁入 839-932 行（含 710-720 行 focusRuleEditors 构造与 928-931 行"当前全局默认"预览，预览需要 `parsedFocusConfig` 作为 prop）。
8. 新建 `TimerBreakGuardSection.tsx`：迁入 934-1037 行（含 1032-1036 行"当前预览"，需要 `parsedBreakConfig` prop）。
9. 主文件 JSX 变为：

```tsx
<DialogContent className="...原样...">
  <DialogHeader>…原样…</DialogHeader>
  <div data-testid="timer-automation-dialog-content" className="...原样...">
    <TimerAutomationSection {...} />
    <TimerFocusSection {...} />
    <TimerBreakGuardSection {...} />
  </div>
  <div className="...底部按钮区原样...">…恢复默认/取消/保存…</div>
</DialogContent>
```

- 不要做什么：不要改 `data-testid="timer-automation-dialog-content"`；不要改保存按钮 onSave/onFocusConfigSave/onBreakConfigSave 的回退逻辑（1063-1076 行：没传回调时直接 `saveTimerFocusConfig`/`saveBreakGuardConfig`）；不要改文案。
- 自查点：vitest 全绿；`TimerAutomationDialog.tsx` ≤ 250 行。

## 3. 测试验收标准

```powershell
cd D:\322321\Memory-Anki\apps\web
npx vitest run src/shared/components/session
npm run typecheck && npm run test && npm run lint && npm run build
```

行为验收（`npm run dev`，在 /freestyle 打开悬浮计时器齿轮）：

- 弹窗打开 → 三节依次可见：配置模式 + 活动判定、专注目标配置、休息守护配置。
- 切"单独配置"→ 出现 8 个场景卡片（宫殿编辑/练习/做题/复习/随心/英语听力/英语阅读等）。
- 修改"离开后询问延迟（秒）"为 30 → 保存 → 重新打开弹窗值仍为 30（localStorage `memory-anki-break-guard-config`）。
- 点"恢复默认"→ 三节全部回到默认值。
- 取消按钮 → 关闭且不保存。

回归检查：`GlobalTimerProvider` 悬浮面板与 Electron 悬浮窗的配置读取不受影响；`ProfileSettingsPage` 等其他入口（如有引用此弹窗）不需改动。

## 4. 进度记录（交接用）

| 时间 | 执行者 | 动作 | 结果/备注 |
|---|---|---|---|
| - | - | 文档创建 | 分 4 批：模型 → 编辑器 → 草稿 hook → section |
