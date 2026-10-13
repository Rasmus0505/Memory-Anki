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
  palaceIdentityClass,
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
  buildPlanRowModel,
  cardPathTexts,
  palaceIdFromEntry,
  RoundPlanRow,
  rowAccentClass,
  rowLabel,
  type PlanRowModel,
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
  /** Last row the learner clicked; the anchor for shift-click ranges. */
  const lastClickedIdRef = useRef<string | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const [collapsedPalaces, setCollapsedPalaces] = useState<Set<number>>(new Set())
  const [viewMode, setViewMode] = useState<RoundPlanView>('palace')
  const palaceDocumentVersion = usePalaceDocumentVersion()
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
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])
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

  /** Path, status and label of one row. Built once per plan change, not per render. */
  const buildModel = useCallback((
    entry: FreestyleRoundPlanCard,
    progressChrome: boolean,
  ): PlanRowModel => {
    const liveCard = liveById.get(entry.cardId)
    const palaceHint = entry.palaceTitle && entry.palaceTitle !== rowLabel(entry)
      ? entry.palaceTitle
      : undefined
    return buildPlanRowModel({
      entry,
      liveCard,
      status: fillStatus(entry),
      isCurrent: entry.cardId === currentCardId,
      pathTexts: cardPathTexts(
        liveCard,
        liveCard?.type === 'mindmap_branch' ? readPalaceEditorDoc(liveCard.palace_id) : null,
      ),
      accentClass: progressChrome ? rowAccentClass(segmentById.get(entry.cardId)) : undefined,
      railIndex: progressChrome ? railIndexById.get(entry.cardId) : undefined,
      palaceHint: progressChrome ? palaceHint : undefined,
    })
  }, [currentCardId, fillStatus, liveById, railIndexById, segmentById])

  const rowModels = useMemo(() => {
    const map = new Map<string, PlanRowModel>()
    for (const entry of [...planRows, ...workingRows]) {
      if (map.has(entry.cardId)) continue
      map.set(entry.cardId, buildModel(entry, viewMode === 'progress'))
    }
    return map
    // palaceDocumentVersion: the path falls back to the editor document, so a newly loaded
    // document must rebuild the labels.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildModel, palaceDocumentVersion, planRows, viewMode, workingRows])

  /** Row ids in on-screen order, used for shift-click ranges. Collapsed palaces are skipped. */
  const visibleIds = useMemo(() => {
    if (viewMode === 'progress') {
      return progressSections.flatMap((section) => section.entries.map((entry) => entry.cardId))
    }
    const ids: string[] = []
    sections.forEach((section) => section.groups.forEach(([palaceId, entries]) => {
      if (collapsedPalaces.has(palaceId)) return
      entries.forEach((entry) => ids.push(entry.cardId))
    }))
    excludedOffFeed.forEach((entry) => ids.push(entry.cardId))
    return ids
  }, [collapsedPalaces, excludedOffFeed, progressSections, sections, viewMode])

  const moveRow = useCallback((sourceId: string, targetId: string) => {
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
  }, [onReorder, roundPlan])

  /** Click toggles one row; shift-click adds every row between the last click and this one. */
  const handleRowSelect = useCallback((cardId: string, shiftKey: boolean) => {
    const anchorId = lastClickedIdRef.current
    const from = anchorId ? visibleIds.indexOf(anchorId) : -1
    const to = visibleIds.indexOf(cardId)
    if (shiftKey && from >= 0 && to >= 0) {
      const [start, end] = from < to ? [from, to] : [to, from]
      const range = visibleIds.slice(start, end + 1)
      setSelectedIds((current) => [...new Set([...current, ...range])])
    } else {
      setSelectedIds((current) => (
        current.includes(cardId) ? current.filter((id) => id !== cardId) : [...current, cardId]
      ))
    }
    lastClickedIdRef.current = cardId
  }, [visibleIds])

  const selectPalaceRows = (entries: FreestyleRoundPlanCard[]) => {
    const ids = entries.map((entry) => entry.cardId)
    setSelectedIds((current) => [...new Set([...current, ...ids])])
  }
  const invertPalaceRows = (entries: FreestyleRoundPlanCard[]) => {
    const ids = entries.map((entry) => entry.cardId)
    setSelectedIds((current) => {
      const next = new Set(current)
      ids.forEach((id) => {
        if (next.has(id)) next.delete(id)
        else next.add(id)
      })
      return [...next]
    })
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
    const model = rowModels.get(entry.cardId) ?? buildModel(entry, progressChrome)
    const index = neighborIds.indexOf(entry.cardId)
    return (
      <RoundPlanRow
        key={entry.cardId}
        entry={entry}
        model={model}
        showChrome={progressChrome}
        isSelected={selectedSet.has(entry.cardId)}
        draggingId={draggingId}
        dragOverId={dragOverId}
        previousId={index > 0 ? neighborIds[index - 1] ?? null : null}
        nextId={index >= 0 ? neighborIds[index + 1] ?? null : null}
        onSelect={handleRowSelect}
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
        if (!next) {
          setSelectedIds([])
          lastClickedIdRef.current = null
        }
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

        <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-4 py-2 sm:px-5">
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
                        <span
                          aria-hidden
                          className={cn('h-5 w-1 shrink-0 rounded-full', palaceIdentityClass(palaceId))}
                        />
                        <div className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</div>
                        <span className="text-xs text-muted-foreground">
                          {entries.filter((entry) => fillStatus(entry) === 'completed').length}/{entries.length}
                        </span>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs"
                          aria-label={`全选${title}`}
                          onClick={() => selectPalaceRows(entries)}
                        >
                          全选
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs"
                          aria-label={`反选${title}`}
                          onClick={() => invertPalaceRows(entries)}
                        >
                          反选
                        </Button>
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

        {selectedIds.length ? (
          <div
            data-testid="round-plan-batch-bar"
            role="toolbar"
            aria-label="已选安排的批量操作"
            className="sticky bottom-0 z-10 flex shrink-0 flex-wrap items-center gap-2 border-t border-border/60 bg-background/95 px-4 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom,0px))] backdrop-blur sm:px-5"
          >
            <span className="mr-auto text-sm font-medium">已选 {selectedIds.length} 张</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => onExclude(selectedIds)}
            >
              <X className="size-3.5" />排除
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => onRestore(selectedIds)}
            >
              <Undo2 className="size-3.5" />恢复
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!compressibleIds.length}
              onClick={onCompressCompleted}
            >
              <Archive className="size-3.5" />结算
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setSelectedIds([])
                lastClickedIdRef.current = null
              }}
            >
              取消选择
            </Button>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
