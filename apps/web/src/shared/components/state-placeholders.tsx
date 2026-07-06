import { type ReactNode } from 'react'
import {
  BookOpen,
  Brain,
  AlertTriangle,
  Link2,
  Search,
  Sparkles,
  type LucideIcon,
} from 'lucide-react'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/shared/components/ui/empty'
import { Skeleton } from '@/shared/components/ui/skeleton'
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
    defaultDescription: '当前没有需要复习的知识点，稍后再来看看。',
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
    defaultDescription: '关联其他宫殿的知识点，建立跨宫殿记忆网络。',
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
          <Skeleton className="size-10" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-3.5 w-1/3" />
            <Skeleton className="h-3 w-1/2" />
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
    <Empty className={cn(config?.containerClassName, className)}>
      <EmptyHeader>
        {icon ? (
          <div className="text-muted-foreground/60">{icon}</div>
        ) : VariantIcon ? (
          <EmptyMedia variant="icon" className={cn('bg-background/80 shadow-sm', config?.iconClassName)}>
            <VariantIcon strokeWidth={1.5} />
          </EmptyMedia>
        ) : null}
        <EmptyTitle>{resolvedTitle}</EmptyTitle>
        {resolvedDescription ? <EmptyDescription>{resolvedDescription}</EmptyDescription> : null}
      </EmptyHeader>
      {action ? <div className="mt-1">{action}</div> : null}
    </Empty>
  )
}

export function ErrorState({
  title = '加载失败',
  description = '数据暂时没有加载出来，请稍后重试。',
  action,
  className,
}: {
  title?: string
  description?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <Empty className={cn('bg-destructive/5', className)}>
      <EmptyHeader>
        <EmptyMedia variant="icon" className="bg-background/80 text-destructive shadow-sm">
          <AlertTriangle strokeWidth={1.5} />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {action ? <div className="mt-1">{action}</div> : null}
    </Empty>
  )
}
