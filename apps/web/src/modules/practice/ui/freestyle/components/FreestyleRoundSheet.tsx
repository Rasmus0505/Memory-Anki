import { useMemo, useState } from 'react'
import {
  Check,
  ChevronDown,
  ChevronRight,
  GripVertical,
  SlidersHorizontal,
  Undo2,
  X,
} from 'lucide-react'
import {
  planCardStatus,
  type FreestyleRoundPlanCard,
  type FreestyleRoundPlanCardStatus,
  type FreestyleRoundPlanState,
} from '@/modules/practice/public'
import type { FreestyleCard } from '@/shared/api/contracts'
import {
  retryChromeClass,
  visualPlanStatus,
} from '@/modules/practice/ui/freestyle/model/freestyleProgressSegments'
import { Button } from '@/shared/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/shared/components/ui/sheet'
import type { FreestyleSkipState } from '@/modules/practice/domain/queueState'
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
  completed: 'border-emerald-500/30 bg-emerald-500/8 text-emerald-700 dark:text-emerald-300',
  retry: 'border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-200',
  excluded: 'border-border/50 bg-muted/50 text-muted-foreground line-through',
  stale: 'border-rose-500/35 bg-rose-500/10 text-rose-700 dark:text-rose-200',
}

function palaceIdFromEntry(entry: FreestyleRoundPlanCard) {
  return entry.palaceId ?? 0
}

function rowLabel(entry: FreestyleRoundPlanCard) {
  return entry.occurrenceKind === 'retry'
    ? `重练第 ${Math.max(1, entry.retryAttempt)} 次 · ${entry.label || entry.cardId}`
    : entry.label || entry.cardId
}

function retryRowStatusLabel(isCurrent: boolean, done: boolean, status: FreestyleRoundPlanCardStatus) {
  if (isCurrent) return done ? '当前 · 已过' : '当前复习'
  if (done) return '重练已过'
  if (status === 'retry' || status === 'pending' || status === 'active') return '待重练'
  return STATUS_LABELS[status]
}

/**
 * In-round pace: open from the progress rail, glance, jump or reorder, close.
 * Configuration lives behind 「调整配置」 because it is a between-rounds decision —
 * the two used to share one 76rem dialog, which on a phone became one long scroll.
 */
export function FreestyleRoundSheet({
  open,
  cards,
  currentIndex,
  queueState,
  roundPlan,
  onOpenChange,
  onJump,
  onExclude,
  onRestore,
  onReorder,
  onOpenConfig,
}: {
  open: boolean
  cards: FreestyleCard[]
  currentIndex: number
  queueState: FreestyleSkipState
  roundPlan: FreestyleRoundPlanState | null
  onOpenChange: (open: boolean) => void
  onJump: (cardId: string) => void
  onExclude: (cardIds: string[]) => void
  onRestore: (cardIds: string[]) => void
  onReorder: (orderIds: string[]) => void
  onOpenConfig: () => void
  loading?: boolean
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const [collapsedPalaces, setCollapsedPalaces] = useState<Set<number>>(new Set())

  const liveById = useMemo(() => new Map(cards.map((card) => [card.id, card])), [cards])
  const rows = useMemo(() => {
    if (!roundPlan) return []
    return roundPlan.orderIds.map((id) => roundPlan.cardsById[id]).filter(Boolean)
  }, [roundPlan])
  const sections = useMemo(() => {
    const groupPalace = (entries: FreestyleRoundPlanCard[]) => {
      const result = new Map<number, FreestyleRoundPlanCard[]>()
      entries.forEach((entry) => {
        const id = palaceIdFromEntry(entry)
        const bucket = result.get(id) ?? []
        bucket.push(entry)
        result.set(id, bucket)
      })
      return [...result.entries()]
    }
    const today = roundPlan?.today || ''
    if (!today) return [{ key: 'all', title: '', groups: groupPalace(rows) }]
    const carried = rows.filter((entry) => entry.enteredOn !== today)
    const fresh = rows.filter((entry) => entry.enteredOn === today)
    if (!carried.length || !fresh.length) {
      return [{ key: 'all', title: '', groups: groupPalace(rows) }]
    }
    return [
      { key: 'carried', title: '此前欠账', groups: groupPalace(carried) },
      { key: 'today', title: '今天新增', groups: groupPalace(fresh) },
    ]
  }, [rows, roundPlan?.today])
  const currentCardId = cards[currentIndex]?.id ?? queueState.currentCardId
  const selectedSet = new Set(selectedIds)
  const fillStatus = (entry: FreestyleRoundPlanCard): FreestyleRoundPlanCardStatus => {
    const liveCard = liveById.get(entry.cardId)
    const planStatus = liveCard
      ? planCardStatus(liveCard, roundPlan, queueState.completedIds, queueState.hiddenIds, currentCardId)
      : entry.status
    return visualPlanStatus(
      planStatus,
      queueState.unitEncountersByCardId[entry.cardId],
      entry.status,
    )
  }

  const moveRow = (sourceId: string, targetId: string) => {
    if (sourceId === targetId || !roundPlan) return
    const today = roundPlan.today || ''
    if (today) {
      const source = roundPlan.cardsById[sourceId]
      const target = roundPlan.cardsById[targetId]
      if (source && target && (source.enteredOn === today) !== (target.enteredOn === today)) return
    }
    const next = [...roundPlan.orderIds]
    const sourceIndex = next.indexOf(sourceId)
    const targetIndex = next.indexOf(targetId)
    if (sourceIndex < 0 || targetIndex < 0) return
    next.splice(sourceIndex, 1)
    next.splice(next.indexOf(targetId), 0, sourceId)
    onReorder(next)
  }

  const toggleSelected = (id: string) => setSelectedIds((current) => (
    current.includes(id) ? current.filter((value) => value !== id) : [...current, id]
  ))
  const toggleGroup = (entries: FreestyleRoundPlanCard[]) => {
    const ids = entries.map((entry) => entry.cardId)
    const allSelected = ids.every((id) => selectedSet.has(id))
    setSelectedIds((current) => (
      allSelected
        ? current.filter((id) => !ids.includes(id))
        : [...new Set([...current, ...ids])]
    ))
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) setSelectedIds([])
        onOpenChange(next)
      }}
    >
      <SheetContent
        side="bottom"
        data-testid="freestyle-round-sheet"
        className="flex max-h-[min(70dvh,100dvh-2rem)] flex-col gap-0 rounded-t-2xl p-0"
      >
        <SheetHeader className="shrink-0 space-y-1 border-b border-border/60 px-4 py-3 text-left sm:px-5">
          <SheetTitle className="text-base">本轮安排</SheetTitle>
          <SheetDescription className="text-xs">
            本轮 {roundPlan?.scheduledCount ?? rows.length} 张
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-4 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom,0px))] sm:px-5">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!selectedIds.length}
            onClick={() => onExclude(selectedIds)}
          >
            <X className="size-3.5" />排除选中
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!selectedIds.length}
            onClick={() => onRestore(selectedIds)}
          >
            <Undo2 className="size-3.5" />恢复选中
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="ml-auto"
            onClick={onOpenConfig}
          >
            <SlidersHorizontal className="size-3.5" />调整配置
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 sm:px-5">
          {!roundPlan || !rows.length ? (
            <div className="flex min-h-40 items-center justify-center text-sm text-muted-foreground">
              当前还没有本轮安排。
            </div>
          ) : null}
          <div className="space-y-4">
            {sections.map((section) => (
              <div key={section.key} className="space-y-3">
                {section.title ? (
                  <div
                    data-testid={`round-plan-cohort-${section.key}`}
                    className="text-xs font-semibold tracking-wide text-muted-foreground"
                  >
                    {section.title}
                  </div>
                ) : null}
            {section.groups.map(([palaceId, entries]) => {
              const collapsed = collapsedPalaces.has(palaceId)
              const title = entries.find((entry) => entry.palaceTitle)?.palaceTitle
                || (palaceId ? `宫殿 ${palaceId}` : '未归属宫殿')
              return (
                <section key={palaceId} className="rounded-xl border border-border/70 bg-card/30">
                  <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
                    <button
                      type="button"
                      className="inline-flex size-7 items-center justify-center rounded-md hover:bg-muted"
                      aria-label={collapsed ? `展开${title}` : `折叠${title}`}
                      onClick={() => setCollapsedPalaces((current) => {
                        const next = new Set(current)
                        if (next.has(palaceId)) next.delete(palaceId)
                        else next.add(palaceId)
                        return next
                      })}
                    >
                      {collapsed ? <ChevronRight className="size-4" /> : <ChevronDown className="size-4" />}
                    </button>
                    <input
                      type="checkbox"
                      checked={entries.every((entry) => selectedSet.has(entry.cardId))}
                      onChange={() => toggleGroup(entries)}
                      aria-label={`选择${title}全部安排`}
                    />
                    <div className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</div>
                    <span className="text-xs text-muted-foreground">
                      {entries.filter((entry) => fillStatus(entry) === 'completed').length}/{entries.length}
                    </span>
                  </div>
                  {!collapsed ? (
                    <div className="divide-y divide-border/50">
                      {entries.map((entry) => {
                        const liveCard = liveById.get(entry.cardId)
                        const status = fillStatus(entry)
                        const isSelected = selectedSet.has(entry.cardId)
                        const canDrag = status !== 'completed' && status !== 'excluded'
                        const isCurrent = entry.cardId === currentCardId
                        const retryDone = entry.occurrenceKind === 'retry' && status === 'completed'
                        const retryPending = entry.occurrenceKind === 'retry' && status !== 'completed' && status !== 'excluded'
                        return (
                          <div key={entry.cardId}>
                            {dragOverId === entry.cardId && draggingId !== entry.cardId ? (
                              <div
                                data-testid="round-plan-drop-placeholder"
                                className="mx-1 my-1 flex h-14 items-center justify-center rounded-lg border-2 border-dashed border-emerald-500/60 bg-emerald-500/8 text-xs font-medium text-emerald-700 dark:text-emerald-300"
                              >
                                放到这里
                              </div>
                            ) : null}
                            <div
                              data-testid={`round-plan-card-${entry.cardId}`}
                              data-fill={status}
                              data-retry={entry.occurrenceKind === 'retry' ? (retryDone ? 'done' : 'pending') : undefined}
                              draggable={canDrag}
                              onDragStart={(event) => {
                                if (!canDrag) return
                                event.dataTransfer.effectAllowed = 'move'
                                event.dataTransfer.setData('text/plain', entry.cardId)
                                setDraggingId(entry.cardId)
                              }}
                              onDragEnter={() => canDrag && setDragOverId(entry.cardId)}
                              onDragOver={(event) => {
                                if (!canDrag) return
                                event.preventDefault()
                                event.dataTransfer.dropEffect = 'move'
                                setDragOverId(entry.cardId)
                              }}
                              onDrop={(event) => {
                                event.preventDefault()
                                const sourceId = draggingId || event.dataTransfer.getData('text/plain')
                                if (sourceId) moveRow(sourceId, entry.cardId)
                                setDraggingId(null)
                                setDragOverId(null)
                              }}
                              onDragEnd={() => {
                                setDraggingId(null)
                                setDragOverId(null)
                              }}
                              className={cn(
                                'mx-1 my-1 flex min-h-14 items-center gap-2 rounded-lg border px-2 py-2 text-sm transition-colors',
                                isCurrent
                                  ? 'border-emerald-500/60 bg-emerald-500/12 shadow-sm ring-1 ring-emerald-500/20'
                                  : retryPending
                                    ? 'border-amber-500/35 bg-amber-500/10 hover:border-amber-500/50'
                                    : retryDone
                                      ? 'border-emerald-500/25 bg-emerald-500/8 hover:border-emerald-500/40'
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
                                  aria-label={`拖动${rowLabel(entry)}`}
                                  title="拖动调整顺序"
                                >
                                  <GripVertical className="size-4" />
                                </button>
                                <div className="flex flex-col sm:hidden">
                                  <button
                                    type="button"
                                    disabled={!canDrag}
                                    className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted disabled:opacity-40"
                                    aria-label={`上移${rowLabel(entry)}`}
                                    onClick={() => {
                                      const index = roundPlan?.orderIds.indexOf(entry.cardId) ?? -1
                                      const previousId = index > 0 ? roundPlan?.orderIds[index - 1] : null
                                      if (previousId) moveRow(entry.cardId, previousId)
                                    }}
                                  >
                                    <ChevronDown className="size-3.5 rotate-180" />
                                  </button>
                                  <button
                                    type="button"
                                    disabled={!canDrag}
                                    className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted disabled:opacity-40"
                                    aria-label={`下移${rowLabel(entry)}`}
                                    onClick={() => {
                                      const index = roundPlan?.orderIds.indexOf(entry.cardId) ?? -1
                                      const nextId = index >= 0 ? roundPlan?.orderIds[index + 1] : null
                                      if (nextId) moveRow(entry.cardId, nextId)
                                    }}
                                  >
                                    <ChevronDown className="size-3.5" />
                                  </button>
                                </div>
                              </div>
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleSelected(entry.cardId)}
                                aria-label={`选择${rowLabel(entry)}`}
                              />
                              <button
                                type="button"
                                className="min-w-0 flex-1 truncate text-left hover:text-primary disabled:cursor-not-allowed"
                                disabled={!liveCard}
                                title={rowLabel(entry)}
                                onClick={() => liveCard && onJump(entry.cardId)}
                              >
                                {rowLabel(entry)}
                              </button>
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
                                <span className="shrink-0 text-[11px] text-amber-700 dark:text-amber-300">
                                  来源 {entry.sourceCardId} · {entry.retryAfterCards}张后
                                </span>
                              ) : null}
                              {status === 'completed' ? <Check className="size-4 shrink-0 text-emerald-500" /> : null}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  ) : null}
                </section>
              )
            })}
              </div>
            ))}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
