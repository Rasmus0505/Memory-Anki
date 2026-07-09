---
编号: 07-01
标题: 决策 @tanstack/react-query 的去留：移除依赖（路线 A）或落地使用（路线 B，推荐）
类型: 删减
范围: 前端
优先级: P1
预估工作量: S（<2h，仅决策 + 路线 A 执行；路线 B 的执行在 08-06）
依赖文档: 无（若选路线 B，后续执行依赖 08-06）
状态: 未开始（本文档是决策类文档：执行前必须先由负责人在"进度记录"中写下选定路线，再按对应清单执行）
负责代理: 无
完成时间: 无
---

## 1. 原始需求

`apps/web/package.json` 第 35 行声明了 `"@tanstack/react-query": "^5.100.9"`，`apps/web/src/app/providers/AppProviders.tsx` 第 54 行与 `apps/web/src/features/timer-overlay/TimerOverlayApp.tsx` 第 21 行都挂载了 `QueryClientProvider`（QueryClient 由 `apps/web/src/shared/api/queryClient.ts` 创建，staleTime 30s、retry 2 次），**但全库没有任何一个 `useQuery` / `useMutation` / `useQueryClient` 调用**（已用 rg 全量核实，仅有 Provider 挂载和 `useMutationQueueAutoSync` 这个同名无关 hook）。

与此同时，项目自研了一套与 react-query 功能高度重叠的轮子：

- `apps/web/src/shared/api/promiseWarmupCache.ts`（92 行）：手写的 Promise 预热缓存，实现了 TTL（默认 30s，与 queryClient 的 staleTime 相同）、LRU 淘汰（上限 24 条）、prefetch/consume/invalidate——这正是 react-query 的 `prefetchQuery` + `staleTime` + `invalidateQueries` 的功能子集。
- `apps/web/src/entities/palace/api/catalogApi.ts` 第 19 行的 `PALACE_CATALOG_INVALIDATED_EVENT`（`'palace-catalog:invalidated'`）：用 window CustomEvent 手工广播缓存失效，监听方在 `features/palace-catalog/PalaceShelfPage.tsx:189` 和 `features/palace-catalog/PalaceListPage.tsx:99`——这正是 react-query `invalidateQueries` 自动触发重取的功能。

当前状态是最差的组合：**依赖的体积和心智负担照付，收益为零，同时还维护着一套重复功能的自研代码**。必须二选一。

## 决策对比与推荐

| 维度 | 路线 A：移除依赖 | 路线 B：落地使用（推荐） |
|---|---|---|
| 立即工作量 | S（删 3 个文件里的引用 + 卸载依赖） | 0（本文档不动代码，执行在 08-06） |
| 长期维护 | 继续维护 promiseWarmupCache（92 行）+ CustomEvent 失效广播这套自研轮子，且它没有 devtools、没有重试/去重/窗口聚焦重取 | 逐步删除 promiseWarmupCache 与 PALACE_CATALOG_INVALIDATED_EVENT，缓存/失效/重试统一收敛到成熟库 |
| 风险 | 极低 | 中（迁移期两套缓存并存，需按页面逐步替换） |
| 与其他文档关系 | 与 08-06 冲突（选 A 则 08-06 作废） | 08-06 负责执行落地；07-09 中 palace-catalog 事件届时一并消亡 |

**推荐路线 B**，理由：

1. 自研的 `promiseWarmupCache` + CustomEvent 失效广播已经在重新发明 react-query 的核心三件事（staleTime 缓存、prefetch、invalidate），而且实现更弱（无去重、无错误重试、无 devtools、失效后靠每个页面自己挂事件监听器手动重取）。
2. 依赖已经安装、Provider 已经挂好、QueryClient 配置（staleTime 30s）与自研缓存的 TTL（30s）语义一致，迁移是"平移"而非"重构"。
3. 按 1.md Karpathy 准则，"删除要安全"——路线 B 最终删掉的自研代码（92 行 + 各页面的事件监听）多于路线 A 删掉的代码（Provider 挂载 + 13 行 queryClient），净删除量更大。

**若负责人拍板选路线 A**，按下面第 2 节执行；**若选路线 B**，本文档标记"已完成（决策=B）"，执行工作全部转到 08-06，本文档不再产生代码改动。

## 2. 详细执行清单（仅路线 A 时执行）

> 不要做什么：不要动 `apps/web/src/shared/api/promiseWarmupCache.ts`、`catalogApi.ts`、`useMutationQueue.ts`（`useMutationQueueAutoSync` 与 react-query 无关，是自研离线队列）；不要动 fable/ 以外的任何非列出文件。

1. 安全检查：确认全库没有 `useQuery`/`useMutation` 调用。
   - 命令：`cd apps/web && rg -n "useQuery\(|useMutation\(|useQueryClient\(" src`
   - 期望结果：**空输出**（`useMutationQueueAutoSync` 不含 `(` 后缀故不会命中；若有任何命中，停止执行，说明现状已变化，改走路线 B）。
2. 打开 `apps/web/src/app/providers/AppProviders.tsx`，做三处删除：
   - 删除第 3 行 `import { QueryClientProvider } from '@tanstack/react-query'`；
   - 删除第 7 行 `import { createAppQueryClient } from '@/shared/api/queryClient'` 与第 15 行 `const queryClient = createAppQueryClient()`；
   - 把 JSX 中包裹层去掉：

   修改前（第 53-69 行附近）：

   ```tsx
   return (
     <QueryClientProvider client={queryClient}>
       <BrowserRouter>
         ...
       </BrowserRouter>
     </QueryClientProvider>
   )
   ```

   修改后：

   ```tsx
   return (
     <BrowserRouter>
       ...
     </BrowserRouter>
   )
   ```

   - 自查点：文件内不再出现 `QueryClient` 字样；`BrowserRouter` 仍是最外层。
3. 打开 `apps/web/src/features/timer-overlay/TimerOverlayApp.tsx`，同样删除第 3 行 import、第 5 行 `createAppQueryClient` import、第 8 行 `const queryClient = ...`，并把 JSX 的 `<QueryClientProvider client={queryClient}>...</QueryClientProvider>` 包裹层去掉，保留内部的 `<BrowserRouter>` 结构。
   - 自查点：`rg -n "tanstack" apps/web/src/features/timer-overlay` 输出为空。
4. 删除文件前的安全检查：`cd apps/web && rg -n "shared/api/queryClient" src`
   - 期望结果：**空输出**（前两步已删掉仅有的两个引用；若非空，先处理列出的引用）。
5. 删除文件 `apps/web/src/shared/api/queryClient.ts`。
6. 卸载依赖：`cd apps/web && npm uninstall @tanstack/react-query`
   - 自查点：`package.json` dependencies 中不再有 `@tanstack/react-query`。
7. 最终安全检查：`cd apps/web && rg -n "@tanstack" src package.json`
   - 期望结果：**空输出**。

## 3. 测试验收标准

- `cd apps/web && npm run typecheck` → 0 错误。
- `cd apps/web && npm run test` → 全部通过（原本就没有测试引用 react-query）。
- `cd apps/web && npm run lint` → 0 错误。
- `cd apps/web && npm run build` → 构建成功。
- 行为验收：
  - 打开 `/freestyle` 首页 → 页面正常渲染、卡片流可加载；
  - 打开 `/palaces` 书架页，新建一个宫殿后返回 → 列表出现新宫殿（自研失效广播仍工作）；
  - 打开 `/timer-overlay` 路由 → 计时浮层正常显示。
- 回归检查：离线变更队列（断网做修改后恢复网络自动重放）不受影响——它由 `useMutationQueueAutoSync` 驱动，与本次删除无关。

## 4. 进度记录（交接用）

| 时间 | 执行者 | 动作 | 结果/备注 |
|---|---|---|---|
| 2026-07-08 22:30 | 文档撰写代理 | 文档创建 | 已核实：全库 0 个 useQuery；Provider 挂载点 2 处；自研缓存 92 行。**执行前必须先在此表登记选定路线（A 或 B）** |
