import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { LoaderCircle, RotateCcw } from 'lucide-react'
import {
  cancelUnratedUnitReviewEncounterApi,
  closeUnitReviewEncounterApi,
  getUnitReviewSessionApi,
  rateReviewUnitApi,
  startFreestyleUnitReviewSessionApi,
  undoReviewUnitRatingApi,
  type FreestyleUnitEncounterState,
  type ReviewUnitDto,
  type UnitRating,
  type UnitRatingEffectDto,
  type UnitReviewSessionDto,
} from '@/modules/practice/public'
import type {
  FreestyleReviewUnitCard,
  MindMapEditorState,
} from '@/shared/api/contracts'
import { toast } from '@/shared/feedback/toast'
import { stripMindMapHtml } from '@/shared/lib/mindmapRichText'
import { coerceEditorDoc } from '@/shared/lib/mindmap-split-marks/splitMarks'
import { cn } from '@/shared/lib/utils'
import { FreestyleUnitReviewFlipPanel } from './FreestyleUnitReviewFlipPanel'

const inFlightSessionLoads = new Map<string, Promise<UnitReviewSessionDto>>()
const ratings: Array<{
  value: UnitRating
  label: string
  className: string
  selectedClassName: string
}> = [
  {
    value: 1,
    label: '忘记',
    className: 'border-rose-400/30 bg-rose-400/10 text-rose-100 hover:bg-rose-400/18',
    selectedClassName: 'border-rose-300 bg-rose-400/25 ring-2 ring-rose-300/45',
  },
  {
    value: 2,
    label: '困难',
    className: 'border-amber-300/30 bg-amber-300/10 text-amber-50 hover:bg-amber-300/18',
    selectedClassName: 'border-amber-200 bg-amber-300/25 ring-2 ring-amber-200/45',
  },
  {
    value: 3,
    label: '记得',
    className: 'border-emerald-300/30 bg-emerald-300/10 text-emerald-50 hover:bg-emerald-300/18',
    selectedClassName: 'border-emerald-200 bg-emerald-300/25 ring-2 ring-emerald-200/45',
  },
  {
    value: 4,
    label: '轻松',
    className: 'border-sky-300/30 bg-sky-300/10 text-sky-50 hover:bg-sky-300/18',
    selectedClassName: 'border-sky-200 bg-sky-300/25 ring-2 ring-sky-200/45',
  },
]

function operationId() {
  return crypto.randomUUID?.() ?? `freestyle-unit-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function sessionCacheKey(cardId: string, encounter: FreestyleUnitEncounterState) {
  return `${cardId}:${encounter.encounterId}:${encounter.status}:${encounter.sessionId ?? ''}`
}

function loadSession(
  card: FreestyleReviewUnitCard,
  encounter: FreestyleUnitEncounterState,
  roundId: string,
) {
  const key = sessionCacheKey(card.id, encounter)
  const cached = inFlightSessionLoads.get(key)
  if (cached) return cached
  const promise = encounter.status === 'closed' && encounter.sessionId
    ? getUnitReviewSessionApi(encounter.sessionId)
    : startFreestyleUnitReviewSessionApi(
        { id: card.unit_id!, revision: card.unit_revision! },
        roundId,
        encounter.encounterId,
      )
  inFlightSessionLoads.set(key, promise)
  const clear = () => {
    if (inFlightSessionLoads.get(key) === promise) inFlightSessionLoads.delete(key)
  }
  void promise.then(clear, clear)
  return promise
}

function buildEditorState(session: UnitReviewSessionDto): MindMapEditorState | null {
  // Session payloads may still ship editor_doc as a JSON string; permanent-mark
  // chip/toggle logic needs a real document object with `.root`.
  const editorDoc = coerceEditorDoc(
    session.palace?.editor_doc as Parameters<typeof coerceEditorDoc>[0],
  )
  if (!editorDoc) return null
  return {
    editor_doc: editorDoc as MindMapEditorState['editor_doc'],
    editor_config: {},
    editor_local_config: {},
    lang: 'zh',
  }
}

function matchesCardUnit(card: FreestyleReviewUnitCard, unit: ReviewUnitDto | undefined) {
  return Boolean(
    unit
    && unit.id === card.unit_id
    && card.unit_revision != null
    && unit.revision === card.unit_revision,
  )
}

function isStaleUnitError(error: unknown) {
  const requestError = error as { status?: number; message?: string }
  const message = String(requestError?.message || '').toLowerCase()
  return requestError?.status === 404
    || message.includes('review unit not found')
    || message.includes('review unit changed')
    || message.includes('rebuild the queue')
    || message.includes('not due')
    || message.includes('no review units available')
    || message.includes('encounter_id belongs to another review unit')
    || message.includes('active unit review session required')
}

function localDateLabel(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return value
  return `${month}月${day}日`
}

export function retryPositionLabel(cardCount: number) {
  const count = Math.max(0, Math.min(3, Math.round(cardCount)))
  return count === 0 ? '立即重练' : `${count}张后重练`
}

export function ratingEffectLabel(effect: UnitRatingEffectDto, retryAfterCards: number) {
  if (effect.passed) {
    return `${effect.target_interval_days}天后复习 · ${localDateLabel(effect.target_due_date)}`
  }
  const stage = effect.rating === 1
    ? `重置${effect.target_interval_days}天级`
    : effect.stage_action === 'lower'
      ? `降至${effect.target_interval_days}天级`
      : `保持${effect.target_interval_days}天级`
  return `${retryPositionLabel(retryAfterCards)} · ${stage}`
}

function encounterState(
  sessionId: string,
  unitRevision: number,
  encounter: NonNullable<ReviewUnitDto['encounter']>,
): FreestyleUnitEncounterState {
  return {
    encounterId: encounter.id,
    unitRevision,
    status: encounter.status,
    sessionId,
    selectedRating: encounter.selected_rating,
    passed: encounter.passed,
    retryAfterCards: encounter.retry_after_cards,
  }
}

function updateSessionUnit(
  session: UnitReviewSessionDto,
  unit: ReviewUnitDto,
): UnitReviewSessionDto {
  const units = session.units.map((item) => item.id === unit.id ? unit : item)
  return {
    ...session,
    units,
    pending_unit_count: units.filter((item) => item.session_status !== 'passed').length,
    completed_unit_count: units.filter((item) => item.session_status === 'passed').length,
  }
}

export function FreestyleUnitReviewCardView({
  card,
  active,
  readOnly,
  roundId,
  encounter,
  retryAfterCards,
  ratingVisible = true,
  onEnsureEncounter,
  onEncounterChange,
  onBranchComplete,
  onStaleDrop,
  onSaveFailed,
  onUnitsReconciled,
}: {
  card: FreestyleReviewUnitCard
  active: boolean
  readOnly: boolean
  roundId: string
  encounter?: FreestyleUnitEncounterState
  retryAfterCards: number
  /** When false, hide the rating overlay (HUD star toggle). */
  ratingVisible?: boolean
  onEnsureEncounter: (
    cardId: string,
    unitRevision: number,
    allowRenew: boolean,
  ) => FreestyleUnitEncounterState
  onEncounterChange: (cardId: string, encounter: FreestyleUnitEncounterState) => void
  onBranchComplete: (
    cardId: string,
    options?: { restudy?: boolean; cleared?: boolean },
  ) => void
  onStaleDrop: (cardId: string) => void
  onSaveFailed: (message: string) => void
  /** Silent freestyle queue rebuild after mark/leave unit reconcile changes. */
  onUnitsReconciled?: () => void
}) {
  const [session, setSession] = useState<UnitReviewSessionDto | null>(null)
  const [busy, setBusy] = useState(false)
  const [lastOperationId, setLastOperationId] = useState<string | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [inlineEditing, setInlineEditing] = useState(false)
  const activeRef = useRef(active)
  const sessionRef = useRef<UnitReviewSessionDto | null>(null)
  const unitRef = useRef<ReviewUnitDto | null>(null)
  const closeRequestRef = useRef<{ encounterId: string; promise: Promise<unknown> } | null>(null)
  const closeOperationRef = useRef<{ encounterId: string; operationId: string } | null>(null)

  activeRef.current = active
  sessionRef.current = session
  const unit = session?.units.find((item) => item.id === card.unit_id) ?? null
  unitRef.current = unit
  const editorState = useMemo(() => session ? buildEditorState(session) : null, [session])

  const closeCurrentEncounter = useCallback(() => {
    const currentSession = sessionRef.current
    const currentUnit = unitRef.current
    const currentEncounter = currentUnit?.encounter
    if (
      !currentSession
      || !currentUnit
      || !currentEncounter
      || currentEncounter.status !== 'open'
    ) {
      return Promise.resolve(null)
    }
    if (closeRequestRef.current?.encounterId === currentEncounter.id) {
      return closeRequestRef.current.promise
    }

    // Unrated leave must cancel the glance. Leaving the open encounter alive made
    // the later pass bill wall clock from first scroll-past (parallel palace rows).
    if (currentEncounter.selected_rating == null) {
      const promise = cancelUnratedUnitReviewEncounterApi(
        currentSession.id,
        currentUnit.id,
        currentEncounter.id,
      ).then((result) => {
        sessionRef.current = null
        unitRef.current = null
        setSession(null)
        setLastOperationId(null)
        onEncounterChange(card.id, {
          encounterId: currentEncounter.id,
          unitRevision: currentUnit.revision,
          status: 'closed',
          sessionId: result.abandoned ? null : currentSession.id,
          selectedRating: null,
          passed: null,
          retryAfterCards: 0,
        })
        return result
      }).catch(() => {
        // Best-effort: next freestyle start also releases competing unrated sessions.
        return null
      }).finally(() => {
        if (closeRequestRef.current?.encounterId === currentEncounter.id) {
          closeRequestRef.current = null
        }
      })
      closeRequestRef.current = { encounterId: currentEncounter.id, promise }
      return promise
    }

    const closeOperation = closeOperationRef.current?.encounterId === currentEncounter.id
      ? closeOperationRef.current.operationId
      : operationId()
    closeOperationRef.current = { encounterId: currentEncounter.id, operationId: closeOperation }
    const promise = closeUnitReviewEncounterApi(
      currentSession.id,
      currentUnit.id,
      currentEncounter.id,
      closeOperation,
    ).then((result) => {
      const nextUnit = { ...currentUnit, encounter: result.encounter }
      const nextSession = {
        ...updateSessionUnit(currentSession, nextUnit),
        status: result.session_status,
      }
      sessionRef.current = nextSession
      unitRef.current = nextUnit
      setSession(nextSession)
      onEncounterChange(
        card.id,
        encounterState(currentSession.id, currentUnit.revision, result.encounter),
      )
      return result
    }).catch((error) => {
      onSaveFailed(error instanceof Error ? error.message : '锁定评分失败')
      return null
    }).finally(() => {
      if (closeRequestRef.current?.encounterId === currentEncounter.id) {
        closeRequestRef.current = null
      }
    })
    closeRequestRef.current = { encounterId: currentEncounter.id, promise }
    return promise
  }, [card.id, onEncounterChange, onSaveFailed])

  const closeCurrentEncounterRef = useRef(closeCurrentEncounter)
  closeCurrentEncounterRef.current = closeCurrentEncounter

  useEffect(() => {
    if (!active) return
    if (!card.unit_id || card.unit_revision == null) {
      onStaleDrop(card.id)
      return
    }
    const identity = onEnsureEncounter(card.id, card.unit_revision, !readOnly)
    if (readOnly && identity.status !== 'closed') return
    let mounted = true
    void loadSession(card, identity, roundId).then((value) => {
      if (!mounted) return
      const nextUnit = value.units.find((item) => item.id === card.unit_id)
      if (!matchesCardUnit(card, nextUnit) || !nextUnit?.encounter) {
        onStaleDrop(card.id)
        return
      }
      if (identity.status !== 'closed' && nextUnit.encounter.status !== 'open') {
        onStaleDrop(card.id)
        return
      }
      setSession(value)
      setLastOperationId(nextUnit.encounter.effective_operation_id)
      onEncounterChange(
        card.id,
        encounterState(value.id, nextUnit.revision, nextUnit.encounter),
      )
    }).catch((error) => {
      if (!mounted) return
      if (isStaleUnitError(error)) {
        onStaleDrop(card.id)
        return
      }
      onSaveFailed(error instanceof Error ? error.message : '创建单元复习失败')
    })
    return () => {
      mounted = false
    }
  }, [
    active,
    card,
    encounter,
    onEncounterChange,
    onEnsureEncounter,
    onSaveFailed,
    onStaleDrop,
    readOnly,
    roundId,
  ])

  const wasActiveRef = useRef(false)
  useEffect(() => {
    if (active) {
      wasActiveRef.current = true
      return
    }
    if (!wasActiveRef.current) return
    wasActiveRef.current = false
    void closeCurrentEncounter()
  }, [active, closeCurrentEncounter])

  useEffect(() => {
    return () => {
      void closeCurrentEncounterRef.current()
    }
  }, [])

  async function rate(rating: UnitRating) {
    const currentEncounter = unit?.encounter
    if (
      !session
      || !unit
      || !currentEncounter
      || currentEncounter.status !== 'open'
      || readOnly
      || busy
      || currentEncounter.selected_rating === rating
    ) {
      return
    }
    setBusy(true)
    const id = operationId()
    try {
      const result = await rateReviewUnitApi(
        session.id,
        unit,
        currentEncounter.id,
        rating,
        id,
      )
      const nextUnit: ReviewUnitDto = {
        ...unit,
        ...result.unit,
        title: result.unit.title || unit.title,
        session_status: result.session_status,
        final_rating: result.rating,
        encounter: result.encounter,
      }
      const nextSession = updateSessionUnit(session, nextUnit)
      sessionRef.current = nextSession
      unitRef.current = nextUnit
      setSession(nextSession)
      setLastOperationId(result.operation_id)
      onEncounterChange(
        card.id,
        encounterState(session.id, nextUnit.revision, result.encounter),
      )
      onBranchComplete(card.id, { restudy: !result.passed })
      if (!activeRef.current) void closeCurrentEncounter()
    } catch (error) {
      if (isStaleUnitError(error)) {
        onStaleDrop(card.id)
      } else {
        onSaveFailed(error instanceof Error ? error.message : '评分失败')
      }
    } finally {
      setBusy(false)
    }
  }

  async function undo() {
    if (!lastOperationId || !session || !unit || readOnly || busy) return
    setBusy(true)
    try {
      const result = await undoReviewUnitRatingApi(lastOperationId)
      const nextUnit: ReviewUnitDto = {
        ...unit,
        ...result.unit,
        title: result.unit.title || unit.title,
        session_status: result.session_status,
        final_rating: result.encounter.selected_rating,
        encounter: result.encounter,
      }
      const nextSession = updateSessionUnit(session, nextUnit)
      sessionRef.current = nextSession
      unitRef.current = nextUnit
      setSession(nextSession)
      setLastOperationId(result.encounter.effective_operation_id)
      onEncounterChange(
        card.id,
        encounterState(session.id, nextUnit.revision, result.encounter),
      )
      if (result.encounter.selected_rating == null) {
        onBranchComplete(card.id, { cleared: true })
      } else {
        onBranchComplete(card.id, { restudy: !result.encounter.passed })
      }
    } catch (error) {
      onSaveFailed(error instanceof Error ? error.message : '撤销评分失败')
    } finally {
      setBusy(false)
    }
  }

  if (!editorState || !session || !unit || !unit.encounter) {
    return (
      <div className="flex h-full items-center justify-center rounded-3xl border border-white/10 bg-white/[0.03] text-sm text-zinc-400">
        <LoaderCircle className="mr-2 size-4 animate-spin" />
        正在加载永久标记单元...
      </div>
    )
  }

  const currentEncounter = unit.encounter
  const selectedRating = currentEncounter.selected_rating
  const selectedEffect = currentEncounter.rating_effects.find(
    (effect) => effect.rating === selectedRating,
  )
  const locked = readOnly || currentEncounter.status === 'closed'
  const titleText = stripMindMapHtml(
    unit.title || card.palace_title || `宫殿 ${card.palace_id}`,
  )

  return (
    <section className="flex h-full min-h-0 flex-col gap-1.5 sm:gap-3" aria-label="永久标记复习单元">
      <header className="flex min-w-0 shrink-0 items-center gap-2 px-1">
        <span
          className="size-2 shrink-0 rounded-full bg-amber-300 shadow-[0_0_0_3px_rgba(252,211,77,0.18)]"
          title="永久标记"
          aria-label="永久标记"
        />
        <h1 className="min-w-0 flex-1 truncate text-sm font-semibold text-zinc-100 sm:text-base">
          {titleText}
        </h1>
        {lastOperationId && !locked ? (
          <button
            type="button"
            disabled={busy}
            className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full px-2.5 text-xs text-zinc-300 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40"
            onClick={() => void undo()}
          >
            <RotateCcw className="size-3.5" />
            撤销
          </button>
        ) : null}
      </header>

      <div className="relative min-h-0 flex-1 overflow-hidden rounded-[1.4rem] border border-white/10 bg-white shadow-[0_18px_50px_rgba(0,0,0,0.28)] sm:rounded-3xl">
        <FreestyleUnitReviewFlipPanel
          key={`${card.id}:${unit.encounter.id}`}
          card={card}
          session={session}
          unit={unit}
          editorState={editorState}
          active={active}
          fullscreen={fullscreen}
          onToggleFullscreen={(next) => setFullscreen(next ?? !fullscreen)}
          onEditingChange={setInlineEditing}
          onSaveFailed={onSaveFailed}
          onUnitsReconciled={onUnitsReconciled}
        />

        {ratingVisible && !inlineEditing ? (
          <footer
            className={cn(
              // Phone: float over map bottom so the map keeps full height.
              // Desktop: still overlay but roomier hit targets.
              'pointer-events-none absolute inset-x-0 bottom-0 z-10 p-2 sm:p-2.5',
            )}
          >
            <div className="pointer-events-auto rounded-[1.2rem] border border-white/12 bg-zinc-950/88 p-1.5 shadow-[0_12px_36px_rgba(0,0,0,0.42)] backdrop-blur-md sm:rounded-2xl sm:p-2">
              {/* After rate, one status line shows the real schedule; buttons stay label-only. */}
              {selectedEffect ? (
                <div className="mb-1.5 truncate rounded-lg bg-white/[0.06] px-2.5 py-1 text-[11px] font-medium text-zinc-100 sm:text-xs">
                  已选{selectedEffect.label} · {ratingEffectLabel(selectedEffect, retryAfterCards)}
                  {locked ? <span className="ml-2 text-zinc-500">已锁定</span> : null}
                </div>
              ) : null}
              <div className="grid grid-cols-4 gap-1 sm:gap-1.5">
                {ratings.map((item) => {
                  const effect = currentEncounter.rating_effects.find(
                    (value) => value.rating === item.value,
                  )
                  const hint = effect
                    ? ratingEffectLabel(effect, retryAfterCards)
                    : '计划不可用'
                  const selected = selectedRating === item.value
                  return (
                    <button
                      key={item.value}
                      type="button"
                      disabled={busy || locked}
                      aria-pressed={selected}
                      aria-label={`${item.label}：${hint}`}
                      title={hint}
                      className={cn(
                        'flex min-h-11 items-center justify-center rounded-xl border px-1 py-1.5 text-center transition-colors active:scale-[0.98] disabled:pointer-events-none disabled:opacity-55 sm:min-h-12 sm:rounded-2xl sm:px-2',
                        item.className,
                        selected && item.selectedClassName,
                      )}
                      onClick={() => void rate(item.value)}
                    >
                      <span className="text-xs font-semibold sm:text-sm">{item.label}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          </footer>
        ) : null}
      </div>
    </section>
  )
}
