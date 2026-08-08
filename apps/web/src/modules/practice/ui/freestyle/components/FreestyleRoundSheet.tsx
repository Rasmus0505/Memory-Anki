import { useMemo, useState } from 'react'
import {
  Check,
  ChevronDown,
  ChevronRight,
  GripVertical,
  RotateCcw,
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
  queueLimit,
  onOpenChange,
  onJump,
  onExclude,
  onRestore,
  onReorder,
  onResetRound,
  onOpenConfig,
  loading = false,
}: {
  open: boolean
  cards: FreestyleCard[]
  currentIndex: number
  queueState: FreestyleSkipState
  roundPlan: FreestyleRoundPlanState | null
  queueLimit: number
  onOpenChange: (open: boolean) => void
  onJump: (cardId: string) => void
  onExclude: (cardIds: string[]) => void
  onRestore: (cardIds: string[]) => void
  onReorder: (orderIds: string[]) => void
  onResetRound: () => void
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
  const groups = useMemo(() => {
    const result = new Map<number, FreestyleRoundPlanCard[]>()
    rows.forEach((entry) => {
      const id = palaceIdFromEntry(entry)
      const bucket = result.get(id) ?? []
      bucket.push(entry)
      result.set(id, bucket)
    })
    return [...result.entries()]
  }, [rows])
  const currentCardId = cards[currentIndex]?.id ?? queueState.currentCardId
  const selectedSet = new Set(selectedIds)

  const moveRow = (sourceId: string, targetId: string) => {
    if (sourceId === targetId || !roundPlan) return
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
        className="flex max-h-[min(85vh,100dvh-2rem)] flex-col gap-0 rounded-t-2xl p-0"
      >
        <SheetHeader className="shrink-0 space-y-1 border-b border-border/60 px-4 py-3 text-left sm:px-5">
          <SheetTitle className="text-base">本轮安排</SheetTitle>
          <SheetDescription className="text-xs">
            已安排 {roundPlan?.scheduledCount ?? rows.length} 张 · 候选 {roundPlan?.candidateCount ?? rows.length} · 上限 {roundPlan?.queueLimit ?? queueLimit}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-4 py-2 sm:px-5">
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
            variant="ghost"
            disabled={loading}
            aria-busy={loading}
            onClick={onResetRound}
          >
            <RotateCcw className={cn('size-3.5', loading && 'animate-spin')} />
            {loading ? '正在安排...' : '再来一轮'}
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
          {roundPlan?.limitReached ? (
            <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/8 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
              候选内容超过本轮上限，只安排了前 {roundPlan.queueLimit} 张。
            </div>
          ) : null}
          {!roundPlan || !rows.length ? (
            <div className="flex min-h-40 items-center justify-center text-sm text-muted-foreground">
              当前还没有本轮安排。
            </div>
          ) : null}
          <div className="space-y-3">
            {groups.map(([palaceId, entries]) => {
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
                      {entries.filter((entry) => entry.status === 'completed').length}/{entries.length}
                    </span>
                  </div>
                  {!collapsed ? (
                    <div className="divide-y divide-border/50">
                      {entries.map((entry) => {
                        const liveCard = liveById.get(entry.cardId)
                        const status = liveCard
                          ? planCardStatus(liveCard, roundPlan, queueState.completedIds, queueState.hiddenIds, currentCardId)
                          : entry.status
                        const isSelected = selectedSet.has(entry.cardId)
                        const canDrag = status !== 'completed' && status !== 'excluded'
                        const isActive = status === 'active'
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
                                isActive
                                  ? 'border-emerald-500/60 bg-emerald-500/12 shadow-sm ring-1 ring-emerald-500/20'
                                  : 'border-transparent hover:border-border/70 hover:bg-background/70',
                                isSelected && !isActive && 'bg-primary/5',
                                draggingId === entry.cardId && 'opacity-45',
                                status === 'excluded' && 'opacity-65',
                              )}
                            >
                              <button
                                type="button"
                                draggable={false}
                                disabled={!canDrag}
                                className="inline-flex size-8 shrink-0 cursor-grab items-center justify-center rounded-md text-muted-foreground hover:bg-muted active:cursor-grabbing disabled:cursor-not-allowed"
                                aria-label={`拖动${rowLabel(entry)}`}
                                title="拖动调整顺序"
                              >
                                <GripVertical className="size-4" />
                              </button>
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
                              <span className={cn('shrink-0 rounded-full border px-2 py-0.5 text-[11px]', STATUS_CLASSES[status])}>
                                {isActive ? '当前复习' : STATUS_LABELS[status]}
                              </span>
                              {entry.occurrenceKind === 'retry' ? (
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
        </div>
      </SheetContent>
    </Sheet>
  )
}
