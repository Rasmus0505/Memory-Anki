import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MindMapSelection } from '@/modules/content/public'
import type {
  FreestyleUnitEncounterState,
  UnitRating,
  UnitRatingEffectDto,
  UnitReviewSessionDto,
} from '@/modules/practice/public'
import type { FreestyleReviewUnitCard, MindMapEditorState } from '@/shared/api/contracts'
import {
  FreestyleUnitReviewCardView,
  RATING_SAVE_FAILED_COPY,
  ratingEffectLabel,
} from './FreestyleUnitReviewCardView'
import { useRatingSaveLedger } from '@/modules/practice/ui/freestyle/hooks/useFreestyleRatingSaves'
import { resetFreestyleRatingSavesForTests } from '@/modules/practice/ui/freestyle/model/ratingSaveRuntime'
import { writeFlipCardRevealSettings } from '@/modules/settings/public'
import { resetClientPreferenceCacheForTest } from '@/shared/preferences/clientPreferences'
import { resetFreestyleSessionLaneForTests } from '@/modules/practice/ui/freestyle/model/freestyleSessionLane'

const apiMocks = vi.hoisted(() => ({
  closeUnitReviewEncounterApi: vi.fn(),
  getUnitReviewSessionApi: vi.fn(),
  startFreestyleUnitReviewSessionApi: vi.fn(),
  rateReviewUnitApi: vi.fn(),
  rateFreestyleRoundUnitApi: vi.fn(),
  ratePalaceDueUnitsApi: vi.fn(),
  undoReviewUnitRatingApi: vi.fn(),
  cancelUnratedUnitReviewEncounterApi: vi.fn().mockResolvedValue({ abandoned: false }),
}))

const persistMocks = vi.hoisted(() => ({
  persistPalaceEditor: vi.fn(),
}))

const previewCacheMocks = vi.hoisted(() => ({
  useUnitPreview: vi.fn(() => null),
  useSharedPalacePreview: vi.fn(() => null),
  rememberUnitPreview: vi.fn(),
}))

const quizBindingMocks = vi.hoisted(() => ({
  getOpenQuestionIds: vi.fn((nodeUid: string) => (nodeUid === 'unit-node' ? [101, 102] : [])),
  getInitialQuestionIndex: vi.fn(() => 0),
  markQuestionCompleted: vi.fn(),
  updateQuestionState: vi.fn(),
  countBadgeByNodeUid: {
    'unit-node': [{ text: '2', tone: 'success' as const, title: '客观 2 道（含子树）', kind: 'objective' as const }],
    'unit-child': [{ text: '1', tone: 'info' as const, title: '主观 1 道（含子树）', kind: 'subjective' as const }],
  },
  questionStates: {} as Record<number, unknown>,
}))

let capturedPanelProps: Record<string, unknown> | null = null
let revealFrameCallbacks: FrameRequestCallback[] = []
let originalRequestAnimationFrame: typeof window.requestAnimationFrame
let originalCancelAnimationFrame: typeof window.cancelAnimationFrame

vi.mock('@/modules/practice/public', () => ({
  closeUnitReviewEncounterApi: apiMocks.closeUnitReviewEncounterApi,
  getUnitReviewSessionApi: apiMocks.getUnitReviewSessionApi,
  startFreestyleUnitReviewSessionApi: apiMocks.startFreestyleUnitReviewSessionApi,
  rateReviewUnitApi: apiMocks.rateReviewUnitApi,
  ratePalaceDueUnitsApi: apiMocks.ratePalaceDueUnitsApi,
  undoReviewUnitRatingApi: apiMocks.undoReviewUnitRatingApi,
  cancelUnratedUnitReviewEncounterApi: apiMocks.cancelUnratedUnitReviewEncounterApi,
}))

vi.mock('@/modules/practice/ui/freestyle/api', () => ({
  rateFreestyleRoundUnitApi: apiMocks.rateFreestyleRoundUnitApi,
}))

vi.mock('@/modules/practice/ui/freestyle/model/freestyleUnitPreviewCache', () => ({
  useUnitPreview: previewCacheMocks.useUnitPreview,
  useSharedPalacePreview: previewCacheMocks.useSharedPalacePreview,
  rememberUnitPreview: previewCacheMocks.rememberUnitPreview,
}))

vi.mock('@/modules/practice/ui/review/components/PalaceReviewUnitsPanel', () => ({
  PalaceReviewUnitsPanel: (props: { open: boolean; palaceId: number }) =>
    props.open ? (
      <div data-testid="palace-review-units-panel-mock">palace:{props.palaceId}</div>
    ) : null,
}))

vi.mock('@/modules/quiz/public', () => ({
  showAnswerDurationBubble: vi.fn(),
  usePalaceQuizNodeBindings: () => ({
    countBadgeByNodeUid: quizBindingMocks.countBadgeByNodeUid,
    getOpenQuestionIds: quizBindingMocks.getOpenQuestionIds,
    getInitialQuestionIndex: quizBindingMocks.getInitialQuestionIndex,
    markQuestionCompleted: quizBindingMocks.markQuestionCompleted,
    updateQuestionState: quizBindingMocks.updateQuestionState,
    questionStates: quizBindingMocks.questionStates,
  }),
}))

vi.mock('@/shared/feedback/toast', () => ({
  toast: {
    message: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('@/widgets/node-bound-quiz', () => ({
  NodeBoundQuizDialog: (props: Record<string, unknown>) =>
    props.open ? (
      <div data-testid="node-bound-quiz-dialog">
        {String(props.nodeUid)}:{Array.isArray(props.questionIds) ? props.questionIds.join(',') : ''}
      </div>
    ) : null,
}))

vi.mock('@/widgets/mindmap-review-flow', () => ({
  FlipCardMindMapPanel: (props: Record<string, unknown>) => {
    capturedPanelProps = props
    // The real panel draws the unit identity row under its toolbar, so the mock
    // must render the slot too or the header disappears from the tree.
    return (
      <div data-testid="flip-card-mind-map-panel">
        {props.belowToolbarSlot as ReactNode}
      </div>
    )
  },
}))

vi.mock('./freestyleBranchCardSupport', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./freestyleBranchCardSupport')>()
  return {
    ...actual,
    persistPalaceEditor: (...args: unknown[]) => persistMocks.persistPalaceEditor(...args),
  }
})

const palaceEditorDoc = {
  root: {
    data: { uid: 'root', text: '完整宫殿' },
    children: [
      {
        data: { uid: 'unit-node', text: '当前单元' },
        children: [{ data: { uid: 'unit-child', text: '当前单元子节点' }, children: [] }],
      },
      {
        data: { uid: 'other-unit', text: '其他单元' },
        children: [{ data: { uid: 'other-child', text: '其他单元子节点' }, children: [] }],
      },
    ],
  },
}

const effects: UnitRatingEffectDto[] = [
  {
    rating: 1,
    label: '忘记',
    passed: false,
    target_stage_index: 0,
    target_interval_days: 0,
    target_actual_interval_days: 0,
    target_due_date: '2026-07-27',
    retry_after_cards: 3,
    retry_after_minutes: 10,
    intraday_kind: 'retry',
    stage_action: 'reset',
  },
  {
    rating: 2,
    label: '困难',
    passed: false,
    target_stage_index: 0,
    target_interval_days: 0,
    target_actual_interval_days: 0,
    target_due_date: '2026-07-27',
    retry_after_cards: 3,
    retry_after_minutes: 10,
    intraday_kind: 'retry',
    stage_action: 'keep',
  },
  {
    rating: 3,
    label: '记得',
    passed: true,
    target_stage_index: 1,
    target_interval_days: 1,
    target_actual_interval_days: 1,
    target_due_date: '2026-07-28',
    retry_after_cards: 0,
    stage_action: 'advance',
  },
  {
    rating: 4,
    label: '轻松',
    passed: true,
    target_stage_index: 2,
    target_interval_days: 3,
    target_actual_interval_days: 3,
    target_due_date: '2026-07-30',
    retry_after_cards: 0,
    stage_action: 'advance',
  },
]

function buildCard(unitId: string, revision = 3): FreestyleReviewUnitCard {
  return {
    id: `mindmap-unit:${unitId}:${revision}`,
    type: 'mindmap_branch',
    content_type: 'mindmap_branch',
    palace_id: 1,
    palace_title: '测试宫殿',
    unit_id: unitId,
    unit_revision: revision,
    anchor_uid: 'unit-node',
    context_path: [{ uid: 'root', text: '完整宫殿' }],
    node_uids: ['unit-node', 'unit-child'],
    node_count: 2,
  }
}

function buildEncounter(overrides: Record<string, unknown> = {}) {
  return {
    id: 'encounter-1',
    round_id: 'round-1',
    sequence: 0,
    status: 'open' as const,
    selected_rating: null,
    passed: null,
    retry_after_cards: 0,
    effective_operation_id: null,
    closed_at: null,
    rating_effects: effects,
    ...overrides,
  }
}

function buildSession(unitId: string, revision = 3, encounter = buildEncounter()): UnitReviewSessionDto {
  return {
    id: `session:${unitId}`,
    palace_id: 1,
    title: '测试宫殿',
    status: 'active',
    palace: { id: 1, title: '测试宫殿', editor_doc: palaceEditorDoc },
    units: [{
      id: unitId,
      palace_id: 1,
      anchor_uid: 'unit-node',
      unit_kind: 'marked',
      title: '当前复习单元',
      node_uids: ['unit-node', 'unit-child'],
      revision,
      stage_index: 0,
      interval_days: 0,
      has_passed: false,
      due_date: '2026-07-27',
      due: true,
      session_status: 'pending',
      retry_count: 0,
      hard_count: 0,
      again_count: 0,
      final_rating: null,
      encounter,
    }],
    pending_unit_count: 1,
    completed_unit_count: 0,
  }
}

function queueEncounter(overrides: Partial<FreestyleUnitEncounterState> = {}): FreestyleUnitEncounterState {
  return {
    encounterId: 'encounter-1',
    roundId: 'round-1',
    unitRevision: 3,
    status: 'pending',
    sessionId: null,
    selectedRating: null,
    passed: null,
    retryAfterCards: 0,
    ...overrides,
  }
}

function undoResult(
  session: UnitReviewSessionDto,
  options: { rating?: UnitRating | null; operationId?: string | null } = {},
) {
  const rating = options.rating ?? null
  const effect = rating == null ? null : effects.find((item) => item.rating === rating)
  const encounter = buildEncounter({
    selected_rating: rating,
    passed: effect?.passed ?? null,
    retry_after_cards: effect?.retry_after_cards ?? 0,
    effective_operation_id: options.operationId ?? null,
  })
  return {
    operation_id: 'undone',
    unit: {
      ...session.units[0],
      session_status: rating == null ? 'pending' as const : session.units[0].session_status,
      final_rating: rating,
      encounter,
    },
    session_status: rating == null ? 'pending' as const : session.units[0].session_status,
    encounter,
  }
}

function ratingResult(session: UnitReviewSessionDto, rating: UnitRating, operationId: string) {
  const effect = effects.find((item) => item.rating === rating)!
  const encounter = buildEncounter({
    selected_rating: rating,
    passed: effect.passed,
    retry_after_cards: effect.retry_after_cards,
    effective_operation_id: operationId,
  })
  return {
    operation_id: operationId,
    study_session_id: session.id,
    encounter_id: encounter.id,
    amended: false,
    unit: { ...session.units[0], stage_index: effect.target_stage_index, encounter },
    passed: effect.passed,
    retry_after_cards: effect.retry_after_cards,
    rating,
    rating_label: effect.label,
    session_status: effect.passed ? 'passed' : 'retry',
    encounter,
  }
}

function renderCard(
  card: FreestyleReviewUnitCard,
  options: {
    active?: boolean
    readOnly?: boolean
    encounter?: FreestyleUnitEncounterState
    lastRating?: number | null
    roundId?: string
    ratingScope?: 'unit' | 'palace'
    preferredZoom?: number
    onUserZoomChange?: (zoom: number) => void
    palaceTarget?: {
      palaceId: number
      dueCount: number
      excludeUnitIds: string[]
      includeUnitIds: string[]
      settleCards: Array<{ cardId: string; unitId: string }>
    }
    onRatingSettled?: (cardId: string, passed: boolean, rating: number, meta?: unknown) => void
    onOpenScopeQuiz?: () => void
    onRemoveFromQueue?: (cardId: string) => void
    onBedtimeRate?: (cardId: string, rating: UnitRating) => Promise<unknown>
  } = {},
) {
  const callbacks = {
    onEnsureEncounter: vi.fn(() => options.encounter ?? queueEncounter()),
    onEncounterChange: vi.fn(),
    onBranchComplete: vi.fn(),
    onBatchCardsSettled: vi.fn(),
    onStaleDrop: vi.fn(),
    onRemoveFromQueue: options.onRemoveFromQueue ?? vi.fn(),
    onRebuildRound: vi.fn(),
    onRevisionAdopted: vi.fn(),
    onSaveFailed: vi.fn(),
    onUnitsReconciled: vi.fn(),
    onRatingSettled: options.onRatingSettled ?? vi.fn(),
    onRatingScopeChange: vi.fn(),
    onRoundSync: vi.fn(),
    onOpenScopeQuiz: options.onOpenScopeQuiz,
    onBedtimeRate: options.onBedtimeRate,
  }
  const props: CardProps = {
    card,
    active: options.active ?? true,
    readOnly: options.readOnly ?? false,
    roundId: options.roundId ?? 'round-1',
    encounter: options.encounter ?? queueEncounter(),
    lastRating: options.lastRating,
    ratingScope: options.ratingScope,
    preferredZoom: options.preferredZoom,
    palaceTarget: options.palaceTarget,
    ...(options.onUserZoomChange ? { onUserZoomChange: options.onUserZoomChange } : {}),
    ...(options.onBedtimeRate ? { onBedtimeRate: options.onBedtimeRate } : {}),
    onEnsureEncounter: callbacks.onEnsureEncounter,
    onEncounterChange: callbacks.onEncounterChange,
    onStaleDrop: callbacks.onStaleDrop,
    onRemoveFromQueue: callbacks.onRemoveFromQueue,
    onRebuildRound: callbacks.onRebuildRound,
    onRevisionAdopted: callbacks.onRevisionAdopted,
    onSaveFailed: callbacks.onSaveFailed,
    onUnitsReconciled: callbacks.onUnitsReconciled,
    onRatingScopeChange: callbacks.onRatingScopeChange,
    onOpenScopeQuiz: callbacks.onOpenScopeQuiz,
  }
  const renderResult = render(<CardWithLedger props={props} ledger={callbacks} />)
  return {
    ...callbacks,
    ...renderResult,
    rerenderCard: (next: Partial<CardProps>) => {
      renderResult.rerender(<CardWithLedger props={{ ...props, ...next }} ledger={callbacks} />)
    },
  }
}

type CardProps = Parameters<typeof FreestyleUnitReviewCardView>[0]

/**
 * The page is the single ledger owner for acknowledged ratings. The card test
 * mounts the same bridge so progress callbacks are observable here.
 */
function CardWithLedger({
  props,
  ledger,
}: {
  props: CardProps
  ledger: {
    onEncounterChange: (cardId: string, encounter: FreestyleUnitEncounterState) => void
    onBranchComplete: (cardId: string, options: Record<string, unknown>) => void
    onRatingSettled: (cardId: string, passed: boolean, rating: number, meta?: unknown) => void
    onRoundSync: (round: unknown) => void
    onSaveFailed: (message: string) => void
    onStaleDrop: (cardId: string, options?: { force?: boolean }) => void
  }
}) {
  useRatingSaveLedger({
    roundId: props.roundId,
    previousEncounter: () => undefined,
    adoptRound: (round) => ledger.onRoundSync(round),
    encounterChange: (cardId, encounter) => ledger.onEncounterChange(cardId, encounter),
    branchComplete: (cardId, options) => ledger.onBranchComplete(cardId, options),
    ratingSettled: (cardId, passed, rating, meta) => ledger.onRatingSettled(cardId, passed, rating, meta),
    saveFailed: () => ledger.onSaveFailed(RATING_SAVE_FAILED_COPY),
    staleDrop: (cardId) => ledger.onStaleDrop(cardId),
  })
  return <FreestyleUnitReviewCardView {...props} />
}

function selection(uid: string, text: string): MindMapSelection {
  return { uid, text, note: '', memoryAnkiId: null, memoryAnkiNodeType: null, rawData: {} }
}

function flushRevealFrame() {
  const callbacks = revealFrameCallbacks
  revealFrameCallbacks = []
  act(() => callbacks.forEach((callback) => callback(16)))
}

describe('FreestyleUnitReviewCardView', () => {
  beforeEach(() => {
    capturedPanelProps = null
    revealFrameCallbacks = []
    originalRequestAnimationFrame = window.requestAnimationFrame
    originalCancelAnimationFrame = window.cancelAnimationFrame
    window.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      revealFrameCallbacks.push(callback)
      return revealFrameCallbacks.length
    })
    window.cancelAnimationFrame = vi.fn()
    Object.values(apiMocks).forEach((mock) => mock.mockReset())
    resetFreestyleSessionLaneForTests()
    // One attempt: a failure spec asserts what the card shows after the save is
    // given up on. The quiet retry loop has its own spec below.
    resetFreestyleRatingSavesForTests({ autoRetry: { maxAttempts: 1 } })
    previewCacheMocks.useUnitPreview.mockReset()
    previewCacheMocks.useUnitPreview.mockReturnValue(null)
    previewCacheMocks.useSharedPalacePreview.mockReset()
    previewCacheMocks.useSharedPalacePreview.mockReturnValue(null)
    previewCacheMocks.rememberUnitPreview.mockReset()
    quizBindingMocks.getOpenQuestionIds.mockClear()
    quizBindingMocks.getInitialQuestionIndex.mockClear()
    quizBindingMocks.markQuestionCompleted.mockClear()
    quizBindingMocks.updateQuestionState.mockClear()
    quizBindingMocks.getOpenQuestionIds.mockImplementation(
      (nodeUid: string) => (nodeUid === 'unit-node' ? [101, 102] : []),
    )
    quizBindingMocks.getInitialQuestionIndex.mockReturnValue(0)
    apiMocks.closeUnitReviewEncounterApi.mockResolvedValue({
      operation_id: 'close-default',
      encounter: buildEncounter({ status: 'closed' }),
      passed: false,
      retry_after_cards: 0,
      session_status: 'active',
      completion: null,
    })
    apiMocks.cancelUnratedUnitReviewEncounterApi.mockResolvedValue({ abandoned: false })
    apiMocks.rateFreestyleRoundUnitApi.mockImplementation(async (roundId: string, payload: {
      study_session_id: string
      unit_id: string
      unit_revision: number
      encounter_id: string
      rating: number
      operation_id: string
      palace_batch?: {
        palace_id: number
        current?: {
          study_session_id: string
          unit_id: string
          unit_revision: number
          encounter_id: string
        }
        exclude_unit_ids?: string[]
        include_unit_ids?: string[]
      } | null
    }) => {
      if (payload.palace_batch) {
        const item = await apiMocks.ratePalaceDueUnitsApi(payload.palace_batch.palace_id, {
          operationId: payload.operation_id,
          rating: payload.rating,
          roundId,
          current: payload.palace_batch.current ?? {
            study_session_id: payload.study_session_id,
            unit_id: payload.unit_id,
            unit_revision: payload.unit_revision,
            encounter_id: payload.encounter_id,
          },
          excludeUnitIds: payload.palace_batch.exclude_unit_ids ?? [],
          includeUnitIds: payload.palace_batch.include_unit_ids ?? [],
        })
        return { item, round: { conflict: false, version: 1, plan_version: 1 } }
      }
      const item = await apiMocks.rateReviewUnitApi(
        payload.study_session_id,
        { id: payload.unit_id, revision: payload.unit_revision },
        payload.encounter_id,
        payload.rating,
        payload.operation_id,
        roundId,
      )
      return { item, round: { conflict: false, version: 1, plan_version: 1 } }
    })
    persistMocks.persistPalaceEditor.mockReset()
    persistMocks.persistPalaceEditor.mockImplementation(async (_palaceId, state) => ({
      state,
      unitReconcile: null,
    }))
    window.localStorage.clear()
    resetClientPreferenceCacheForTest()
  })

  afterEach(() => {
    window.requestAnimationFrame = originalRequestAnimationFrame
    window.cancelAnimationFrame = originalCancelAnimationFrame
  })

  it('does not open or cancel a session when the card is only flashed', async () => {
    const card = buildCard('unit-flash')
    apiMocks.startFreestyleUnitReviewSessionApi.mockResolvedValue(buildSession(card.unit_id!))
    const view = renderCard(card)
    view.rerenderCard({ active: false })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250))
    })
    expect(apiMocks.startFreestyleUnitReviewSessionApi).not.toHaveBeenCalled()
    expect(apiMocks.cancelUnratedUnitReviewEncounterApi).not.toHaveBeenCalled()
    expect(view.onEnsureEncounter).not.toHaveBeenCalled()
  })

  it('uses the full palace and the current unit as the only rating scope', async () => {
    const card = buildCard('unit-full-palace')
    apiMocks.startFreestyleUnitReviewSessionApi.mockResolvedValue(buildSession(card.unit_id!))
    const { onEnsureEncounter, onSaveFailed, onStaleDrop } = renderCard(card)

    await waitFor(() => expect(onEnsureEncounter).toHaveBeenCalled())
    expect(onEnsureEncounter.mock.results[0]?.value).toMatchObject({
      encounterId: 'encounter-1',
      status: 'pending',
    })
    expect(apiMocks.getUnitReviewSessionApi).not.toHaveBeenCalled()
    await waitFor(() => expect(apiMocks.startFreestyleUnitReviewSessionApi).toHaveBeenCalled())
    expect(onSaveFailed).not.toHaveBeenCalled()
    expect(onStaleDrop).not.toHaveBeenCalled()
    await screen.findByTestId('flip-card-mind-map-panel')
    expect(apiMocks.startFreestyleUnitReviewSessionApi).toHaveBeenCalledWith(
      { id: card.unit_id, revision: card.unit_revision },
      'round-1',
      'encounter-1',
      { allowNotDue: false, cardId: card.id, occurrenceId: '', retryAttempt: 0 },
    )
    expect(capturedPanelProps?.activeUnitNodeUids).toEqual(['unit-node', 'unit-child'])
    // auto (the FlipCard default): phone still uses the tight camera, but the map stays pannable.
    expect(capturedPanelProps?.mobileViewPolicy).toBeUndefined()
    expect(capturedPanelProps?.countBadgeByNodeUid).toEqual(quizBindingMocks.countBadgeByNodeUid)
    expect(typeof capturedPanelProps?.onCountBadgeClick).toBe('function')
    expect(
      (capturedPanelProps?.visibleEditorState as {
        editor_doc: { root: { data: { uid: string } } }
      }).editor_doc.root.data.uid,
    ).toBe('root')
  })

  it('forwards the shared freestyle zoom preference to the map panel', async () => {
    const card = buildCard('unit-shared-zoom')
    const onUserZoomChange = vi.fn()
    apiMocks.startFreestyleUnitReviewSessionApi.mockResolvedValue(buildSession(card.unit_id!))
    renderCard(card, { preferredZoom: 0.72, onUserZoomChange })

    await screen.findByTestId('flip-card-mind-map-panel')
    expect(capturedPanelProps).toMatchObject({
      preferredZoom: 0.72,
      onUserZoomChange,
    })
    const panelOnUserZoomChange = capturedPanelProps?.onUserZoomChange as
      | ((zoom: number) => void)
      | undefined
    panelOnUserZoomChange?.(0.84)
    expect(onUserZoomChange).toHaveBeenCalledWith(0.84)
  })

  it('lets a cached preview flip locally and preserves that progress when the live session lands', async () => {
    writeFlipCardRevealSettings({ granularity: 'single', stage: 'direct' })
    const card = buildCard('unit-preview-flip')
    const preview: UnitReviewSessionDto = {
      ...buildSession(card.unit_id!),
      id: `preview:${card.unit_id}`,
      units: [{
        ...buildSession(card.unit_id!).units[0],
        encounter: null,
      }],
    }
    previewCacheMocks.useUnitPreview.mockReturnValue(preview)
    let resolveSession!: (value: UnitReviewSessionDto) => void
    apiMocks.startFreestyleUnitReviewSessionApi.mockReturnValue(
      new Promise<UnitReviewSessionDto>((resolve) => {
        resolveSession = resolve
      }),
    )
    renderCard(card)

    await screen.findByTestId('flip-card-mind-map-panel')
    const shell = screen.getByTestId('freestyle-unit-review-map-shell')
    expect(shell.hasAttribute('inert')).toBe(false)
    const onNodeClick = capturedPanelProps?.onNodeClick as (nodes: MindMapSelection[]) => void
    act(() => onNodeClick([selection('root', '完整宫殿')]))
    flushRevealFrame()

    resolveSession(buildSession(card.unit_id!))
    const badge = await screen.findByTestId('flip-progress-badge')
    expect(badge.textContent).toBe('1/2')
  })
  it('arms then removes this card from the round without posting a rating', async () => {
    const card = buildCard('unit-remove-queue')
    apiMocks.startFreestyleUnitReviewSessionApi.mockReturnValue(new Promise(() => undefined))
    const onRemoveFromQueue = vi.fn()
    renderCard(card, { onRemoveFromQueue })

    const button = await screen.findByTestId('freestyle-rating-button-remove')
    fireEvent.click(button)
    expect(onRemoveFromQueue).not.toHaveBeenCalled()
    fireEvent.click(button)
    expect(onRemoveFromQueue).toHaveBeenCalledWith(card.id)
    expect(apiMocks.rateReviewUnitApi).not.toHaveBeenCalled()
    expect(apiMocks.rateFreestyleRoundUnitApi).not.toHaveBeenCalled()
    expect(apiMocks.ratePalaceDueUnitsApi).not.toHaveBeenCalled()
  })

  it('keeps the map when preparing the score fails and does not start a second glance', async () => {
    const card = buildCard('unit-prepare-keeps-map')
    const preview: UnitReviewSessionDto = {
      ...buildSession(card.unit_id!),
      id: `preview:${card.unit_id}`,
      units: [{
        ...buildSession(card.unit_id!).units[0],
        encounter: null,
      }],
    }
    previewCacheMocks.useUnitPreview.mockReturnValue(preview)
    apiMocks.startFreestyleUnitReviewSessionApi.mockRejectedValue(
      new Error('请求超过 15 秒未响应'),
    )
    const view = renderCard(card)

    expect(await screen.findByTestId('flip-card-mind-map-panel')).toBeTruthy()
    expect(await screen.findByTestId('freestyle-copy-for-assistant')).toBeTruthy()
    expect(screen.queryByText(/网络请求失败/)).toBeNull()
    expect(screen.queryByText(/start-all/)).toBeNull()
    expect((screen.getByTestId('freestyle-rating-button-3') as HTMLButtonElement).disabled).toBe(false)

    view.rerenderCard({
      encounter: queueEncounter({ status: 'pending' }),
    })
    await waitFor(() => expect(apiMocks.startFreestyleUnitReviewSessionApi).toHaveBeenCalledTimes(1))
  })

  it('keeps four rating buttons pressable while the session is loading', async () => {
    const card = buildCard('unit-loading-ratings')
    apiMocks.startFreestyleUnitReviewSessionApi.mockReturnValue(new Promise(() => undefined))
    renderCard(card)

    const bar = await screen.findByTestId('freestyle-rating-bar')
    expect(bar).toBeTruthy()
    for (const value of [1, 2, 3, 4]) {
      const button = screen.getByTestId(`freestyle-rating-button-${value}`) as HTMLButtonElement
      expect(button.disabled).toBe(false)
      expect(button.getAttribute('aria-label')).not.toContain('正在准备评分')
    }
  })

  it('posts a rating without waiting for the glance and lights it at once while the save is on the wire', async () => {
    const card = buildCard('unit-rate-before-session')
    let resolveSession: (value: UnitReviewSessionDto) => void = () => undefined
    apiMocks.startFreestyleUnitReviewSessionApi.mockReturnValue(
      new Promise((resolve) => {
        resolveSession = resolve
      }),
    )
    const onRatingSettled = vi.fn()
    renderCard(card, { onRatingSettled })

    const button = await screen.findByTestId('freestyle-rating-button-3')
    expect((button as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(button)

    expect(button.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('freestyle-rating-saving-line')).toBeTruthy()
    expect(onRatingSettled).not.toHaveBeenCalled()
    await waitFor(() => expect(apiMocks.rateFreestyleRoundUnitApi).toHaveBeenCalled())
    expect(apiMocks.rateFreestyleRoundUnitApi.mock.calls[0][1]).toMatchObject({
      study_session_id: '',
      encounter_id: expect.any(String),
    })

    resolveSession(buildSession(card.unit_id!))
  })

  it('shows flip progress badge next to the unit title (empty tone at start)', async () => {
    const card = buildCard('unit-flip-progress')
    apiMocks.startFreestyleUnitReviewSessionApi.mockResolvedValue(buildSession(card.unit_id!))
    renderCard(card)

    await screen.findByTestId('flip-card-mind-map-panel')
    const badge = await screen.findByTestId('flip-progress-badge')
    // Unit membership only (unit-node + unit-child), not whole-palace node count.
    expect(badge.textContent).toBe('0/2')
    expect(badge.getAttribute('data-tone')).toBe('empty')
  })

  it('opens node-bound quiz from the corner question badge', async () => {
    const card = buildCard('unit-badge-open')
    apiMocks.startFreestyleUnitReviewSessionApi.mockResolvedValue(buildSession(card.unit_id!))
    renderCard(card)

    await screen.findByTestId('flip-card-mind-map-panel')
    const onCountBadgeClick = capturedPanelProps?.onCountBadgeClick as (nodeUid: string) => void
    act(() => onCountBadgeClick('unit-node'))
    expect(quizBindingMocks.getOpenQuestionIds).toHaveBeenCalledWith('unit-node', undefined)
    const dialog = await screen.findByTestId('node-bound-quiz-dialog')
    expect(dialog.textContent).toBe('unit-node:101,102')
  })

  it('exposes 进入编辑 in mind-map moreActions and toggles to 返回学习', async () => {
    const card = buildCard('unit-inline-edit')
    apiMocks.startFreestyleUnitReviewSessionApi.mockResolvedValue(buildSession(card.unit_id!))
    renderCard(card)

    await screen.findByTestId('flip-card-mind-map-panel')
    expect(capturedPanelProps?.displayMode).toBe('review')
    expect(capturedPanelProps?.scopeBranchUid).toBeNull()
    expect(capturedPanelProps?.forceExpanded).toBe(false)
    const moreActions = capturedPanelProps?.toolbarExtensions as {
      moreActions?: Array<{ label: string; onClick: () => void }>
    }
    const enter = moreActions?.moreActions?.find((item) => item.label === '进入编辑')
    expect(enter).toBeTruthy()
    expect(moreActions?.moreActions?.some((item) => item.label === '复习进度')).toBe(true)
    expect(moreActions?.moreActions?.some((item) => item.label === '复制导图')).toBe(true)
    expect(moreActions?.moreActions?.some((item) => item.label === '文字转脑图')).toBe(true)
    expect(moreActions?.moreActions?.some((item) => item.label === '导出脑图')).toBe(true)
    expect(capturedPanelProps?.englishInOverflow).toBeUndefined()
    expect(capturedPanelProps?.textActionLabel).toBe('文字')

    act(() => enter!.onClick())

    await waitFor(() => {
      expect(capturedPanelProps?.displayMode).toBe('edit')
    })
    expect(capturedPanelProps?.scopeBranchUid).toBe('unit-node')
    expect(capturedPanelProps?.forceExpanded).toBe(true)
    expect(capturedPanelProps?.initialViewPolicy).toBe('preserve')
    expect(capturedPanelProps?.sceneTransitionFallbackNodeId).toBe('unit-node')
    expect(capturedPanelProps?.activeUnitNodeUids).toEqual(['unit-node', 'unit-child'])
    expect(
      (capturedPanelProps?.editableEditorState as {
        editor_doc: { root: { children: Array<{ data: { uid: string } }> } }
      }).editor_doc.root.children.map((child) => child.data.uid),
    ).toEqual(['unit-node', 'other-unit'])
    const editMore = capturedPanelProps?.toolbarExtensions as {
      moreActions?: Array<{ label: string; onClick: () => void }>
      permanentMarkAction?: { label: string; active?: boolean; onClick: () => void }
    }
    const labels = (editMore?.moreActions ?? []).map((item) => item.label)
    expect(labels).toContain('返回学习')
    // 永久标记 is a dedicated toolbar button, not an ⋯ item.
    expect(labels).not.toContain('永久标记')
    expect(editMore?.permanentMarkAction).toMatchObject({ label: '永久标记', active: false })
    expect(labels).toContain('复习进度')
    expect(labels).toContain('复制导图')
    expect(labels).toContain('文字转脑图')
    expect(labels).toContain('导出脑图')
    expect(screen.queryByRole('button', { name: /忘记/ })).toBeNull()

    const leave = editMore?.moreActions?.find((item) => item.label === '返回学习')
    act(() => leave!.onClick())
    await waitFor(() => {
      expect(capturedPanelProps?.displayMode).toBe('review')
    })
  })

  it('turns clipboard JSON into a mind-map preview and appends it onto the selected node', async () => {
    const clipboardJson = JSON.stringify({
      title: '外部片段',
      children: [{ text: '新知识点', children: [] }],
    })
    const readText = vi.fn().mockResolvedValue(clipboardJson)
    Object.assign(navigator, { clipboard: { readText } })
    const card = buildCard('unit-text-to-mindmap')
    apiMocks.startFreestyleUnitReviewSessionApi.mockResolvedValue(buildSession(card.unit_id!))
    renderCard(card)

    await screen.findByTestId('flip-card-mind-map-panel')
    const moreActions = () => (capturedPanelProps?.toolbarExtensions as {
      moreActions?: Array<{ label: string; onClick: () => void; opensOverlay?: boolean }>
    }).moreActions
    const action = moreActions()?.find((item) => item.label === '文字转脑图')
    expect(action?.opensOverlay).toBe(true)
    act(() => action?.onClick())

    const dialog = await screen.findByRole('dialog', { name: '文字转脑图' })
    expect(dialog.textContent).toContain('外部片段')
    expect((screen.getByLabelText('粘贴 JSON 或大纲文本') as HTMLTextAreaElement).value).toBe(clipboardJson)
    expect((screen.getByRole('button', { name: '追加到选中知识点' }) as HTMLButtonElement).disabled).toBe(true)

    const onNodeActive = capturedPanelProps?.onNodeActive as (nodes: MindMapSelection[]) => void
    act(() => onNodeActive([selection('unit-node', '当前单元')]))
    await waitFor(() => {
      expect(screen.getByText('追加目标：当前单元')).toBeTruthy()
      expect((screen.getByRole('button', { name: '追加到选中知识点' }) as HTMLButtonElement).disabled).toBe(false)
    })
    fireEvent.click(screen.getByRole('button', { name: '追加到选中知识点' }))

    await waitFor(() => expect(capturedPanelProps?.displayMode).toBe('edit'))
    const savedDoc = JSON.stringify(capturedPanelProps?.editableEditorState)
    expect(savedDoc).toContain('外部片段')
    expect(savedDoc).toContain('新知识点')
    expect(savedDoc).toContain('其他单元')
    await waitFor(() => expect(persistMocks.persistPalaceEditor).toHaveBeenCalled(), { timeout: 3000 })
    const persisted = JSON.stringify(persistMocks.persistPalaceEditor.mock.calls.at(-1)?.[1])
    expect(persisted).toContain('外部片段')
    expect(persisted).toContain('新知识点')
  })

  it('opens the manual paste surface when the clipboard is empty', async () => {
    const readText = vi.fn().mockResolvedValue('')
    Object.assign(navigator, { clipboard: { readText } })
    const card = buildCard('unit-text-to-mindmap-empty')
    apiMocks.startFreestyleUnitReviewSessionApi.mockResolvedValue(buildSession(card.unit_id!))
    renderCard(card)

    await screen.findByTestId('flip-card-mind-map-panel')
    const action = (capturedPanelProps?.toolbarExtensions as {
      moreActions?: Array<{ label: string; onClick: () => void }>
    }).moreActions?.find((item) => item.label === '文字转脑图')
    act(() => action?.onClick())

    const dialog = await screen.findByRole('dialog', { name: '文字转脑图' })
    expect(dialog.textContent).toContain('请先粘贴 JSON 或大纲文本')
    expect((screen.getByLabelText('粘贴 JSON 或大纲文本') as HTMLTextAreaElement).value).toBe('')
    expect((screen.getByRole('button', { name: '追加到选中知识点' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('exposes 做题 as a toolbar action and keeps 英语 inline rather than in ⋯', async () => {
    const onOpenScopeQuiz = vi.fn()
    const card = buildCard('unit-quiz-toolbar')
    apiMocks.startFreestyleUnitReviewSessionApi.mockResolvedValue(buildSession(card.unit_id!))
    renderCard(card, { onOpenScopeQuiz })

    await screen.findByTestId('flip-card-mind-map-panel')
    const quizAction = (capturedPanelProps?.toolbarExtensions as { quizAction?: { label: string; onClick: () => void } | null })?.quizAction
    expect(quizAction?.label).toBe('做题')
    expect(capturedPanelProps?.englishInOverflow).toBeUndefined()
    expect(capturedPanelProps?.textActionLabel).toBe('文字')
    act(() => quizAction!.onClick())
    expect(onOpenScopeQuiz).toHaveBeenCalledTimes(1)
  })

  it('shows 做题 while the score session is still opening', async () => {
    const onOpenScopeQuiz = vi.fn()
    const card = buildCard('unit-quiz-before-glance')
    const preview: UnitReviewSessionDto = {
      ...buildSession(card.unit_id!),
      id: `preview:${card.unit_id}`,
      units: [{
        ...buildSession(card.unit_id!).units[0],
        encounter: null,
      }],
    }
    previewCacheMocks.useUnitPreview.mockReturnValue(preview)
    apiMocks.startFreestyleUnitReviewSessionApi.mockReturnValue(new Promise(() => undefined))
    renderCard(card, { onOpenScopeQuiz })

    await screen.findByTestId('flip-card-mind-map-panel')
    const quizAction = (capturedPanelProps?.toolbarExtensions as { quizAction?: { label: string; onClick: () => void } | null })?.quizAction
    expect(quizAction?.label).toBe('做题')
    act(() => quizAction!.onClick())
    expect(onOpenScopeQuiz).toHaveBeenCalledTimes(1)
  })

  it('opens edit mode only as far as the current flip progress', async () => {
    const card = buildCard('unit-edit-follows-flip')
    apiMocks.startFreestyleUnitReviewSessionApi.mockResolvedValue(buildSession(card.unit_id!))
    renderCard(card)

    await screen.findByTestId('flip-card-mind-map-panel')
    // Review shows nothing flipped yet, and edit carries no fold seed.
    expect(capturedPanelProps?.revealCollapsedNodeIds).toBeNull()

    act(() => (capturedPanelProps?.onPaneDoubleClick as () => void)())
    await waitFor(() => expect(capturedPanelProps?.displayMode).toBe('edit'))

    // No card flipped out yet → every branch parent that has children stays folded,
    // instead of the branch being force-expanded as before.
    const beforeFlip = capturedPanelProps?.revealCollapsedNodeIds as Set<string> | null
    expect(beforeFlip).not.toBeNull()
    expect([...(beforeFlip ?? [])].sort()).toEqual(['other-unit', 'unit-node'])
    expect(capturedPanelProps?.forceExpanded).toBe(true)

    act(() => (capturedPanelProps?.onPaneDoubleClick as () => void)())
    await waitFor(() => expect(capturedPanelProps?.displayMode).toBe('review'))
    expect(capturedPanelProps?.revealCollapsedNodeIds).toBeNull()
  })

  it('reopens the flipped branch when edit is entered after that card was revealed', async () => {
    const card = buildCard('unit-edit-after-reveal')
    apiMocks.startFreestyleUnitReviewSessionApi.mockResolvedValue(buildSession(card.unit_id!))
    renderCard(card)

    await screen.findByTestId('flip-card-mind-map-panel')
    const badge = await screen.findByTestId('flip-progress-badge')

    // Reveal the active unit anchor (root first, then the unit card itself).
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })))
    flushRevealFrame()
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })))
    flushRevealFrame()
    expect(badge.textContent).toBe('1/2')

    act(() => (capturedPanelProps?.onPaneDoubleClick as () => void)())
    await waitFor(() => expect(capturedPanelProps?.displayMode).toBe('edit'))
    const flipped = capturedPanelProps?.revealCollapsedNodeIds as Set<string>
    // The revealed branch is open; the untouched sibling stays folded.
    expect(flipped.has('unit-node')).toBe(false)
    expect(flipped.has('other-unit')).toBe(true)
  })

  it('palace editScope shows the full palace instead of the current unit spine', async () => {
    writeFlipCardRevealSettings({
      granularity: 'level',
      stage: 'two-step',
      editScope: 'palace',
    })
    const card = buildCard('unit-palace-edit')
    apiMocks.startFreestyleUnitReviewSessionApi.mockResolvedValue(buildSession(card.unit_id!))
    renderCard(card)

    await screen.findByTestId('flip-card-mind-map-panel')
    const moreActions = capturedPanelProps?.toolbarExtensions as {
      moreActions?: Array<{ label: string; onClick: () => void }>
    }
    const enter = moreActions?.moreActions?.find((item) => item.label === '进入编辑')
    act(() => enter!.onClick())

    await waitFor(() => {
      expect(capturedPanelProps?.displayMode).toBe('edit')
    })
    expect(capturedPanelProps?.scopeBranchUid).toBeNull()
    expect(capturedPanelProps?.forceExpanded).toBe(false)
  })

  it('toggles edit mode from pane double-click both ways without stealing node click', async () => {
    const card = buildCard('unit-pane-gestures')
    apiMocks.startFreestyleUnitReviewSessionApi.mockResolvedValue(buildSession(card.unit_id!))
    renderCard(card)

    await screen.findByTestId('flip-card-mind-map-panel')
    expect(typeof capturedPanelProps?.onPaneDoubleClick).toBe('function')
    expect(capturedPanelProps?.onPaneLongPress).toBeUndefined()
    expect(typeof capturedPanelProps?.onNodeClick).toBe('function')
    expect(typeof capturedPanelProps?.onNodeContextMenu).toBe('function')
    expect(screen.getByTestId('freestyle-unit-review-map-shell').className).not.toContain('pb-[6.75rem]')
    expect(screen.getByTestId('freestyle-rating-bar')).toBeTruthy()

    act(() => (capturedPanelProps?.onPaneDoubleClick as () => void)())
    await waitFor(() => {
      expect(capturedPanelProps?.displayMode).toBe('edit')
    })
    expect(typeof capturedPanelProps?.onPaneDoubleClick).toBe('function')
    expect(capturedPanelProps?.onPaneLongPress).toBeUndefined()
    expect(screen.queryByTestId('freestyle-rating-bar')).toBeNull()
    expect(screen.getByTestId('freestyle-unit-review-map-shell').className).not.toContain('pb-[6.75rem]')

    act(() => (capturedPanelProps?.onPaneDoubleClick as () => void)())
    await waitFor(() => {
      expect(capturedPanelProps?.displayMode).toBe('review')
    })
    expect(typeof capturedPanelProps?.onPaneDoubleClick).toBe('function')
    expect(capturedPanelProps?.onPaneLongPress).toBeUndefined()
    expect(typeof capturedPanelProps?.onNodeClick).toBe('function')
    expect(typeof capturedPanelProps?.onNodeContextMenu).toBe('function')
    expect(screen.getByTestId('freestyle-rating-bar')).toBeTruthy()
    expect(screen.getByTestId('freestyle-unit-review-map-shell').className).not.toContain('pb-[6.75rem]')
  })

  it('keeps flip progress and preserve camera policy across edit/review toggles', async () => {
    const card = buildCard('unit-mode-flip-progress')
    apiMocks.startFreestyleUnitReviewSessionApi.mockResolvedValue(buildSession(card.unit_id!))
    renderCard(card)

    await screen.findByTestId('flip-card-mind-map-panel')
    const badge = await screen.findByTestId('flip-progress-badge')
    expect(badge.textContent).toBe('0/2')
    expect(capturedPanelProps?.initialViewPolicy).toBe('preserve')
    expect(capturedPanelProps?.sceneTransitionFallbackNodeId).toBe('unit-node')

    const revealTarget = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    })
    act(() => window.dispatchEvent(revealTarget))
    flushRevealFrame()
    expect(badge.textContent).toBe('1/2')
    expect(
      (capturedPanelProps?.visibleEditorState as {
        editor_doc: { root: { children: Array<{ data: { text: string } }> } }
      }).editor_doc.root.children[0]?.data.text,
    ).toBe('当前单元')

    act(() => (capturedPanelProps?.onPaneDoubleClick as () => void)())
    await waitFor(() => {
      expect(capturedPanelProps?.displayMode).toBe('edit')
    })
    expect(badge.textContent).toBe('1/2')
    expect(capturedPanelProps?.initialViewPolicy).toBe('preserve')
    expect(typeof capturedPanelProps?.onNodeClick).toBe('function')
    expect(typeof capturedPanelProps?.onNodeContextMenu).toBe('function')

    act(() => (capturedPanelProps?.onPaneDoubleClick as () => void)())
    await waitFor(() => {
      expect(capturedPanelProps?.displayMode).toBe('review')
    })
    expect(persistMocks.persistPalaceEditor).not.toHaveBeenCalled()
    expect(badge.textContent).toBe('1/2')
    expect(capturedPanelProps?.initialViewPolicy).toBe('preserve')
    expect(
      (capturedPanelProps?.visibleEditorState as {
        editor_doc: { root: { children: Array<{ data: { text: string } }> } }
      }).editor_doc.root.children[0]?.data.text,
    ).toBe('当前单元')
    expect(typeof capturedPanelProps?.onNodeClick).toBe('function')
    expect(typeof capturedPanelProps?.onNodeContextMenu).toBe('function')
  })

  it('adopts an immediate save fingerprint without rebuilding the revealed document', async () => {
    const card = buildCard('unit-mode-flip-progress-persist')
    apiMocks.startFreestyleUnitReviewSessionApi.mockResolvedValue(buildSession(card.unit_id!))
    persistMocks.persistPalaceEditor.mockImplementation(async (_palaceId, state) => ({
      state: {
        ...state,
        editor_fingerprint: 'after-immediate-save',
      },
      unitReconcile: null,
    }))
    const view = renderCard(card)

    await screen.findByTestId('flip-card-mind-map-panel')
    const badge = await screen.findByTestId('flip-progress-badge')
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })))
    flushRevealFrame()
    expect(badge.textContent).toBe('1/2')

    act(() => (capturedPanelProps?.onPaneDoubleClick as () => void)())
    await waitFor(() => expect(capturedPanelProps?.displayMode).toBe('edit'))

    const editable = capturedPanelProps?.editableEditorState as MindMapEditorState
    const nextState = JSON.parse(JSON.stringify(editable)) as MindMapEditorState
    act(() => (capturedPanelProps?.onEditorStateChange as (state: MindMapEditorState) => void)(nextState))
    await waitFor(() => expect(persistMocks.persistPalaceEditor).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(capturedPanelProps?.unitScopeEditorState).toMatchObject({
      editor_fingerprint: 'after-immediate-save',
    }))

    act(() => (capturedPanelProps?.onPaneDoubleClick as () => void)())
    await waitFor(() => expect(capturedPanelProps?.displayMode).toBe('review'))
    expect(badge.textContent).toBe('1/2')

    view.rerenderCard({
      encounter: queueEncounter({ encounterId: 'encounter-after-reconcile' }),
    })
    expect(screen.getByTestId('flip-progress-badge').textContent).toBe('1/2')
  })

  it('opens 复习进度 panel from moreActions', async () => {
    const card = buildCard('unit-review-progress')
    apiMocks.startFreestyleUnitReviewSessionApi.mockResolvedValue(buildSession(card.unit_id!))
    renderCard(card)

    await screen.findByTestId('flip-card-mind-map-panel')
    const moreActions = capturedPanelProps?.toolbarExtensions as {
      moreActions?: Array<{ label: string; onClick: () => void }>
    }
    const progress = moreActions?.moreActions?.find((item) => item.label === '复习进度')
    expect(progress).toBeTruthy()
    act(() => progress!.onClick())
    expect(await screen.findByTestId('palace-review-units-panel-mock')).toBeTruthy()
  })

  it('saves permanent mark toggles immediately without reconciling in the active card', async () => {
    const card = buildCard('unit-mark-reconcile')
    apiMocks.startFreestyleUnitReviewSessionApi.mockResolvedValue(buildSession(card.unit_id!))
    renderCard(card)

    await screen.findByTestId('flip-card-mind-map-panel')
    const moreActions = capturedPanelProps?.toolbarExtensions as {
      moreActions?: Array<{ label: string; onClick: () => void }>
    }
    act(() => moreActions?.moreActions?.find((item) => item.label === '进入编辑')!.onClick())
    await waitFor(() => expect(capturedPanelProps?.displayMode).toBe('edit'))

    const editMore = capturedPanelProps?.toolbarExtensions as {
      permanentMarkAction?: { label: string; onClick: () => void }
    }
    act(() => editMore?.permanentMarkAction!.onClick())
    const onEditNodeClick = capturedPanelProps?.onEditNodeClick as (
      nodes: MindMapSelection[],
    ) => void
    expect(typeof onEditNodeClick).toBe('function')

    await act(async () => {
      onEditNodeClick([selection('unit-node', '当前单元')])
      await Promise.resolve()
    })
    await waitFor(() => expect(persistMocks.persistPalaceEditor).toHaveBeenCalledTimes(1))
    await act(async () => {
      onEditNodeClick([selection('other-unit', '其他单元')])
      await Promise.resolve()
    })
    await waitFor(() => expect(persistMocks.persistPalaceEditor).toHaveBeenCalledTimes(2))
    expect(persistMocks.persistPalaceEditor).toHaveBeenLastCalledWith(
      1,
      expect.objectContaining({ editor_doc: expect.any(Object) }),
      undefined,
    )

    const callCount = persistMocks.persistPalaceEditor.mock.calls.length
    const markMore = capturedPanelProps?.toolbarExtensions as {
      permanentMarkAction?: { label: string; active?: boolean; onClick: () => void }
    }
    expect(markMore?.permanentMarkAction?.active).toBe(true)
    expect(markMore?.permanentMarkAction?.label.startsWith('退出永久标记')).toBe(true)
    act(() => markMore!.permanentMarkAction!.onClick())
    await act(async () => {
      await Promise.resolve()
    })

    expect(persistMocks.persistPalaceEditor).toHaveBeenCalledTimes(callCount)
    expect(
      persistMocks.persistPalaceEditor.mock.calls.some((call) => call[2]?.syncReason),
    ).toBe(false)
  })

  it('reconciles with editor_leave only after the edited card becomes inactive', async () => {
    const card = buildCard('unit-leave-reconcile')
    apiMocks.startFreestyleUnitReviewSessionApi.mockResolvedValue(buildSession(card.unit_id!))
    const view = renderCard(card)

    await screen.findByTestId('flip-card-mind-map-panel')
    const moreActions = capturedPanelProps?.toolbarExtensions as {
      moreActions?: Array<{ label: string; onClick: () => void }>
    }
    act(() => moreActions?.moreActions?.find((item) => item.label === '进入编辑')!.onClick())
    await waitFor(() => expect(capturedPanelProps?.displayMode).toBe('edit'))

    const editable = capturedPanelProps?.editableEditorState as MindMapEditorState
    const nextState = JSON.parse(JSON.stringify(editable)) as MindMapEditorState
    act(() => (capturedPanelProps?.onEditorStateChange as (state: MindMapEditorState) => void)(nextState))
    await waitFor(() => expect(persistMocks.persistPalaceEditor).toHaveBeenCalledTimes(1))

    const editMore = capturedPanelProps?.toolbarExtensions as {
      moreActions?: Array<{ label: string; onClick: () => void }>
    }
    act(() => editMore?.moreActions?.find((item) => item.label === '返回学习')!.onClick())
    await waitFor(() => expect(capturedPanelProps?.displayMode).toBe('review'))
    expect(persistMocks.persistPalaceEditor).toHaveBeenCalledTimes(1)

    persistMocks.persistPalaceEditor.mockImplementationOnce(async (_palaceId, state) => ({
      state,
      unitReconcile: {
        changed: true,
        changes: [],
        undo_token: 'leave-reconcile',
      },
    }))
    view.rerenderCard({ active: false })

    await waitFor(() => {
      expect(persistMocks.persistPalaceEditor).toHaveBeenLastCalledWith(
        1,
        expect.objectContaining({ editor_doc: expect.any(Object) }),
        expect.objectContaining({
          reconcileUnits: true,
          syncReason: 'editor_leave',
        }),
      )
    })
  })

  it('returns to review with local content while an immediate save is still in flight', async () => {
    const card = buildCard('unit-optimistic-return')
    apiMocks.startFreestyleUnitReviewSessionApi.mockResolvedValue(buildSession(card.unit_id!))
    renderCard(card)

    await screen.findByTestId('flip-card-mind-map-panel')
    const moreActions = capturedPanelProps?.toolbarExtensions as {
      moreActions?: Array<{ label: string; onClick: () => void }>
    }
    act(() => moreActions?.moreActions?.find((item) => item.label === '进入编辑')!.onClick())
    await waitFor(() => expect(capturedPanelProps?.displayMode).toBe('edit'))

    const editable = capturedPanelProps?.editableEditorState as MindMapEditorState
    const localState = JSON.parse(JSON.stringify(editable)) as MindMapEditorState
    localState.editor_fingerprint = 'local-pending'
    let resolveSave!: (result: { state: MindMapEditorState; unitReconcile: null }) => void
    const gate = new Promise<{ state: MindMapEditorState; unitReconcile: null }>((res) => {
      resolveSave = res
    })
    persistMocks.persistPalaceEditor.mockImplementationOnce(() => gate)

    act(() => (capturedPanelProps?.onEditorStateChange as (state: MindMapEditorState) => void)(localState))
    await waitFor(() => expect(persistMocks.persistPalaceEditor).toHaveBeenCalledTimes(1))
    expect(screen.getByTestId('freestyle-return-saving')).toBeTruthy()

    const editMore = capturedPanelProps?.toolbarExtensions as {
      moreActions?: Array<{ label: string; onClick: () => void }>
    }
    act(() => editMore?.moreActions?.find((item) => item.label === '返回学习')!.onClick())

    await waitFor(() => expect(capturedPanelProps?.displayMode).toBe('review'))
    expect(screen.getByTestId('freestyle-return-saving')).toBeTruthy()
    expect(screen.getByTestId('freestyle-rating-bar')).toBeTruthy()
    await waitFor(() => {
      expect(
        (capturedPanelProps?.unitScopeEditorState as MindMapEditorState).editor_doc,
      ).toEqual(localState.editor_doc)
    })

    await act(async () => {
      resolveSave({
        state: { ...localState, editor_fingerprint: 'saved-fingerprint' },
        unitReconcile: null,
      })
    })
    await waitFor(() => expect(screen.getByTestId('freestyle-save-saved')).toBeTruthy())
    expect(screen.queryByTestId('freestyle-return-saving')).toBeNull()
    await waitFor(() => {
      expect(
        (capturedPanelProps?.unitScopeEditorState as MindMapEditorState).editor_fingerprint,
      ).toBe('saved-fingerprint')
    })
  })

  it('keeps review usable and offers retry when an immediate save fails', async () => {
    const card = buildCard('unit-return-failure')
    apiMocks.startFreestyleUnitReviewSessionApi.mockResolvedValue(buildSession(card.unit_id!))
    const { onSaveFailed } = renderCard(card)

    await screen.findByTestId('flip-card-mind-map-panel')
    const moreActions = capturedPanelProps?.toolbarExtensions as {
      moreActions?: Array<{ label: string; onClick: () => void }>
    }
    act(() => moreActions?.moreActions?.find((item) => item.label === '进入编辑')!.onClick())
    await waitFor(() => expect(capturedPanelProps?.displayMode).toBe('edit'))

    const editable = capturedPanelProps?.editableEditorState as MindMapEditorState
    const localState = JSON.parse(JSON.stringify(editable)) as MindMapEditorState
    persistMocks.persistPalaceEditor.mockRejectedValueOnce(new Error('保存宫殿失败'))
    act(() => (capturedPanelProps?.onEditorStateChange as (state: MindMapEditorState) => void)(localState))

    await waitFor(() => expect(screen.getByTestId('freestyle-save-error')).toBeTruthy())
    expect(onSaveFailed).toHaveBeenCalledWith('保存宫殿失败')

    const editMore = capturedPanelProps?.toolbarExtensions as {
      moreActions?: Array<{ label: string; onClick: () => void }>
    }
    act(() => editMore?.moreActions?.find((item) => item.label === '返回学习')!.onClick())
    await waitFor(() => expect(capturedPanelProps?.displayMode).toBe('review'))
    expect(screen.getByTestId('freestyle-save-error')).toBeTruthy()
    expect(screen.getByTestId('freestyle-rating-bar')).toBeTruthy()
    await waitFor(() => {
      expect(
        (capturedPanelProps?.unitScopeEditorState as MindMapEditorState).editor_doc,
      ).toEqual(localState.editor_doc)
    })

    act(() => screen.getByRole('button', { name: '重试' }).click())
    await waitFor(() => expect(persistMocks.persistPalaceEditor).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByTestId('freestyle-save-saved')).toBeTruthy())
    expect(capturedPanelProps?.displayMode).toBe('review')
  })

  it('never rebuilds the freestyle queue while the edited card remains active', async () => {
    const card = buildCard('unit-deferred-rebuild')
    apiMocks.startFreestyleUnitReviewSessionApi.mockResolvedValue(buildSession(card.unit_id!))
    const view = renderCard(card)
    const { onUnitsReconciled } = view

    await screen.findByTestId('flip-card-mind-map-panel')
    persistMocks.persistPalaceEditor.mockImplementation(async (_palaceId, state, options) => ({
      state,
      unitReconcile: options?.syncReason === 'editor_leave'
        ? { changed: true, changes: [], undo_token: 'leave-reconcile' }
        : { changed: true, changes: [], undo_token: 'plain-should-not-rebuild' },
    }))

    const enter = () => {
      const actions = capturedPanelProps?.toolbarExtensions as {
        moreActions?: Array<{ label: string; onClick: () => void }>
      }
      act(() => actions?.moreActions?.find((item) => item.label === '进入编辑')!.onClick())
    }
    const leave = () => {
      const actions = capturedPanelProps?.toolbarExtensions as {
        moreActions?: Array<{ label: string; onClick: () => void }>
      }
      act(() => actions?.moreActions?.find((item) => item.label === '返回学习')!.onClick())
    }

    enter()
    await waitFor(() => expect(capturedPanelProps?.displayMode).toBe('edit'))
    const editable = capturedPanelProps?.editableEditorState as MindMapEditorState
    const nextState = JSON.parse(JSON.stringify(editable)) as MindMapEditorState
    act(() => (capturedPanelProps?.onEditorStateChange as (state: MindMapEditorState) => void)(nextState))
    await waitFor(() => expect(persistMocks.persistPalaceEditor).toHaveBeenCalledTimes(1))
    leave()
    await waitFor(() => expect(capturedPanelProps?.displayMode).toBe('review'))

    enter()
    await waitFor(() => expect(capturedPanelProps?.displayMode).toBe('edit'))
    leave()
    await waitFor(() => expect(capturedPanelProps?.displayMode).toBe('review'))
    await act(async () => {
      await Promise.resolve()
    })
    expect(onUnitsReconciled).not.toHaveBeenCalled()

    view.rerenderCard({ active: false })
    await waitFor(() => expect(onUnitsReconciled).toHaveBeenCalledTimes(1))
  })

  it('typing autosave does not force reconcile options', async () => {
    const card = buildCard('unit-type-autosave')
    apiMocks.startFreestyleUnitReviewSessionApi.mockResolvedValue(buildSession(card.unit_id!))
    renderCard(card)

    await screen.findByTestId('flip-card-mind-map-panel')
    const moreActions = capturedPanelProps?.toolbarExtensions as {
      moreActions?: Array<{ label: string; onClick: () => void }>
    }
    act(() => moreActions?.moreActions?.find((item) => item.label === '进入编辑')!.onClick())
    await waitFor(() => expect(capturedPanelProps?.displayMode).toBe('edit'))

    const onEditorStateChange = capturedPanelProps?.onEditorStateChange as (
      state: MindMapEditorState,
    ) => void
    const nextState = {
      editor_doc: palaceEditorDoc,
      editor_config: {},
      editor_local_config: {},
      lang: 'zh',
    } as MindMapEditorState
    act(() => onEditorStateChange(nextState))

    await waitFor(() => {
      expect(persistMocks.persistPalaceEditor).toHaveBeenCalledWith(1, nextState, undefined)
    })
    expect(persistMocks.persistPalaceEditor).toHaveBeenCalledTimes(1)
  })

  it('does not restore a deleted card when a slower pre-delete save settles', async () => {
    const card = buildCard('unit-stale-save-restore')
    apiMocks.startFreestyleUnitReviewSessionApi.mockResolvedValue(buildSession(card.unit_id!))
    renderCard(card)

    await screen.findByTestId('flip-card-mind-map-panel')
    const moreActions = capturedPanelProps?.toolbarExtensions as {
      moreActions?: Array<{ label: string; onClick: () => void }>
    }
    act(() => moreActions?.moreActions?.find((item) => item.label === '进入编辑')!.onClick())
    await waitFor(() => expect(capturedPanelProps?.displayMode).toBe('edit'))

    const withCard = {
      editor_doc: palaceEditorDoc,
      editor_config: {},
      editor_local_config: {},
      lang: 'zh',
    }
    const withoutCard = {
      editor_doc: {
        root: {
          data: { uid: 'root', text: '完整宫殿' },
          children: [
            {
              data: { uid: 'unit-node', text: '当前单元' },
              children: [],
            },
            {
              data: { uid: 'other-unit', text: '其他单元' },
              children: [{ data: { uid: 'other-child', text: '其他单元子节点' }, children: [] }],
            },
          ],
        },
      },
      editor_config: {},
      editor_local_config: {},
      lang: 'zh',
    }
    const unitChildUids = (state: unknown) => {
      const doc = (state as {
        editor_doc?: {
          root?: {
            children?: Array<{ data?: { uid?: string }; children?: Array<{ data?: { uid?: string } }> }>
          }
        }
      } | null)?.editor_doc
      const unit = doc?.root?.children?.find((node) => node.data?.uid === 'unit-node')
      return (unit?.children ?? []).map((node) => node.data?.uid)
    }

    let resolveFirst!: (result: { state: unknown; unitReconcile: null }) => void
    const firstGate = new Promise<{ state: unknown; unitReconcile: null }>((res) => {
      resolveFirst = res
    })
    persistMocks.persistPalaceEditor.mockImplementationOnce(() => firstGate)

    const onEditorStateChange = capturedPanelProps?.onEditorStateChange as (
      state: typeof withCard,
    ) => void
    act(() => onEditorStateChange(withCard))
    await waitFor(() => expect(persistMocks.persistPalaceEditor).toHaveBeenCalledTimes(1))
    act(() => onEditorStateChange(withoutCard))

    expect(unitChildUids(capturedPanelProps?.editableEditorState)).toEqual([])

    await act(async () => {
      resolveFirst({
        state: { ...withCard, editor_fingerprint: 'fp-stale' },
        unitReconcile: null,
      })
    })

    expect(unitChildUids(capturedPanelProps?.editableEditorState)).toEqual([])
    await waitFor(() => expect(persistMocks.persistPalaceEditor).toHaveBeenCalledTimes(2))
    expect(persistMocks.persistPalaceEditor).toHaveBeenLastCalledWith(
      1,
      expect.objectContaining({ editor_doc: withoutCard.editor_doc }),
      undefined,
    )
  })

  it('keeps reveal and hide interactions scoped to presentation only', async () => {
    const card = buildCard('unit-pointer-actions')
    apiMocks.startFreestyleUnitReviewSessionApi.mockResolvedValue(buildSession(card.unit_id!))
    renderCard(card)

    await screen.findByTestId('flip-card-mind-map-panel')
    const onNodeClick = capturedPanelProps?.onNodeClick as (nodes: MindMapSelection[]) => void
    act(() => onNodeClick([selection('root', '完整宫殿')]))
    flushRevealFrame()
    expect(capturedPanelProps?.visibleEditorState).toBeTruthy()
    expect(capturedPanelProps?.revealFollowNonce ?? 0).toBe(0)
  })

  it('uses Enter to reveal the active unit anchor through the same progressive flip flow', async () => {
    const card = buildCard('unit-enter-reveal')
    apiMocks.startFreestyleUnitReviewSessionApi.mockResolvedValue(buildSession(card.unit_id!))
    renderCard(card)

    await screen.findByTestId('flip-card-mind-map-panel')
    const revealTarget = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    })
    act(() => window.dispatchEvent(revealTarget))
    expect(revealTarget.defaultPrevented).toBe(true)
    expect(capturedPanelProps?.revealFollowNodeIds).toContain('unit-node')
    expect(capturedPanelProps?.revealFollowNodeIds).not.toContain('unit-child')
    expect(capturedPanelProps?.revealFollowNonce).toBe(1)
    flushRevealFrame()
    expect(
      (capturedPanelProps?.visibleEditorState as {
        editor_doc: { root: { children: Array<{ data: { text: string } }> } }
      }).editor_doc.root.children[0]?.data.text,
    ).toBe('当前单元')

    const revealChild = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    })
    act(() => window.dispatchEvent(revealChild))
    expect(capturedPanelProps?.revealFollowNodeIds).toEqual(['unit-child'])
    expect(capturedPanelProps?.revealFollowNonce).toBe(2)
    flushRevealFrame()
    expect(
      (capturedPanelProps?.visibleEditorState as {
        editor_doc: {
          root: { children: Array<{ children: Array<{ data: { text: string } }> }> }
        }
      }).editor_doc.root.children[0]?.children[0]?.data.text,
    ).toBe('待回忆')
  })

  it('retracts the flipped unit back to 待回忆 on Backspace', async () => {
    const card = buildCard('unit-backspace-retract')
    apiMocks.startFreestyleUnitReviewSessionApi.mockResolvedValue(buildSession(card.unit_id!))
    renderCard(card)

    await screen.findByTestId('flip-card-mind-map-panel')
    for (const key of ['Enter', 'Enter']) {
      const reveal = new KeyboardEvent('keydown', {
        key,
        bubbles: true,
        cancelable: true,
      })
      act(() => window.dispatchEvent(reveal))
      flushRevealFrame()
    }
    expect(
      (capturedPanelProps?.visibleEditorState as {
        editor_doc: {
          root: { children: Array<{ children: Array<{ data: { text: string } }> }> }
        }
      }).editor_doc.root.children[0]?.children[0]?.data.text,
    ).toBe('待回忆')

    const retract = new KeyboardEvent('keydown', {
      key: 'Backspace',
      bubbles: true,
      cancelable: true,
    })
    act(() => window.dispatchEvent(retract))
    expect(retract.defaultPrevented).toBe(true)
    flushRevealFrame()
    const retractedAnchor = (capturedPanelProps?.visibleEditorState as {
      editor_doc: {
        root: { children: Array<{ data: { text: string }; children?: unknown[] }> }
      }
    }).editor_doc.root.children[0]
    expect(retractedAnchor?.data.text).toBe('待回忆')
    expect(retractedAnchor?.children ?? []).toEqual([])
  })

  it('flips on Enter without moving the camera when camera tracking is off', async () => {
    writeFlipCardRevealSettings({
      granularity: 'level',
      stage: 'two-step',
      enterRevealFollow: false,
    })
    const card = buildCard('unit-enter-no-follow')
    apiMocks.startFreestyleUnitReviewSessionApi.mockResolvedValue(buildSession(card.unit_id!))
    renderCard(card)

    await screen.findByTestId('flip-card-mind-map-panel')
    const revealTarget = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    })
    act(() => window.dispatchEvent(revealTarget))
    expect(revealTarget.defaultPrevented).toBe(true)
    expect(capturedPanelProps?.revealFollowNonce ?? 0).toBe(0)
    expect(capturedPanelProps?.revealFollowNodeIds).toEqual([])
    flushRevealFrame()
    expect(
      (capturedPanelProps?.visibleEditorState as {
        editor_doc: { root: { children: Array<{ data: { text: string } }> } }
      }).editor_doc.root.children[0]?.data.text,
    ).toBe('当前单元')
  })

  it('no longer treats Shift as a hide-to-root shortcut', async () => {
    const card = buildCard('unit-shift-noop')
    apiMocks.startFreestyleUnitReviewSessionApi.mockResolvedValue(buildSession(card.unit_id!))
    renderCard(card)

    await screen.findByTestId('flip-card-mind-map-panel')
    const revealTarget = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    })
    act(() => window.dispatchEvent(revealTarget))
    flushRevealFrame()

    const childrenBefore = (capturedPanelProps?.visibleEditorState as {
      editor_doc: { root: { children: unknown[] } }
    }).editor_doc.root.children
    const shiftEvent = new KeyboardEvent('keydown', {
      key: 'Shift',
      bubbles: true,
      cancelable: true,
    })
    act(() => window.dispatchEvent(shiftEvent))
    flushRevealFrame()
    expect(shiftEvent.defaultPrevented).toBe(false)
    expect(
      (capturedPanelProps?.visibleEditorState as {
        editor_doc: { root: { children: unknown[] } }
      }).editor_doc.root.children,
    ).toEqual(childrenBefore)
  })

  it('ignores Enter outside the active review surface and while editing or typing', async () => {
    const card = buildCard('unit-enter-guards')
    apiMocks.startFreestyleUnitReviewSessionApi.mockResolvedValue(buildSession(card.unit_id!))
    const view = renderCard(card)

    await screen.findByTestId('flip-card-mind-map-panel')
    await act(async () => {
      view.rerenderCard({ active: false })
      await Promise.resolve()
    })
    const inactiveEvent = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    act(() => window.dispatchEvent(inactiveEvent))
    expect(inactiveEvent.defaultPrevented).toBe(false)

    await act(async () => {
      view.rerenderCard({ active: true })
      await Promise.resolve()
    })
    const input = document.createElement('input')
    document.body.appendChild(input)
    try {
      const typingEvent = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
      act(() => input.dispatchEvent(typingEvent))
      expect(typingEvent.defaultPrevented).toBe(false)
    } finally {
      input.remove()
    }

    const toolbarExtensions = capturedPanelProps?.toolbarExtensions as {
      moreActions: Array<{ label: string; onClick: () => void }>
    }
    act(() => toolbarExtensions.moreActions.find((action) => action.label === '进入编辑')?.onClick())
    const editingEvent = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    act(() => window.dispatchEvent(editingEvent))
    expect(editingEvent.defaultPrevented).toBe(false)
  })

  it('does not restart the glance when a silent rebuild replaces the retry card object', async () => {
    const source = buildCard('unit-retry-stable-session')
    const retryCard: FreestyleReviewUnitCard = {
      ...source,
      id: `retry:round-1:${source.id}:1`,
      source_card_id: source.id,
      occurrence_kind: 'retry',
      retry_attempt: 1,
    }
    const session = buildSession(retryCard.unit_id!)
    apiMocks.startFreestyleUnitReviewSessionApi.mockResolvedValue(session)
    apiMocks.rateReviewUnitApi.mockImplementation(
      (_sessionId, _unit, _encounterId, rating, operationId) =>
        Promise.resolve(ratingResult(session, rating, operationId)),
    )
    const view = renderCard(retryCard)

    await screen.findByTestId('flip-card-mind-map-panel')
    fireEvent.click(screen.getByRole('button', { name: /困难：首学 → 今天 · 10 分钟后重练/ }))
    await waitFor(() => expect(apiMocks.rateFreestyleRoundUnitApi).toHaveBeenCalledTimes(1))
    expect(apiMocks.startFreestyleUnitReviewSessionApi).toHaveBeenCalledTimes(1)
    await screen.findByText(/已选困难/)

    view.rerenderCard({
      card: { ...retryCard },
      encounter: queueEncounter({
        encounterId: 'encounter-1',
        status: 'open',
        sessionId: session.id,
        selectedRating: 2,
        passed: false,
        retryAfterCards: 3,
      }),
    })
    await waitFor(() => expect(screen.getByTestId('flip-card-mind-map-panel')).toBeTruthy())
    expect(apiMocks.startFreestyleUnitReviewSessionApi).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/已选困难/)).toBeTruthy()
  })

  it('does not remount the map when a retry pass returns the source encounter', async () => {
    const source = buildCard('unit-retry-keep-view')
    const retryCard: FreestyleReviewUnitCard = {
      ...source,
      id: `retry:round-1:${source.id}:1`,
      source_card_id: source.id,
      occurrence_kind: 'retry',
      retry_attempt: 1,
    }
    const session = buildSession(retryCard.unit_id!)
    apiMocks.startFreestyleUnitReviewSessionApi.mockResolvedValue(session)
    apiMocks.rateReviewUnitApi.mockImplementation(
      (_sessionId, _unit, _encounterId, rating, operationId) => {
        const payload = ratingResult(session, rating, operationId)
        return Promise.resolve({
          ...payload,
          encounter_id: 'encounter-source',
          encounter: { ...payload.encounter, id: 'encounter-source', status: 'closed' },
          unit: {
            ...payload.unit,
            encounter: { ...payload.encounter, id: 'encounter-source', status: 'closed' },
          },
        })
      },
    )
    const view = renderCard(retryCard)

    await screen.findByTestId('flip-card-mind-map-panel')
    const onNodeClick = capturedPanelProps?.onNodeClick as (nodes: MindMapSelection[]) => void
    act(() => onNodeClick([selection('root', '完整宫殿')]))
    flushRevealFrame()
    const revealedBefore = (
      capturedPanelProps?.visibleEditorState as { editor_doc: { root: { children: unknown[] } } }
    ).editor_doc.root.children.length
    expect(revealedBefore).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: /记得：首学 → 1天 · 7月28日/ }))
    await waitFor(() => expect(apiMocks.rateFreestyleRoundUnitApi).toHaveBeenCalledTimes(1))
    expect(apiMocks.startFreestyleUnitReviewSessionApi).toHaveBeenCalledTimes(1)
    await screen.findByText(/已选记得/)
    expect(view.onEncounterChange).toHaveBeenCalledWith(
      retryCard.id,
      expect.objectContaining({ encounterId: 'encounter-1', status: 'open' }),
    )
    expect(
      (capturedPanelProps?.visibleEditorState as { editor_doc: { root: { children: unknown[] } } })
        .editor_doc.root.children.length,
    ).toBe(revealedBefore)

    view.rerenderCard({
      card: { ...retryCard },
      encounter: queueEncounter({
        encounterId: 'encounter-source',
        status: 'closed',
        sessionId: session.id,
        selectedRating: 3,
        passed: true,
      }),
    })
    await waitFor(() => expect(screen.getByTestId('flip-card-mind-map-panel')).toBeTruthy())
    expect(apiMocks.startFreestyleUnitReviewSessionApi).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/已选记得/)).toBeTruthy()
  })

  it('keeps the flipped map when the same card reopens a fresh encounter', async () => {
    // A rating (or a revision adopt) closes and reopens the glance under the
    // learner. Remounting the panel there folded every branch back to the root —
    // the "评完分脑图自己收起来了" report.
    const card = buildCard('unit-retry-fresh-reveal')
    const firstSession = buildSession(card.unit_id!)
    const retryEncounter = queueEncounter({ encounterId: 'encounter-2' })
    const retrySession = buildSession(
      card.unit_id!,
      3,
      buildEncounter({ id: 'encounter-2' }),
    )
    apiMocks.startFreestyleUnitReviewSessionApi
      .mockResolvedValueOnce(firstSession)
      .mockResolvedValueOnce(retrySession)
    const view = renderCard(card)

    await screen.findByTestId('flip-card-mind-map-panel')
    const onNodeClick = capturedPanelProps?.onNodeClick as (nodes: MindMapSelection[]) => void
    act(() => onNodeClick([selection('root', '完整宫殿')]))
    flushRevealFrame()
    const revealedBefore = (
      capturedPanelProps?.visibleEditorState as { editor_doc: { root: { children: unknown[] } } }
    ).editor_doc.root.children.length
    expect(revealedBefore).toBeGreaterThan(0)

    view.rerenderCard({
      encounter: retryEncounter,
      onEnsureEncounter: vi.fn(() => retryEncounter),
    })
    await waitFor(() => expect(apiMocks.startFreestyleUnitReviewSessionApi).toHaveBeenCalledTimes(2))
    expect(
      (capturedPanelProps?.visibleEditorState as {
        editor_doc: { root: { children: unknown[] } }
      }).editor_doc.root.children.length,
    ).toBe(revealedBefore)
  })

  it('shows the booked wait rather than a retry queue position', () => {
    expect(ratingEffectLabel(effects[0])).toBe('10 分钟后重练 · 今天')
    expect(ratingEffectLabel(effects[1])).toBe('10 分钟后重练 · 今天')
    expect(ratingEffectLabel(effects[2])).toBe('1天后复习 · 7月28日')
    expect(ratingEffectLabel({ ...effects[0], retry_after_minutes: null }))
      .toBe('今天再练')
  })

  it('reports the real booked gap when a due date carries per-unit spread', () => {
    // Server books 362d for a 365d stage after spread; the label must not claim 365.
    const spread: UnitRatingEffectDto = {
      rating: 3,
      label: '记得',
      passed: true,
      target_stage_index: 9,
      target_interval_days: 365,
      target_actual_interval_days: 362,
      target_due_date: '2027-07-25',
      retry_after_cards: 0,
      stage_action: 'keep',
    }
    expect(ratingEffectLabel(spread)).toBe('362天后复习 · 7月25日')
  })

  it('falls back to the nominal interval when a cached client lacks the spread field', () => {
    const legacy: UnitRatingEffectDto = {
      rating: 3,
      label: '记得',
      passed: true,
      target_stage_index: 1,
      target_interval_days: 1,
      target_due_date: '2026-07-28',
      retry_after_cards: 0,
      stage_action: 'advance',
    }
    expect(ratingEffectLabel(legacy)).toBe('1天后复习 · 7月28日')
  })

  it('says a lapsed mature unit is retry work today, not a ladder demotion', () => {
    const lapsed: UnitRatingEffectDto = {
      rating: 1,
      label: '忘记',
      passed: false,
      target_stage_index: 4,
      target_interval_days: 14,
      target_actual_interval_days: 0,
      target_due_date: '2026-07-27',
      retry_after_cards: 3,
      stage_action: 'lower',
    }
    expect(ratingEffectLabel(lapsed)).toBe('今天再练')

    const heldAtLearning: UnitRatingEffectDto = {
      ...lapsed,
      target_stage_index: 0,
      target_interval_days: 0,
      stage_action: 'keep',
    }
    expect(ratingEffectLabel(heldAtLearning)).toBe('今天再练')
  })

  it('stays on the card and atomically amends another rating', async () => {
    const card = buildCard('unit-amend')
    const session = buildSession(card.unit_id!)
    apiMocks.startFreestyleUnitReviewSessionApi.mockResolvedValue(session)
    apiMocks.rateReviewUnitApi.mockImplementation(
      (_sessionId, _unit, _encounterId, rating, operationId) =>
        Promise.resolve(ratingResult(session, rating, operationId)),
    )
    const { onBranchComplete } = renderCard(card)

    await screen.findByTestId('flip-card-mind-map-panel')
    fireEvent.click(screen.getByRole('button', { name: /记得：首学 → 1天 · 7月28日/ }))
    await screen.findByText('已选记得 · 首学 → 1天 · 7月28日')

    fireEvent.click(screen.getByRole('button', { name: /轻松：首学 → 3天 · 7月30日/ }))
    await screen.findByText('已选轻松 · 首学 → 3天 · 7月30日')
    expect(apiMocks.rateReviewUnitApi).toHaveBeenCalledTimes(2)
    expect(apiMocks.undoReviewUnitRatingApi).not.toHaveBeenCalled()
    expect(onBranchComplete).toHaveBeenLastCalledWith(card.id, {
      restudy: false,
      rating: 4,
      retryAfterCards: 0,
    })
    expect(screen.getByTestId('flip-card-mind-map-panel')).not.toBeNull()
  })

  it('clears the selected rating when it is clicked again', async () => {
    const card = buildCard('unit-clear-rating')
    const session = buildSession(card.unit_id!)
    apiMocks.startFreestyleUnitReviewSessionApi.mockResolvedValue(session)
    apiMocks.rateReviewUnitApi.mockImplementation(
      (_sessionId, _unit, _encounterId, rating, operationId) =>
        Promise.resolve(ratingResult(session, rating, operationId)),
    )
    apiMocks.undoReviewUnitRatingApi.mockResolvedValue(undoResult(session))
    const { onBranchComplete } = renderCard(card)

    await screen.findByTestId('flip-card-mind-map-panel')
    const remembered = screen.getByRole('button', { name: /记得：首学 → 1天 · 7月28日/ })
    fireEvent.click(remembered)
    await screen.findByText('已选记得 · 首学 → 1天 · 7月28日')
    fireEvent.click(screen.getByRole('button', { name: /记得：.*再点取消评分/ }))
    await waitFor(() => expect(apiMocks.undoReviewUnitRatingApi).toHaveBeenCalledTimes(1))
    expect(apiMocks.rateReviewUnitApi).toHaveBeenCalledTimes(1)
    expect(onBranchComplete).toHaveBeenLastCalledWith(card.id, { cleared: true })
    expect(screen.queryByText(/已选记得/)).toBeNull()
  })

  it('undoes every prior rating when the selected rating is clicked again after an amend', async () => {
    const card = buildCard('unit-clear-all-ratings')
    const session = buildSession(card.unit_id!)
    apiMocks.startFreestyleUnitReviewSessionApi.mockResolvedValue(session)
    apiMocks.rateReviewUnitApi.mockImplementation(
      (_sessionId, _unit, _encounterId, rating, operationId) =>
        Promise.resolve(ratingResult(session, rating, operationId)),
    )
    apiMocks.undoReviewUnitRatingApi
      .mockResolvedValueOnce(undoResult(session, { rating: 3, operationId: 'rating-remember' }))
      .mockResolvedValueOnce(undoResult(session))
    const { onBranchComplete } = renderCard(card)

    await screen.findByTestId('flip-card-mind-map-panel')
    fireEvent.click(screen.getByRole('button', { name: /记得：首学 → 1天 · 7月28日/ }))
    await screen.findByText('已选记得 · 首学 → 1天 · 7月28日')
    fireEvent.click(screen.getByRole('button', { name: /轻松：首学 → 3天 · 7月30日/ }))
    await screen.findByText('已选轻松 · 首学 → 3天 · 7月30日')
    fireEvent.click(screen.getByRole('button', { name: /轻松：.*再点取消评分/ }))

    await waitFor(() => expect(apiMocks.undoReviewUnitRatingApi).toHaveBeenCalledTimes(2))
    expect(onBranchComplete).toHaveBeenLastCalledWith(card.id, { cleared: true })
    expect(screen.queryByText(/已选/)).toBeNull()
  })

  it('adopts the session id returned when a rating reopens a dead glance', async () => {
    const card = buildCard('unit-healed-session')
    const session = buildSession(card.unit_id!)
    apiMocks.startFreestyleUnitReviewSessionApi.mockResolvedValue(session)
    apiMocks.rateReviewUnitApi.mockImplementation(
      (_sessionId, _unit, _encounterId, rating, operationId) =>
        Promise.resolve({
          ...ratingResult(session, rating, operationId),
          study_session_id: 'healed-session',
        }),
    )
    const { onEncounterChange, onSaveFailed } = renderCard(card)

    await screen.findByTestId('flip-card-mind-map-panel')
    fireEvent.click(screen.getByRole('button', { name: /记得：首学 → 1天 · 7月28日/ }))
    await screen.findByText('已选记得 · 首学 → 1天 · 7月28日')
    expect(onSaveFailed).not.toHaveBeenCalled()
    expect(onEncounterChange).toHaveBeenCalledWith(
      card.id,
      expect.objectContaining({ sessionId: 'healed-session', selectedRating: 3 }),
    )
  })

  it('rates only the current card even if a palace target is supplied', async () => {
    const card = buildCard('unit-palace-rate')
    const session = buildSession(card.unit_id!)
    apiMocks.startFreestyleUnitReviewSessionApi.mockResolvedValue(session)
    apiMocks.rateFreestyleRoundUnitApi.mockResolvedValue({
      item: ratingResult(session, 3, 'op-current-only'),
      round: { conflict: false, version: 2, plan_version: 2 },
    })
    const { onBatchCardsSettled, onBranchComplete } = renderCard(card, {
      ratingScope: 'palace',
      palaceTarget: {
        palaceId: card.palace_id,
        dueCount: 2,
        excludeUnitIds: [],
        includeUnitIds: [card.unit_id, 'unit-b'],
        settleCards: [
          { cardId: card.id, unitId: card.unit_id },
          { cardId: 'card-b', unitId: 'unit-b' },
        ],
      },
    })

    await screen.findByTestId('flip-card-mind-map-panel')
    fireEvent.click(screen.getByTestId('freestyle-rating-button-3'))
    await screen.findByText('已选记得 · 首学 → 1天 · 7月28日')
    expect(apiMocks.ratePalaceDueUnitsApi).not.toHaveBeenCalled()
    expect(apiMocks.rateFreestyleRoundUnitApi).toHaveBeenCalledTimes(1)
    expect(apiMocks.rateFreestyleRoundUnitApi.mock.calls[0][1].palace_batch).toBeUndefined()
    expect(onBranchComplete).toHaveBeenCalledWith(card.id, {
      restudy: false,
      rating: 3,
      retryAfterCards: 0,
    })
    expect(onBatchCardsSettled).not.toHaveBeenCalled()
  })

  it('shows the tapped rating as saving while the rate is still in flight', async () => {
    const card = buildCard('unit-pending-rate')
    const session = buildSession(card.unit_id!)
    apiMocks.startFreestyleUnitReviewSessionApi.mockResolvedValue(session)
    let resolveRate: ((value: unknown) => void) | null = null
    apiMocks.rateReviewUnitApi.mockImplementation(
      (_sessionId, _unit, _encounterId, rating, operationId) =>
        new Promise((resolve) => {
          resolveRate = () => resolve(ratingResult(session, rating, operationId))
        }),
    )
    const { onBranchComplete } = renderCard(card)

    await screen.findByTestId('flip-card-mind-map-panel')
    fireEvent.click(screen.getByRole('button', { name: /记得：首学 → 1天 · 7月28日/ }))

    const button = screen.getByTestId('freestyle-rating-button-3')
    // Local-first: the tap is lit at once while the save is still on the wire.
    expect(button.getAttribute('aria-pressed')).toBe('true')
    expect(button.hasAttribute('disabled')).toBe(false)
    expect(screen.getByTestId('freestyle-rating-saving-line').textContent).toContain('保存中')
    expect(screen.getByTestId('freestyle-rating-pending-3')).toBeTruthy()
    expect(onBranchComplete).not.toHaveBeenCalled()

    await act(async () => {
      resolveRate?.(null)
    })
    expect(onBranchComplete).toHaveBeenCalledWith(card.id, {
      restudy: false, rating: 3, retryAfterCards: 0,
    })
    expect(screen.getByText('已选记得 · 首学 → 1天 · 7月28日')).toBeTruthy()
    expect(button.getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByTestId('freestyle-rating-saving-line')).toBeNull()
    expect(button.hasAttribute('disabled')).toBe(false)
  })

  it('shows a failed save as 未保存 and retries it with the same operation id on the next tap', async () => {
    const card = buildCard('unit-busy-rate')
    const session = buildSession(card.unit_id!)
    apiMocks.startFreestyleUnitReviewSessionApi.mockResolvedValue(session)
    apiMocks.rateFreestyleRoundUnitApi.mockRejectedValueOnce(new Error('storage busy'))
    apiMocks.rateReviewUnitApi.mockImplementation(
      async (_sessionId, _unit, _encounterId, rating, operationId) =>
        ratingResult(session, rating, operationId),
    )
    const { onSaveFailed } = renderCard(card)

    await screen.findByTestId('flip-card-mind-map-panel')
    fireEvent.click(screen.getByTestId('freestyle-rating-button-3'))

    await waitFor(() => expect(onSaveFailed).toHaveBeenCalled())
    expect(apiMocks.rateFreestyleRoundUnitApi).toHaveBeenCalledTimes(1)
    expect(apiMocks.rateFreestyleRoundUnitApi.mock.calls[0]).toHaveLength(2)
    expect(screen.getByTestId('freestyle-rating-unsaved-line').textContent).toContain('未保存记得')
    expect(screen.getByTestId('freestyle-rating-button-3').getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByTestId('freestyle-rating-button-3').getAttribute('data-failed')).toBe('true')
    expect(screen.queryByTestId('freestyle-rating-saving-line')).toBeNull()

    fireEvent.click(screen.getByTestId('freestyle-rating-button-3'))
    await waitFor(() => expect(apiMocks.rateFreestyleRoundUnitApi).toHaveBeenCalledTimes(2))
    const operationIds = apiMocks.rateFreestyleRoundUnitApi.mock.calls.map(
      (call) => (call[1] as { operation_id: string }).operation_id,
    )
    expect(operationIds[1]).toBe(operationIds[0])
    await waitFor(() => {
      expect(screen.getByTestId('freestyle-rating-button-3').getAttribute('aria-pressed')).toBe('true')
    })
    expect(screen.queryByTestId('freestyle-rating-unsaved-line')).toBeNull()
  })

  it('keeps the tapped grade 保存中 and retries quietly before anything says 未保存', async () => {
    // Production retry policy for this spec: a failed attempt is resent shortly after.
    resetFreestyleRatingSavesForTests()
    const card = buildCard('unit-quiet-retry')
    const session = buildSession(card.unit_id!)
    apiMocks.startFreestyleUnitReviewSessionApi.mockResolvedValue(session)
    apiMocks.rateReviewUnitApi
      .mockRejectedValueOnce(new Error('storage busy'))
      .mockImplementation(
        async (_sessionId, _unit, _encounterId, rating, operationId) =>
          ratingResult(session, rating, operationId),
      )
    const { onBranchComplete, onSaveFailed } = renderCard(card)

    await screen.findByTestId('flip-card-mind-map-panel')
    fireEvent.click(screen.getByTestId('freestyle-rating-button-3'))

    await waitFor(() => expect(apiMocks.rateFreestyleRoundUnitApi).toHaveBeenCalledTimes(2))
    // Nothing was given up on: no 未保存 line, no diagnostic, the tap stays lit.
    expect(onSaveFailed).not.toHaveBeenCalled()
    expect(screen.getByTestId('freestyle-rating-button-3').getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByTestId('freestyle-rating-unsaved-line')).toBeNull()
    const operationIds = apiMocks.rateFreestyleRoundUnitApi.mock.calls.map(
      (call) => (call[1] as { operation_id: string }).operation_id,
    )
    expect(operationIds[1]).toBe(operationIds[0])

    await waitFor(() => expect(onBranchComplete).toHaveBeenCalledWith(card.id, {
      restudy: false, rating: 3, retryAfterCards: 0,
    }))
    expect(screen.getByTestId('freestyle-rating-button-3').getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByTestId('freestyle-rating-saving-line')).toBeNull()
  })

  it('lights the newest grade at once and posts it after the first reply', async () => {
    const card = buildCard('unit-queued-rate')
    const session = buildSession(card.unit_id!)
    apiMocks.startFreestyleUnitReviewSessionApi.mockResolvedValue(session)
    const pending: Array<() => void> = []
    apiMocks.rateReviewUnitApi.mockImplementation(
      (_sessionId, _unit, _encounterId, rating, operationId) =>
        new Promise((resolve) => {
          pending.push(() => resolve(ratingResult(session, rating, operationId)))
        }),
    )
    renderCard(card)

    await screen.findByTestId('flip-card-mind-map-panel')
    fireEvent.click(screen.getByTestId('freestyle-rating-button-3'))
    expect(screen.getByTestId('freestyle-rating-button-3').getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByTestId('freestyle-rating-button-4'))
    expect(screen.getByTestId('freestyle-rating-button-4').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('freestyle-rating-button-3').getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByTestId('freestyle-rating-button-4').hasAttribute('disabled')).toBe(false)
    expect(apiMocks.rateReviewUnitApi).toHaveBeenCalledTimes(1)

    await act(async () => {
      pending.shift()?.()
    })
    await waitFor(() => expect(apiMocks.rateReviewUnitApi).toHaveBeenCalledTimes(2))
    await act(async () => {
      pending.shift()?.()
    })
    expect(screen.getByText('已选轻松 · 首学 → 3天 · 7月30日')).toBeTruthy()
  })

  it('keeps an earlier acknowledged grade when the newer selected grade fails', async () => {
    const card = buildCard('unit-superseded-save')
    const session = buildSession(card.unit_id!)
    apiMocks.startFreestyleUnitReviewSessionApi.mockResolvedValue(session)
    const pending: Array<{ resolve: () => void; reject: () => void }> = []
    apiMocks.rateReviewUnitApi.mockImplementation(
      (_sessionId, _unit, _encounterId, rating, operationId) =>
        new Promise((resolve, reject) => {
          pending.push({
            resolve: () => resolve(ratingResult(session, rating, operationId)),
            reject: () => reject(new Error('newer save failed')),
          })
        }),
    )
    const onRatingSettled = vi.fn()
    const { onBranchComplete, onEncounterChange, onSaveFailed } = renderCard(card, { onRatingSettled })
    await screen.findByTestId('flip-card-mind-map-panel')
    fireEvent.click(screen.getByTestId('freestyle-rating-button-3'))
    fireEvent.click(screen.getByTestId('freestyle-rating-button-4'))
    expect(onBranchComplete).not.toHaveBeenCalled()
    await act(async () => pending[0].resolve())
    await waitFor(() => expect(pending).toHaveLength(2))
    expect(onBranchComplete).toHaveBeenLastCalledWith(card.id, {
      restudy: false, rating: 3, retryAfterCards: 0,
    })
    expect(onEncounterChange).toHaveBeenLastCalledWith(card.id, expect.objectContaining({
      selectedRating: 3,
    }))
    expect(onRatingSettled).not.toHaveBeenCalled()
    // The newer 轻松 is still saving, so it is the lit grade; the acknowledged 记得 is not.
    expect(screen.getByTestId('freestyle-rating-button-4').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('freestyle-rating-button-3').getAttribute('aria-pressed')).toBe('false')
    await act(async () => pending[1].reject())
    await waitFor(() => expect(onSaveFailed).toHaveBeenCalled())
    expect(onBranchComplete).toHaveBeenLastCalledWith(card.id, {
      restudy: false, rating: 3, retryAfterCards: 0,
    })
    expect(onRatingSettled).not.toHaveBeenCalled()
    expect(screen.getByTestId('freestyle-rating-button-4').getAttribute('aria-pressed')).toBe('false')
    // The acknowledged 记得 stays lit; only the newer 轻松 is 未保存.
    expect(screen.getByTestId('freestyle-rating-button-3').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('freestyle-rating-unsaved-line').textContent).toContain('未保存轻松')

    fireEvent.click(screen.getByTestId('freestyle-rating-button-4'))
    await waitFor(() => expect(pending).toHaveLength(3))
    await act(async () => pending[2].resolve())
    expect(onRatingSettled).toHaveBeenCalledWith(card.id, true, 4, expect.anything())
    expect(onBranchComplete).toHaveBeenLastCalledWith(card.id, {
      restudy: false, rating: 4, retryAfterCards: 0,
    })
  })

  it('never claims progress for a failed post and shows 未保存 instead of a chosen grade', async () => {
    const card = buildCard('unit-rate-rollback')
    const session = buildSession(card.unit_id!)
    apiMocks.startFreestyleUnitReviewSessionApi.mockResolvedValue(session)
    apiMocks.rateReviewUnitApi.mockRejectedValue(new Error('network down'))
    const { onBranchComplete, onSaveFailed } = renderCard(card)

    await screen.findByTestId('flip-card-mind-map-panel')
    fireEvent.click(screen.getByTestId('freestyle-rating-button-3'))
    expect(onBranchComplete).not.toHaveBeenCalled()

    await waitFor(() => expect(onSaveFailed).toHaveBeenCalled())
    expect(onBranchComplete).not.toHaveBeenCalled()
    expect(screen.getByTestId('freestyle-rating-button-3').getAttribute('aria-pressed')).toBe('false')
    expect(screen.queryByTestId('freestyle-rating-effect-line')).toBeNull()
    expect(screen.getByTestId('freestyle-rating-unsaved-line').textContent).toContain('未保存记得')
    expect(screen.queryByText(/network down/)).toBeNull()
    expect(apiMocks.rateReviewUnitApi).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(/网络请求失败/)).toBeNull()
  })

  it('keeps saving after the card unmounts and reports the acknowledgement to the ledger', async () => {
    const card = buildCard('unit-rate-unmount')
    const session = buildSession(card.unit_id!)
    apiMocks.startFreestyleUnitReviewSessionApi.mockResolvedValue(session)
    let resolveRate: (() => void) | null = null
    apiMocks.rateReviewUnitApi.mockImplementation(
      (_sessionId, _unit, _encounterId, rating, operationId) =>
        new Promise((resolve) => {
          resolveRate = () => resolve(ratingResult(session, rating, operationId))
        }),
    )
    const onEncounterChange = vi.fn()
    const onBranchComplete = vi.fn()
    function Ledger() {
      useRatingSaveLedger({
        roundId: 'round-1',
        previousEncounter: () => undefined,
        adoptRound: () => undefined,
        encounterChange: onEncounterChange,
        branchComplete: onBranchComplete,
      })
      return null
    }
    render(<Ledger />)
    const view = renderCard(card)
    await screen.findByTestId('flip-card-mind-map-panel')
    fireEvent.click(screen.getByTestId('freestyle-rating-button-3'))
    view.unmount()
    await act(async () => {
      resolveRate?.()
    })
    expect(onBranchComplete).toHaveBeenCalledWith(card.id, {
      restudy: false, rating: 3, retryAfterCards: 0,
    })
    // Leave-close still locks the rated glance instead of cancelling it as unrated.
    await waitFor(() => expect(apiMocks.closeUnitReviewEncounterApi).toHaveBeenCalledTimes(1))
    expect(apiMocks.cancelUnratedUnitReviewEncounterApi).not.toHaveBeenCalled()
  })

  it('does not close the encounter until the in-flight rate resolves', async () => {
    const card = buildCard('unit-rate-hold-close')
    const session = buildSession(card.unit_id!)
    apiMocks.startFreestyleUnitReviewSessionApi.mockResolvedValue(session)
    let resolveRate: ((value: unknown) => void) | null = null
    apiMocks.rateReviewUnitApi.mockImplementation(
      (_sessionId, _unit, _encounterId, rating, operationId) =>
        new Promise((resolve) => {
          resolveRate = () => resolve(ratingResult(session, rating, operationId))
        }),
    )
    const view = renderCard(card)

    await screen.findByTestId('flip-card-mind-map-panel')
    fireEvent.click(screen.getByTestId('freestyle-rating-button-2'))
    view.rerenderCard({ active: false })
    await act(async () => {
      await Promise.resolve()
    })
    expect(apiMocks.closeUnitReviewEncounterApi).not.toHaveBeenCalled()
    expect(apiMocks.cancelUnratedUnitReviewEncounterApi).not.toHaveBeenCalled()

    await act(async () => {
      resolveRate?.(null)
    })
    await waitFor(() => expect(apiMocks.closeUnitReviewEncounterApi).toHaveBeenCalledTimes(1))
    expect(apiMocks.cancelUnratedUnitReviewEncounterApi).not.toHaveBeenCalled()
  })

  /**
   * Rate confirmation lives at the card's own edge, not at screen center.
   *
   * The earlier attempt dispatched a global `save_success`, which GlobalFeedbackProvider
   * draws at its default point — the middle of the map the learner is reading — and
   * which is gated only by the global sound/animation switches, so it still fired under
   * the 专注 preset whose whole purpose is silent learning.
   */
  it('confirms a settled rate at the card edge, not with a screen-center burst', async () => {
    const card = buildCard('unit-rate-feedback')
    const session = buildSession(card.unit_id!)
    apiMocks.startFreestyleUnitReviewSessionApi.mockResolvedValue(session)
    apiMocks.rateReviewUnitApi.mockImplementation(
      (_sessionId, _unit, _encounterId, rating, operationId) =>
        Promise.resolve(ratingResult(session, rating, operationId)),
    )
    const events: string[] = []
    const listener = (event: Event) => {
      events.push((event as CustomEvent<{ event: string }>).detail.event)
    }
    window.addEventListener('memory-anki-global-feedback-request', listener)

    try {
      renderCard(card)
      await screen.findByTestId('flip-card-mind-map-panel')
      fireEvent.click(screen.getByRole('button', { name: /记得：首学 → 1天 · 7月28日/ }))
      await waitFor(() => expect(apiMocks.rateReviewUnitApi).toHaveBeenCalledTimes(1))

      const breath = await screen.findByTestId('freestyle-flow-breath')
      expect(breath.getAttribute('data-breath')).toBe('affirm')
      expect(events).toEqual([])
    } finally {
      window.removeEventListener('memory-anki-global-feedback-request', listener)
    }
  })

  it('marks a weak rate as a neutral note, never a failure alarm', async () => {
    const card = buildCard('unit-rate-weak-feedback')
    const session = buildSession(card.unit_id!)
    apiMocks.startFreestyleUnitReviewSessionApi.mockResolvedValue(session)
    apiMocks.rateReviewUnitApi.mockImplementation(
      (_sessionId, _unit, _encounterId, rating, operationId) =>
        Promise.resolve(ratingResult(session, rating, operationId)),
    )

    renderCard(card)
    await screen.findByTestId('flip-card-mind-map-panel')
    fireEvent.click(screen.getByRole('button', { name: /忘记/ }))
    await waitFor(() => expect(apiMocks.rateReviewUnitApi).toHaveBeenCalledTimes(1))

    const breath = await screen.findByTestId('freestyle-flow-breath')
    expect(breath.getAttribute('data-breath')).toBe('note')
  })

  it('reports the rating up so the challenge–skill channel can read it', async () => {
    const card = buildCard('unit-rate-channel')
    const session = buildSession(card.unit_id!)
    apiMocks.startFreestyleUnitReviewSessionApi.mockResolvedValue(session)
    apiMocks.rateReviewUnitApi.mockImplementation(
      (_sessionId, _unit, _encounterId, rating, operationId) =>
        Promise.resolve(ratingResult(session, rating, operationId)),
    )
    const onRatingSettled = vi.fn()

    renderCard(card, { onRatingSettled })
    await screen.findByTestId('flip-card-mind-map-panel')
    fireEvent.click(screen.getByRole('button', { name: /记得：首学 → 1天 · 7月28日/ }))

    await waitFor(() => expect(onRatingSettled).toHaveBeenCalledWith(
      card.id,
      true,
      3,
      expect.objectContaining({
        occurrenceId: card.id,
        encounterId: 'encounter-1',
      }),
    ))
  })

  it('rates with the server-owned encounter round when the queue round is stale', async () => {
    const card = buildCard('unit-server-round')
    const session = buildSession(card.unit_id!, 3, buildEncounter({ round_id: 'round-server' }))
    apiMocks.startFreestyleUnitReviewSessionApi.mockResolvedValue(session)
    apiMocks.rateReviewUnitApi.mockImplementation(
      (_sessionId, _unit, _encounterId, rating, operationId, roundId) => {
        expect(roundId).toBe('round-server')
        return Promise.resolve(ratingResult(session, rating, operationId))
      },
    )
    renderCard(card, { roundId: 'round-stale' })

    await screen.findByTestId('flip-card-mind-map-panel')
    fireEvent.click(screen.getByRole('button', { name: /记得：首学 → 1天 · 7月28日/ }))

    await waitFor(() => expect(apiMocks.rateReviewUnitApi).toHaveBeenCalledTimes(1))
  })

  it('closes and locks the selected rating only after leaving the card', async () => {
    const card = buildCard('unit-close')
    const session = buildSession(card.unit_id!)
    apiMocks.startFreestyleUnitReviewSessionApi.mockResolvedValue(session)
    apiMocks.rateReviewUnitApi.mockImplementation(
      (_sessionId, _unit, _encounterId, rating, operationId) =>
        Promise.resolve(ratingResult(session, rating, operationId)),
    )
    apiMocks.closeUnitReviewEncounterApi.mockResolvedValue({
      operation_id: 'close-1',
      encounter: buildEncounter({
        status: 'closed',
        selected_rating: 2,
        passed: false,
        retry_after_cards: 3,
        effective_operation_id: 'rating-hard',
      }),
      passed: false,
      retry_after_cards: 3,
      session_status: 'active',
      completion: null,
    })
    const view = renderCard(card)

    await screen.findByTestId('flip-card-mind-map-panel')
    fireEvent.click(screen.getByRole('button', { name: /困难：首学 → 今天 · 10 分钟后重练/ }))
    await waitFor(() => expect(apiMocks.rateReviewUnitApi).toHaveBeenCalledTimes(1))
    expect(apiMocks.closeUnitReviewEncounterApi).not.toHaveBeenCalled()
    expect(view.onRoundSync).toHaveBeenCalledWith(expect.objectContaining({ plan_version: 1 }))

    // A new queue round may be selected while the old encounter is still open.
    // Closing must retain the encounter's server-owned round identity.
    view.rerenderCard({ active: false, roundId: 'round-2' })
    await waitFor(() => expect(apiMocks.closeUnitReviewEncounterApi).toHaveBeenCalledWith(
      session.id,
      card.unit_id,
      'encounter-1',
      expect.any(String),
      'round-1',
    ))
  })

  it('loads a closed historical encounter without creating a new session', async () => {
    const card = buildCard('unit-history')
    const closedEncounter = buildEncounter({
      status: 'closed',
      selected_rating: 3,
      passed: true,
      effective_operation_id: 'rating-history',
    })
    const historical = queueEncounter({
      status: 'closed',
      sessionId: `session:${card.unit_id}`,
      selectedRating: 3,
      passed: true,
    })
    apiMocks.getUnitReviewSessionApi.mockResolvedValue(buildSession(card.unit_id!, 3, closedEncounter))
    renderCard(card, { readOnly: true, encounter: historical })

    await screen.findByText(/已选记得/)
    expect(apiMocks.getUnitReviewSessionApi).toHaveBeenCalledWith(`session:${card.unit_id}`, historical.encounterId)
    expect(apiMocks.startFreestyleUnitReviewSessionApi).not.toHaveBeenCalled()
    expect(
      (screen.getByRole('button', { name: /记得：首学 → 1天 · 7月28日/ }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('locks an earlier score after a later real attempt, even when not in history mode', async () => {
    const card = buildCard('unit-superseded')
    const historical = queueEncounter({ status: 'closed', sessionId: `session:${card.unit_id}` })
    apiMocks.getUnitReviewSessionApi.mockResolvedValue(buildSession(card.unit_id!, 3, buildEncounter({
      status: 'closed', selected_rating: 2, rating_editable: false,
      effective_operation_id: 'old-hard',
    })))
    renderCard(card, { readOnly: false, encounter: historical })
    await screen.findByText('已有后续练习，这次评分仅供回看；请到最近一次练习修改。')
    expect((screen.getByRole('button', { name: /记得：首学 → 1天 · 7月28日/ }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: /记得：首学 → 1天 · 7月28日/ }))
    expect(apiMocks.rateReviewUnitApi).not.toHaveBeenCalled()
    expect(apiMocks.undoReviewUnitRatingApi).not.toHaveBeenCalled()
  })

  it('starts a new session when returning to a passed unit to re-score', async () => {
    const card = buildCard('unit-rerate')
    const renewed = queueEncounter({
      encounterId: 'encounter-amend',
      status: 'pending',
      selectedRating: 3,
      passed: true,
    })
    apiMocks.startFreestyleUnitReviewSessionApi.mockResolvedValue(buildSession(card.unit_id!))
    renderCard(card, { readOnly: false, encounter: renewed })

    await waitFor(() => expect(apiMocks.startFreestyleUnitReviewSessionApi).toHaveBeenCalledWith(
      { id: card.unit_id, revision: card.unit_revision },
      'round-1',
      'encounter-amend',
      { allowNotDue: true, cardId: card.id, occurrenceId: '', retryAttempt: 0 },
    ))
    expect(apiMocks.getUnitReviewSessionApi).not.toHaveBeenCalled()
    await screen.findByTestId('flip-card-mind-map-panel')
    expect(
      (screen.getByRole('button', { name: /轻松：首学 → 3天 · 7月30日/ }) as HTMLButtonElement).disabled,
    ).toBe(false)
  })

  it('keeps the last this-round rating visible after an empty amend glance starts', async () => {
    const card = buildCard('unit-amend-display')
    apiMocks.startFreestyleUnitReviewSessionApi.mockResolvedValue(buildSession(card.unit_id!))
    const view = renderCard(card, {
      encounter: queueEncounter({
        encounterId: 'encounter-amend',
        status: 'pending',
        selectedRating: 3,
        passed: true,
      }),
      lastRating: 3,
    })

    await waitFor(() => expect(apiMocks.startFreestyleUnitReviewSessionApi).toHaveBeenCalled())
    await screen.findByTestId('flip-card-mind-map-panel')
    view.rerenderCard({
      encounter: queueEncounter({
        encounterId: 'encounter-amend',
        status: 'open',
        sessionId: `session:${card.unit_id}`,
        selectedRating: null,
        passed: null,
      }),
      lastRating: 3,
    })

    await screen.findByText(/已选记得/)
    expect(screen.getByText('上次评分')).toBeTruthy()
    // No silent drop: confirming the last score saves it on this glance.
    fireEvent.click(screen.getByRole('button', { name: /记得：首学 → 1天 · 7月28日/ }))
    expect(apiMocks.undoReviewUnitRatingApi).not.toHaveBeenCalled()
    await waitFor(() => expect(apiMocks.rateReviewUnitApi).toHaveBeenCalledTimes(1))
    expect(apiMocks.rateReviewUnitApi.mock.calls[0][3]).toBe(3)
  })

  it('adopts a live unit revision instead of dropping when the session succeeds', async () => {
    const card = buildCard('unit-stale', 3)
    apiMocks.startFreestyleUnitReviewSessionApi.mockResolvedValue(buildSession(card.unit_id!, 4))
    const { onStaleDrop, onSaveFailed, onEncounterChange, onRevisionAdopted } = renderCard(card)

    await screen.findByTestId('flip-card-mind-map-panel')
    expect(onStaleDrop).not.toHaveBeenCalled()
    expect(onSaveFailed).not.toHaveBeenCalled()
    expect(onRevisionAdopted).toHaveBeenCalledWith(card.id, card.unit_id, 4)
    expect(onEncounterChange).toHaveBeenCalledWith(
      card.id,
      expect.objectContaining({ unitRevision: 4 }),
    )
  })

  it('renders a successful session whose encounter is not open instead of auto-dropping', async () => {
    const card = buildCard('unit-closed-glance')
    const closed = buildEncounter({ status: 'closed', selected_rating: 3, passed: true })
    apiMocks.startFreestyleUnitReviewSessionApi.mockResolvedValue(
      buildSession(card.unit_id!, 3, closed),
    )
    const { onStaleDrop } = renderCard(card)

    await screen.findByTestId('flip-card-mind-map-panel')
    expect(onStaleDrop).not.toHaveBeenCalled()
  })

  it('drops when the session payload has no matching unit', async () => {
    const card = buildCard('unit-missing')
    // A different anchor: a same-anchor unit would be the successor, not a miss.
    const session = buildSession('other-unit', 3)
    session.units[0].anchor_uid = 'other-anchor'
    apiMocks.startFreestyleUnitReviewSessionApi.mockResolvedValue(session)
    const { onStaleDrop, onSaveFailed } = renderCard(card)

    await waitFor(() => expect(onStaleDrop).toHaveBeenCalledWith(card.id))
    expect(onSaveFailed).not.toHaveBeenCalled()
  })

  it('shows recovery actions instead of an endless loading state for a non-stale load failure', async () => {
    const card = buildCard('unit-load-failure')
    apiMocks.startFreestyleUnitReviewSessionApi.mockRejectedValue(new Error('temporary API failure'))
    const onOpenScopeQuiz = vi.fn()
    const { onSaveFailed, onStaleDrop, onRebuildRound } = renderCard(card, { onOpenScopeQuiz })

    await screen.findByText('这张图还在打开')
    expect((screen.getByTestId('freestyle-rating-button-3') as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(screen.getByTestId('freestyle-quiz-while-opening'))
    expect(onOpenScopeQuiz).toHaveBeenCalled()
    expect(onSaveFailed).not.toHaveBeenCalled()
    expect(screen.queryByText(/temporary API failure/)).toBeNull()
    expect(screen.getByRole('button', { name: '重试' })).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '跳过这张' }))
    expect(onStaleDrop).toHaveBeenCalledWith(card.id)
    fireEvent.click(screen.getByRole('button', { name: '重建本轮' }))
    expect(onRebuildRound).toHaveBeenCalled()
  })

  it('force-drops a deleted palace instead of redrawing the dead wall', async () => {
    const card = buildCard('unit-deleted-palace')
    apiMocks.startFreestyleUnitReviewSessionApi.mockRejectedValue({
      status: 400,
      message: 'palace not found: 145',
    })
    const { onStaleDrop, onSaveFailed } = renderCard(card)

    await waitFor(() => expect(onStaleDrop).toHaveBeenCalledWith(card.id, { force: true }))
    expect(onSaveFailed).not.toHaveBeenCalled()
    expect(screen.queryByText('这张卡暂时打不开')).toBeNull()
    expect(screen.getByText('正在更新复习安排...')).toBeTruthy()
  })

  it('drops silently when encounter_id belongs to another review unit', async () => {
    const card = buildCard('unit-wrong-encounter')
    apiMocks.startFreestyleUnitReviewSessionApi.mockRejectedValue({
      status: 400,
      message: 'encounter_id belongs to another review unit',
    })
    const { onStaleDrop, onSaveFailed } = renderCard(card)

    await waitFor(() => expect(onStaleDrop).toHaveBeenCalledWith(card.id))
    expect(onSaveFailed).not.toHaveBeenCalled()
    expect(screen.queryByTestId('flip-card-mind-map-panel')).toBeNull()
    // The parent rebuild removes the stale card; until then, distinguish recovery
    // from a normal session load so the UI does not look stuck.
    expect(screen.getByText('正在更新复习安排...')).toBeTruthy()
    expect(onStaleDrop).toHaveBeenCalledTimes(1)
  })

  it('shows a retryable load error when an active session is required', async () => {
    const card = buildCard('unit-session-required')
    apiMocks.startFreestyleUnitReviewSessionApi.mockRejectedValue({
      status: 409,
      message: 'Active unit review session required',
    })
    const { onStaleDrop, onSaveFailed } = renderCard(card)

    expect(await screen.findByRole('button', { name: '重试' })).toBeTruthy()
    expect(await screen.findByText('复习图还没打开')).toBeTruthy()
    expect((screen.getByTestId('freestyle-rating-button-3') as HTMLButtonElement).disabled).toBe(false)
    expect(onStaleDrop).not.toHaveBeenCalled()
    expect(onSaveFailed).not.toHaveBeenCalled()
  })

  it('offers choices instead of a blocking banner when a passed unit cannot start', async () => {
    const card = buildCard('unit-passed-start')
    apiMocks.startFreestyleUnitReviewSessionApi.mockRejectedValue({
      status: 400,
      message: 'passed review unit cannot start another encounter',
    })
    const { onSaveFailed, onStaleDrop } = renderCard(card)

    expect(await screen.findByText('这张已经评过')).toBeTruthy()
    expect(onSaveFailed).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '只看不评' }))
    expect(await screen.findByText('这张已经评过，当前只看不评')).toBeTruthy()
    expect(screen.getByRole('button', { name: '改评分' })).toBeTruthy()
    expect(onStaleDrop).not.toHaveBeenCalled()
  })

  it('saves a mirrored last score on this glance instead of swallowing the tap', async () => {
    const card = buildCard('unit-mirrored-rating')
    const session = buildSession(card.unit_id!)
    apiMocks.startFreestyleUnitReviewSessionApi.mockResolvedValue(session)
    const { onSaveFailed } = renderCard(card, {
      ratingScope: 'palace',
      encounter: queueEncounter({
        status: 'open',
        sessionId: session.id,
        selectedRating: 3,
        passed: true,
      }),
      palaceTarget: {
        palaceId: card.palace_id,
        dueCount: 1,
        excludeUnitIds: [],
        includeUnitIds: [card.unit_id],
        settleCards: [{ cardId: card.id, unitId: card.unit_id }],
      },
    })
    await screen.findByTestId('flip-card-mind-map-panel')
    fireEvent.click(screen.getByTestId('freestyle-rating-button-3'))
    await waitFor(() => expect(apiMocks.rateFreestyleRoundUnitApi).toHaveBeenCalledTimes(1))
    expect(apiMocks.rateFreestyleRoundUnitApi.mock.calls[0][1].palace_batch).toBeUndefined()
    expect(apiMocks.ratePalaceDueUnitsApi).not.toHaveBeenCalled()
    expect(apiMocks.undoReviewUnitRatingApi).not.toHaveBeenCalled()
    expect(onSaveFailed).not.toHaveBeenCalled()
  })

  it('clears a mirrored selected rating through undo instead of posting again', async () => {
    const card = buildCard('unit-mirrored-clear')
    const session = buildSession(
      card.unit_id!,
      3,
      buildEncounter({
        selected_rating: 3,
        passed: true,
        effective_operation_id: 'mirrored-rate',
      }),
    )
    apiMocks.startFreestyleUnitReviewSessionApi.mockResolvedValue(session)
    apiMocks.undoReviewUnitRatingApi.mockResolvedValue(undoResult(session))
    const { onBranchComplete, onSaveFailed } = renderCard(card, {
      encounter: queueEncounter({
        status: 'open',
        sessionId: session.id,
        selectedRating: 3,
        passed: true,
      }),
    })
    await screen.findByTestId('flip-card-mind-map-panel')
    fireEvent.click(screen.getByTestId('freestyle-rating-button-3'))
    await waitFor(() => expect(apiMocks.undoReviewUnitRatingApi).toHaveBeenCalledWith(
      'mirrored-rate',
      'round-1',
    ))
    expect(apiMocks.rateReviewUnitApi).not.toHaveBeenCalled()
    expect(onSaveFailed).not.toHaveBeenCalled()
    expect(onBranchComplete).toHaveBeenCalledWith(card.id, { cleared: true })
  })

  it('adopts a conflict reply and re-sends the same operation once against the new version', async () => {
    const card = buildCard('unit-stale-palace')
    const session = buildSession(card.unit_id!)
    const unitResult = ratingResult(session, 2, 'overwrite')
    apiMocks.startFreestyleUnitReviewSessionApi.mockResolvedValue(session)
    apiMocks.rateFreestyleRoundUnitApi
      .mockResolvedValueOnce({ item: null, round: { conflict: true, version: 4, plan_version: 4 } })
      .mockResolvedValueOnce({
        item: unitResult,
        round: { conflict: false, version: 5, plan_version: 5 },
      })
    const { onSaveFailed, onBranchComplete, onRoundSync } = renderCard(card)
    await screen.findByTestId('flip-card-mind-map-panel')
    fireEvent.click(screen.getByTestId('freestyle-rating-button-2'))
    await waitFor(() => expect(onBranchComplete).toHaveBeenCalledWith(card.id, {
      restudy: true,
      rating: 2,
      retryAfterCards: 3,
    }))
    expect(onSaveFailed).not.toHaveBeenCalled()
    expect(apiMocks.rateFreestyleRoundUnitApi).toHaveBeenCalledTimes(2)
    const calls = apiMocks.rateFreestyleRoundUnitApi.mock.calls.map(
      (call) => call[1] as { operation_id: string; expected_version: number },
    )
    expect(calls[1].operation_id).toBe(calls[0].operation_id)
    expect(calls[1].expected_version).toBe(4)
    expect(onRoundSync).toHaveBeenCalledWith(expect.objectContaining({ conflict: true, plan_version: 4 }))
  })

  it('treats a replayed operation (item: null with a round) as saved', async () => {
    const card = buildCard('unit-replayed')
    const session = buildSession(card.unit_id!)
    apiMocks.startFreestyleUnitReviewSessionApi.mockResolvedValue(session)
    apiMocks.rateFreestyleRoundUnitApi.mockResolvedValueOnce({
      item: null,
      round: { conflict: false, duplicate: true, version: 6, plan_version: 6 },
    })
    const { onSaveFailed, onBranchComplete } = renderCard(card)
    await screen.findByTestId('flip-card-mind-map-panel')
    fireEvent.click(screen.getByTestId('freestyle-rating-button-3'))
    await waitFor(() => {
      expect(screen.getByTestId('freestyle-rating-button-3').getAttribute('aria-pressed')).toBe('true')
    })
    expect(onSaveFailed).not.toHaveBeenCalled()
    expect(onBranchComplete).toHaveBeenCalledWith(card.id, expect.objectContaining({ restudy: false, rating: 3 }))
  })
})

describe('进入编辑 while the glance is still opening', () => {
  it('queues the edit tap and enters edit once the live glance arrives', async () => {
    const card = buildCard('unit-edit-pending')
    // Preview only: the unit has no open encounter yet, so the flip panel is not live.
    previewCacheMocks.useUnitPreview.mockReturnValue(buildSession(card.unit_id!, 3, null as never))
    let resolveSession!: (value: UnitReviewSessionDto) => void
    apiMocks.startFreestyleUnitReviewSessionApi.mockReturnValue(
      new Promise<UnitReviewSessionDto>((resolve) => { resolveSession = resolve }),
    )
    renderCard(card)

    await screen.findByTestId('flip-card-mind-map-panel')
    const editAction = () => (capturedPanelProps?.toolbarExtensions as {
      moreActions?: Array<{ label: string; onClick: () => void }>
    }).moreActions?.find((item) => item.label === '进入编辑')
    act(() => editAction()!.onClick())

    resolveSession(buildSession(card.unit_id!))
    await waitFor(() => expect(capturedPanelProps?.displayMode).toBe('edit'))
  })
})

describe('睡前复习 card', () => {
  beforeEach(() => {
    capturedPanelProps = null
    Object.values(apiMocks).forEach((mock) => mock.mockReset())
    resetFreestyleSessionLaneForTests()
    resetFreestyleRatingSavesForTests()
    previewCacheMocks.useUnitPreview.mockReset()
    previewCacheMocks.useSharedPalacePreview.mockReset()
    previewCacheMocks.useSharedPalacePreview.mockReturnValue(null)
    previewCacheMocks.rememberUnitPreview.mockReset()
    apiMocks.cancelUnratedUnitReviewEncounterApi.mockResolvedValue({ abandoned: false })
  })

  it('renders a whole-palace pass from the read-only preview and records one grade', async () => {
    const card: FreestyleReviewUnitCard = {
      ...buildCard('unit-bedtime'),
      bedtime: true,
      palace_pass: true,
      node_uids: ['unit-node', 'unit-child', 'other-unit', 'other-child'],
      node_count: 4,
    }
    previewCacheMocks.useUnitPreview.mockReturnValue(buildSession('unit-bedtime'))
    const onBedtimeRate = vi.fn().mockResolvedValue(undefined)

    renderCard(card, { onBedtimeRate, lastRating: 3 })

    expect(await screen.findByTestId('freestyle-bedtime-rating-bar')).toBeTruthy()
    expect(screen.getByTestId('freestyle-bedtime-note').textContent).toContain('整座宫殿')
    expect(screen.getByTestId('freestyle-bedtime-note').textContent).toContain('不改动复习安排')
    expect(screen.getByTestId('freestyle-bedtime-rating-button-3').getAttribute('data-selected')).toBe('true')
    // The whole palace is the reveal scope, not the representative unit slice.
    expect(capturedPanelProps?.activeUnitNodeUids).toEqual([
      'unit-node',
      'unit-child',
      'other-unit',
      'other-child',
    ])
    // No Reviews glance: the card is already rated today.
    expect(apiMocks.startFreestyleUnitReviewSessionApi).not.toHaveBeenCalled()
    expect(apiMocks.getUnitReviewSessionApi).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('freestyle-bedtime-rating-button-2'))

    await waitFor(() => expect(onBedtimeRate).toHaveBeenCalledWith(card.id, 2))
    // It must never reach the normal rating path.
    expect(apiMocks.rateFreestyleRoundUnitApi).not.toHaveBeenCalled()
    expect(apiMocks.rateReviewUnitApi).not.toHaveBeenCalled()
  })

  it('keeps the map reveal-only: no edit action and no document write', async () => {
    const card: FreestyleReviewUnitCard = { ...buildCard('unit-bedtime-edit'), bedtime: true }
    previewCacheMocks.useUnitPreview.mockReturnValue(buildSession('unit-bedtime-edit'))

    renderCard(card, { onBedtimeRate: vi.fn().mockResolvedValue(undefined) })

    await screen.findByTestId('flip-card-mind-map-panel')
    const actions = (capturedPanelProps?.toolbarExtensions as {
      moreActions?: Array<{ label: string }>
    }).moreActions ?? []
    expect(actions.some((item) => item.label === '进入编辑')).toBe(false)
    expect(capturedPanelProps?.onPaneDoubleClick).toBeUndefined()
  })
})
