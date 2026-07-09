---
编号: 08-04
标题: 拆分 924 行的 DashboardPage 单组件——过滤器模型、派生纯函数、各卡片区块独立
类型: 优化
范围: 前端
优先级: P1
预估工作量: M（2-8h）
依赖文档: 无（与 08-06 TanStack Query 试点无冲突；若 08-06 已扩展到 dashboard 领域，加载逻辑以彼时结构为准）
状态: 已完成
负责代理: Codex
完成时间: 2026-07-09
---

# 08-04 拆分 DashboardPage

## 1. 原始需求

`apps/web/src/features/dashboard/DashboardPage.tsx` 目前有 924 行，默认导出的 `Dashboard` 组件（320-924 行，共 605 行）在单文件里承担：仪表盘数据加载、总时长过滤器（月份/自定义范围/全部三模式，持久化到 localStorage 键 `memory_anki_dashboard_total_duration_filter`）、今日待办分桶、今日学习分段条与悬浮 tooltip、新增章节树、recharts 趋势/分布图卡（经 `TimeRecordsTrendChart`/`TimeRecordsBreakdownChart`）、时间记录表格与录入弹窗（经 `useTimeRecordsDashboard`，623 行 hook，已独立无需动）。

配套测试：`DashboardPage.filters.test.tsx`（475 行）与 `DashboardPage.charts.test.tsx`，均按对外行为断言。目标：过滤器模型与派生纯函数下沉 `model/`，四块卡片区独立成组件，主文件降到约 300 行，**不改任何行为与视觉**。

## 原文件职责分区表（行号范围 → 目标新文件）

| 行号范围 | 现有内容 | 目标新文件 |
|---|---|---|
| 1-22 | import 区 + `DASHBOARD_TOTAL_DURATION_FILTER_STORAGE_KEY` | 键常量随过滤器模型迁走 |
| 24-43 | `formatLearningTooltip` + `dashboardLearningLegend` | `model/dashboard-derive.ts`（新建） |
| 45-79 | `TodayTodoTone`/`TodayTodoBucket` 类型 + `todayTodoToneClassName` | `model/dashboard-derive.ts` |
| 81-122 | `buildTodayTodoBuckets` + `getBucketWidth` | `model/dashboard-derive.ts` |
| 124-152 | `buildLearningSegments` | `model/dashboard-derive.ts` |
| 154-283 | 过滤器模型：`DurationFilterMode`、`DashboardDurationFilterState`、默认值/校验/normalize/比较/格式化 8 个函数 | `model/dashboard-duration-filter.ts`（新建） |
| 284-318 | `TimeRecordChartCard` 组件 | `components/TimeRecordChartCard.tsx`（新建） |
| 320-432 | 主组件：state + `updateDurationFilter` + `loadDashboard`/`loadSelectedDuration` + 3 个 effect | 主文件保留（加载部分可选抽 `hooks/useDashboardData.ts`，见第 4 批） |
| 434-450 | ErrorState / DashboardSkeleton 早退 | 主文件保留 |
| 452-632 | `quickActions` 数组 + `statCards` 数组（含"今日待处理"分桶 JSX、"总时长"过滤器 JSX） | `components/DashboardStatCards.tsx`（新建，过滤器 UI 一并进入） |
| 634-692 | JSX：标题 + stat cards grid + 快速操作卡 | stat cards 归 `DashboardStatCards`；快速操作归 `components/DashboardQuickActions.tsx`（新建） |
| 694-770 | JSX：今日学习卡（分段条 + hover tooltip） | `components/DashboardTodayLearningCard.tsx`（新建，`hoveredLearningPalaceId` state 一并迁入） |
| 772-845 | JSX：新增章节卡 | `components/DashboardNewPalacesCard.tsx`（新建） |
| 847-921 | JSX：两个图卡 + TimeRecordsTable + TimeRecordDialog | 主文件保留（props 已经全部来自 `timeRecordsDashboard`，无拆分收益） |

## 2. 详细执行清单

新文件均放 `apps/web/src/features/dashboard/` 的 `model/`、`components/` 子目录。每批后跑 `cd apps/web && npx vitest run src/features/dashboard`。不要修改 `useTimeRecordsDashboard.ts`、`DashboardSkeleton.tsx`、两个测试文件，也不要动 `features/profile/components/` 下被复用的图表组件。

### 第 1 批：过滤器模型下沉

1. 新建 `apps/web/src/features/dashboard/model/dashboard-duration-filter.ts`，剪切 21-22 行键常量与 154-283 行全部内容（`DurationFilterMode`、`DashboardDurationFilterState`、`NormalizedDashboardDurationFilterState`、`DEFAULT_TIME_RECORD_CHART_RANGE`、`TIME_RECORD_CHART_RANGE_OPTIONS`、`isTimeRecordChartRange`、`getCurrentMonthValue`、`createDefaultDurationFilterState`、`isDashboardDurationFilterState`、`normalizeDashboardDurationFilterState`、`isDefaultDurationFilterState`、`formatSelectedDurationLabel`、`formatTrendCardTitle`、`hasDurationFilterStateChanged`），逐个加 `export`。
2. 主文件补 import。
- 不要做什么：不要改 localStorage 键名或 `isDashboardDurationFilterState` 的校验逻辑（旧数据要能读回）。
- 自查点：`npx vitest run src/features/dashboard/DashboardPage.filters.test.tsx` 全绿。

### 第 2 批：派生纯函数下沉

3. 新建 `model/dashboard-derive.ts`，剪切 24-152 行（`formatLearningTooltip`、`dashboardLearningLegend`、`TodayTodoTone`、`TodayTodoBucket`、`todayTodoToneClassName`、`buildTodayTodoBuckets`、`getBucketWidth`、`buildLearningSegments`），逐个 `export`。它 import `formatDuration`（entities/session）与 `getTimeRecordChartColor`（features/profile）。
- 自查点：typecheck + dashboard 测试全绿。

### 第 3 批：卡片组件拆出

4. 剪切 284-318 行 → `components/TimeRecordChartCard.tsx`（props 不变：title/selectedRange/onRangeChange/children；`TIME_RECORD_CHART_RANGE_OPTIONS` 从模型 import）。
5. 新建 `components/DashboardStatCards.tsx`：迁入 452-632 行的 `statCards` 构造与 640-661 行渲染循环。props：

```ts
{
  data: DashboardResponse
  durationFilter: NormalizedDashboardDurationFilterState
  onUpdateDurationFilter: (patch: Partial<DashboardDurationFilterState> | ((c: NormalizedDashboardDurationFilterState) => Partial<DashboardDurationFilterState>)) => void
}
```

"今日待处理"分桶条与"总时长"过滤器按钮/日期输入的 JSX 原样搬入。
6. 新建 `components/DashboardQuickActions.tsx`：迁入 458-482 行 `quickActions` 数组与 663-692 行卡片 JSX，无 props（数据是静态的，`todayTodoTotal` 通过 prop 传入用于"n 项待处理"文案）。
7. 新建 `components/DashboardTodayLearningCard.tsx`：迁入 694-770 行与 `hoveredLearningPalaceId` useState（322 行）。props：`{ palaces: DashboardResponse['today_learning_palaces'] }`。
8. 新建 `components/DashboardNewPalacesCard.tsx`：迁入 772-845 行。props：`{ data: Pick<DashboardResponse, 'today_new_palace_count' | 'today_new_palaces'> }`。
- 不要做什么：不要改 `aria-label="今日待处理优先级"`、`role="img"` 等无障碍属性；不要改 `title` tooltip 文案格式（filters 测试断言了部分文案）。
- 自查点：dashboard 两个测试文件全绿；主文件降到约 350 行。

### 第 4 批（可选）：加载逻辑抽 hook

9. 若主文件仍 >300 行：新建 `hooks/useDashboardData.ts`，迁入 `data`/`hasLoadedDashboard`/`loadError` state、`loadDashboard`/`loadSelectedDuration`、391-432 行三个 effect 中的加载相关两个（过滤器 normalize 回写 effect 395-401 行留在主文件，它属于过滤器状态）。返回 `{ data, loadError, loadDashboard, reload }`。
- 注意：若 08-06 后续批次已把 dashboard 迁到 TanStack Query，跳过本批。
- 自查点：dashboard 测试全绿；主文件 ≤ 300 行。

## 3. 测试验收标准

```powershell
cd D:\322321\Memory-Anki\apps\web
npx vitest run src/features/dashboard
npm run typecheck && npm run test && npm run lint && npm run build
```

行为验收（`npm run dev` 打开 `/dashboard`）：

- 首屏出现 5 张统计卡 + 快速操作 + 今日学习 + 新增章节 + 2 张图卡 + 时间记录表。
- "总时长"卡切换 月份/自定义范围/显示全部 → 数值随之刷新；选择开始日期晚于结束日期 → 显示红色提示"开始日期不能晚于结束日期。"。
- 刷新页面 → 过滤器选择被记住（localStorage）。
- 今日学习分段条 hover → 弹出分时长 tooltip；移开消失。
- 图卡右上角切换 7/30 天等范围 → 图表数据切换。
- 时间记录表新增/编辑/删除记录 → 表格与上方统计联动刷新。

回归检查：`memory_anki_dashboard_total_duration_filter` 键格式不变；`DashboardSkeleton` 加载骨架仍在数据未就绪时显示；加载失败时 `ErrorState` + "重新加载"按钮可用。

## 4. 进度记录（交接用）

| 时间 | 执行者 | 动作 | 结果/备注 |
|---|---|---|---|
| - | - | 文档创建 | 分 4 批（第 4 批可选） |
| 2026-07-09 | Codex | 拆分 DashboardPage | 下沉过滤器模型与派生函数，抽出统计卡、快速操作、今日学习、新增章节、图表卡组件；主文件 262 行；`npx vitest run src/features/dashboard`、`npm run typecheck` 通过 |
