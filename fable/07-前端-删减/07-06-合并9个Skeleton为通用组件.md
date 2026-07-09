---
编号: 07-06
标题: 合并 9 个手写页面骨架为 2~3 个通用布局骨架（并删除其中 2 个死代码骨架）
类型: 删减
范围: 前端
优先级: P1
预估工作量: M（2-8h）
依赖文档: 无
状态: 未开始
负责代理: 无
完成时间: 无
---

# 07-06 合并 9 个 Skeleton 为通用组件

## 1. 原始需求

项目已有骨架原语 `apps/web/src/shared/components/ui/skeleton.tsx`（15 行，`animate-pulse rounded-md bg-muted` 的 div），但各页面在其上各写了一份整页骨架，共 9 个文件、约 330 行，布局高度雷同。经逐个 Read + grep 引用方核实：

| 骨架文件 | 行数 | 引用方 | 布局模式 |
|---|---|---|---|
| `features/dashboard/DashboardSkeleton.tsx` | 73 | DashboardPage.tsx:449 | 页头 + 统计卡网格 + 双列卡片 |
| `features/knowledge/KnowledgeSkeleton.tsx` | 43 | **无（死代码）** | 页头 + 侧栏 320px + 内容区 |
| `features/profile/ProfileSkeleton.tsx` | 35 | ProfileSettingsPage.tsx:146 | 页头 + tab 栏 + 表单卡 |
| `features/english/EnglishWorkspaceSkeleton.tsx` | 39 | EnglishWorkspacePage.tsx:81 | 页头 + 双列卡片 |
| `features/palace-catalog/components/PalaceListSkeleton.tsx` | 42 | PalaceListPage.tsx:131 | 页头 + 工具栏 + 分组卡片列表 |
| `features/palace-catalog/components/PalaceShelfSkeleton.tsx` | 42 | PalaceShelfPage.tsx:391 | 页头 + 工具栏 + 卡片网格 |
| `features/palace-edit/PalaceEditSkeleton.tsx` | 41 | PalaceEditPage.tsx:148、454 | 页头 + 侧栏 300px + 内容区 |
| `features/review/ReviewSessionSkeleton.tsx` | 31 | ReviewSessionContainer.tsx:380 | 居中单卡片 + 进度条 |
| `shared/components/palace-view/PalaceViewSkeleton.tsx` | 29 | **无（死代码）** | 页头 + 大内容区 |

共同点：全部由"页头行（标题条 + 按钮条）→ 可选工具栏 → 主体（卡片网格 / 侧栏+内容 / 居中卡片）"组成。目标：在 shared 层沉淀 3 个通用布局骨架，逐页替换后删除 9 个手写文件（其中 2 个死代码直接删）。

## 2. 详细执行清单

### 步骤 1：删除前安全检查

```powershell
cd D:\322321\Memory-Anki\apps\web
rg -n "DashboardSkeleton|KnowledgeSkeleton|ProfileSkeleton|EnglishWorkspaceSkeleton|PalaceListSkeleton|PalaceShelfSkeleton|PalaceEditSkeleton|ReviewSessionSkeleton|PalaceViewSkeleton" src
```

期望：`KnowledgeSkeleton`、`PalaceViewSkeleton` 只命中各自定义文件（0 个引用方）；其余 7 个各有 1~2 个引用方（见上表）。若引用关系有变化，按实际引用方执行后续替换。

- **自查点**：引用清单与上表一致（或差异已记录进进度表）。

### 步骤 2：先删 2 个死代码骨架

删除 `apps/web/src/features/knowledge/KnowledgeSkeleton.tsx` 与 `apps/web/src/shared/components/palace-view/PalaceViewSkeleton.tsx`。

- 这两个文件没有任何 import 方，删除零风险。
- **自查点**：`npm run typecheck` 通过。

### 步骤 3：新建通用骨架文件

新建 `apps/web/src/shared/components/skeletons/PageSkeletons.tsx`，包含 3 个导出（骨架内容按下述规格实现，均只依赖 `@/shared/components/ui/skeleton` 与 `@/shared/components/ui/card`，**不得**依赖任何 feature/entities 代码——shared 分层约束）：

1. `CardGridPageSkeleton`——覆盖 Dashboard / PalaceShelf / PalaceList / EnglishWorkspace / Profile：

```tsx
interface CardGridPageSkeletonProps {
  /** 页头右侧是否有操作按钮条 */
  headerAction?: boolean
  /** 页头下方工具栏/tab 栏占位数量，0 表示无 */
  toolbarSlots?: number
  /** 主体卡片列数（Tailwind 类由内部映射，支持 1/2/3/4） */
  columns?: 1 | 2 | 3 | 4
  /** 卡片数量 */
  cards?: number
}
```

结构：`<div className="space-y-6">` → 页头行（`h-8 w-32` 标题条 + 可选 `h-9 w-24` 按钮条）→ 可选工具栏行（N 个 `h-9` 条）→ `grid gap-4` 卡片区，每张卡片内部为"图标块 + 两行文字条"的通用样子（参考现 PalaceShelfSkeleton 第 22~37 行的卡片内容）。

2. `SidebarPageSkeleton`——覆盖 PalaceEdit（及未来 Knowledge 页需要时）：

```tsx
interface SidebarPageSkeletonProps {
  /** 侧栏宽度 Tailwind 任意值类，默认 'xl:grid-cols-[300px_minmax(0,1fr)]' 对应的 300px */
  sidebarWidth?: '300px' | '320px'
  /** 内容区主块高度，默认 'h-[450px]' */
  contentHeight?: string
}
```

结构：页头行 → `grid xl:grid-cols-[300px_minmax(0,1fr)] gap-4`，左列两张列表卡（参考 PalaceEditSkeleton 第 15~26 行），右列工具条 + 大块占位（参考其第 28~36 行）。

3. `CenteredCardSkeleton`——覆盖 ReviewSession：结构照搬现 `ReviewSessionSkeleton.tsx` 全文（进度条区 + `max-w-2xl` 卡片），无 props。

- 通用组件刻意**不追求像素级还原**每页原骨架，只要"页面轮廓 + 闪烁占位"成立即可；骨架只在加载的几百毫秒内可见。
- **自查点**：新文件通过 `npm run typecheck`、`npm run lint`（注意 shared 不得 import features——eslint-plugin-boundaries 会拦截）。

### 步骤 4：逐页替换（每替换一页跑一次该页测试）

按下表逐个修改引用方，把原 import 与 JSX 替换为通用骨架：

| 引用方文件 | 原 JSX | 替换为 |
|---|---|---|
| `features/dashboard/DashboardPage.tsx`:449 | `<DashboardSkeleton />` | `<CardGridPageSkeleton toolbarSlots={0} columns={2} cards={6} />` |
| `features/profile/ProfileSettingsPage.tsx`:146 | `<ProfileSkeleton />` | `<CardGridPageSkeleton toolbarSlots={3} columns={1} cards={1} />` |
| `features/english/EnglishWorkspacePage.tsx`:81 | `<EnglishWorkspaceSkeleton />` | `<CardGridPageSkeleton headerAction={false} columns={2} cards={2} />` |
| `features/palace-catalog/PalaceListPage.tsx`:131 | `<PalaceListSkeleton />` | `<CardGridPageSkeleton headerAction toolbarSlots={2} columns={1} cards={6} />` |
| `features/palace-catalog/PalaceShelfPage.tsx`:391 | `<PalaceShelfSkeleton />` | `<CardGridPageSkeleton headerAction toolbarSlots={4} columns={4} cards={8} />` |
| `features/palace-edit/PalaceEditPage.tsx`:148、454 | `<PalaceEditSkeleton />`（2 处） | `<SidebarPageSkeleton />` |
| `features/review/ReviewSessionContainer.tsx`:380 | `<ReviewSessionSkeleton />` | `<CenteredCardSkeleton />` |

import 一律写 `import { CardGridPageSkeleton } from '@/shared/components/skeletons/PageSkeletons'`（按需换组件名）。

- 一次只改一个文件；不要顺手改动引用方文件里的任何加载判断逻辑（`if (loading) return ...` 的条件保持原样）。
- 若某页测试断言了原骨架的特定 testid/文本，按新组件更新断言（通用骨架可加 `data-testid="page-skeleton"` 统一锚点）。
- **自查点**：每页替换后 `npx vitest run src/features/<该页目录>` 全绿。

### 步骤 5：删除 7 个旧骨架文件

再跑一次步骤 1 的 grep，确认 9 个旧名字全部只剩 0 命中后，删除：

- `features/dashboard/DashboardSkeleton.tsx`
- `features/profile/ProfileSkeleton.tsx`
- `features/english/EnglishWorkspaceSkeleton.tsx`
- `features/palace-catalog/components/PalaceListSkeleton.tsx`
- `features/palace-catalog/components/PalaceShelfSkeleton.tsx`
- `features/palace-edit/PalaceEditSkeleton.tsx`
- `features/review/ReviewSessionSkeleton.tsx`

- **自查点**：`rg -n "Skeleton" src -l` 只剩 `ui/skeleton.tsx`、`skeletons/PageSkeletons.tsx`、`state-placeholders.tsx` 及各引用方。

### 回滚方式

```powershell
cd D:\322321\Memory-Anki
git checkout -- apps/web/src
```

（纯 src 改动；已 commit 则 `git revert`。）

## 3. 测试验收标准

```powershell
cd D:\322321\Memory-Anki\apps\web
npm run test        # 期望：全部通过
npm run typecheck   # 期望：0 错误
npm run lint        # 期望：0 错误（重点：boundaries 规则确认 shared 未反向依赖 features）
npm run build       # 期望：构建成功
```

行为验收（`npm run dev`，用浏览器 DevTools Network 面板设 "Slow 4G" 放大加载窗口）：

- 依次访问 /dashboard、/palaces、/palaces/list、/english、/profile、/palaces/:id/edit、/review/session/:id → 每页加载期间出现闪烁骨架，轮廓与最终页面大致对应（页头位置、栏目划分不跳变过大）。
- 骨架消失后页面正常渲染。

回归检查：各页数据加载逻辑（loading 条件、错误态）不变；PalaceEditPage 两处骨架（初始加载 + 局部区域，第 148、454 行）都被替换且都正常。

## 4. 进度记录（交接用）

| 时间 | 执行者 | 动作 | 结果/备注 |
|---|---|---|---|
| - | - | 文档创建 | 核实发现 KnowledgeSkeleton 与 PalaceViewSkeleton 为 0 引用死代码，可直接删除 |
