---
编号: 07-06
标题: 用通用 SkeletonLayout 原语合并 9 个手写骨架屏（先删 2 个死文件，再收敛 7 个在用文件）
类型: 删减
范围: 前端
优先级: P1
预估工作量: M（2-8h）
依赖文档: 无
状态: 已完成
负责代理: fable Worker 5
完成时间: 2026-07-09 00:47
---

## 1. 原始需求

全库有 9 个手写骨架屏组件，都只是在用 `shared/components/ui/skeleton.tsx`（15 行基元）反复拼同几种形状（页头条、工具条、"图标+两行文字"列表行、大面积占位块、label+input 表单行），已逐个核实（文件 → 消费方）：

| 骨架文件 | 消费方 |
|---|---|
| `apps/web/src/features/dashboard/DashboardSkeleton.tsx`（73 行） | `DashboardPage.tsx:449` |
| `apps/web/src/features/knowledge/KnowledgeSkeleton.tsx`（43 行） | **无（死代码，rg 全库 0 引用）** |
| `apps/web/src/features/profile/ProfileSkeleton.tsx`（35 行） | `ProfileSettingsPage.tsx:146` |
| `apps/web/src/features/english/EnglishWorkspaceSkeleton.tsx`（39 行） | `EnglishWorkspacePage.tsx:81` |
| `apps/web/src/features/palace-catalog/components/PalaceListSkeleton.tsx`（42 行） | `PalaceListPage.tsx:131` |
| `apps/web/src/features/palace-catalog/components/PalaceShelfSkeleton.tsx`（42 行） | `PalaceShelfPage.tsx:391` |
| `apps/web/src/features/palace-edit/PalaceEditSkeleton.tsx`（41 行） | `PalaceEditPage.tsx:148、454` |
| `apps/web/src/features/review/ReviewSessionSkeleton.tsx`（31 行） | `ReviewSessionContainer.tsx:380` |
| `apps/web/src/shared/components/palace-view/PalaceViewSkeleton.tsx`（29 行） | **无（死代码，rg 全库 0 引用）** |

目标：删除 2 个死文件；为其余 7 个抽取共享原语 `skeleton-layout.tsx`，使每个页面骨架从 30-70 行的手拼降为若干行组合调用。**各页骨架只需形状近似，不追求像素一致。**

## 2. 详细执行清单

> 不要做什么：不要动 `shared/components/ui/skeleton.tsx` 基元本身；不要改变各消费方"何时显示骨架"的条件逻辑；不要把页面骨架组件搬进 shared（features 层的骨架留在 features，遵守 FSD）；不要为追求像素一致给原语加大量一次性参数。

### 第一部分：删除 2 个无引用的死文件

1. 安全检查：`cd apps/web && rg -n "KnowledgeSkeleton|PalaceViewSkeleton" src`
   - 期望结果：只有两个定义文件自身各 1 行（`export function ...`）。若出现任何 import 行，停止，该文件改归入第二部分处理。
2. 删除 `apps/web/src/features/knowledge/KnowledgeSkeleton.tsx`。
3. 删除 `apps/web/src/shared/components/palace-view/PalaceViewSkeleton.tsx`。
4. 自查点：`npm run typecheck` 0 错误；再跑一次第 1 步命令，期望**空输出**。

### 第二部分：新建共享原语

5. 新建文件 `apps/web/src/shared/components/ui/skeleton-layout.tsx`，完整内容如下：

   ```tsx
   import { Skeleton } from '@/shared/components/ui/skeleton'
   import { cn } from '@/shared/lib/utils'

   /** 页头骨架：标题条 + 可选右侧按钮位。 */
   export function SkeletonPageHeader({ actions = 0, withIcon = false }: { actions?: number; withIcon?: boolean }) {
     return (
       <div className="flex items-center justify-between">
         <div className="flex items-center gap-3">
           {withIcon ? <Skeleton className="size-8 rounded-md" /> : null}
           <Skeleton className="h-8 w-32" />
         </div>
         {actions > 0 ? (
           <div className="flex gap-2">
             {Array.from({ length: actions }).map((_, i) => (
               <Skeleton key={i} className="h-9 w-24 rounded-md" />
             ))}
           </div>
         ) : null}
       </div>
     )
   }

   /** 工具条骨架：一个搜索框位 + 若干按钮位。 */
   export function SkeletonToolbar({ buttons = 1, framed = false }: { buttons?: number; framed?: boolean }) {
     return (
       <div className={cn('flex items-center gap-3', framed && 'rounded-lg border p-4')}>
         <Skeleton className="h-9 flex-1 max-w-xs rounded-md" />
         {Array.from({ length: buttons }).map((_, i) => (
           <Skeleton key={i} className="size-9 rounded-md" />
         ))}
       </div>
     )
   }

   /** 列表行骨架：`图标 + 两行文字 + 可选尾部徽标`，重复 rows 次。 */
   export function SkeletonListRows({ rows = 3, withTrailing = false, framed = false }: { rows?: number; withTrailing?: boolean; framed?: boolean }) {
     return (
       <div className="space-y-2">
         {Array.from({ length: rows }).map((_, i) => (
           <div key={i} className={cn('flex items-center gap-3 py-2', framed && 'rounded-xl border p-4 py-4')}>
             <Skeleton className="size-10 rounded-lg" />
             <div className="flex-1 space-y-2">
               <Skeleton className="h-4 w-2/3" />
               <Skeleton className="h-3 w-1/3" />
             </div>
             {withTrailing ? <Skeleton className="h-6 w-14 rounded-md" /> : null}
           </div>
         ))}
       </div>
     )
   }

   /** 表单行骨架：`label + 输入框`，重复 rows 次。 */
   export function SkeletonFormRows({ rows = 4 }: { rows?: number }) {
     return (
       <div className="flex flex-col gap-5">
         {Array.from({ length: rows }).map((_, i) => (
           <div key={i} className="flex flex-col gap-2">
             <Skeleton className="h-4 w-24" />
             <Skeleton className="h-9 w-full max-w-md rounded-md" />
           </div>
         ))}
       </div>
     )
   }

   /** 大面积内容占位（图表 / 画布 / 编辑器区）。 */
   export function SkeletonPanel({ heightClassName = 'h-52', framed = false }: { heightClassName?: string; framed?: boolean }) {
     return framed ? (
       <div className="rounded-lg border p-4">
         <Skeleton className={cn('w-full rounded-xl', heightClassName)} />
       </div>
     ) : (
       <Skeleton className={cn('w-full rounded-xl', heightClassName)} />
     )
   }
   ```

   - 自查点：`npm run typecheck` 0 错误；该文件只 import shared 内部模块，不违反 boundaries。

### 第三部分：逐页替换（每替换一页跑一次 typecheck + 该页测试）

> 通用模式：保留各骨架文件与导出名不变（消费方 import 零改动），仅把文件内部的手拼 JSX 换成原语组合。形状近似即可。

6. 重写 `apps/web/src/features/profile/ProfileSkeleton.tsx`（形状：页头 + tab 条 + 表单卡）：

   ```tsx
   import { Card, CardContent } from '@/shared/components/ui/card'
   import { Skeleton } from '@/shared/components/ui/skeleton'
   import { SkeletonFormRows, SkeletonPageHeader } from '@/shared/components/ui/skeleton-layout'

   export function ProfileSkeleton() {
     return (
       <div className="flex flex-col gap-6">
         <SkeletonPageHeader />
         <div className="flex gap-1 border-b pb-px">
           {Array.from({ length: 3 }).map((_, i) => (
             <Skeleton key={i} className="h-9 w-20 rounded-md" />
           ))}
         </div>
         <Card>
           <CardContent className="flex flex-col gap-5 pt-6">
             <SkeletonFormRows rows={4} />
             <Skeleton className="h-9 w-20 rounded-md" />
           </CardContent>
         </Card>
       </div>
     )
   }
   ```

7. 重写 `apps/web/src/features/english/EnglishWorkspaceSkeleton.tsx`：`SkeletonPageHeader` + 左侧 `SkeletonPanel heightClassName="h-32"`（上传卡内）+ 右侧 `SkeletonListRows rows={4} withTrailing`，保留原两列 grid 外壳 `grid xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)] gap-4`。
8. 重写 `apps/web/src/features/palace-catalog/components/PalaceListSkeleton.tsx`：`SkeletonPageHeader withIcon actions={1}` + `SkeletonToolbar buttons={1}` + 两组（组标题 `Skeleton h-5 w-20` + `SkeletonListRows rows={3} withTrailing framed`）。
9. 重写 `apps/web/src/features/palace-catalog/components/PalaceShelfSkeleton.tsx`：`SkeletonPageHeader actions={1}` + `SkeletonToolbar buttons={3} framed` + 卡片 grid（保留原 `grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4` 外壳，格子内部用 `SkeletonListRows rows={1}` + 一条 `Skeleton h-3 w-full`）。
10. 重写 `apps/web/src/features/palace-edit/PalaceEditSkeleton.tsx`：`SkeletonPageHeader withIcon` + 保留 `grid xl:grid-cols-[300px_minmax(0,1fr)] gap-4` 外壳，左栏两个 framed 区块（`SkeletonFormRows`/`SkeletonPanel heightClassName="h-20"`），右栏 `SkeletonPanel heightClassName="h-[450px]" framed`。
11. 重写 `apps/web/src/features/review/ReviewSessionSkeleton.tsx`：保留居中外壳 `flex min-h-[60vh] flex-col items-center justify-center gap-6` 与进度条两行（此形状特殊、保留手拼），卡片内部用 `SkeletonPanel heightClassName="h-20"` + 三个按钮位。
12. 重写 `apps/web/src/features/dashboard/DashboardSkeleton.tsx`：页头 `SkeletonPageHeader`；5 个统计卡 grid 外壳保留，卡内保留现有 3 行小骨架（形状特殊）；下方 4 张卡用 `SkeletonListRows` 与 `SkeletonPanel heightClassName="h-52"` 组合。
    - 每步自查点：`cd apps/web && npm run typecheck`，且对应页面测试通过（如 `npx vitest run src/features/palace-catalog`）。
13. 收尾检查（重复形状确已收敛）：`cd apps/web && rg -c "size-10 rounded-lg" src/features`
    - 期望结果：0 个文件命中（该"图标+两行文字"行形状已统一进 `SkeletonListRows`）。

## 3. 测试验收标准

- `cd apps/web && npm run typecheck && npm run test && npm run lint && npm run build` → 全部通过。
- 行为验收（打开 dev server，用浏览器 DevTools 把网络调成 Slow 4G 以看清骨架）：
  - 访问 `/dashboard` → 加载期显示统计卡+图表骨架，形状与改前近似；
  - 访问 `/profile` → 显示 tab+表单骨架；
  - 访问 `/palaces` 与 `/palaces/list` → 各自显示卡片格/分组列表骨架；
  - 访问 `/english` → 显示两列骨架；
  - 访问 `/palaces/{id}/edit` → 显示侧栏+编辑区骨架；
  - 进入一个复习会话 `/review/session/{id}` → 显示居中卡片骨架。
- 回归检查：骨架消失后各页真实内容渲染不受影响；`data-testid="session-timer-bar"` 等与骨架无关的测试锚点不被波及。

## 4. 进度记录（交接用）

| 时间 | 执行者 | 动作 | 结果/备注 |
|---|---|---|---|
| 2026-07-08 22:30 | 文档撰写代理 | 文档创建 | 已核实 9 个骨架的结构与消费方；KnowledgeSkeleton、PalaceViewSkeleton 为 0 引用死代码可直删 |
| 2026-07-09 00:47 | fable Worker 5 | 执行完成 | 删除 2 个无引用死骨架；新增 `shared/components/ui/skeleton-layout.tsx`；保留 7 个 feature skeleton 导出并改为组合通用原语，消费方加载条件未改 |
