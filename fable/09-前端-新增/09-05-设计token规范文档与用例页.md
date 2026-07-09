---
编号: 09-05
标题: 整理设计 token 规范清单，并新增 DEV-only 的 /dev/tokens 展示页
类型: 新增
范围: 前端
优先级: P2
预估工作量: S（<2h）
依赖文档: 无（09-01 暗色模式完成后，token 页可直接用于核对暗色板；09-08 会复用本文档的 DEV 路由注册模式）
状态: 未开始
负责代理: 无
完成时间: 无
---

# 09-05 设计 token 规范文档与用例页

## 1. 原始需求

`apps/web/src/index.css` 第 3-48 行的 `@theme` 块定义了完整 token 体系（字体 2 个、颜色 30 个、圆角 5 个、阴影 4 个），全部组件通过 Tailwind 类（`bg-primary`、`text-memory-strong` 等）消费。但这些 token **没有任何文档**，写新页面时容易凭感觉硬编码颜色（FreestylePage 已出现 44 行 zinc 硬编码，见 08-14）。`src/app/dev/` 目录已存在但目前只有一个测试文件 `manualRefreshGuard.test.ts`（866 字节，校验 vite 配置），没有任何 dev 页面。

产出两件事：① 本文档内的 token 清单表（实测抄录自 `@theme`，作为规范基准）；② `/dev/tokens` 展示页（仅 DEV 构建可访问），改 token 时肉眼核对全套色板。

## 2. Token 清单（2026-07-08 实测抄录自 apps/web/src/index.css 第 3-48 行）

### 字体

| Token | 值 | Tailwind 用法 |
|---|---|---|
| `--font-sans` | "Inter", ui-sans-serif, system-ui, -apple-system, sans-serif | `font-sans`（默认） |
| `--font-mono` | "JetBrains Mono", ui-monospace, monospace | `font-mono` |

### 基础颜色

| Token | 值 | 用途 |
|---|---|---|
| `--color-background` | hsl(38 28% 97%) | 页面背景（暖白） |
| `--color-foreground` | hsl(224 24% 14%) | 正文 |
| `--color-card` / `--color-card-foreground` | hsl(0 0% 100%) / hsl(224 24% 14%) | 卡片 |
| `--color-popover` / `--color-popover-foreground` | hsl(0 0% 100%) / hsl(224 24% 14%) | 浮层 |
| `--color-primary` / `--color-primary-foreground` | hsl(24 76% 43%) / hsl(34 100% 98%) | 主色（橙棕） |
| `--color-secondary` / `--color-secondary-foreground` | hsl(220 16% 93%) / hsl(222 22% 20%) | 次级底色 |
| `--color-muted` / `--color-muted-foreground` | hsl(220 14% 94%) / hsl(220 10% 42%) | 弱化区/辅助文字 |
| `--color-accent` / `--color-accent-foreground` | hsl(32 38% 91%) / hsl(222 22% 20%) | hover 强调底 |
| `--color-destructive` / `--color-destructive-foreground` | hsl(0 84.2% 60.2%) / hsl(0 0% 98%) | 危险操作 |
| `--color-border` | hsl(220 14% 86%) | 边框 |
| `--color-input` | hsl(220 14% 84%) | 输入框边框 |
| `--color-ring` | hsl(24 76% 43%) | 焦点环 |

### Semantic 状态色

| Token | 值 | 用途 |
|---|---|---|
| `--color-success` / `--color-success-foreground` | hsl(145 55% 42%) / hsl(0 0% 100%) | 成功 |
| `--color-warning` / `--color-warning-foreground` | hsl(34 92% 52%) / hsl(0 0% 100%) | 警告 |
| `--color-error` / `--color-error-foreground` | hsl(0 84.2% 60.2%) / hsl(0 0% 98%) | 错误 |
| `--color-info` / `--color-info-foreground` | hsl(210 72% 56%) / hsl(0 0% 100%) | 信息 |
| `--color-memory-strong` | hsl(160 68% 34%) | 记忆强 |
| `--color-memory-medium` | hsl(34 92% 52%) | 记忆中 |
| `--color-memory-weak` | hsl(0 84.2% 60.2%) | 记忆弱 |

### 圆角与阴影

| Token | 值 | 备注 |
|---|---|---|
| `--color-radius` | 0.625rem | 基准圆角。**命名怪癖**：挂在 color 前缀下（历史原因），本文档只记录不改名 |
| `--radius-sm` / `--radius-md` / `--radius-lg` / `--radius-xl` | 基准 −4px / −2px / 基准 / +4px | `rounded-sm/md/lg/xl` |
| `--shadow-soft` | 0 1px 2px rgba(15,23,42,0.04) | `shadow-soft` |
| `--shadow-card` | 0 1px 2px rgba(15,23,42,0.06), 0 8px 24px rgba(15,23,42,0.06) | `shadow-card` |
| `--shadow-popover` | 0 18px 44px rgba(15,23,42,0.12) | `shadow-popover` |
| `--shadow-floating` | 0 24px 72px rgba(15,23,42,0.14) | `shadow-floating` |

### 间距

无自定义间距 token，使用 Tailwind v4 默认 `--spacing: 0.25rem` 刻度。**规范**：不要新增自定义间距 token，除非同一间距在 ≥3 处重复且语义明确。

### 使用规范（写新代码时遵守）

1. 颜色一律用 token 类（`bg-primary`、`text-muted-foreground`、`text-memory-weak`），禁止 `bg-orange-600`、`text-zinc-500` 等调色板类与裸 hex。
2. 状态提示按语义选：成功 `success`、警告 `warning`、错误 `error`/`destructive`、提示 `info`；记忆强度用 `memory-*` 三色。
3. 阴影只用四档语义阴影，不手写 `shadow-[...]`。

## 3. 详细执行清单

> 约定：路径相对仓库根目录 `Memory-Anki/`。

### 步骤 1：新建 /dev/tokens 页面

新建文件 `apps/web/src/app/dev/DevTokensPage.tsx`，完整内容：

```tsx
const COLOR_TOKENS = [
  'background', 'foreground', 'card', 'card-foreground', 'popover', 'popover-foreground',
  'primary', 'primary-foreground', 'secondary', 'secondary-foreground',
  'muted', 'muted-foreground', 'accent', 'accent-foreground',
  'destructive', 'destructive-foreground',
  'success', 'success-foreground', 'warning', 'warning-foreground',
  'error', 'error-foreground', 'info', 'info-foreground',
  'memory-strong', 'memory-medium', 'memory-weak',
  'border', 'input', 'ring',
] as const

const RADIUS_TOKENS = ['sm', 'md', 'lg', 'xl'] as const
const SHADOW_TOKENS = ['soft', 'card', 'popover', 'floating'] as const

function resolveCssVariable(name: string) {
  if (typeof window === 'undefined') return ''
  return window.getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

function SectionTitle({ children }: { children: string }) {
  return <h2 className="mb-3 mt-8 text-lg font-semibold first:mt-0">{children}</h2>
}

export default function DevTokensPage() {
  return (
    <div className="mx-auto max-w-5xl p-6">
      <h1 className="text-2xl font-bold">设计 Token 一览（DEV）</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        实时读取 index.css @theme 生成的 CSS 变量。规范见 fable/09-前端-新增/09-05。
      </p>

      <SectionTitle>颜色</SectionTitle>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {COLOR_TOKENS.map((token) => {
          const variable = `--color-${token}`
          return (
            <div key={token} className="rounded-lg border p-3">
              <div
                className="h-12 w-full rounded-md border"
                style={{ backgroundColor: `var(${variable})` }}
              />
              <div className="mt-2 font-mono text-xs font-medium">{token}</div>
              <div className="font-mono text-[11px] text-muted-foreground">
                {resolveCssVariable(variable)}
              </div>
            </div>
          )
        })}
      </div>

      <SectionTitle>圆角</SectionTitle>
      <div className="flex flex-wrap gap-4">
        {RADIUS_TOKENS.map((token) => (
          <div key={token} className="text-center">
            <div
              className="size-20 border-2 border-primary bg-accent"
              style={{ borderRadius: `var(--radius-${token})` }}
            />
            <div className="mt-1 font-mono text-xs">radius-{token}</div>
            <div className="font-mono text-[11px] text-muted-foreground">
              {resolveCssVariable(`--radius-${token}`)}
            </div>
          </div>
        ))}
      </div>

      <SectionTitle>阴影</SectionTitle>
      <div className="grid grid-cols-2 gap-6 lg:grid-cols-4">
        {SHADOW_TOKENS.map((token) => (
          <div key={token} className="text-center">
            <div
              className="h-20 rounded-lg bg-card"
              style={{ boxShadow: `var(--shadow-${token})` }}
            />
            <div className="mt-2 font-mono text-xs">shadow-{token}</div>
          </div>
        ))}
      </div>

      <SectionTitle>字体</SectionTitle>
      <div className="space-y-2 rounded-lg border p-4">
        <p className="font-sans">font-sans：记忆宫殿复习系统 Memory Anki 0123456789</p>
        <p className="font-mono">font-mono：memory_anki --channel=stable 0123456789</p>
      </div>
    </div>
  )
}
```

自查点：`npm run typecheck` 通过。

### 步骤 2：注册 DEV-only 路由

打开 `apps/web/src/app/router/appRoutes.tsx`：

2a. 在 lazy 定义区（第 38-56 行之后）新增：

```tsx
const DevTokensPage = lazy(() => import('@/app/dev/DevTokensPage'))
```

（若 09-03 已执行，用 `lazyWithRetry`；两者皆可，跟随文件现状。）

2b. 在 `<Routes>` 内、`<Route path="*" ...>` 之前新增：

```tsx
{import.meta.env.DEV ? <Route path="/dev/tokens" element={<DevTokensPage />} /> : null}
```

说明：

- **不要**把 `/dev/tokens` 加入第 68-85 行 `REGISTERED_EXACT_PATHS`——那张表只服务未知路径回退；PROD 下 `/dev/tokens` 落到 `*` 路由回退 `/freestyle` 正是期望行为。
- 已知代价：即使 PROD 不渲染该路由，rollup 仍会产出一个小的 DevTokensPage chunk（纯静态 JSX，约 2-3KB），但永远不会被请求加载。可接受，**不要**为消除它加构建插件。
- 若 09-08 已先执行并建立了同样的 DEV 条件块，直接在同一位置追加本路由即可，不要重复写条件。

自查点：`npm run dev` 下访问 `http://localhost:5173/dev/tokens` 可见色板；`npm run build && npm run preview` 下访问同路径被重定向到 `/freestyle`。

### 步骤 3：不要做的事

- 不引入 Storybook / Ladle 等文档工具（09-08 的 playground 同理，轻方案已够）。
- 不改 `@theme` 里的任何值、不给 `--color-radius` 改名（改名会牵连全部 `rounded-*` 类，超出本文档范围）。
- 不给 token 页加交互编辑功能。

## 4. 测试验收标准

命令验证：

```
cd apps/web && npm run typecheck   # 期望：0 错误
cd apps/web && npm run test        # 期望：全部通过
cd apps/web && npm run build       # 期望：构建成功
```

行为验收（操作 → 期望现象）：

1. `npm run dev` 后访问 `/dev/tokens` → 显示 30 个颜色卡（含 memory-strong/medium/weak）、4 档圆角、4 档阴影、2 种字体示例；每个颜色卡下方显示实际 hsl 值，与本文档清单表一致。
2. 生产构建 preview 下访问 `/dev/tokens` → 重定向到 `/freestyle`，无报错。
3. （若 09-01 已完成）在 token 页切换暗色主题 → 全部色卡即时刷新为暗色值（注意：`resolveCssVariable` 在渲染时读取，切主题后需刷新页面才更新文字标注——色块本身用 `var()` 即时变化，属预期，记录即可）。
4. 手机 PWA：生产环境同验收 2，dev 页面不进入手机使用路径。

回归检查：既有路由全部可达；`*` 通配回退逻辑（`appRoutes.fallback.test.ts`）不受影响。

## 5. 进度记录（交接用）

| 时间 | 执行者 | 动作 | 结果/备注 |
|---|---|---|---|
| - | - | 文档创建 | - |
