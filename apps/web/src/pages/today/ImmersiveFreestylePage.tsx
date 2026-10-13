import { ImmersiveFreestylePage as FeaturePage } from '@/modules/practice/public'

// Route wrapper: the feature component is already lazy in the practice barrel, so this page must stay a plain
// function component. Re-exporting the lazy value as the default would make lazyWithRetry wrap a lazy twice.
export default function ImmersiveFreestylePage() {
  return <FeaturePage />
}
