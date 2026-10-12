import { useEffect } from 'react'
import { RefreshCw } from 'lucide-react'

export function StaleUnitReviewCard({
  cardId,
  onStaleDrop,
}: {
  cardId: string
  onStaleDrop: (cardId: string) => void
}) {
  useEffect(() => {
    onStaleDrop(cardId)
  }, [cardId, onStaleDrop])
  return (
    <div className="flex h-full items-center justify-center text-sm text-stage-muted">
      <RefreshCw className="mr-2 size-4 animate-spin" />
      正在重建复习队列...
    </div>
  )
}
