import type { useFreestyleFeedNavigation } from '@/modules/practice/ui/freestyle/hooks/useFreestyleFeedNavigation'

type EdgeHint = NonNullable<ReturnType<typeof useFreestyleFeedNavigation>['edgeHint']>

export function FreestyleEdgeHint({
  edgeHint,
  roundComplete,
}: {
  edgeHint: EdgeHint
  roundComplete: boolean
}) {
  return (
    <div key={edgeHint.nonce} role="status" data-edge={edgeHint.edge} className="fs-edge-hint">
      {edgeHint.edge === 'top'
        ? '已经是第一张'
        : roundComplete
          ? '本轮已经到底了'
          : '已经是本轮最后一张'}
    </div>
  )
}
