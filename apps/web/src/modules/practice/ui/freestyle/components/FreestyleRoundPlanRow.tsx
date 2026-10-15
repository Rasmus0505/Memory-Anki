import { memo } from 'react'
import type { UnitRating } from '@/modules/practice/public'
import { Check, ChevronDown, CornerDownRight, GripVertical, LoaderCircle } from 'lucide-react'
import type {
  FreestyleRoundPlanCard,
  FreestyleRoundPlanCardStatus,
} from '@/modules/practice/public'
import type { FreestyleCard } from '@/shared/api/contracts'
import {
  palaceIdentityClass,
  planStatusChromeClass,
  retryChromeClass,
  type FreestyleProgressSegment,
} from '@/modules/practice/ui/freestyle/model/freestyleProgressSegments'
import {
  formatMarkedNodePath,
  markedNodePathParts,
  markedNodePathTexts,
} from '@/modules/practice/ui/freestyle/model/markedNodePathLabel'
import type { RatingSaveEntry } from '@/modules/practice/ui/freestyle/model/ratingSaveStore'
import { cn } from '@/shared/lib/utils'

const STATUS_LABELS: Record<FreestyleRoundPlanCardStatus, string> = {
  pending: '待复习',
  active: '当前',
  completed: '已通过',
  retry: '待重练',
  excluded: '已排除',
  stale: '需重建',
}

export type RoundPlanView = 'palace' | 'progress'

/** Everything a row paints that does not depend on the selection or drag state. */
export interface PlanRowModel {
  cardId: string
  status: FreestyleRoundPlanCardStatus
  isCurrent: boolean
  retry: boolean
  retryDone: boolean
  /** Retry attempt prefix, e.g. `重练第 2 次`. Empty for source rows. */
  lead: string
  /** Root node of the marked path, or null when the path has one node or is unknown. */
  root: string | null
  /** Marked node, or the plain row label when no path is known. */
  anchor: string
  /** Plain text for accessible names: `[lead · ]root ⋯ anchor`. */
  label: string
  /** Full path text for the title attribute. */
  title: string
  statusLabel: string
  statusChrome: string
  canJump: boolean
  rateable: boolean
  accentClass?: string
  railIndex?: number
  palaceHint?: string
}

export function palaceIdFromEntry(entry: FreestyleRoundPlanCard) {
  return entry.palaceId ?? 0
}

export function rowLabel(entry: FreestyleRoundPlanCard) {
  return entry.occurrenceKind === 'retry'
    ? `重练第 ${Math.max(1, entry.retryAttempt)} 次 · ${entry.label || entry.cardId}`
    : entry.label || entry.cardId
}

/**
 * Root-first node texts for a mind-map card. The payload `context_path` is preferred, so the
 * label does not depend on the editor document being loaded. It is trusted only when it ends
 * at the card's anchor; otherwise the loaded document is used, and the payload is the last resort.
 */
export function cardPathTexts(card: FreestyleCard | undefined, palaceDoc: unknown): string[] {
  if (!card || card.type !== 'mindmap_branch') return []
  const items = card.context_path ?? []
  const fromPayload = items
    .map((item) => String(item.text || '').trim())
    .filter(Boolean)
  const anchor = String(card.anchor_uid || '').trim()
  const lastUid = String(items.at(-1)?.uid || '').trim()
  if (fromPayload.length && (!anchor || lastUid === anchor)) return fromPayload
  const fromDocument = markedNodePathTexts(palaceDoc, card.anchor_uid)
  if (fromDocument.length) return fromDocument
  return fromPayload
}

function retryRowStatusLabel(isCurrent: boolean, done: boolean, status: FreestyleRoundPlanCardStatus) {
  if (isCurrent) return done ? '当前 · 已过' : '当前复习'
  if (done) return '重练已过'
  if (status === 'retry' || status === 'pending' || status === 'active') return '待重练'
  return STATUS_LABELS[status]
}

export function buildPlanRowModel({
  entry,
  liveCard,
  status,
  isCurrent,
  pathTexts,
  accentClass,
  railIndex,
  palaceHint,
}: {
  entry: FreestyleRoundPlanCard
  liveCard: FreestyleCard | undefined
  status: FreestyleRoundPlanCardStatus
  isCurrent: boolean
  pathTexts: string[]
  accentClass?: string
  railIndex?: number
  palaceHint?: string
}): PlanRowModel {
  const retry = entry.occurrenceKind === 'retry'
  const retryDone = retry && status === 'completed'
  const parts = markedNodePathParts(pathTexts)
  const hasPath = Boolean(parts.anchor)
  const anchor = hasPath ? parts.anchor : rowLabel(entry)
  const root = hasPath ? parts.root : null
  const lead = retry ? `重练第 ${Math.max(1, entry.retryAttempt)} 次` : ''
  const body = hasPath ? formatMarkedNodePath({ root, anchor, full: parts.full }) : anchor
  const label = lead && hasPath ? `${lead} · ${body}` : body
  return {
    cardId: entry.cardId,
    status,
    isCurrent,
    retry,
    retryDone,
    lead: hasPath ? lead : '',
    root,
    anchor,
    label,
    title: hasPath ? parts.full : label,
    statusLabel: retry
      ? retryRowStatusLabel(isCurrent, retryDone, status)
      : isCurrent
        ? (status === 'completed' ? '当前 · 已过' : '当前复习')
        : STATUS_LABELS[status],
    statusChrome: retry ? retryChromeClass(retryDone) : planStatusChromeClass(status),
    canJump: Boolean(liveCard),
    rateable: liveCard?.type === 'mindmap_branch' && status !== 'excluded',
    accentClass,
    railIndex,
    palaceHint,
  }
}

/** Identity stripe for a progress-view row: the palace colour, never the status. */
export function rowAccentClass(segment: FreestyleProgressSegment | undefined) {
  if (!segment) return undefined
  return palaceIdentityClass(segment.palaceId)
}

export interface RoundPlanRowProps {
  entry: FreestyleRoundPlanCard
  model: PlanRowModel
  /** Progress view shows the identity stripe, rail number and palace hint. */
  showChrome: boolean
  isSelected: boolean
  draggingId: string | null
  dragOverId: string | null
  previousId: string | null
  nextId: string | null
  onSelect: (cardId: string, shiftKey: boolean) => void
  onJump: (cardId: string) => void
  onMove: (sourceId: string, targetId: string) => void
  onDragOverId: (id: string | null) => void
  onDraggingId: (id: string | null) => void
  onRate: (cardId: string, rating: UnitRating) => void
  onRemove?: (cardId: string) => void
  /** This card's background save: 保存中 / 已保存 / 未保存. */
  saveState?: RatingSaveEntry | null
}

function RowSaveChip({
  cardId,
  label,
  saveState,
  onRate,
}: {
  cardId: string
  label: string
  saveState: RatingSaveEntry | null | undefined
  onRate: (cardId: string, rating: UnitRating) => void
}) {
  if (!saveState) return null
  if (saveState.status === 'saving') {
    return (
      <span
        data-testid={`round-plan-save-${cardId}`}
        data-save="saving"
        className="inline-flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground"
      >
        <LoaderCircle className="size-3 animate-spin" aria-hidden />保存中
      </span>
    )
  }
  if (saveState.status === 'failed' && saveState.rating != null) {
    const rating = saveState.rating
    return (
      <button
        type="button"
        data-testid={`round-plan-save-${cardId}`}
        data-save="failed"
        className="shrink-0 rounded-full border border-rate-again/50 px-2 py-0.5 text-[11px] font-medium text-rate-again hover:bg-rate-again/10"
        aria-label={`${label}未保存，点此重试`}
        onClick={() => onRate(cardId, rating)}
      >
        未保存 · 重试
      </button>
    )
  }
  if (saveState.status === 'saved' && saveState.ackedRating != null) {
    return (
      <span
        data-testid={`round-plan-save-${cardId}`}
        data-save="saved"
        className="shrink-0 text-[11px] text-rate-good"
      >
        已保存
      </span>
    )
  }
  return null
}

function RoundPlanRowView({
  entry,
  model,
  showChrome,
  isSelected,
  draggingId,
  dragOverId,
  previousId,
  nextId,
  onSelect,
  onJump,
  onMove,
  onDragOverId,
  onDraggingId,
  onRate,
  onRemove,
  saveState = null,
}: RoundPlanRowProps) {
  const { cardId, status, label } = model
  const canDrag = status !== 'completed' && status !== 'excluded'
  const retryPending = model.retry && !model.retryDone && status !== 'excluded'
  return (
    <div>
      {dragOverId === cardId && draggingId !== cardId ? (
        <div
          data-testid="round-plan-drop-placeholder"
          className="mx-1 my-1 flex h-14 items-center justify-center rounded-lg border-2 border-dashed border-primary/60 bg-primary/8 text-xs font-medium text-primary fs-expand"
        >
          放到这里
        </div>
      ) : null}
      <div
        data-testid={`round-plan-card-${cardId}`}
        data-fill={status}
        data-selected={isSelected || undefined}
        data-rail-index={model.railIndex ?? undefined}
        data-retry={model.retry ? (model.retryDone ? 'done' : 'pending') : undefined}
        draggable={canDrag}
        onClick={(event) => {
          // Buttons and the checkbox handle their own clicks; the rest of the row toggles.
          const target = event.target as HTMLElement
          if (target.closest('button, input, select, textarea, a')) return
          onSelect(cardId, event.shiftKey)
        }}
        onDragStart={(event) => {
          if (!canDrag) return
          event.dataTransfer.effectAllowed = 'move'
          event.dataTransfer.setData('text/plain', cardId)
          onDraggingId(cardId)
        }}
        onDragEnter={() => canDrag && onDragOverId(cardId)}
        onDragOver={(event) => {
          if (!canDrag) return
          event.preventDefault()
          event.dataTransfer.dropEffect = 'move'
          onDragOverId(cardId)
        }}
        onDrop={(event) => {
          event.preventDefault()
          const sourceId = draggingId || event.dataTransfer.getData('text/plain')
          if (sourceId) onMove(sourceId, cardId)
          onDraggingId(null)
          onDragOverId(null)
        }}
        onDragEnd={() => {
          onDraggingId(null)
          onDragOverId(null)
        }}
        className={cn(
          'mx-1 my-1 flex min-h-11 cursor-pointer flex-wrap items-center gap-x-2 gap-y-1.5 rounded-xl border px-2 py-2 text-sm transition-[background-color,border-color,box-shadow,opacity] duration-200',
          model.isCurrent
            ? 'border-primary/60 bg-primary/12 shadow-sm ring-1 ring-primary/25'
            : retryPending
              ? 'border-rate-hard/35 bg-rate-hard/10 hover:border-rate-hard/50'
              : model.retryDone
                ? 'border-rate-good/25 bg-rate-good/8 hover:border-rate-good/40'
                : 'border-transparent hover:border-border/70 hover:bg-background/70',
          isSelected && 'border-primary/50 bg-primary/8',
          draggingId === cardId && 'opacity-45',
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
              onClick={() => previousId && onMove(cardId, previousId)}
            >
              <ChevronDown className="size-3.5 rotate-180" />
            </button>
            <button
              type="button"
              disabled={!canDrag || !nextId}
              className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted disabled:opacity-40"
              aria-label={`下移${label}`}
              onClick={() => nextId && onMove(cardId, nextId)}
            >
              <ChevronDown className="size-3.5" />
            </button>
          </div>
        </div>
        <input
          type="checkbox"
          className="size-4 shrink-0 accent-primary"
          checked={isSelected}
          onChange={() => undefined}
          onClick={(event) => {
            event.stopPropagation()
            onSelect(cardId, event.shiftKey)
          }}
          aria-label={`选择${label}`}
        />
        {showChrome && model.accentClass ? (
          <span
            aria-hidden
            data-testid={`round-plan-accent-${cardId}`}
            className={cn('h-6 w-1 shrink-0 rounded-full', model.accentClass)}
          />
        ) : null}
        {showChrome && model.railIndex ? (
          <span className="w-6 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
            {model.railIndex}
          </span>
        ) : null}
        <span
          className="flex min-w-[10rem] flex-1 items-baseline gap-1.5 leading-snug"
          title={model.title}
        >
          {model.lead ? (
            <span className="shrink-0 text-[11px] font-medium text-rate-hard">{model.lead}</span>
          ) : null}
          {model.root ? (
            <>
              <span className="min-w-0 max-w-[45%] shrink truncate text-muted-foreground">{model.root}</span>
              <span aria-hidden className="shrink-0 text-muted-foreground"> ⋯ </span>
            </>
          ) : null}
          <span className="min-w-0 flex-1 truncate font-medium">{model.anchor}</span>
        </span>
        {showChrome && model.palaceHint ? (
          <span className="max-w-[28%] shrink truncate text-[11px] text-muted-foreground">{model.palaceHint}</span>
        ) : null}
        <span className={cn('shrink-0 rounded-full border px-2 py-0.5 text-[11px]', model.statusChrome)}>
          {model.statusLabel}
        </span>
        <button
          type="button"
          data-row-control
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-primary disabled:opacity-40"
          disabled={!model.canJump}
          aria-label={`跳到${label}`}
          title="跳到这张卡片"
          onClick={() => model.canJump && onJump(cardId)}
        >
          <CornerDownRight className="size-4" />
        </button>
        {entry.occurrenceKind === 'retry' && !model.retryDone ? (
          <span className="shrink-0 text-[11px] text-rate-hard">
            来源 {entry.sourceCardId} · {entry.retryAfterCards}张后
          </span>
        ) : null}
        <RowSaveChip cardId={cardId} label={label} saveState={saveState} onRate={onRate} />
        {model.rateable ? (
          <div
            className="flex w-full items-center gap-1.5 sm:w-auto sm:gap-1"
            role="group"
            aria-label={`给${label}评分`}
          >
            {onRemove ? (
              <button
                type="button"
                className="inline-flex h-11 flex-1 items-center justify-center rounded-lg border border-border/70 px-2 text-xs font-semibold text-muted-foreground hover:border-primary/60 hover:text-primary sm:h-7 sm:flex-none sm:rounded-md sm:px-1.5 sm:text-[11px]"
                aria-label={`${label}移除本队列`}
                onClick={() => onRemove(cardId)}
              >
                移除
              </button>
            ) : null}
            {[1, 2, 3, 4].map((rating) => {
              // Lit only from the acknowledged ledger; a pending tap only spins.
              const pending = saveState?.status === 'saving'
                && saveState.pendingKind === 'rate'
                && saveState.rating === rating
              const failed = saveState?.status === 'failed' && saveState.rating === rating
              return (
                <button
                  key={rating}
                  type="button"
                  className={cn(
                    'relative inline-flex h-11 flex-1 items-center justify-center rounded-lg border text-sm font-semibold transition-colors sm:h-7 sm:w-7 sm:flex-none sm:rounded-md sm:text-[11px]',
                    entry.lastRating === rating
                      ? 'border-primary bg-primary text-primary-foreground'
                      : failed
                        ? 'border-rate-again/60 text-rate-again'
                        : 'border-border/70 text-muted-foreground hover:border-primary/60 hover:text-primary',
                  )}
                  aria-label={`${label}评分${rating}`}
                  aria-pressed={entry.lastRating === rating}
                  aria-busy={pending || undefined}
                  data-pending={pending ? 'true' : undefined}
                  data-failed={failed ? 'true' : undefined}
                  onClick={() => onRate(cardId, rating as UnitRating)}
                >
                  {rating}
                </button>
              )
            })}
          </div>
        ) : null}
        {status === 'completed' ? <Check className="size-4 shrink-0 text-rate-good" /> : null}
      </div>
    </div>
  )
}

export const RoundPlanRow = memo(RoundPlanRowView)
