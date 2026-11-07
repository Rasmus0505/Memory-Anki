import type { ReactNode } from 'react'
import { cn } from '@/shared/lib/utils'

/**
 * 账本行：标签在左、衬线数字在右，行间一条发丝线。
 * 这是本应用读数字的默认排版；卡片只负责把一组行框起来。
 */
export function Ledger({ children, className }: { children: ReactNode; className?: string }) {
  return <dl className={cn('divide-y divide-border/70 border-y border-border/70', className)}>{children}</dl>
}

export interface LedgerRowProps {
  label: ReactNode
  value: ReactNode
  /** sm 用于卡片内的摘要，md 用于页面级统计。 */
  size?: 'sm' | 'md'
  /** mark：这一行需要被批改（遗忘、截止）。 */
  tone?: 'default' | 'mark'
  className?: string
}

export function LedgerRow({ label, value, size = 'md', tone = 'default', className }: LedgerRowProps) {
  return (
    <div className={cn('flex items-baseline justify-between gap-3', size === 'md' ? 'py-1.5' : 'py-1', className)}>
      <dt className="min-w-0 truncate text-[12px] text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          'ma-figure shrink-0 font-semibold tabular-nums',
          size === 'md' ? 'text-[19px]' : 'text-[14px]',
          tone === 'mark' ? 'text-mark' : 'text-foreground',
        )}
      >
        {value}
      </dd>
    </div>
  )
}
