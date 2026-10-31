import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Brain, LoaderCircle } from 'lucide-react'
import { MindMapEditorSurface } from '@/modules/content/public'
import { filterMindMapDocumentToNodeUids } from '@/modules/content/public'
import type { MindMapDocumentInput } from '@/modules/content/public'
import {
  cancelUnratedUnitReviewEncounterApi,
  closeUnitReviewEncounterApi,
  FreestyleRatingBar,
  getPalaceReviewUnitsApi,
  getUnitReviewPreviewApi,
  intervalBadgeLabel,
  intervalOutlookLabel,
  ReviewLevelBar,
  rateReviewUnitApi,
  startFreestyleUnitReviewSessionApi,
  type PalaceUnitProjectionDto,
  type ReviewUnitDto,
  type UnitRating,
  type UnitReviewEncounterDto,
  type UnitReviewSessionDto,
} from '@/modules/practice/public'
import { studyDayStart, toIsoDate } from '@/modules/practice/ui/review/model/scheduleLimits'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent } from '@/shared/components/ui/card'
import { MindMapSplitLayout } from '@/shared/components/layout/MindMapSplitLayout'
import { cn } from '@/shared/lib/utils'

function operationId() {
  return (
    crypto.randomUUID?.() ??
    `unit-rating-${Date.now()}-${Math.random().toString(36).slice(2)}`
  )
}

function dateLabel(value: string | null | undefined) {
  if (!value) return '未排期'
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return value
  return `${month}月${day}日`
}

function mergeUnit(projection: PalaceUnitProjectionDto, unit: ReviewUnitDto) {
  const units = projection.units.map((item) => (item.id === unit.id ? { ...item, ...unit } : item))
  const nextReviewDate =
    units
      .map((item) => item.due_date)
      .filter(Boolean)
      .sort()[0] ?? null
  return {
    ...projection,
    units,
    due_unit_count: units.filter((item) => item.due).length,
    next_review_date: nextReviewDate,
  }
}

interface ActiveEncounter {
  sessionId: string
  unitId: string
  encounterId: string
  rated: boolean
}

/**
 * 单元评分：edit-palace work and the review it already provoked in one place.
 *
 * The learner recalls the unit while organising it; rating here books that
 * recall for real, so 随心 does not ask the same unit twice. Only a due unit can
 * be rated — an early pass would prove nothing — and the due date of a not-yet
 * due unit is moved from the progress strip instead.
 */
export default function PalaceUnitRatingPage() {
  const { id } = useParams<{ id: string }>()
  const palaceId = Number(id)
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const today = useMemo(() => toIsoDate(studyDayStart()), [])

  const [projection, setProjection] = useState<PalaceUnitProjectionDto | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get('unit'))
  const [palaceDoc, setPalaceDoc] = useState<unknown>(null)
  const [palaceDocError, setPalaceDocError] = useState<string | null>(null)
  const [session, setSession] = useState<UnitReviewSessionDto | null>(null)
  const [encounter, setEncounter] = useState<UnitReviewEncounterDto | null>(null)
  const [selectedRating, setSelectedRating] = useState<UnitRating | null>(null)
  const [pendingRating, setPendingRating] = useState<UnitRating | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [refreshTick, setRefreshTick] = useState(0)
  const [openNonce, setOpenNonce] = useState(0)
  const [collapsed, setCollapsed] = useState(false)
  const activeRef = useRef<ActiveEncounter | null>(null)

  const units = projection?.units ?? []
  const selectedUnit = units.find((unit) => unit.id === selectedId) ?? null
  const selectedUnitId = selectedUnit?.id ?? null
  const unitShownAtRef = useRef<number | null>(null)
  useEffect(() => {
    unitShownAtRef.current = selectedUnitId == null ? null : Date.now()
  }, [selectedUnitId])
  const getRatingDurationMs = useCallback(
    () =>
      unitShownAtRef.current == null
        ? null
        : Math.max(0, Date.now() - unitShownAtRef.current),
    [],
  )

  const loadProjection = useCallback(async () => {
    if (!Number.isFinite(palaceId) || palaceId <= 0) return
    try {
      const item = await getPalaceReviewUnitsApi(palaceId)
      setProjection(item)
      setLoadError(null)
      setSelectedId((current) => {
        if (current && item.units.some((unit) => unit.id === current)) return current
        return (item.units.find((unit) => unit.due) ?? item.units[0])?.id ?? null
      })
    } catch (caught) {
      setLoadError(caught instanceof Error ? caught.message : '加载复习单元失败')
    }
  }, [palaceId])

  useEffect(() => {
    void loadProjection()
  }, [loadProjection, refreshTick])

  // The palace document is identical for every unit, so fetch it once through
  // the first unit's preview and re-filter on each switch. Keeping the map
  // mounted is what stops a unit click from reloading and refitting the view.
  useEffect(() => {
    if (!selectedId || palaceDoc) return
    const controller = new AbortController()
    setPalaceDocError(null)
    void getUnitReviewPreviewApi(selectedId, { signal: controller.signal })
      .then((item) => {
        if (!controller.signal.aborted) setPalaceDoc(item.palace?.editor_doc ?? null)
      })
      .catch((caught) => {
        if (!controller.signal.aborted) {
          setPalaceDocError(caught instanceof Error ? caught.message : '加载单元内容失败')
        }
      })
    return () => controller.abort()
  }, [selectedId, palaceDoc])

  const releaseActive = useCallback(async () => {
    const active = activeRef.current
    activeRef.current = null
    if (!active) return
    try {
      if (active.rated) {
        await closeUnitReviewEncounterApi(
          active.sessionId,
          active.unitId,
          active.encounterId,
          operationId(),
        )
      } else {
        await cancelUnratedUnitReviewEncounterApi(
          active.sessionId,
          active.unitId,
          active.encounterId,
        )
      }
    } catch {
      // A stale glance is cancelled by the next session start; never block the page.
    }
  }, [])

  // One encounter per selected unit. A rating keeps it open so another grade can
  // still amend this visit; leaving the unit closes it.
  useEffect(() => {
    let cancelled = false
    setSession(null)
    setEncounter(null)
    setSelectedRating(null)
    setActionError(null)
    void (async () => {
      await releaseActive()
      if (cancelled) return
      const unit = selectedUnit
      if (!unit || !unit.due) return
      try {
        const started = await startFreestyleUnitReviewSessionApi(
          { id: unit.id, revision: unit.revision },
          `unit-rating:${unit.id}:${today}`,
          operationId(),
          { cardId: `review_unit:${unit.id}:r${unit.revision}` },
        )
        const sessionUnit = started.units.find((item) => item.id === unit.id) ?? started.units[0]
        const opened = sessionUnit?.encounter ?? null
        if (cancelled) {
          // The learner moved on while the glance was opening: close it now
          // rather than leaving an unrated encounter open on the server.
          if (opened) {
            void cancelUnratedUnitReviewEncounterApi(started.id, unit.id, opened.id)
          }
          return
        }
        setSession(started)
        setEncounter(opened)
        activeRef.current = opened
          ? {
              sessionId: started.id,
              unitId: unit.id,
              encounterId: opened.id,
              rated: false,
            }
          : null
      } catch (caught) {
        if (!cancelled) {
          setActionError(caught instanceof Error ? caught.message : '打开评分失败')
        }
      }
    })()
    return () => {
      cancelled = true
    }
    // Re-opening is driven by the selected unit, its revision, and an explicit
    // nonce after a manual schedule change — not by the due date a rating just
    // moved, which would tear down the encounter mid-amend.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedUnit?.id, selectedUnit?.revision, openNonce, today, releaseActive])

  useEffect(() => {
    return () => {
      void releaseActive()
    }
  }, [releaseActive])

  const rate = useCallback(
    async (rating: UnitRating) => {
      const active = activeRef.current
      const unit = selectedUnit
      if (!active || !session || !unit || pendingRating) return
      if (selectedRating === rating) return
      setPendingRating(rating)
      setActionError(null)
      try {
        const result = await rateReviewUnitApi(
          session.id,
          { id: unit.id, revision: unit.revision },
          active.encounterId,
          rating,
          operationId(),
        )
        active.rated = true
        setSelectedRating(rating)
        setProjection((current) => (current ? mergeUnit(current, result.unit) : current))
        setRefreshTick((tick) => tick + 1)
      } catch (caught) {
        setActionError(caught instanceof Error ? caught.message : '保存评分失败')
      } finally {
        setPendingRating(null)
      }
    },
    [pendingRating, selectedRating, selectedUnit, session],
  )

  // Depend on the member ids, not the unit object: a rating replaces that
  // object and must not re-filter (and re-layout) an unchanged document.
  const selectedNodeUidsKey = selectedUnit?.node_uids.join('|') ?? ''
  const scopeDoc = useMemo(() => {
    if (!palaceDoc || !selectedNodeUidsKey) return null
    return filterMindMapDocumentToNodeUids(
      palaceDoc as MindMapDocumentInput,
      selectedNodeUidsKey.split('|'),
    )
  }, [palaceDoc, selectedNodeUidsKey])

  const editorState = useMemo(
    () =>
      scopeDoc
        ? { editor_doc: scopeDoc, editor_config: {}, editor_local_config: {}, lang: 'zh' }
        : null,
    [scopeDoc],
  )

  const handleScheduleAdjusted = useCallback(() => {
    setRefreshTick((tick) => tick + 1)
    setOpenNonce((nonce) => nonce + 1)
  }, [])

  const unitsPanel = (
    <aside className="flex h-full min-h-0 flex-col" data-testid="unit-rating-list">
      <div className="flex items-center justify-between px-3 pt-3 text-xs text-muted-foreground">
        <span>复习单元</span>
        <span>
          {units.length} 个 · 今日到期 {projection?.due_unit_count ?? 0}
        </span>
      </div>
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
        {units.map((unit) => {
          const active = unit.id === selectedUnit?.id
          return (
            <button
              key={unit.id}
              type="button"
              data-testid={`unit-rating-row-${unit.id}`}
              data-active={active ? 'true' : undefined}
              onClick={() => setSelectedId(unit.id)}
              className={cn(
                'flex w-full flex-col items-start gap-0.5 rounded-lg border px-2.5 py-2 text-left transition-colors',
                active
                  ? 'border-primary/60 bg-primary/10'
                  : 'border-transparent hover:border-border/70 hover:bg-muted/50',
              )}
            >
              <span className="w-full truncate text-sm font-medium">{unit.title}</span>
              <span className="flex w-full items-center justify-between text-[11px] text-muted-foreground">
                <span className={unit.due ? 'font-medium text-amber-500' : undefined}>
                  {unit.due ? '今天到期' : intervalBadgeLabel(unit.interval_days)}
                </span>
                <span>{dateLabel(unit.due_date)}</span>
              </span>
            </button>
          )
        })}
        {units.length === 0 && !loadError ? (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">
            这座宫殿还没有复习单元。标记永久标记后会出现。
          </p>
        ) : null}
      </div>
    </aside>
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-3 border-b border-border/70 px-4 py-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => navigate(`/palaces/${palaceId}/edit`)}
        >
          <ArrowLeft className="mr-1 size-4" aria-hidden />
          返回编辑
        </Button>
        <div className="flex min-w-0 items-center gap-2">
          <Brain className="size-4 text-primary" aria-hidden />
          <span className="truncate font-medium">单元评分</span>
          {projection?.title ? (
            <span className="truncate text-sm text-muted-foreground">· {projection.title}</span>
          ) : null}
        </div>
      </header>

      {loadError ? (
        <div className="p-4">
          <Card>
            <CardContent className="py-4 text-sm text-destructive">
              无法加载复习单元：{loadError}
            </CardContent>
          </Card>
        </div>
      ) : (
        <MindMapSplitLayout
          collapsed={collapsed}
          onCollapsedChange={setCollapsed}
          collapseLabel="收起单元列表"
          expandLabel="展开单元列表"
          sidePanel={unitsPanel}
        >
          <section
            data-testid="unit-rating-sheet"
            className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[1.4rem] border border-border/70 bg-card/92"
          >
            <div className="relative min-h-0 flex-1">
              {editorState ? (
                <MindMapEditorSurface
                  editorState={editorState}
                  readonly
                  forceExpanded
                  flushCanvas
                  preserveViewOnSync
                  initialViewPolicy="preserve"
                  sceneChrome="review"
                  outlinedNodeUids={selectedUnit?.node_uids ?? []}
                  onEditorStateChange={() => {}}
                  className="h-full min-h-0"
                  toolbarCenterContent={
                    selectedUnit ? (
                      <ReviewLevelBar
                        unitId={selectedUnit.id}
                        stageIndex={selectedUnit.stage_index}
                        intervalDays={selectedUnit.interval_days}
                        dueDate={selectedUnit.due_date}
                        due={selectedUnit.due}
                        adjustable
                        onScheduleAdjusted={handleScheduleAdjusted}
                      />
                    ) : null
                  }
                  belowToolbarSlot={
                    <div className="flex min-h-10 shrink-0 items-center gap-2 border-b border-border/60 px-3">
                      <div className="min-w-0 flex-1 truncate text-sm font-medium">
                        {selectedUnit?.title ?? '选择一个复习单元'}
                      </div>
                      <div className="shrink-0 text-[11px] text-muted-foreground">
                        {selectedUnit
                          ? `${intervalOutlookLabel(selectedUnit.interval_days)} · 下次到期 ${dateLabel(
                              selectedUnit.due_date,
                            )} · ${selectedUnit.node_uids.length} 个节点`
                          : ''}
                      </div>
                    </div>
                  }
                />
              ) : (
                <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
                  {palaceDocError ? (
                    <span className="text-destructive">无法加载单元内容：{palaceDocError}</span>
                  ) : selectedUnit ? (
                    <span className="inline-flex items-center gap-2">
                      <LoaderCircle className="size-4 animate-spin" aria-hidden />
                      正在加载单元内容…
                    </span>
                  ) : (
                    '这座宫殿还没有可评分的复习单元'
                  )}
                </div>
              )}
            </div>

            <FreestyleRatingBar
              ratingEffects={encounter?.rating_effects ?? []}
              selectedRating={selectedRating}
              currentIntervalDays={selectedUnit?.interval_days ?? null}
              pendingRating={pendingRating}
              busy={false}
              locked={false}
              reviewReady={Boolean(encounter)}
              hasEncounter={Boolean(encounter)}
              shortcutsActive={false}
              actionError={actionError}
              disabledReason={
                !selectedUnit
                  ? '先选择一个复习单元'
                  : !selectedUnit.due
                    ? `这张卡 ${dateLabel(selectedUnit.due_date)} 才到期 · 可在上方进度条调整进度`
                    : null
              }
              onRate={(rating) => void rate(rating)}
              getRatingDurationMs={getRatingDurationMs}
              onDismissError={() => setActionError(null)}
            />
          </section>
        </MindMapSplitLayout>
      )}
    </div>
  )
}
