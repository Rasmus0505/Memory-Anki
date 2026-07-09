---
编号: 04-02
标题: 退役 session-records-legacy 兼容层：删除死别名与 localStorage 旧进度存储，文件更名去 legacy 化
类型: 删减
范围: 功能
优先级: P1
预估工作量: M（2-8h）
依赖文档: 无
状态: 未开始
负责代理: 无
完成时间: 无
---

# 04-02 退役 session-records-legacy 遗留兼容层

## 1. 原始需求

`apps/web/src/entities/session/model/session-records-legacy.ts`（467 行）是"时长记录本地存储时代"
留下的兼容层。经全仓 rg 逐个导出核实，它现在是**三种代码的混合体**：

1. **死的兼容别名（5 个）**：`listTimeRecords`、`createTimeRecord`、`updateTimeRecord`、
   `deleteTimeRecord`、`bulkDeleteTimeRecords`（第 64-66、73-75、90-92、99-101、108-110 行），每个都
   只是一行转发到同文件的 `*StudySessionRecord*` 新名字。`rg` 证实全仓（含测试）没有任何调用方。
2. **死的 localStorage 练习进度读写（第 22-62 行）**：`PRACTICE_PROGRESS_KEY = 'memory-anki.practice-progress.v1'`
   与 `readPracticeProgressMap` / `getPracticeProgress` / `savePracticeProgress` / `clearPracticeProgress`
   以及私有辅助 `safeParse` / `readLocalStorage` / `writeLocalStorage`。`rg` 证实无任何调用方——练习进度
   早已改为服务端持久化（见 `apps/web/src/app/router/practiceRouteSupport.tsx` 的
   `loadProgress` / `saveProgress`，走后端 API）。
3. **活代码**：`persistStudySessionRecord`、`listStudySessionRecords` 等 API 适配函数与
   `getTimeRecordSummary` / `getTrendByRange` / `formatDuration` 等统计/格式化纯函数，被
   `useTimedSession.ts`、`useTimeRecordsDashboard.ts`、review 流程等大量使用（经由桶文件
   `entities/session/model/index.ts` 第 2 行 re-export）。

**旧数据格式是否还会出现的评估结论**：会话时长记录本身已全部走后端（文件不再读写任何时长记录
localStorage 键；仅存的相邻键 `memory-anki.time-record-recovery.v1` 属于 `time-record-recovery.ts`，
是在用的补救机制，与本兼容层无关）。唯一的残留旧数据是两台设备浏览器里可能还躺着的
`memory-anki.practice-progress.v1` 键——它自服务端化后无人再读，属于纯垃圾数据，**不需要迁移到服务端，
只需要一次性清除**。

目标：删除死别名与死进度函数，加一次性 localStorage 清理，最后把文件从 `-legacy` 更名为
`session-records-store.ts`，让"兼容层"这个概念彻底退役。

## 2. 详细执行清单

### 步骤 1：删除前安全检查（引用面确认）

```powershell
cd D:\322321\Memory-Anki
rg -n "listTimeRecords|createTimeRecord\b|updateTimeRecord|deleteTimeRecord|bulkDeleteTimeRecords" apps/web/src
rg -n "PracticeProgress|practice-progress" apps/web/src
```

- 第 1 条：期望所有匹配都**只在** `session-records-legacy.ts` 文件内部（定义与自我转发）。
- 第 2 条：期望匹配只有三类——`session-records-legacy.ts`（本次要删的实现）、
  `session-records.ts` 第 89 行（`PracticeProgressRecord` 接口定义，本次一并删）、
  `app/router/practiceRouteSupport.tsx` 及 4 个 practice 页面（它们用的是自己定义的
  `PracticeProgressSnapshot` 服务端快照类型，**名字相似但无关，绝对不要动**）。
- 如出现其他调用方，先记录并停止，回报文档维护者。
- **自查点**：两条 rg 的结果与期望一致。

### 步骤 2：删除 5 个死别名函数

打开 `apps/web/src/entities/session/model/session-records-legacy.ts`，整块删除以下函数
（只删别名，**保留**每对中的 `*StudySessionRecord*` 真实实现）：

- 第 64-66 行 `export async function listTimeRecords(...)`
- 第 73-75 行 `export async function createTimeRecord(...)`
- 第 90-92 行 `export async function updateTimeRecord(...)`
- 第 99-101 行 `export async function deleteTimeRecord(...)`
- 第 108-110 行 `export async function bulkDeleteTimeRecords(...)`

- **自查点**：`rg -n "TimeRecords\(|createTimeRecord|updateTimeRecord|deleteTimeRecord" apps/web/src`
  中与这 5 个函数名相关的匹配为 0（注意 `listStudySessionRecords`、`getTimeRecordsInRange` 等带
  `TimeRecord` 字样的其他函数是活代码，不要误删）。

### 步骤 3：删除 localStorage 练习进度块

同文件，整块删除第 22-62 行（以步骤 2 之前的行号计）：

```typescript
const PRACTICE_PROGRESS_KEY = 'memory-anki.practice-progress.v1'

function safeParse<T>(...) { ... }
function readLocalStorage<T>(...) { ... }
function writeLocalStorage<T>(...) { ... }

export function readPracticeProgressMap() { ... }
export function getPracticeProgress(palaceId: number) { ... }
export function savePracticeProgress(record: PracticeProgressRecord) { ... }
export function clearPracticeProgress(palaceId: number) { ... }
```

同时从文件头部第 1-10 行的类型 import 中删掉 `PracticeProgressRecord,`（其余类型保留）。

- `safeParse` / `readLocalStorage` / `writeLocalStorage` 在文件内只被这 4 个进度函数使用，必须一并删，
  否则 typecheck 会报 unused。
- **自查点**：`cd apps/web && npm run typecheck` 通过（此时可能提示 `session-records.ts` 的
  `PracticeProgressRecord` 未使用——步骤 4 处理）。

### 步骤 4：删除孤儿类型 PracticeProgressRecord

打开 `apps/web/src/entities/session/model/session-records.ts`，删除第 89-95 行：

```typescript
export interface PracticeProgressRecord {
  palaceId: number
  updatedAt: string
  completed: boolean
  revealMap: Record<string, RevealState>
  redNodeIds: string[]
}
```

- **不要删**第 1 行的 `export type RevealState`——它被 `entities/review/model/review-flow-tree.ts`、
  `shared/components/mindmap/` 等多处使用。
- **自查点**：`rg -n "PracticeProgressRecord" apps/web/src` 为空。

### 步骤 5：一次性清除旧 localStorage 键（数据迁移收尾）

在 `session-records-legacy.ts`（即将更名）文件末尾追加一个一次性清理函数：

```typescript
/**
 * 一次性清理：练习进度已服务端化（见 app/router/practiceRouteSupport.tsx），
 * 移除两台设备浏览器中残留的旧 localStorage 键。清理逻辑保留至 2026-10 后可整体删除。
 */
export function cleanupLegacyPracticeProgressStorage() {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem('memory-anki.practice-progress.v1')
  } catch {
    // localStorage 不可用时静默跳过
  }
}
```

然后打开 `apps/web/src/main.tsx`（当前 13 行），在 `registerServiceWorker()` 之后追加调用：

修改前（第 13 行）：

```typescript
registerServiceWorker()
```

修改后：

```typescript
registerServiceWorker()
cleanupLegacyPracticeProgressStorage()
```

并在 main.tsx 头部加 import：

```typescript
import { cleanupLegacyPracticeProgressStorage } from './entities/session/model'
```

- 不要把清理写成模块顶层副作用（会污染所有 import 该模块的测试）。
- **自查点**：`npm run typecheck` 通过。

### 步骤 6：文件更名，去掉 legacy 字样

1. `git mv apps/web/src/entities/session/model/session-records-legacy.ts apps/web/src/entities/session/model/session-records-store.ts`
2. `git mv apps/web/src/entities/session/model/session-records-legacy.test.ts apps/web/src/entities/session/model/session-records-store.test.ts`
3. 打开 `apps/web/src/entities/session/model/index.ts`，改第 2 行：

修改前：

```typescript
export * from './session-records-legacy'
```

修改后：

```typescript
export * from './session-records-store'
```

- 测试文件（原 `session-records-legacy.test.ts`）的 import 走的是桶文件 `@/entities/session/model`，
  更名后无需改内容。
- 所有外部调用方（`useTimedSession.ts`、`useTimeRecordsDashboard.ts`、
  `useMindMapReviewFlowController.ts`、`MindMapReviewFlow.test-support.tsx` 等）都从桶文件 import，
  无需逐个修改；用 `rg -n "session-records-legacy" apps/web/src` 确认真的没有直连引用。
- **自查点**：`rg -n "session-records-legacy" apps/web` 为空。

### 步骤 7：全量验证

```powershell
cd D:\322321\Memory-Anki\apps\web
npm run typecheck
npm run test
```

### 明确不要做的事

1. 不要动 `time-record-recovery.ts` / `time-record-recovery.test.ts`——那是在用的失败补写机制，不是兼容层。
2. 不要动 `practiceRouteSupport.tsx` 与 4 个 practice 页面的 `PracticeProgressSnapshot`。
3. 不要"顺手"重构 `studySessionToTimeRecord` 等适配函数或改 `TimeSessionRecord` 类型——它们是活代码。
4. 不要动后端 `modules/sessions` / `time_records`。
5. 不要删除 `formatDuration`、`getTrendByRange` 等统计函数——有大量调用方。

## 3. 测试验收标准

### 可执行命令

| 命令 | 期望结果 |
|---|---|
| `rg -n "session-records-legacy|listTimeRecords|PracticeProgressRecord|practice-progress.v1" apps/web/src --glob "!**/session-records-store.ts"` | 无任何匹配 |
| `cd apps/web && npm run typecheck` | 0 退出码 |
| `cd apps/web && npm run test` | 全部通过（含更名后的 session-records-store.test.ts 与 useTimedSession.test.tsx） |

### 行为验收（人工）

1. 打开 `/profile/timer` 时长记录面板 → 列表、汇总卡片、趋势图、类型占比图正常显示（活代码链路未破坏）。
2. 完成一次计时会话 → 记录成功写入并出现在列表中（`persistStudySessionRecord` 链路正常）。
3. 打开浏览器 DevTools → Application → Local Storage：若存在 `memory-anki.practice-progress.v1`，
   刷新页面后该键被移除。

### 回归检查

- 复习流程结束时的会话记录写入（`useMindMapReviewFlowController.ts` 第 301 行）不受影响。
- 计时会话崩溃补写（`time-record-recovery.ts`）不受影响。
- 练习进度的保存/恢复（服务端，practice 各页面）不受影响。

## 4. 进度记录（交接用）

| 时间 | 执行者 | 动作 | 结果/备注 |
|---|---|---|---|
| 2026-07-08 | 文档代理（fable） | 文档创建；核实 5 个别名与 4 个进度函数零调用方、旧键仅剩浏览器残留、活代码调用面清单 | - |
