import { GrowthView, useProgressionOverview } from '@/modules/progression/public'
import { ErrorState, LoadingState } from '@/shared/components/state-placeholders'
import { Button } from '@/shared/components/ui/button'

export default function GrowthPage() {
  const { data, error, reload } = useProgressionOverview()
  if (!data && error) {
    return (
      <ErrorState
        title="成长数据加载失败"
        description={error}
        action={<Button onClick={() => void reload()}>重试</Button>}
      />
    )
  }
  if (!data) return <LoadingState text="正在点亮星图…" />
  return <GrowthView overview={data} />
}
