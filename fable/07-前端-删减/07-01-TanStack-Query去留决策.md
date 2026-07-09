---
编号: 07-01
标题: 决策 @tanstack/react-query 的去留——已安装已挂载但全库 0 个 useQuery/useMutation
类型: 删减
范围: 前端
优先级: P1
预估工作量: S（<2h）
依赖文档: 与 08-06（TanStack Query 落地）互斥——二选一执行
状态: 未开始
负责代理: 无
完成时间: 无
---

# 07-01 TanStack Query 去留决策

## 1. 原始需求

`apps/web/package.json` 第 35 行声明了 `"@tanstack/react-query": "^5.100.9"`。该库当前已被完整挂载，但没有任何真实消费。经逐文件核实的现状：

| 位置 | 内容 | 行号 |
|---|---|---|
| `apps/web/src/shared/api/queryClient.ts` | 全文 13 行，导出 `createAppQueryClient()`：`staleTime: 30_000`、失败重试最多 2 次、指数退避（1s 起、封顶 8s） | 1~13 |
| `apps/web/src/app/providers/AppProviders.tsx` | import `QueryClientProvider`/`createAppQueryClient`，模块级创建 queryClient，`<QueryClientProvider>` 包裹整个应用 | 3、7、15、54、69 |
| `apps/web/src/features/timer-overlay/TimerOverlayApp.tsx` | **第二个挂载点**（Electron 悬浮窗入口），独立创建 queryClient 并挂载 | 3、5、8、21、26 |

而全库 grep `useQuery|useMutation\(|useQueryClient|useInfiniteQuery` 的结果是 **0 个真实调用**。唯一的"疑似命中"是 `shared/persistence/useMutationQueue.ts` 第 6 行的 `useMutationQueueAutoSync`——那是名字里恰好含 "useMutation" 字样的自定义 hook（离线写队列自动重放），与 TanStack Query 毫无关系。所有数据获取都走 `shared/api/http.ts` 手写 fetch 封装 + 组件内 `useState`/`useEffect` + `window CustomEvent` 手动失效（见 07-09 清单中的 `palace-catalog:invalidated`）。

也就是说：应用打包并挂载了一个完全没发挥作用的库。本文档是**决策文档**：给出两条路线，做出推荐，并把"若走删除路线"的完整步骤写清，避免后续代理各凭直觉行动。

注意与任务派发描述的差异：核实发现挂载点有**两个**（AppProviders + TimerOverlayApp），不止 AppProviders 一处；执行路线 A 时两处都要摘除。

## 2. 详细执行清单

### 2.0 决策：两条路线对比与结论

| 维度 | 路线 A：移除依赖与 Provider | 路线 B：保留，按 08-06 落地使用 |
|---|---|---|
| 立即收益 | bundle 减小（react-query 约 12KB gzip）；Provider 少一层；消除"装而不用"的困惑 | 无立即收益 |
| 长期收益 | 无 | 消灭全库大量"手写 loading/error/refetch + CustomEvent 手动失效"样板（PalaceShelfPage、PalaceListPage、DashboardPage 等每页一套）；缓存、重试、竞态取消由库统一处理 |
| 成本 | 2 处文件修改 + 卸载；若日后 08-06 复活需全部装回 | 需要按 08-06 执行整套迁移（工作量 L） |
| 风险 | 极低（无消费者） | 迁移期间行为回归风险，由 08-06 自己管控 |

**结论：推荐路线 B。** 理由：

1. 本项目手写数据层的痛点（重复请求、手动事件失效、每页复制 loading/error 状态机）恰是 react-query 的核心用例，`fable/08-前端-优化/08-06` 已规划迁移；现在删了将来还要装回来，来回折腾。
2. 挂载成本已付清（Provider、queryClient 配置都写好且正确），保留的持有成本只有 bundle 体积。
3. **互斥关系（重要）**：本文档路线 A 与 08-06 互斥。执行者动手前必须先查看 `fable/08-前端-优化/08-06` 的状态字段——只要它是"未开始/进行中/已完成"中的任何一种且未被否决，就采纳路线 B：本文档**零代码改动**，直接在第 4 节进度表登记"采纳路线 B"并把状态改为"已完成"。

只有当 08-06 被明确否决（其进度表写明"不做"）时，才执行下面路线 A。

### 路线 A：彻底移除（仅在 08-06 被否决时执行）

#### 步骤 A1：删除前安全检查——确认全库仍无真实用法

```powershell
cd D:\322321\Memory-Anki\apps\web
rg -n "useQuery|useMutation\(|useQueryClient|useInfiniteQuery" src
rg -n "@tanstack/react-query|QueryClientProvider|createAppQueryClient" src
```

期望输出：第 1 条为空（或只命中 `useMutationQueueAutoSync` 这类同名巧合，逐个确认不是 react-query API）；第 2 条**只命中** 3 个文件：

- `src/shared/api/queryClient.ts`
- `src/app/providers/AppProviders.tsx`
- `src/features/timer-overlay/TimerOverlayApp.tsx`

如果出现了任何 feature/entities 文件的真实 `useQuery(`/`useMutation(` 调用，**立即停止**：说明 08-06 已开始落地，路线 A 作废，改走路线 B 并在进度表说明。

- **自查点**：命中文件数 = 3，且无真实 hook 调用。

#### 步骤 A2：从 AppProviders.tsx 摘除 Provider

打开 `apps/web/src/app/providers/AppProviders.tsx`。

修改前（相关行，省略无关代码）：

```tsx
import { QueryClientProvider } from '@tanstack/react-query'
import { createAppQueryClient } from '@/shared/api/queryClient'

const queryClient = createAppQueryClient()

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        {/* RouteProgressBar / GlobalErrorBoundary / ... */}
      </BrowserRouter>
    </QueryClientProvider>
  )
```

修改后：

```tsx
// 两个 import 与 const queryClient 行整行删除

  return (
    <BrowserRouter>
      {/* 内部结构一行不改，原样保留 */}
    </BrowserRouter>
  )
```

- **不要做什么**：不要动 `useMutationQueueAutoSync()` 调用、`cleanupExpiredAppLogs()`、window error/unhandledrejection 监听、`GlobalTimerProvider`/`QuizLauncherProvider` 等任何其他 Provider 层级与顺序。
- **自查点**：在该文件内搜索 "query"（不区分大小写）无匹配；JSX 只少了最外面一层。

#### 步骤 A3：从 TimerOverlayApp.tsx 摘除 Provider

打开 `apps/web/src/features/timer-overlay/TimerOverlayApp.tsx`，做与 A2 完全同构的修改：删除第 3 行 `QueryClientProvider` import、第 5 行 `createAppQueryClient` import、第 8 行 `const queryClient = createAppQueryClient()`，把 JSX 中 `<QueryClientProvider client={queryClient}>...</QueryClientProvider>` 替换为其子元素（`<BrowserRouter>` + `<TimerOverlayPage />` + `<Toaster />` 原样保留）。

- **不要做什么**：不要动 `useEffect` 里给 body/documentElement 加 `memory-anki-timer-overlay-page` class 的逻辑（Electron 悬浮窗透明背景依赖它）。
- **自查点**：文件内搜索 "query" 无匹配。

#### 步骤 A4：删除 queryClient.ts

先确认引用已清零：

```powershell
rg -n "shared/api/queryClient" src
```

期望输出为空。然后删除文件 `apps/web/src/shared/api/queryClient.ts`。

- **不要做什么**：不要动同目录的 `http.ts`、`contracts/`、`generated.ts`（后者归 07-05 处理）。
- **自查点**：`npm run typecheck` 无 "Cannot find module" 报错。

#### 步骤 A5：卸载依赖

```powershell
cd D:\322321\Memory-Anki\apps\web
npm uninstall @tanstack/react-query
```

- **不要做什么**：不要顺手卸载/升级其他任何依赖（依赖归位问题统一见 07-10）。
- **自查点**：`package.json` 中已无 `@tanstack/react-query`；`npm run build` 成功。

#### 回滚方式

```powershell
cd D:\322321\Memory-Anki\apps\web
git checkout -- src/app/providers/AppProviders.tsx src/features/timer-overlay/TimerOverlayApp.tsx src/shared/api/queryClient.ts package.json package-lock.json
npm install
```

若已 commit，则 `git revert <commit>` 后 `npm install`。

## 3. 测试验收标准

路线 B（推荐）：无代码改动，仅登记决策，无需跑命令；把 08-06 的"依赖文档"里补上"07-01 已裁决保留"即可。

路线 A 执行后，全部命令必须通过：

```powershell
cd D:\322321\Memory-Anki\apps\web
npm run typecheck   # 期望：0 错误
npm run lint        # 期望：0 错误
npm run test        # 期望：97 个测试文件全部通过（改动前先跑一遍记录基线）
npm run build       # 期望：构建成功
```

行为验收（操作 → 期望现象）：

- 启动 `npm run dev` 打开 /freestyle → 今日训练/随心练习卡片流正常加载（数据层本就不走 react-query，不应有任何差异）。
- 打开 /palaces、/profile、/dashboard → 列表与统计正常渲染。
- 打开 /timer-overlay 路由（或 `npm run desktop:timer`）→ 悬浮计时器正常渲染、按钮可点。
- 制造一次请求失败（停掉后端）→ 错误 toast 照常出现（错误处理在 http.ts，与被删代码无关）。

回归检查：

- Toaster（sonner）、全局计时器、路由进度条、全局错误边界等 Provider 内其余功能不受影响。
- `npm run build` 后 dist 产物中不再包含 react-query chunk（体积应可见下降）。

## 4. 进度记录（交接用）

| 时间 | 执行者 | 动作 | 结果/备注 |
|---|---|---|---|
| 2026-07-08 | 文档撰写代理（fable-07） | 文档创建 | 核实：挂载点有 2 处（AppProviders + TimerOverlayApp），全库 0 个 useQuery/useMutation；推荐路线 B，与 08-06 互斥 |
