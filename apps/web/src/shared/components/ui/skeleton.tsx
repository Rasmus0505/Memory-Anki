import { cn } from '@/shared/lib/utils'

/**
 * 骨架屏占位组件。用于加载态，替代纯文字"正在加载…"，减少视觉跳变。
 */
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('animate-pulse rounded-md bg-muted', className)}
      {...props}
    />
  )
}

export { Skeleton }
