import type { UnitRating } from '@/modules/practice/public'
import { Check, ChevronDown, GripVertical } from 'lucide-react'
import type {
  FreestyleRoundPlanCard,
  FreestyleRoundPlanCardStatus,
} from '@/modules/practice/public'
import type { FreestyleCard } from '@/shared/api/contracts'
import {
  palaceAccentToneClass,
  retryChromeClass,
  retryNodeToneClass,
  type FreestyleProgressSegment,
} from '@/modules/practice/ui/freestyle/model/freestyleProgressSegments'
import { markedNodePathLabel } from '@/modules/practice/ui/freestyle/model/markedNodePathLabel'
import { readPalaceEditorDoc } from '@/modules/practice/ui/freestyle/model/freestyleUnitPreviewCache'
import { cn } from '@/shared/lib/utils'

const STATUS_LABELS: Record<FreestyleRoundPlanCardStatus, string> = {
  pending: '待复习',
  active: '当前',
  completed: '已通过',
  retry: '待重练',
  excluded: '已排除',
  stale: '需重建',
}

const STATUS_CLASSES: Record<FreestyleRoundPlanCardStatus, string> = {
  pending: 'border-border/60 text-muted-foreground',
  active: 'border-primary/60 bg-primary/10 text-primary',
  completed: 'border-rate-good/30 bg-rate-good/8 text-rate-good',
  retry: 'border-rate-hard/35 bg-rate-hard/10 text-rate-hard',
  excluded: 'border-border/50 bg-muted/50 text-muted-foreground line-through',
  stale: 'border-rate-again/35 bg-rate-again/10 text-rate-again',
}

export function palaceIdFromEntry(entry: FreestyleRoundPlanCard) {
  return entry.palaceId ?? 0
}

export function rowLabel(entry: FreestyleRoundPlanCard) {
  return entry.occurrenceKind === 'retry'
    ? `重练第 ${Math.max(1, entry.retryAttempt)} 次 · ${entry.label || entry.cardId}`
    : entry.label || entry.cardId
}

function pathLabelFor(card: FreestyleCard | undefined) {
  if (!card || card.type !== 'mindmap_branch') return ''
  const fromDocument = markedNodePathLabel(readPalaceEditorDoc(card.palace_id), card.anchor_uid)
  if (fromDocument) return fromDocument
  const fromPayload = card.context_path.map((item) => item.text.trim()).filter(Boolean)
  if (fromPayload.length > 1) return fromPayload.join('-')
  return ''
}

function displayLabel(entry: FreestyleRoundPlanCard, card: FreestyleCard | undefined) {
  const path = pathLabelFor(card)
  if (!path) return rowLabel(entry)
  return entry.occurrenceKind === 'retry'
    ? `重练第 ${Math.max(1, entry.retryAttempt)} 次 · ${path}`
    : path
}

function retryRowStatusLabel(isCurrent: boolean, done: boolean, status: FreestyleRoundPlanCardStatus) {
  if (isCurrent) return done ? '当前 · 已过' : '当前复习'
  if (done) return '重练已过'
  if (status === 'retry' || status === 'pending' || status === 'active') return '待重练'
  return STATUS_LABELS[status]
}

export type RoundPlanView = 'palace' | 'progress'

export function rowAccentClass(segment: FreestyleProgressSegment | undefined) {
  if (!segment) return undefined
  if (segment.kind === 'retry') return retryNodeToneClass(segment.tone)
  return palaceAccentToneClass(segment.palaceId, segment.tone)
}

export function RoundPlanRow({
  entry,
  liveCard,
  status,
  isCurrent,
  isSelected,
  draggingId,
  dragOverId,
  neighborIds,
  accentClass,
  railIndex,
  palaceHint,
  onToggle,
  onJump,
  onMove,
  onDragOverId,
  onDraggingId,
  onRate,
  onRemove,
}: {
  entry: FreestyleRoundPlanCard
  liveCard: FreestyleCard | undefined
  status: FreestyleRoundPlanCardStatus
  isCurrent: boolean
  isSelected: boolean
  draggingId: string | null
  dragOverId: string | null
  neighborIds: string[]
  accentClass?: string
  railIndex?: number
  palaceHint?: string
  onToggle: (id: string) => void
  onJump: (cardId: string) => void
  onMove: (sourceId: string, targetId: string) => void
  onDragOverId: (id: string | null) => void
  onDraggingId: (id: string | null) => void
  onRate: (cardId: string, rating: UnitRating) => void
  onRemove?: (cardId: string) => void
}) {
  const label = displayLabel(entry, liveCard)
  const canDrag = status !== 'completed' && status !== 'excluded'
  const retryDone = entry.occurrenceKind === 'retry' && status === 'completed'
  const retryPending = entry.occurrenceKind === 'retry' && status !== 'completed' && status !== 'excluded'
  const index = neighborIds.indexOf(entry.cardId)
  const previousId = index > 0 ? neighborIds[index - 1] : null
  const nextId = index >= 0 ? neighborIds[index + 1] : null
  return (
    <div>
      {dragOverId === entry.cardId && draggingId !== entry.cardId ? (
        <div
          data-testid="round-plan-drop-placeholder"
          className="mx-1 my-1 flex h-14 items-center justify-center rounded-lg border-2 border-dashed border-primary/60 bg-primary/8 text-xs font-medium text-primary fs-expand"
        >
          放到这里
        </div>
      ) : null}
      <div
        data-testid={`round-plan-card-${entry.cardId}`}
        data-fill={status}
        data-rail-index={railIndex ?? undefined}
        data-retry={entry.occurrenceKind === 'retry' ? (retryDone ? 'done' : 'pending') : undefined}
        draggable={canDrag}
        onDragStart={(event) => {
          if (!canDrag) return
          event.dataTransfer.effectAllowed = 'move'
          event.dataTransfer.setData('text/plain', entry.cardId)
          onDraggingId(entry.cardId)
        }}
        onDragEnter={() => canDrag && onDragOverId(entry.cardId)}
        onDragOver={(event) => {
          if (!canDrag) return
          event.preventDefault()
          event.dataTransfer.dropEffect = 'move'
          onDragOverId(entry.cardId)
        }}
        onDrop={(event) => {
          event.preventDefault()
          const sourceId = draggingId || event.dataTransfer.getData('text/plain')
          if (sourceId) onMove(sourceId, entry.cardId)
          onDraggingId(null)
          onDragOverId(null)
        }}
        onDragEnd={() => {
          onDraggingId(null)
          onDragOverId(null)
        }}
        className={cn(
          'mx-1 my-1 flex min-h-14 items-center gap-2 rounded-xl border px-2 py-2 text-sm transition-[background-color,border-color,box-shadow,opacity] duration-200',
          isCurrent
            ? 'border-primary/60 bg-primary/12 shadow-sm ring-1 ring-primary/25'
            : retryPending
              ? 'border-rate-hard/35 bg-rate-hard/10 hover:border-rate-hard/50'
              : retryDone
                ? 'border-rate-good/25 bg-rate-good/8 hover:border-rate-good/40'
                : 'border-transparent hover:border-border/70 hover:bg-background/70',
          isSelected && !isCurrent && 'bg-primary/5',
          draggingId === entry.cardId && 'opacity-45',
          status === 'excluded' && 'opacity-65',
        )}
      >
        <div className="flex shrink-0 items-center">
          <button
            type="button"
            draggable={false}
            disabled={!canDrag}
            className="hidden size-8 cursor-grab items-center justify-center rounded-md text-muted-foreground hover:bg-muted active:cursor-grabbing disabled:cursor-not-allowed sm:inline-flex"
            aria-label={`拖动${label}`}
            title="拖动调整顺序"
          >
            <GripVertical className="size-4" />
          </button>
          <div className="flex flex-col sm:hidden">
            <button
              type="button"
              disabled={!canDrag || !previousId}
              className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted disabled:opacity-40"
              aria-label={`上移${label}`}
              onClick={() => previousId && onMove(entry.cardId, previousId)}
            >
              <ChevronDown className="size-3.5 rotate-180" />
            </button>
            <button
              type="button"
              disabled={!canDrag || !nextId}
              className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted disabled:opacity-40"
              aria-label={`下移${label}`}
              onClick={() => nextId && onMove(entry.cardId, nextId)}
            >
              <ChevronDown className="size-3.5" />
            </button>
          </div>
        </div>
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => onToggle(entry.cardId)}
          aria-label={`选择${label}`}
        />
        {accentClass ? (
          <span
            aria-hidden
            data-testid={`round-plan-accent-${entry.cardId}`}
            className={cn('h-6 w-1 shrink-0 rounded-full', accentClass)}
          />
        ) : null}
        {railIndex ? (
          <span className="w-6 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
            {railIndex}
          </span>
        ) : null}
        <button
          type="button"
          className="min-w-0 flex-1 text-left leading-snug hover:text-primary disabled:cursor-not-allowed"
          disabled={!liveCard}
          title={label}
          onClick={() => liveCard && onJump(entry.cardId)}
        >
          {label}
        </button>
        {palaceHint ? (
          <span className="max-w-[28%] shrink truncate text-[11px] text-muted-foreground">{palaceHint}</span>
        ) : null}
        <span className={cn(
          'shrink-0 rounded-full border px-2 py-0.5 text-[11px]',
          entry.occurrenceKind === 'retry'
            ? retryChromeClass(retryDone)
            : STATUS_CLASSES[status],
        )}>
          {entry.occurrenceKind === 'retry'
            ? retryRowStatusLabel(isCurrent, retryDone, status)
            : isCurrent
              ? (status === 'completed' ? '当前 · 已过' : '当前复习')
              : STATUS_LABELS[status]}
        </span>
        {entry.occurrenceKind === 'retry' && !retryDone ? (
          <span className="shrink-0 text-[11px] text-rate-hard">
            来源 {entry.sourceCardId} · {entry.retryAfterCards}张后
          </span>
        ) : null}
        {liveCard?.type === 'mindmap_branch' && status !== 'excluded' ? (
          <div className="flex shrink-0 items-center gap-1" role="group" aria-label={`给${label}评分`}>
            {onRemove ? (
              <button
                type="button"
                className="inline-flex h-7 items-center rounded-md border border-border/70 px-1.5 text-[11px] font-semibold text-muted-foreground hover:border-primary/60 hover:text-primary"
                aria-label={`${label}移除本队列`}
                onClick={() => onRemove(entry.cardId)}
              >
                移除
              </button>
            ) : null}
            {[1, 2, 3, 4].map((rating) => (
              <button
                key={rating}
                type="button"
                className={cn(
                  'inline-flex size-7 items-center justify-center rounded-md border text-[11px] font-semibold transition-colors',
                  entry.lastRating === rating
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border/70 text-muted-foreground hover:border-primary/60 hover:text-primary',
                )}
                aria-label={`${label}评分${rating}`}
                aria-pressed={entry.lastRating === rating}
                onClick={() => onRate(entry.cardId, rating as UnitRating)}
              >
                {rating}
              </button>
            ))}
          </div>
        ) : null}
        {status === 'completed' ? <Check className="size-4 shrink-0 text-rate-good" /> : null}
      </div>
    </div>
  )
}
