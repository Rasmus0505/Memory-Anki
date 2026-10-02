# 加载体验优化方案

## 概述

基于现有架构（自定义 keep-alive 路由、useState+useEffect 数据加载、Sonner toast、BackgroundTaskBar），在不引入大规模重构的前提下，分四个方向优化加载体验。

---

## 一、路由切换进度条

**方案：NProgress（推荐）**

- 库：`nprogress`（2KB gzip），最成熟的顶部进度条方案
- 集成点：在 `AppRouter` 中监听 `location` 变化，start/done 控制进度条
- 样式：顶部细条（2px），颜色用 `hsl(var(--primary))`，与项目配色一致
- 由于 keep-alive 路由机制，已缓存的页面切换是瞬时的（不触发进度条），只有首次加载 lazy chunk 时会显示

**实现位置：**
- 新建 `src/shared/components/route-progress/RouteProgressBar.tsx`
- 在 `AppProviders.tsx` 中挂载（需在 BrowserRouter 内部）
- 用 `useLocation` + `useEffect` 驱动 start/done
- 配合 Suspense：利用 `React.startTransition` 或 `useDeferredValue` 让进度条在 chunk 加载期间可见

---

## 二、按钮 Loading 态

**方案：扩展现有 Button 组件**

给 `Button` 增加 `loading?: boolean` prop：
- `loading=true` 时：
  - 自动 `disabled`
  - 在文字前显示 `<LoaderCircle className="animate-spin" />`（Lucide，项目已有）
  - 可选 `loadingText` prop 替换文字（如 "保存中…"）
- 保持向后兼容，不影响已有使用方式

**实现位置：**
- 修改 `src/shared/components/ui/button.tsx`
- 无需新依赖

---

## 三、骨架屏全覆盖

**方案：每个主要页面一个专属 Skeleton 组件**

不使用 `react-loading-skeleton`（当前 Skeleton 原语够用），而是为每个页面创建匹配其真实布局的骨架组件。

### 需要覆盖的页面 + 骨架结构

| 页面 | 骨架文件 | 布局摘要 |
|------|---------|---------|
| Dashboard | `DashboardSkeleton.tsx` | 5 stat cards grid + 2-col content cards + 2-col chart cards |
| PalaceShelf | `PalaceShelfSkeleton.tsx` | toolbar card + 4-col card grid (6张卡片) |
| PalaceList | `PalaceListSkeleton.tsx` | toolbar + 2 组标题+卡片列表 |
| Knowledge | `KnowledgeSkeleton.tsx` | 左侧 320px sidebar + 右侧大区域 |
| English | `EnglishWorkspaceSkeleton.tsx` | 2-col cards (1.15fr + 0.85fr) |
| Profile | `ProfileSkeleton.tsx` | tab bar + 内容面板 |
| PalaceView | `PalaceViewSkeleton.tsx` | header + mind-map 区域 |
| PalaceEdit | `PalaceEditSkeleton.tsx` | sidebar + editor area |
| ReviewSession | `ReviewSessionSkeleton.tsx` | 单卡片居中 |

### 骨架通用模式

```tsx
// 每个 Skeleton 组件复用项目内的 Skeleton 原语
import { Skeleton } from '@/shared/components/ui/skeleton'

export function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      {/* stat cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-2xl" />
        ))}
      </div>
      {/* content grid */}
      <div className="grid lg:grid-cols-2 gap-4">
        <Skeleton className="h-48 rounded-2xl" />
        <Skeleton className="h-48 rounded-2xl" />
      </div>
      {/* charts */}
      <div className="grid xl:grid-cols-2 gap-4">
        <Skeleton className="h-64 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    </div>
  )
}
```

### 替换策略

每个页面的 `if (!data) return <LoadingState ... />` 替换为对应的 `<XxxSkeleton />`。

---

## 四、长任务分步进度

**方案：增强现有 BackgroundTaskBar 的 task model**

当前 task 只有 `progress: number`（百分比），缺少"当前在第几步"的语义。增加 `steps` 字段：

```ts
interface BackgroundTask {
  // 现有字段...
  steps?: { label: string; status: 'pending' | 'active' | 'done' | 'failed' }[]
}
```

**UI 变化：**
- 当 task 有 `steps` 时，在进度条上方显示一排 step indicators（圆点 + label）
- Active step 高亮，done steps 有 checkmark，pending steps 灰色
- 进度条仍然保留（反映整体百分比）

**实现位置：**
- 修改 `src/shared/background-tasks/backgroundTaskRegistry.ts` — 扩展 type
- 修改 `src/shared/background-tasks/BackgroundTaskBar.tsx` — 渲染 steps UI
- 新建 `src/shared/background-tasks/TaskSteps.tsx` — step indicator 子组件

**调用方式（feature 侧）：**
```ts
registerTask({
  id: 'pdf-import-123',
  title: 'PDF 导入',
  steps: [
    { label: '解析文件', status: 'active' },
    { label: 'AI 拆分', status: 'pending' },
    { label: '生成宫殿', status: 'pending' },
  ],
})

// 后续更新
updateTask('pdf-import-123', {
  steps: [
    { label: '解析文件', status: 'done' },
    { label: 'AI 拆分', status: 'active' },
    { label: '生成宫殿', status: 'pending' },
  ],
  progress: 40,
})
```

---

## 实施顺序

1. **Button loading 态**（改动最小，立即可用）
2. **路由进度条**（一次性设置，全局生效）
3. **骨架屏逐页覆盖**（工作量最大，但每页独立，可逐个推进）
4. **长任务分步进度**（需要配合后端/feature 侧一起改 task 注册逻辑）

## 新依赖

| 包 | 用途 | 大小 |
|----|------|------|
| `nprogress` | 路由进度条 | ~2KB gzip |
| `@types/nprogress` | TS 类型 | dev only |

其余均利用项目已有的 Skeleton 原语 + Lucide 图标 + Tailwind，无需新增依赖。
