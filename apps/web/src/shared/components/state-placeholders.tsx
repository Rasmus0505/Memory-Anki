import { type ReactNode } from 'react'
import {
  BookOpen,
  Brain,
  Link2,
  Search,
  Sparkles,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/shared/lib/utils'

/**
 * 空状态变体。每种变体对应不同的图标组合 + 配色 + 鼓励文案。
 */
export type EmptyStateVariant = 'list' | 'search' | 'review' | 'create' | 'link'

interface VariantConfig {
  icon: LucideIcon
  iconClassName: string
  containerClassName: string
  defaultTitle: string
  defaultDescription: string
}

const VARIANT_CONFIGS: Record<EmptyStateVariant, VariantConfig> = {
  list: {
    icon: BookOpen,
    iconClassName: 'text-info/50',
    containerClassName: 'bg-info/5',
    defaultTitle: '还没有内容',
    defaultDescription: '从创建第一个开始吧。',
  },
  search: {
    icon: Search,
    iconClassName: 'text-muted-foreground/50',
    containerClassName: 'bg-muted/40',
    defaultTitle: '没有找到结果',
    defaultDescription: '试试调整搜索条件或关键词。',
  },
  review: {
    icon: Brain,
    iconClassName: 'text-success/50',
    containerClassName: 'bg-success/5',
    defaultTitle: '暂无待复习内容',
    defaultDescription: '当前没有需要复习的卡片，稍后再来看看。',
  },
  create: {
    icon: Sparkles,
    iconClassName: 'text-warning/50',
    containerClassName: 'bg-warning/5',
    defaultTitle: '开始创建',
    defaultDescription: '点击下方按钮，添加你的第一条内容。',
  },
  link: {
    icon: Link2,
    iconClassName: 'text-info/50',
    containerClassName: 'bg-info/5',
    defaultTitle: '还没有链接',
    defaultDescription: '关联其他宫殿的节点，建立跨宫殿记忆网络。',
  },
}

/**
 * 统一加载态，替代各页面重复手写的 "正在加载…" 纯文字。
 * 默认显示轻量骨架行，也可通过 children 自定义。
 */
export function LoadingState({
  text = '正在加载…',
  className,
  rows = 3,
  children,
}: {
  text?: string
  className?: string
  rows?: number
  children?: ReactNode
}) {
  if (children) {
    return <div className={cn('flex flex-col gap-3 py-10', className)}>{children}</div>
  }
  return (
    <div className={cn('flex flex-col gap-3 py-10', className)} role="status" aria-live="polite">
      <p className="text-sm text-muted-foreground">{text}</p>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="h-10 w-10 animate-pulse rounded-md bg-muted" />
          <div className="flex-1 space-y-2">
            <div className="h-3.5 w-1/3 animate-pulse rounded bg-muted" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * 统一空状态，提供图标、标题、描述和可选的引导动作。
 *
 * 支持两种模式：
 * 1. variant 模式：传入 variant（list/search/review/create/link），
 *    自动选择图标 + 配色 + 默认文案，仅需提供 action。
 * 2. 自定义模式：传入 icon/title/description，完全自定义。
 *
 * 替代各页面重复手写的灰色图标 + 文字。
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  variant,
}: {
  icon?: ReactNode
  title?: string
  description?: ReactNode
  action?: ReactNode
  className?: string
  variant?: EmptyStateVariant
}) {
  // variant 模式：使用预设配置
  const config = variant ? VARIANT_CONFIGS[variant] : null
  const resolvedTitle = title ?? config?.defaultTitle ?? '暂无内容'
  const resolvedDescription = description ?? config?.defaultDescription ?? null
  const VariantIcon = config?.icon

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-2xl px-6 py-16 text-center',
        config?.containerClassName,
        className,
      )}
    >
      {icon ? (
        <div className="text-muted-foreground/60">{icon}</div>
      ) : VariantIcon ? (
        <div className={cn('rounded-2xl bg-background/80 p-3 shadow-sm', config?.iconClassName)}>
          <VariantIcon className="h-8 w-8" strokeWidth={1.5} />
        </div>
      ) : null}
      <p className="text-base font-medium text-foreground">{resolvedTitle}</p>
      {resolvedDescription ? (
        <p className="max-w-sm text-sm text-muted-foreground">{resolvedDescription}</p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  )
}
