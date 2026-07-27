import { Suspense } from 'react'
import { lazyWithRetry } from '@/shared/lib/lazyWithRetry'
import type { MindMapCanvasProps } from './MindMapCanvas'

// @xyflow/react（mindmap-vendor）只在画布真正挂载时加载，
// 避免经各模块 public 桶把 189KB vendor 拖进首屏静态依赖图。
const MindMapCanvasView = lazyWithRetry(() =>
  import('./MindMapCanvas').then((module) => ({ default: module.MindMapCanvas })),
)

export function MindMapCanvas(props: MindMapCanvasProps) {
  return (
    <Suspense
      fallback={<div className="h-full w-full animate-pulse rounded-xl bg-muted/40" aria-label="正在加载导图画布" />}
    >
      <MindMapCanvasView {...props} />
    </Suspense>
  )
}
