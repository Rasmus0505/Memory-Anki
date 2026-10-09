import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  BookOpenText,
  Captions,
  Languages,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/shared/lib/utils'

export type EnglishHubZone = 'hub' | 'listening' | 'cloze'

const ZONE_LINKS: Array<{
  id: EnglishHubZone
  label: string
  to: string
  icon: LucideIcon
  primary?: boolean
}> = [
  { id: 'listening', label: '听力', to: '/english/listening', icon: Captions, primary: true },
  { id: 'cloze', label: '完形', to: '/english/cloze', icon: BookOpenText },
]

/** Sticky zone switcher for the listening workspace and course chrome. */
export function EnglishZoneNav({
  zone = 'hub',
  sticky = true,
  className,
}: {
  zone?: EnglishHubZone
  sticky?: boolean
  className?: string
}) {
  return (
    <div
      role="navigation"
      aria-label="英语分区"
      data-testid="english-zone-nav"
      className={cn(
        'flex gap-1 rounded-2xl border border-border/70 bg-muted/90 p-1 shadow-soft backdrop-blur-md',
        sticky ? 'sticky top-0 z-30' : null,
        className,
      )}
    >
      {ZONE_LINKS.map((item) => {
        const Icon = item.icon
        const active = zone === item.id
        return (
          <Link
            key={item.id}
            to={item.to}
            data-testid={`english-zone-${item.id}`}
            className={cn(
              'inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-all',
              active
                ? 'bg-background text-foreground shadow-soft'
                : 'text-muted-foreground hover:bg-background/60 hover:text-foreground',
              item.primary ? '' : 'max-sm:text-xs',
            )}
          >
            <Icon className="size-4" />
            {item.label}
          </Link>
        )
      })}
    </div>
  )
}

export function EnglishZoneLayout({
  zone = 'hub',
  children,
  headerAside,
  title = '英语学习',
  description = '上传视频生成逐句听写课程。',
  showZoneNav = true,
}: {
  zone?: EnglishHubZone
  children: ReactNode
  headerAside?: ReactNode
  title?: string
  description?: string
  showZoneNav?: boolean
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
            {title}
          </h1>
          <p className="max-w-xl text-sm leading-6 text-muted-foreground">{description}</p>
        </div>
        {headerAside ? <div className="shrink-0">{headerAside}</div> : null}
      </header>

      {showZoneNav ? <EnglishZoneNav zone={zone} /> : null}

      <div className="min-h-[50vh]">{children}</div>
    </div>
  )
}
