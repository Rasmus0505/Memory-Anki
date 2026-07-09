---
编号: 07-09
标题: 清点 window CustomEvent 总线全部事件，删除 2 个"只发不听"的死事件
类型: 删减
范围: 前端
优先级: P2
预估工作量: M（2-8h）
依赖文档: 活跃事件的统一收敛留给 08-08，本文档只删死事件
状态: 未开始
负责代理: 无
完成时间: 无
---

# 07-09 清理冗余 CustomEvent 事件

## 1. 原始需求

前端以 `window.dispatchEvent(new CustomEvent(...))` 作为跨组件事件总线，事件散落在 shared/entities 各处。经全库 grep（`dispatchEvent(new CustomEvent|new Event` 与各 `*_EVENT` 常量的交叉核对），清点出 **13 个生产事件**，其中 2 个是"有发送方、订阅函数从未被调用"的死事件。完整清单：

| # | 事件名 | 发送方（文件:行） | 监听方 | 判定 |
|---|---|---|---|---|
| 1 | `memory-anki-client-preferences-updated` | `shared/preferences/clientPreferences.ts:22` | `persistentPreferenceStore.ts:44`、`shared/lib/localStorage.ts:65` | 活跃 |
| 2 | `memory-anki-mutation-queue:changed` | `shared/persistence/mutationQueue.ts:155` | `subscribeMutationQueue`（158 行）**0 调用方** | **死事件** |
| 3 | `memory-anki-app-logs:changed` | `shared/logs/model/appLogs.ts:113` | `subscribeAppLogs` → `AppLogDrawer.tsx:87` | 活跃 |
| 4 | `memory-anki-open-ai-log-detail` | `appLogs.ts:292`（调用方 `usePalaceEditPage.ts:517`、`MindMapImportDrawer.tsx:339`） | `subscribeOpenAiLogDetail` → `AppLogDrawer.tsx:91` | 活跃 |
| 5 | `memory-anki-review-feedback-settings-change` | `shared/feedback/reviewFeedbackSettings.ts:456`、`useClientPreferenceBootstrap.ts` | `useMindMapFeedback.ts:85`、`useReviewFeedback.ts:251` | 活跃 |
| 6 | `memory-anki-global-feedback-request` | `shared/feedback/globalFeedbackModel.ts:61` | `GlobalFeedbackProvider.tsx:243` | 活跃 |
| 7 | `memory-anki-timer-focus-change` | `timer-focus-config.ts:283`、bootstrap | `SessionTimerBar.tsx:138`、`GlobalTimerProvider.tsx:334/958` | 活跃 |
| 8 | `memory-anki-timer-automation-change` | `timer-automation-config.ts:244`、bootstrap | `timedSessionBrowserEffects.ts:130`、`SessionTimerBar.tsx:137`、`GlobalTimerProvider.tsx:333/957` | 活跃（注意监听方全是**裸字符串**未用常量） |
| 9 | `memory-anki-break-guard-config-change` | `break-guard-config.ts:115` | `SessionTimerBar.tsx:139`、`GlobalTimerProvider.tsx:959` | 活跃 |
| 10 | `memory-anki-time-record-recovery:changed` | `entities/session/model/time-record-recovery.ts:81` | `subscribePendingTimeRecordRecoveries`（178 行）**0 调用方** | **死事件** |
| 11 | `memory-anki-shortcuts-change` | 经 `persistentPreferenceStore`（`updatedEvent`） | `memoryAnkiShortcuts.ts:132` | 活跃 |
| 12 | `memory-anki-english-practice-settings-change` | 经 `persistentPreferenceStore` | `EnglishCoursePage.tsx:166` | 活跃 |
| 13 | `palace-catalog:invalidated`（`PALACE_CATALOG_INVALIDATED_EVENT`） | `entities/palace/api/catalogApi.ts:69` | `PalaceShelfPage.tsx:189`、`PalaceListPage.tsx:99` | 活跃 |

目标：删除 #2、#10 两个死事件及其无人调用的订阅函数；活跃事件（含 #8 裸字符串问题）的统一改造归 `fable/08-前端-优化/08-08`，本文档不动。

## 2. 详细执行清单

### 步骤 1：删除前安全检查

```powershell
cd D:\322321\Memory-Anki\apps\web
rg -n "subscribeMutationQueue" src
rg -n "subscribePendingTimeRecordRecoveries" src
rg -n "memory-anki-mutation-queue:changed|memory-anki-time-record-recovery:changed" src
```

期望：前两条各**只命中定义处 1 行**（`mutationQueue.ts:158`、`time-record-recovery.ts:178`）；第三条只命中两个常量定义与各自文件内的 dispatch/addEventListener，无其他文件。若任何一条出现了新调用方，对应事件改判"活跃"，从本文档移除并记录进度表。

- **自查点**：三条命令输出与期望一致。

### 步骤 2：删除 mutationQueue 死事件

打开 `apps/web/src/shared/persistence/mutationQueue.ts`：

修改前（第 68 行与第 153~162 行）：

```ts
const CHANGE_EVENT = 'memory-anki-mutation-queue:changed'
// ...
function notifyMutationQueueChanged() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

export function subscribeMutationQueue(listener: () => void) {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(CHANGE_EVENT, listener)
  return () => window.removeEventListener(CHANGE_EVENT, listener)
}
```

修改后：删除 `CHANGE_EVENT` 常量、`notifyMutationQueueChanged` 函数、`subscribeMutationQueue` 函数，并删除文件内**所有 `notifyMutationQueueChanged()` 调用行**（先 `rg -n "notifyMutationQueueChanged" src/shared/persistence/mutationQueue.ts` 列出每一处，逐行删除调用语句本身，不要动调用点所在函数的其他逻辑）。

- **不要**动 `replayQueuedMutations`、`useMutationQueue.ts`（它监听的是浏览器原生 `online`/`visibilitychange`，与本事件无关）及 IndexedDB 读写逻辑。
- **自查点**：`rg -n "CHANGE_EVENT|notifyMutationQueueChanged|subscribeMutationQueue" src/shared/persistence` 输出为空；`npm run typecheck` 通过。

### 步骤 3：删除 time-record-recovery 死事件

打开 `apps/web/src/entities/session/model/time-record-recovery.ts`：

3a. 删除第 6 行 `const TIME_RECORD_RECOVERY_CHANGE_EVENT = ...`。

3b. 删除第 79~82 行 `dispatchRecoveryStoreChanged` 函数，并删除文件内所有对它的调用行（核实有：第 89 行 `updateRecoveryStore` 内、第 175 行 `clearPendingTimeRecordRecoveriesForTest` 内；以 `rg -n "dispatchRecoveryStoreChanged"` 实际输出为准）。

3c. 删除第 178~191 行整个 `subscribePendingTimeRecordRecoveries` 函数（其内部的 `storage` 跨标签页监听也一并消失——该函数本身 0 调用方，无行为损失）。

- **不要**动 `listPendingTimeRecordRecoveries`、`buildTimeRecordRecoveryMutationId`、replay 逻辑等其余导出。
- **自查点**：`rg -n "TIME_RECORD_RECOVERY_CHANGE_EVENT|dispatchRecoveryStoreChanged|subscribePendingTimeRecordRecoveries" src` 输出为空；`npx vitest run src/entities/session` 全绿（若有测试调用了被删函数，说明步骤 1 检查有漏，恢复该函数并把事件改判活跃）。

### 步骤 4：全量回归

```powershell
cd D:\322321\Memory-Anki\apps\web
rg -n "dispatchEvent\(new (CustomEvent|Event)\(" src --glob "!*.test.*"
```

对照第 1 节清单逐行核对：剩余 dispatch 全部属于 11 个活跃事件。把最终清单（含本次删除记录）抄送 08-08 文档作为输入。

- **自查点**：清单核对完成，无漏网事件。

### 回滚方式

```powershell
cd D:\322321\Memory-Anki
git checkout -- apps/web/src/shared/persistence/mutationQueue.ts apps/web/src/entities/session/model/time-record-recovery.ts
```

## 3. 测试验收标准

```powershell
cd D:\322321\Memory-Anki\apps\web
npm run test        # 期望：全部通过（重点 shared/persistence、entities/session）
npm run typecheck   # 期望：0 错误
npm run lint        # 期望：0 错误（删函数后若出现 unused import 一并清掉）
npm run build       # 期望：构建成功
```

行为验收：

- 断网做一次会产生写请求的操作（如答题）→ 恢复网络 → 30 秒内（或切回标签页时）队列自动重放成功（`useMutationQueueAutoSync` 的 online/visibility/interval 三个触发器均与被删事件无关）。
- 练习页启动计时器 → 强制刷新页面 → 时间记录恢复逻辑正常（recovery store 的读写与 replay 不依赖被删事件）。
- 打开应用日志抽屉（AppLogDrawer）→ 日志实时刷新、AI 日志详情跳转正常（#3、#4 活跃事件未动）。

回归检查：第 1 节表中 11 个活跃事件的收发两侧文件本文档一律未触碰（可用 `git diff --stat` 确认只改了 2 个文件）。

## 4. 进度记录（交接用）

| 时间 | 执行者 | 动作 | 结果/备注 |
|---|---|---|---|
| - | - | 文档创建 | 清点 13 个生产事件，死事件 2 个（mutation-queue:changed、time-record-recovery:changed） |
