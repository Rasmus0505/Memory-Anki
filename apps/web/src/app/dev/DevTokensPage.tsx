const COLOR_TOKENS = [
  'background',
  'foreground',
  'card',
  'card-foreground',
  'popover',
  'popover-foreground',
  'primary',
  'primary-foreground',
  'secondary',
  'secondary-foreground',
  'muted',
  'muted-foreground',
  'accent',
  'accent-foreground',
  'destructive',
  'destructive-foreground',
  'success',
  'success-foreground',
  'warning',
  'warning-foreground',
  'error',
  'error-foreground',
  'info',
  'info-foreground',
  'memory-strong',
  'memory-medium',
  'memory-weak',
  'border',
  'input',
  'ring',
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
