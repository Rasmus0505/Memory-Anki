import type { FreestylePartialSettlementSnapshot } from '@/modules/practice/domain/partialSettlement'
import { Button } from '@/shared/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'

/**
 * 结算已完成 confirmation. A 小结算 is a ledger write, not a ceremony: the
 * learner already rated these units in the feed, so this only says what is
 * about to leave the round — no closing animation, no second review surface.
 */
export function FreestylePartialSettlement({
  snapshot,
  onExit,
  onConfirmPartial,
}: {
  snapshot: FreestylePartialSettlementSnapshot
  roundId?: string
  onExit: () => void
  onConfirmPartial: (snapshot: FreestylePartialSettlementSnapshot) => void
}) {
  const subjectCount = snapshot.bySubject.length
  const palaceCount = snapshot.bySubject.reduce((sum, subject) => sum + subject.palaceCount, 0)
  const units = [
    snapshot.newCount ? `新学 ${snapshot.newCount}` : '',
    snapshot.reviewCount ? `复习 ${snapshot.reviewCount}` : '',
  ].filter(Boolean)
  const outcomes = [
    snapshot.passedCount ? `通过 ${snapshot.passedCount}` : '',
    snapshot.retryCount ? `重练 ${snapshot.retryCount}` : '',
    snapshot.quizCount ? `题 ${snapshot.quizCount}` : '',
  ].filter(Boolean)

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onExit() }}>
      <DialogContent
        data-testid="freestyle-partial-settlement"
        className="max-w-md"
      >
        <DialogHeader>
          <DialogTitle>结算已完成</DialogTitle>
          <DialogDescription>
            {snapshot.cardCount} 张 · {subjectCount} 个学科 · {palaceCount} 座宫殿
          </DialogDescription>
        </DialogHeader>

        <dl className="space-y-2 text-sm">
          {units.length ? (
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-muted-foreground">内容</dt>
              <dd className="tabular-nums">{units.join(' · ')}</dd>
            </div>
          ) : null}
          {outcomes.length ? (
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-muted-foreground">结果</dt>
              <dd className="tabular-nums">{outcomes.join(' · ')}</dd>
            </div>
          ) : null}
        </dl>

        {snapshot.bySubject.length ? (
          <ul className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-border/60 p-2 text-sm">
            {snapshot.bySubject.map((subject) => (
              <li key={subject.subjectId ?? subject.subjectName} className="flex items-baseline justify-between gap-3 px-1">
                <span className="min-w-0 flex-1 truncate">{subject.subjectName}</span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {subject.palaceCount} 座 · {subject.cardCount} 张
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onExit}>取消</Button>
          <Button type="button" onClick={() => onConfirmPartial(snapshot)}>
            结算这 {snapshot.cardCount} 张
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
