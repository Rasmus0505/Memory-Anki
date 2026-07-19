import type { ReactNode } from 'react'
import { BookOpenText, Captions, Languages, MessagesSquare, NotebookPen } from 'lucide-react'
import { cn } from '@/shared/lib/utils'

export type EnglishHubTab = 'listening' | 'reading' | 'vocab' | 'patterns'

const TABS: Array<{
  id: EnglishHubTab
  label: string
  icon: typeof Captions
}> = [
  { id: 'listening', label: '听力', icon: Captions },
  { id: 'reading', label: '阅读', icon: BookOpenText },
  { id: 'patterns', label: '句模', icon: MessagesSquare },
  { id: 'vocab', label: '生词', icon: NotebookPen },
]

export function EnglishZoneLayout({
  tab,
  onTabChange,
  children,
  headerAside,
}: {
  tab: EnglishHubTab
  onTabChange: (tab: EnglishHubTab) => void
  children: ReactNode
  headerAside?: ReactNode
}) {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-5" data-testid="english-zone-layout">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1.5">
          <div className="inline-flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-info">
            <Languages className="size-3.5" />
            English
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-[1.7rem]">
            英语学习
          </h1>
          <p className="max-w-xl text-sm leading-6 text-muted-foreground">
            继续上次的听写与阅读，少一点管理台，多一点沉浸练习。
          </p>
        </div>
        {headerAside ? <div className="shrink-0">{headerAside}</div> : null}
      </header>

      <div
        role="tablist"
        aria-label="英语分区"
        className="flex gap-1 rounded-2xl border border-border/70 bg-muted/60 p-1"
      >
        {TABS.map((item) => {
          const Icon = item.icon
          const active = tab === item.id
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={active}
              data-testid={`english-tab-${item.id}`}
              onClick={() => onTabChange(item.id)}
              className={cn(
                'inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-all',
                active
                  ? 'bg-background text-foreground shadow-soft'
                  : 'text-muted-foreground hover:bg-background/60 hover:text-foreground',
              )}
            >
              <Icon className="size-4" />
              {item.label}
            </button>
          )
        })}
      </div>

      <div role="tabpanel" className="min-h-[50vh]">
        {children}
      </div>
    </div>
  )
}
