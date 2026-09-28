import { Suspense } from 'react'
import { lazyWithRetry } from '@/shared/lib/lazyWithRetry'
import type { MindMapCanvasProps } from './MindMapCanvas'

// @xyflow/react（mindmap-vendor）只在画布真正挂载时加载，
// 避免经各模块 public 桶把 189KB vendor 拖进首屏静态依赖图。
let canvasModule: Promise<typeof import('./MindMapCanvas')> | null = null

function loadCanvasModule() {
  canvasModule ??= import('./MindMapCanvas').catch((error: unknown) => {
    canvasModule = null
    throw error
  })
  return canvasModule
}

/** Warm the canvas chunk before any map mounts (e.g. on idle in a map-heavy route). */
export function preloadMindMapCanvas() {
  void loadCanvasModule().catch(() => undefined)
}

const MindMapCanvasView = lazyWithRetry(() =>
  loadCanvasModule().then((module) => ({ default: module.MindMapCanvas })),
)

export function MindMapCanvas(props: MindMapCanvasProps) {
  return (
    // Still paper, not a pulsing grey block: the chunk usually lands within a frame
    // after preload, and a flashing placeholder read as the card "blinking".
    <Suspense
      fallback={
        <div
          className="h-full w-full rounded-xl"
          style={{ background: 'var(--memory-anki-mindmap-canvas)' }}
          aria-label="正在加载导图画布"
        />
      }
    >
      <MindMapCanvasView {...props} />
    </Suspense>
  )
}
