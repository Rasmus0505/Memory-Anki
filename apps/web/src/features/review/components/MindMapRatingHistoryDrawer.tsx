import type { MindMapRecallEvent, MindMapRecallRating } from '@/shared/api/contracts'
import { Button } from '@/shared/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/shared/components/ui/sheet'

export function MindMapRatingHistoryDrawer({ open, onOpenChange, events, onCorrect }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  events: MindMapRecallEvent[]
  onCorrect: (nodeUid: string, rating: MindMapRecallRating, round: 'first' | 'weak_retry') => void
}) {
  const effective = events.slice().reverse()
  return <Sheet open={open} onOpenChange={onOpenChange}><SheetContent className="w-full overflow-y-auto sm:max-w-lg"><SheetHeader><SheetTitle>本轮节点评分</SheetTitle></SheetHeader><div className="space-y-3 p-4">{effective.length ? effective.map((event) => <div key={event.id} className="rounded-xl border p-3"><div className="flex items-center justify-between gap-2"><div><div className="font-medium">节点 {event.node_uid}</div><div className="text-xs text-muted-foreground">{event.recall_round === 'first' ? '首次回忆' : '弱点回合'} · 当前 {event.rating === 1 ? '忘记' : event.rating === 3 ? '模糊' : '记住'}</div></div><div className="flex gap-1">{([1, 3, 5] as const).map((rating) => <Button key={rating} size="sm" variant={event.rating === rating ? 'default' : 'outline'} onClick={() => onCorrect(event.node_uid, rating, event.recall_round)}>{rating}</Button>)}</div></div></div>) : <div className="text-sm text-muted-foreground">本轮还没有评分。</div>}</div></SheetContent></Sheet>
}
