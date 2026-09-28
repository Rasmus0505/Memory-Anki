import { Suspense, type ComponentProps } from 'react'
import { lazyWithRetry } from '@/shared/lib/lazyWithRetry'
import type { FreestyleComboChip as ComboChipComponent } from './FreestyleComboChip'

// /freestyle is the startup route: keep `motion` out of its static import graph.
const ComboChipView = lazyWithRetry(() =>
  import('./FreestyleComboChip').then((module) => ({ default: module.FreestyleComboChip })),
)

export function FreestyleComboChip(props: ComponentProps<typeof ComboChipComponent>) {
  return (
    <Suspense fallback={null}>
      <ComboChipView {...props} />
    </Suspense>
  )
}
