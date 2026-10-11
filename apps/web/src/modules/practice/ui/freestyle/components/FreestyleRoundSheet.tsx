import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { UnitRating } from '@/modules/practice/public'
import {
  Archive,
  ChevronDown,
  ChevronRight,
  SlidersHorizontal,
  Undo2,
  X,
} from 'lucide-react'
import {
  cardSettledOut,
  compressibleRoundPlanIds,
  planCardStatus,
  planEntryForLiveCard,
  settledIdSet,
  type FreestyleRoundPlanCard,
  type FreestyleRoundPlanCardStatus,
  type FreestyleRoundPlanState,
  isOccurrenceScored,
} from '@/modules/practice/public'
import type { FreestyleCard } from '@/shared/api/contracts'
import {
  buildFreestyleProgressSummary,
  dayCohortLabel,
  roundDaySpan,
  visualPlanStatus,
  type FreestyleProgressSegment,
} from '@/modules/practice/ui/freestyle/model/freestyleProgressSegments'
import { formatLocalDateKey } from '@/shared/lib/dateTime'
import { Button } from '@/shared/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/shared/components/ui/sheet'
import type { FreestyleSkipState } from '@/modules/practice/domain/queueState'
import {
  palaceIdFromEntry,
  RoundPlanRow,
  rowAccentClass,
  rowLabel,
  type RoundPlanView,
} from '@/modules/practice/ui/freestyle/components/FreestyleRoundPlanRow'
import {
  prefetchUnitPreview,
  readPalaceEditorDoc,
  usePalaceDocumentVersion,
} from '@/modules/practice/ui/freestyle/model/freestyleUnitPreviewCache'
import { cn } from '@/shared/lib/utils'


/**
 * In-round pace: open from the HUD count (or an off-feed tick), glance, jump or reorder, close.
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
  onCompressCompleted,
  onReorder,
  onOpenConfig,
  onRateCard,
  onRemoveCard,
  labelToday,
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
  onCompressCompleted: () => void
  onReorder: (orderIds: string[]) => void
  onOpenConfig: () => void
  onRateCard?: (cardId: string, rating: UnitRating) => void
  onRemoveCard?: (cardId: string) => void
  loading?: boolean
  /** Day the section titles speak from. Defaults to the learner's today. */
  labelToday?: string
}) {
  const spokenToday = labelToday || formatLocalDateKey(new Date())
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const [collapsedPalaces, setCollapsedPalaces] = useState<Set<number>>(new Set())
  const [viewMode, setViewMode] = useState<RoundPlanView>('palace')
  usePalaceDocumentVersion()
  const requestedPalaces = useRef(new Set<number>())
  useEffect(() => {
    if (!open) return
    for (const card of cards) {
      if (card.type !== 'mindmap_branch') continue
      if (readPalaceEditorDoc(card.palace_id)) continue
      if (requestedPalaces.current.has(card.palace_id)) continue
      if (!card.unit_id || card.unit_revision == null) continue
      requestedPalaces.current.add(card.palace_id)
      void prefetchUnitPreview(card.unit_id, card.unit_revision)
    }
  }, [open, cards])

  const liveById = useMemo(() => new Map(cards.map((card) => [card.id, card])), [cards])
  const planRows = useMemo(() => {
    if (!roundPlan) return []
    return roundPlan.orderIds.map((id) => roundPlan.cardsById[id]).filter(Boolean)
  }, [roundPlan])
  const workingRows = useMemo(() => {
    const compressed = settledIdSet(roundPlan?.compressedIds)
    return cards.flatMap((card) => {
      const id = String(card.id || '').trim()
      if (!id || cardSettledOut(card, compressed)) return []
      const entry = planEntryForLiveCard(card, roundPlan)
      return entry ? [entry] : []
    })
  }, [cards, roundPlan])
  const arrangementCatchingUp = !roundPlan && cards.length > 0
  const arrangementCount = arrangementCatchingUp ? cards.length : workingRows.length
  const excludedOffFeed = useMemo(() => {
    const shown = new Set(workingRows.map((entry) => entry.cardId))
    return planRows.filter((entry) => !shown.has(entry.cardId) && entry.status === 'excluded')
  }, [planRows, workingRows])
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
    const distinct = new Set(workingRows.map((entry) => entry.enteredOn || ''))
    if (distinct.size <= 1) return [{ key: 'all', title: '', groups: groupPalace(workingRows) }]
    const order: string[] = []
    const buckets = new Map<string, FreestyleRoundPlanCard[]>()
    workingRows.forEach((entry) => {
      const day = entry.enteredOn || ''
      const bucket = buckets.get(day) ?? []
      if (!buckets.has(day)) order.push(day)
      bucket.push(entry)
      buckets.set(day, bucket)
    })
    return order.map((day) => ({
      key: day || 'undated',
      title: day ? dayCohortLabel(day, spokenToday) : '更早留下的',
      groups: groupPalace(buckets.get(day) ?? []),
    }))
  }, [workingRows, spokenToday])
  const currentCardId = cards[currentIndex]?.id ?? queueState.currentCardId
  const selectedSet = new Set(selectedIds)
  const fillStatus = useCallback((entry: FreestyleRoundPlanCard): FreestyleRoundPlanCardStatus => {
    const liveCard = liveById.get(entry.cardId)
    const planStatus = liveCard
      ? planCardStatus(liveCard, roundPlan, queueState.completedIds, queueState.hiddenIds, currentCardId)
      : entry.status
    return visualPlanStatus(
      planStatus,
      queueState.unitEncountersByCardId[entry.cardId],
      entry.status,
      isOccurrenceScored(entry.cardId, {
        completedIds: queueState.completedIds,
        encounters: queueState.unitEncountersByCardId,
        roundPlan,
      }),
    )
  }, [
    currentCardId,
    liveById,
    queueState.completedIds,
    queueState.hiddenIds,
    queueState.unitEncountersByCardId,
    roundPlan,
  ])
  const compressibleIds = useMemo(
    () => compressibleRoundPlanIds(roundPlan, {
      completedIds: queueState.completedIds,
      encounters: queueState.unitEncountersByCardId,
      liveCardIds: cards.map((card) => card.id),
    }),
    [cards, queueState.completedIds, queueState.unitEncountersByCardId, roundPlan],
  )
  const progressSummary = useMemo(
    () => buildFreestyleProgressSummary(
      cards,
      roundPlan,
      queueState.completedIds,
      queueState.hiddenIds,
      currentCardId ?? null,
      queueState.unitEncountersByCardId,
    ),
    [
      cards,
      currentCardId,
      queueState.completedIds,
      queueState.hiddenIds,
      queueState.unitEncountersByCardId,
      roundPlan,
    ],
  )
  const segmentById = useMemo(() => {
    const map = new Map<string, FreestyleProgressSegment>()
    progressSummary.segments.forEach((segment) => map.set(segment.cardId, segment))
    return map
  }, [progressSummary.segments])
  const railIndexById = useMemo(() => {
    const map = new Map<string, number>()
    progressSummary.segments.forEach((segment, index) => map.set(segment.cardId, index + 1))
    return map
  }, [progressSummary.segments])
  const progressSections = useMemo(() => {
    const byId = roundPlan?.cardsById ?? {}
    const entriesFor = (list: FreestyleProgressSegment[]) => list.flatMap((segment) => {
      const card = liveById.get(segment.cardId)
      const entry = byId[segment.cardId] ?? (card ? planEntryForLiveCard(card, roundPlan) : null)
      return entry ? [entry] : []
    })
    const split = progressSummary.segments.some((segment) => segment.cohortBoundary)
    const runs: FreestyleProgressSegment[][] = []
    progressSummary.segments.forEach((segment) => {
      if (segment.cohortBoundary || runs.length === 0) runs.push([])
      runs[runs.length - 1]?.push(segment)
    })
    const sections: Array<{ key: string; title: string; entries: FreestyleRoundPlanCard[] }> = runs
      .map((run, index) => {
        const day = run.find((segment) => segment.enteredOn)?.enteredOn || ''
        return {
          key: day ? `${day}-${index}` : `run-${index}`,
          title: split ? (day ? dayCohortLabel(day, spokenToday) : '更早留下的') : '',
          entries: entriesFor(run),
        }
      })
      .filter((section) => section.entries.length)
    const shown = new Set(sections.flatMap((section) => section.entries.map((entry) => entry.cardId)))
    const excluded = planRows.filter((entry) => !shown.has(entry.cardId) && fillStatus(entry) === 'excluded')
    if (excluded.length) sections.push({ key: 'excluded', title: '已排除', entries: excluded })
    return sections
  }, [fillStatus, liveById, planRows, progressSummary.segments, roundPlan, spokenToday])

  const moveRow = (sourceId: string, targetId: string) => {
    if (sourceId === targetId || !roundPlan) return
    const source = roundPlan.cardsById[sourceId]
    const target = roundPlan.cardsById[targetId]
    if (source && target && (source.enteredOn || '') !== (target.enteredOn || '')) return
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
  const orderIds = roundPlan?.orderIds ?? []
  const onRate = useCallback((cardId: string, rating: UnitRating) => {
    onRateCard?.(cardId, rating)
  }, [onRateCard])

  const renderPlanRow = (
    entry: FreestyleRoundPlanCard,
    neighborIds: string[],
    progressChrome: boolean,
  ) => {
    const label = rowLabel(entry)
    const palaceHint = progressChrome && entry.palaceTitle && entry.palaceTitle !== label
      ? entry.palaceTitle
      : undefined
    return (
      <RoundPlanRow
        key={entry.cardId}
        entry={entry}
        liveCard={liveById.get(entry.cardId)}
        status={fillStatus(entry)}
        isCurrent={entry.cardId === currentCardId}
        isSelected={selectedSet.has(entry.cardId)}
        draggingId={draggingId}
        dragOverId={dragOverId}
        neighborIds={neighborIds}
        accentClass={progressChrome ? rowAccentClass(segmentById.get(entry.cardId)) : undefined}
        railIndex={progressChrome ? railIndexById.get(entry.cardId) : undefined}
        palaceHint={palaceHint}
        onToggle={toggleSelected}
        onJump={onJump}
        onMove={moveRow}
        onDragOverId={setDragOverId}
        onDraggingId={setDraggingId}
        onRate={onRate}
        onRemove={onRemoveCard}
      />
    )
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
        <SheetHeader className="shrink-0 space-y-1 border-b border-border/60 px-4 py-3 pr-12 text-left sm:px-5 sm:pr-14">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <SheetTitle className="text-base">本轮安排</SheetTitle>
            <div
              role="group"
              aria-label="本轮安排视图"
              className="inline-flex shrink-0 rounded-lg bg-muted p-0.5"
            >
              {([
                ['palace', '按宫殿'],
                ['progress', '按进度'],
              ] as const).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={viewMode === mode}
                  className={cn(
                    'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                    viewMode === mode
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                  onClick={() => setViewMode(mode)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <SheetDescription className="text-xs">
            本轮 {arrangementCount} 张
            {roundDaySpan(workingRows.map((entry) => entry.enteredOn), spokenToday) > 1
              ? ` · 跨了 ${roundDaySpan(workingRows.map((entry) => entry.enteredOn), spokenToday)} 天`
              : ''}
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
            disabled={!compressibleIds.length}
            onClick={onCompressCompleted}
          >
            <Archive className="size-3.5" />
            {compressibleIds.length ? `结算已完成 ${compressibleIds.length}` : '结算已完成单元'}
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
          {!workingRows.length && !excludedOffFeed.length ? (
            <div className="flex min-h-40 items-center justify-center text-sm text-muted-foreground">
              {arrangementCatchingUp ? '安排正在接上，先按上面的进度翻。' : '当前还没有本轮安排。'}
            </div>
          ) : null}
          <div className="space-y-4" data-testid="round-plan-list" data-mode={viewMode}>
            {viewMode === 'palace' ? (
              <>
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
                          {entries.map((entry) => renderPlanRow(entry, orderIds, false))}
                        </div>
                      ) : null}
                    </section>
                  )
                })}
              </div>
            ))}
            {excludedOffFeed.length ? (
              <section className="rounded-xl border border-border/70 bg-card/30">
                <div className="border-b border-border/60 px-3 py-2 text-sm font-semibold">已排除</div>
                <div className="divide-y divide-border/50">
                  {excludedOffFeed.map((entry) => renderPlanRow(
                    entry,
                    excludedOffFeed.map((item) => item.cardId),
                    false,
                  ))}
                </div>
              </section>
            ) : null}
              </>
            ) : progressSections.map((section) => {
              const neighborIds = section.entries.map((entry) => entry.cardId)
              return (
                <div key={section.key} className="space-y-1">
                  {section.title ? (
                    <div
                      data-testid={`round-plan-cohort-${section.key}`}
                      className="text-xs font-semibold tracking-wide text-muted-foreground"
                    >
                      {section.title}
                    </div>
                  ) : null}
                  <div className="divide-y divide-border/50">
                    {section.entries.map((entry) => renderPlanRow(entry, neighborIds, section.key !== 'excluded'))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
