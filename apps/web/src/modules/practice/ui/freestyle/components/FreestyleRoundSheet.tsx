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
import { beijingStudyDay } from '@/shared/lib/dateTime'
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
import { useRatingSaveEntries } from '@/modules/practice/ui/freestyle/hooks/useFreestyleRatingSaves'
import { unsavedRatingCardIds } from '@/modules/practice/ui/freestyle/model/ratingSaveStore'
import { cn } from '@/shared/lib/utils'

/** What a 多选 评分 sent: queued per card, already at that grade, or not rateable. */
export interface PlanBatchRatingResult {
  queued: number
  unchanged: number
  skipped: number
}


function groupEntriesByPalace(entries: FreestyleRoundPlanCard[]) {
  const result = new Map<number, FreestyleRoundPlanCard[]>()
  entries.forEach((entry) => {
    const id = palaceIdFromEntry(entry)
    const bucket = result.get(id) ?? []
    bucket.push(entry)
    result.set(id, bucket)
  })
  return [...result.entries()]
}

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
  subjectByPalaceId,
  onOpenChange,
  onJump,
  onExclude,
  onRestore,
  onCompressCompleted,
  onReorder,
  onOpenConfig,
  onRateCard,
  onRateCards,
  onRemoveCard,
  labelToday,
}: {
  open: boolean
  cards: FreestyleCard[]
  currentIndex: number
  queueState: FreestyleSkipState
  roundPlan: FreestyleRoundPlanState | null
  subjectByPalaceId?: ReadonlyMap<number, { id: number; name: string }>
  onOpenChange: (open: boolean) => void
  onJump: (cardId: string) => void
  onExclude: (cardIds: string[]) => void
  onRestore: (cardIds: string[]) => void
  onCompressCompleted: () => void
  onReorder: (orderIds: string[]) => void
  onOpenConfig: () => void
  /** Rate one row in the background. The feed does not move. */
  onRateCard?: (cardId: string, rating: UnitRating) => void
  /** 多选 评分: every selected card through the same per-card background save. */
  onRateCards?: (cardIds: string[], rating: UnitRating) => PlanBatchRatingResult | undefined
  onRemoveCard?: (cardId: string) => void
  loading?: boolean
  /** Day the section titles speak from. Defaults to the learner's today. */
  labelToday?: string
}) {
  const spokenToday = labelToday || beijingStudyDay()
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  /** Last row the learner clicked; the anchor for shift-click ranges. */
  const lastClickedIdRef = useRef<string | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const [collapsedPalaces, setCollapsedPalaces] = useState<Set<number>>(new Set())
  const [collapsedSubjects, setCollapsedSubjects] = useState<Set<string>>(new Set())
  const [viewMode, setViewMode] = useState<RoundPlanView>('subject')
  const saveEntries = useRatingSaveEntries(queueState.roundId)
  const [batchRating, setBatchRating] = useState<{
    rating: UnitRating
    cardIds: string[]
    unchanged: number
    skipped: number
  } | null>(null)
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
    const distinct = new Set(workingRows.map((entry) => entry.enteredOn || ''))
    if (distinct.size <= 1) return [{ key: 'all', title: '', groups: groupEntriesByPalace(workingRows) }]
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
      groups: groupEntriesByPalace(buckets.get(day) ?? []),
    }))
  }, [workingRows, spokenToday])
  const subjectSections = useMemo(() => {
    const order: string[] = []
    const buckets = new Map<string, { title: string; entries: FreestyleRoundPlanCard[] }>()
    workingRows.forEach((entry) => {
      const subject = subjectByPalaceId?.get(palaceIdFromEntry(entry))
      const key = subject ? `subject:${subject.id}` : 'subject:none'
      const bucket = buckets.get(key)
      if (bucket) {
        bucket.entries.push(entry)
        return
      }
      order.push(key)
      buckets.set(key, { title: subject?.name ?? '未分类学科', entries: [entry] })
    })
    return order.map((key) => {
      const bucket = buckets.get(key)
      return {
        key,
        title: bucket?.title ?? '',
        groups: groupEntriesByPalace(bucket?.entries ?? []),
      }
    })
  }, [subjectByPalaceId, workingRows])
  const currentCardId = cards[currentIndex]?.id ?? queueState.currentCardId
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const unsavedRatingIds = useMemo(() => unsavedRatingCardIds(saveEntries), [saveEntries])
  const fillStatus = useCallback((entry: FreestyleRoundPlanCard): FreestyleRoundPlanCardStatus => {
    // Not saved is not done: a row must not read 已过 while its own chip says 未保存.
    if (unsavedRatingIds.has(entry.cardId)) return 'active'
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
    unsavedRatingIds,
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
      unsavedRatingIds,
    ),
    [
      cards,
      currentCardId,
      queueState.completedIds,
      queueState.hiddenIds,
      queueState.unitEncountersByCardId,
      roundPlan,
      unsavedRatingIds,
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
    const palaceGroups = viewMode === 'subject'
      ? subjectSections.flatMap((subject) => (collapsedSubjects.has(subject.key) ? [] : subject.groups))
      : sections.flatMap((section) => section.groups)
    palaceGroups.forEach(([palaceId, entries]) => {
      if (collapsedPalaces.has(palaceId)) return
      entries.forEach((entry) => {
        if (entry.kind !== 'quiz_question') ids.push(entry.cardId)
      })
    })
    excludedOffFeed.forEach((entry) => ids.push(entry.cardId))
    return ids
  }, [collapsedPalaces, collapsedSubjects, excludedOffFeed, progressSections, sections, subjectSections, viewMode])

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
  const rateSelected = (rating: UnitRating) => {
    if (!onRateCards || !selectedIds.length) return
    const cardIds = [...selectedIds]
    const result = onRateCards(cardIds, rating)
    setBatchRating({
      rating,
      cardIds,
      unchanged: result?.unchanged ?? 0,
      skipped: result?.skipped ?? 0,
    })
  }
  const batchCounts = batchRating
    ? batchRating.cardIds.reduce(
        (counts, id) => {
          const save = saveEntries[id]
          if (save?.status === 'saving') counts.saving += 1
          else if (save?.status === 'failed') counts.failed += 1
          else if (save?.status === 'saved' && save.ackedRating === batchRating.rating) counts.saved += 1
          return counts
        },
        { saving: 0, saved: 0, failed: 0 },
      )
    : null
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
        saveState={saveEntries[entry.cardId] ?? null}
      />
    )
  }

  const renderPalaceGroup = (palaceId: number, entries: FreestyleRoundPlanCard[]) => {
    const collapsed = collapsedPalaces.has(palaceId)
    const title = entries.find((entry) => entry.palaceTitle)?.palaceTitle
      || (palaceId ? `宫殿 ${palaceId}` : '未归属宫殿')
    // Quiz questions are not listed one per row; they are summarized as a count badge on the palace.
    const quizEntries = entries.filter((entry) => entry.kind === 'quiz_question')
    const rowEntries = entries.filter((entry) => entry.kind !== 'quiz_question')
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
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <span className="truncate text-sm font-semibold">{title}</span>
            {quizEntries.length ? (
              <span
                data-testid={`round-plan-quiz-count-${palaceId}`}
                className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[11px] leading-none text-muted-foreground"
              >
                题 {quizEntries.length}
              </span>
            ) : null}
          </div>
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
            {rowEntries.map((entry) => renderPlanRow(entry, orderIds, false))}
          </div>
        ) : null}
      </section>
    )
  }
  const excludedBlock = excludedOffFeed.length ? (
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
  ) : null

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setSelectedIds([])
          setBatchRating(null)
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
                ['subject', '按学科'],
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
            {viewMode === 'subject' ? (
              <>
                {subjectSections.map((subject) => {
                  const collapsed = collapsedSubjects.has(subject.key)
                  const entries = subject.groups.flatMap(([, group]) => group)
                  const completed = entries.filter((entry) => fillStatus(entry) === 'completed').length
                  return (
                    <section key={subject.key} className="rounded-xl border border-border/70 bg-card/20">
                      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
                        <button
                          type="button"
                          className="inline-flex size-7 items-center justify-center rounded-md hover:bg-muted"
                          aria-label={collapsed ? `展开${subject.title}` : `折叠${subject.title}`}
                          onClick={() => setCollapsedSubjects((current) => {
                            const next = new Set(current)
                            if (next.has(subject.key)) next.delete(subject.key)
                            else next.add(subject.key)
                            return next
                          })}
                        >
                          {collapsed ? <ChevronRight className="size-4" /> : <ChevronDown className="size-4" />}
                        </button>
                        <div className="min-w-0 flex-1 truncate text-sm font-semibold">{subject.title}</div>
                        <span className="text-xs text-muted-foreground">{completed}/{entries.length}</span>
                      </div>
                      {!collapsed ? (
                        <div className="space-y-3 p-2">
                          {subject.groups.map(([palaceId, group]) => renderPalaceGroup(palaceId, group))}
                        </div>
                      ) : null}
                    </section>
                  )
                })}
                {excludedBlock}
              </>
            ) : null}
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
                {section.groups.map(([palaceId, entries]) => renderPalaceGroup(palaceId, entries))}
              </div>
            ))}
            {excludedBlock}
              </>
            ) : null}
            {viewMode === 'progress' ? progressSections.map((section) => {
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
            }) : null}
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
            {onRateCards ? (
              <div role="group" aria-label="给已选评分" className="flex items-center gap-1">
                <span className="text-xs text-muted-foreground">评分</span>
                {([1, 2, 3, 4] as const).map((rating) => (
                  <Button
                    key={rating}
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 w-8 px-0"
                    aria-label={`已选评分${rating}`}
                    onClick={() => rateSelected(rating)}
                  >
                    {rating}
                  </Button>
                ))}
              </div>
            ) : null}
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
                setBatchRating(null)
                lastClickedIdRef.current = null
              }}
            >
              取消选择
            </Button>
            {batchRating && batchCounts ? (
              <div
                data-testid="round-plan-batch-rating-status"
                role="status"
                className="basis-full text-xs text-muted-foreground"
              >
                评分 {batchRating.rating}：已保存 {batchCounts.saved + batchRating.unchanged}
                {batchCounts.saving ? ` · 保存中 ${batchCounts.saving}` : ''}
                {batchCounts.failed ? ` · 未保存 ${batchCounts.failed}（点该行重试）` : ''}
                {batchRating.skipped ? ` · 跳过 ${batchRating.skipped}` : ''}
              </div>
            ) : null}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
