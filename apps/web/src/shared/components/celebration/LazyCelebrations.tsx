import { Suspense } from 'react'
import { lazyWithRetry } from '@/shared/lib/lazyWithRetry'
import type { ComboMilestoneBurstProps } from './ComboMilestoneBurst'
import type { CompletionCelebrationProps } from './CompletionCelebration'

// motion（约 100KB）只在庆祝动画真正触发时加载；fallback 为 null，
// 动画晚一帧出现无感知，但 motion 不再进入首屏静态依赖图。
const ComboMilestoneBurstView = lazyWithRetry(() =>
  import('./ComboMilestoneBurst').then((module) => ({ default: module.ComboMilestoneBurst })),
)
const CompletionCelebrationView = lazyWithRetry(() =>
  import('./CompletionCelebration').then((module) => ({ default: module.CompletionCelebration })),
)

export function ComboMilestoneBurst(props: ComboMilestoneBurstProps) {
  return (
    <Suspense fallback={null}>
      <ComboMilestoneBurstView {...props} />
    </Suspense>
  )
}

export function CompletionCelebration(props: CompletionCelebrationProps) {
  return (
    <Suspense fallback={null}>
      <CompletionCelebrationView {...props} />
    </Suspense>
  )
}
