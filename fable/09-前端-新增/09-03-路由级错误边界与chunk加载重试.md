---
编号: 09-03
标题: 增加路由级错误边界（含重试）、lazy chunk 加载失败自动重试，以及重 widget 局部边界
类型: 新增
范围: 前端
优先级: P0
预估工作量: M（2-8h）
依赖文档: 无
状态: 已完成
负责代理: fable Worker 4
完成时间: 2026-07-09 00:46
---

# 09-03 路由级错误边界与 chunk 加载重试

## 1. 原始需求

前端目前**只有一个全局错误边界** `apps/web/src/app/providers/GlobalErrorBoundary.tsx`（按 `location.pathname` 作为 resetKey 重置，第 80-87 行），挂载在 `AppProviders.tsx` 第 57 行——位于 `AppShell` 之外。任何页面内组件抛错（尤其是 mindmap 画布 `@xyflow/react`、recharts 图表这类重 widget）都会打掉**整个应用外壳**（侧边栏、底部导航一并消失），只剩全屏错误页。

lazy chunk 加载失败（部署新版本后旧 chunk 404 是最常见场景）目前只有两层兜底：`apps/web/index.html` 第 20-97 行的启动诊断脚本（只覆盖"启动时"失败，运行中切页失败不触发 root 为空的检测），以及 PWA 场景下 `apps/web/public/sw.js` 第 167-178 行 `staleScriptRecoveryResponse` 把失败脚本替换为跳转 `/pwa-reset.html` 的代码（只在 Service Worker 生效时工作，桌面浏览器直连开发/生产站点时无效）。`apps/web/vite.config.ts` 已有 `stableChunkCompatPlugin`（第 101-145 行）为 `PalaceEditPage`、`useMindMapImport` 两个 chunk 生成免哈希稳定文件名 + 旧文件名别名（第 9 行 `stableChunkNames`），但**其余所有 chunk 部署后旧哈希文件即消失**，运行中的旧页面切换路由会直接命中 React lazy 报错。

目标：路由内容崩溃只损失内容区并可"重试"；chunk 加载失败先自动重试一次，仍失败则提示刷新；MindMapFrame 与图表容器有局部边界，不再牵连整页。

## 2. 详细执行清单

> 约定：路径相对仓库根目录 `Memory-Anki/`。禁止改动 `GlobalErrorBoundary.tsx` 的现有逻辑（它仍是最外层兜底），禁止改动 `index.html` 启动诊断脚本与 `sw.js`。

### 步骤 1：新建 chunk 加载重试工具

新建文件 `apps/web/src/shared/lib/lazyWithRetry.ts`，完整内容：

```ts
import { lazy, type ComponentType } from 'react'

const CHUNK_ERROR_PATTERN =
  /failed to fetch dynamically imported module|loading chunk|importing a module script failed|load failed|failed to fetch/i

export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '')
  return CHUNK_ERROR_PATTERN.test(message)
}

export class ChunkLoadError extends Error {
  constructor(original: unknown) {
    const originalMessage = original instanceof Error ? original.message : String(original)
    super(`页面资源加载失败（可能是应用刚更新过）：${originalMessage}`)
    this.name = 'ChunkLoadError'
  }
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

/**
 * React.lazy 包装：动态 import 失败时自动重试一次（间隔 500ms）。
 * 仍失败且判定为 chunk 加载问题时抛 ChunkLoadError，
 * 由 RouteErrorBoundary 显示"刷新页面"引导（处理部署后旧 chunk 404）。
 */
export function lazyWithRetry<T extends ComponentType<unknown>>(
  importer: () => Promise<{ default: T }>,
) {
  return lazy(async () => {
    try {
      return await importer()
    } catch (firstError) {
      await delay(500)
      try {
        return await importer()
      } catch (secondError) {
        if (isChunkLoadError(secondError) || isChunkLoadError(firstError)) {
          throw new ChunkLoadError(secondError)
        }
        throw secondError
      }
    }
  })
}
```

说明：动态 import 的 URL 由打包产物固定，无法加 cache-bust 参数；重试主要解决瞬时网络抖动（手机 Tailscale 场景常见）。部署后旧 chunk 已被删除的 404 重试也救不回，所以必须配合步骤 2 的"刷新页面"引导。

自查点：`cd apps/web && npm run typecheck` 通过。

### 步骤 2：新建路由级错误边界

新建文件 `apps/web/src/app/providers/RouteErrorBoundary.tsx`，完整内容：

```tsx
import { Component, type ErrorInfo, type PropsWithChildren } from 'react'
import { Button } from '@/shared/components/ui/button'
import { ErrorState } from '@/shared/components/state-placeholders'
import { isChunkLoadError } from '@/shared/lib/lazyWithRetry'
import { logAppError } from '@/shared/logs/model/appLogs'

interface RouteErrorBoundaryState {
  error: Error | null
}

interface RouteErrorBoundaryProps {
  /** 变化时自动清除错误（传当前 pathname） */
  resetKey: string
}

/**
 * 路由内容区错误边界：挂在 AppShell 之内，崩溃只损失内容区，
 * 侧边栏 / 底部导航 / 命令面板保持可用。
 */
export class RouteErrorBoundary extends Component<
  PropsWithChildren<RouteErrorBoundaryProps>,
  RouteErrorBoundaryState
> {
  state: RouteErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): RouteErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logAppError({
      feature: 'React 渲染',
      stage: 'route_error_boundary',
      error,
      responseSummary: info.componentStack ?? '',
      meta: { componentStack: info.componentStack ?? '' },
    })
  }

  componentDidUpdate(previousProps: RouteErrorBoundaryProps) {
    if (this.state.error && previousProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null })
    }
  }

  handleRetry = () => {
    this.setState({ error: null })
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    const chunkError = isChunkLoadError(error)
    return (
      <div className="flex min-h-[50vh] items-center justify-center p-6">
        <ErrorState
          className="max-w-xl"
          title={chunkError ? '页面资源加载失败' : '这个页面出了点问题'}
          description={
            <span className="space-y-2">
              <span className="block">
                {chunkError
                  ? '应用可能刚发布了新版本，旧的页面资源已不存在。刷新页面即可加载最新版本。'
                  : '页面渲染遇到异常，导航仍然可用。你可以重试渲染，或刷新整页。'}
              </span>
              {error.message ? (
                <span className="block text-xs text-muted-foreground">错误信息：{error.message}</span>
              ) : null}
            </span>
          }
          action={
            <div className="flex flex-wrap justify-center gap-2">
              {chunkError ? (
                <Button type="button" onClick={() => window.location.reload()}>
                  刷新页面
                </Button>
              ) : (
                <>
                  <Button type="button" onClick={this.handleRetry}>
                    重试
                  </Button>
                  <Button type="button" variant="outline" onClick={() => window.location.reload()}>
                    刷新页面
                  </Button>
                </>
              )}
            </div>
          }
        />
      </div>
    )
  }
}
```

自查点：`npm run typecheck` 通过。

### 步骤 3：在 appRoutes.tsx 接入重试 lazy 与路由边界

打开 `apps/web/src/app/router/appRoutes.tsx`：

3a. 第 1 行修改前：

```tsx
import { Suspense, lazy } from 'react'
```

修改后：

```tsx
import { Suspense } from 'react'
import { lazyWithRetry } from '@/shared/lib/lazyWithRetry'
import { RouteErrorBoundary } from '@/app/providers/RouteErrorBoundary'
```

3b. 第 38-56 行的所有 `lazy(...)` 调用（共 14 处：`KnowledgePage`、`FreestylePage`、`EnglishWorkspacePage`、`EnglishCoursePage`、`EnglishReadingPage`、`PalaceEditPage`、`PalaceViewPage`、`PalaceQuizPage`、`ProfilePage`、`ProfileFeedbackPage`、`ProfileTimerPage`、`ProfileAiPage`、`ProfileBackupsPage`、`ReviewSessionPage`、`ReviewFeedbackPreviewRoute`）逐个把 `lazy` 替换为 `lazyWithRetry`。示例，修改前：

```tsx
const KnowledgePage = lazy(preloadKnowledgePage)
```

修改后：

```tsx
const KnowledgePage = lazyWithRetry(preloadKnowledgePage)
```

**不要**改动第 13-22 行的 `preload*` 导出函数本身（AppShell 悬停预热依赖它们）。

3c. 第 157-193 行 `AppRoutes` 组件，用 `RouteErrorBoundary` 包住 `<Routes>`（放在 Suspense 内侧，这样 chunk 加载中仍显示 fallback，渲染错误由边界接住）。修改前：

```tsx
return (
  <Suspense fallback={<RouteFallback />}>
    <Routes location={location}>
```

修改后：

```tsx
return (
  <Suspense fallback={<RouteFallback />}>
    <RouteErrorBoundary resetKey={fallbackPathname}>
      <Routes location={location}>
```

对应地在 `</Routes>` 后补 `</RouteErrorBoundary>`。

说明：`AppRouter.tsx`（keep-alive，最多驻留 4 个路由实例，第 6 行 `MAX_RESIDENT_ROUTE_COUNT`）为每个驻留路由渲染一个独立的 `AppRoutes`，因此每个驻留页面自动获得独立边界，互不牵连。**不要**去改 `AppRouter.tsx`。

架构提醒：`RouteErrorBoundary` 放在 `app/providers/` 下、`lazyWithRetry` 放在 `shared/lib/` 下，符合"`shared` 不依赖 `app/features/entities`"的边界（shared 里的工具不 import app 层）。

自查点：在任一 lazy 页面组件里临时 `throw new Error('test')`，该页显示局部错误卡片，侧边栏和底部导航仍在，点"重试"（修掉 throw 后热更/刷新）恢复；测试完删除临时代码。

### 步骤 4：新建通用 widget 局部边界（shared 层）

新建文件 `apps/web/src/shared/components/widget-error-boundary.tsx`，完整内容：

```tsx
import { Component, type ErrorInfo, type PropsWithChildren, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { logAppError } from '@/shared/logs/model/appLogs'
import { Button } from '@/shared/components/ui/button'

interface WidgetErrorBoundaryProps {
  /** 出现在日志与提示里的 widget 名称，例如 "思维导图" / "图表" */
  label: string
  /** 自定义降级 UI；不传则用默认卡片 */
  fallback?: ReactNode
  className?: string
}

interface WidgetErrorBoundaryState {
  error: Error | null
}

/**
 * 重 widget（mindmap 画布、recharts 图表）的局部错误边界：
 * 崩溃只影响该 widget 区域，提供"重试渲染"按钮。
 */
export class WidgetErrorBoundary extends Component<
  PropsWithChildren<WidgetErrorBoundaryProps>,
  WidgetErrorBoundaryState
> {
  state: WidgetErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): WidgetErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logAppError({
      feature: `Widget:${this.props.label}`,
      stage: 'widget_error_boundary',
      error,
      responseSummary: info.componentStack ?? '',
      meta: { componentStack: info.componentStack ?? '' },
    })
  }

  render() {
    if (!this.state.error) return this.props.children
    if (this.props.fallback) return this.props.fallback
    return (
      <div
        className={
          this.props.className ??
          'flex min-h-[160px] flex-col items-center justify-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-muted-foreground'
        }
        role="alert"
      >
        <AlertTriangle className="size-5 text-destructive" />
        <span>{this.props.label}渲染失败，页面其他部分不受影响。</span>
        <Button type="button" size="sm" variant="outline" onClick={() => this.setState({ error: null })}>
          重试渲染
        </Button>
      </div>
    )
  }
}
```

自查点：`npm run typecheck` 通过。

### 步骤 5：给 MindMapFrame 内容包上局部边界

打开 `apps/web/src/shared/components/mindmap-host/MindMapFrame.tsx`（组件从第 35 行 `export const MindMapFrame = forwardRef(...)` 开始）。找到组件 `return` 的最外层 JSX（文件后半部分，最外层是 `ref={frameRef}` 的 div），在 `MindMapCanvas` 渲染处外面包一层：

修改前（示意，以实际代码为准，定位 `<MindMapCanvas`）：

```tsx
<MindMapCanvas
  ...props
/>
```

修改后：

```tsx
<WidgetErrorBoundary label="思维导图">
  <MindMapCanvas
    ...props
  />
</WidgetErrorBoundary>
```

并在文件顶部 import 区加：

```tsx
import { WidgetErrorBoundary } from '@/shared/components/widget-error-boundary'
```

**不要**改动 MindMapFrame 的 props、handle（`useImperativeHandle`）或任何画布交互逻辑；只包一层。若 `MindMapFrame.test.tsx` 因 DOM 层级断言失败，优先调整测试选择器而不是去掉边界。

### 步骤 6：给图表容器包上局部边界

打开 `apps/web/src/shared/components/ui/chart.tsx`。`ChartContainer`（第 11-32 行）是 recharts 图表的统一容器。修改其 return，修改前：

```tsx
return (
  <div
    className={cn(
      'h-[280px] min-h-0 min-w-0 w-full rounded-lg border border-border/70 bg-card p-3',
      className,
    )}
    style={style as React.CSSProperties}
  >
    {children}
  </div>
)
```

修改后：

```tsx
return (
  <div
    className={cn(
      'h-[280px] min-h-0 min-w-0 w-full rounded-lg border border-border/70 bg-card p-3',
      className,
    )}
    style={style as React.CSSProperties}
  >
    <WidgetErrorBoundary label="图表" className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
      {children}
    </WidgetErrorBoundary>
  </div>
)
```

import 区加：

```tsx
import { WidgetErrorBoundary } from '@/shared/components/widget-error-boundary'
```

### 步骤 7：核实 stableChunkCompatPlugin 兼容性（只核实，不改）

阅读 `apps/web/vite.config.ts` 第 101-145 行确认：该插件在 build 时给 `stableChunkNames`（第 9 行，仅 `PalaceEditPage`、`useMindMapImport`）的**上一次构建产物文件名**写入别名转发文件（`export {default} from './PalaceEditPage.js'`）。与本文档的关系：

- 这两个 chunk 部署后旧引用仍可加载，`lazyWithRetry` 对它们只是冗余保险——无冲突。
- 其余 chunk（如 `KnowledgePage-<hash>.js`）部署后旧文件消失，404 → `lazyWithRetry` 重试一次仍失败 → `ChunkLoadError` → 边界显示"刷新页面"。这正是本文档要补的洞。
- PWA 场景：sw.js `cacheFirstStaticAsset` 缓存过的旧 chunk 会先命中缓存不发 404；未缓存且 404 时 sw 返回跳转 `/pwa-reset.html` 的恢复脚本（sw.js 第 152-158 行）——该行为**先于** import 报错发生，属于既有逃生舱，不要动。

在进度记录中登记核实结论即可，**不修改 vite.config.ts**。

## 3. 测试验收标准

命令验证：

```
cd apps/web && npm run typecheck   # 期望：0 错误
cd apps/web && npm run test        # 期望：全部通过（重点 MindMapFrame.test.tsx、AppRouter.test.tsx、dialog.test.tsx）
cd apps/web && npm run build       # 期望：构建成功
```

行为验收（操作 → 期望现象）：

1. 在 `KnowledgePage` 组件顶部临时 `throw new Error('boom')` → 打开 `/knowledge`：内容区显示"这个页面出了点问题"+ 重试/刷新按钮；**侧边栏、底部导航、Ctrl+K 命令面板仍可用**；切到 `/freestyle` 正常；切回 `/knowledge` 边界因 resetKey 变化重试渲染。测试后移除 throw。
2. 在 `MindMapCanvas` 内部临时抛错 → 打开 `/palaces/:id`：仅画布区域显示"思维导图渲染失败"，页面头部与其他面板正常；点"重试渲染"再次尝试。测试后移除。
3. 模拟 chunk 404：`npm run build` 后手动删除 `dist/assets/KnowledgePage-*.js`，`npm run preview` 打开首页再点"知识大纲" → 等待约 0.5s 自动重试后，内容区显示"页面资源加载失败……刷新页面即可加载最新版本"，点击刷新恢复。
4. DevTools Network 设为 Offline，点击一个未加载过的 lazy 页面 → 出现 chunk 失败提示；恢复 Online 点"刷新页面" → 正常加载。
5. 手机 PWA 验收：部署新版本后，旧 PWA 会话内切换到未缓存页面 → 要么 sw 逃生舱跳 `/pwa-reset.html`，要么显示本文档的刷新引导——两者任一出现即合格，不允许出现无限白屏。

回归检查：正常浏览全部页面无新增报错；`GlobalErrorBoundary` 仍兜底 Shell 级错误（在 `AppShell.tsx` 临时抛错验证后移除）；路由 keep-alive（切换后回到原页保留滚动/状态）不受影响。

## 4. 进度记录（交接用）

| 时间 | 执行者 | 动作 | 结果/备注 |
|---|---|---|---|
| - | - | 文档创建 | - |
| 2026-07-09 00:46 | fable Worker 4 | 实现路由级错误边界、lazy chunk 重试与 widget 局部边界 | 新增 `lazyWithRetry`、`RouteErrorBoundary`、`WidgetErrorBoundary`；`appRoutes` 改用 `lazyWithRetry` 并在 `Suspense` 内包路由边界；MindMapFrame 与 ChartContainer 获得局部降级；补充 retry/边界测试。 |
| 2026-07-09 00:46 | fable Worker 4 | 核实 stableChunkCompatPlugin 兼容性 | `stableChunkNames` 仅覆盖 `PalaceEditPage`、`useMindMapImport`；稳定 chunk 别名机制与 `lazyWithRetry` 无冲突，其余哈希 chunk 持续失败时由 `ChunkLoadError` 引导刷新。未修改 `vite.config.ts`。 |
| 2026-07-09 00:46 | fable Worker 4 | 验证 | `npm run typecheck` 通过；`npx vitest run src/shared/lib/lazyWithRetry.test.ts src/app/providers/RouteErrorBoundary.test.tsx src/app/router/appRoutes.error-boundary.test.tsx src/shared/components/widget-error-boundary.test.tsx src/app/router/appRoutes.fallback.test.ts src/app/router/AppRouter.test.tsx src/shared/components/mindmap-host/MindMapFrame.test.tsx src/shared/components/ui/dialog.test.tsx` 通过。 |
| 2026-07-09 01:46 | Codex | 复核并收口 | 代码核实：路由 lazy 页面均使用 `lazyWithRetry`，`AppRoutes` 在 `Suspense` 内接入 `RouteErrorBoundary`，`MindMapFrame` 与 `ChartContainer` 已包 `WidgetErrorBoundary`；`stableChunkCompatPlugin` 与 PWA `staleScriptRecoveryResponse` 兼容结论仍成立。验证：`npm run typecheck` 通过；同上 8 个相关 vitest 文件共 22 个测试通过。 |
