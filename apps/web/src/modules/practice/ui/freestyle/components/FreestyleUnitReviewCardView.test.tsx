import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MindMapSelection } from '@/modules/content/public'
import type {
  FreestyleUnitEncounterState,
  UnitRating,
  UnitRatingEffectDto,
  UnitReviewSessionDto,
} from '@/modules/practice/public'
import type { FreestyleReviewUnitCard } from '@/shared/api/contracts'
import {
  FreestyleUnitReviewCardView,
  ratingEffectLabel,
  retryPositionLabel,
} from './FreestyleUnitReviewCardView'

const apiMocks = vi.hoisted(() => ({
  closeUnitReviewEncounterApi: vi.fn(),
  getUnitReviewSessionApi: vi.fn(),
  startFreestyleUnitReviewSessionApi: vi.fn(),
  rateReviewUnitApi: vi.fn(),
  ratePalaceDueUnitsApi: vi.fn(),
  undoReviewUnitRatingApi: vi.fn(),
  cancelUnratedUnitReviewEncounterApi: vi.fn().mockResolvedValue({ abandoned: false }),
}))

const persistMocks = vi.hoisted(() => ({
  persistPalaceEditor: vi.fn(),
}))

const quizBindingMocks = vi.hoisted(() => ({
  getOpenQuestionIds: vi.fn((nodeUid: string) => (nodeUid === 'unit-node' ? [101, 102] : [])),
  getInitialQuestionIndex: vi.fn(() => 0),
  markQuestionCompleted: vi.fn(),
  updateQuestionState: vi.fn(),
  countBadgeByNodeUid: {
    'unit-node': { text: '2', tone: 'success' as const, title: '2/2 道未做关联题' },
    'unit-child': { text: '1', tone: 'success' as const, title: '1/1 道未做关联题' },
  },
  questionStates: {} as Record<number, unknown>,
}))

let capturedPanelProps: Record<string, unknown> | null = null
let capturedSavedState: unknown = null
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

vi.mock('@/modules/practice/ui/review/components/PalaceReviewUnitsPanel', () => ({
  PalaceReviewUnitsPanel: (props: { open: boolean; palaceId: number }) =>
    props.open ? (
      <div data-testid="palace-review-units-panel-mock">palace:{props.palaceId}</div>
    ) : null,
}))

vi.mock('@/modules/quiz/public', () => ({
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
    return <div data-testid="flip-card-mind-map-panel" />
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
    effective_seconds: null,
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
    onRatingSettled?: (cardId: string, passed: boolean, rating: number) => void
  } = {},
) {
  const callbacks = {
    onEnsureEncounter: vi.fn(() => options.encounter ?? queueEncounter()),
    onEncounterChange: vi.fn(),
    onBranchComplete: vi.fn(),
    onBatchCardsSettled: vi.fn(),
    onStaleDrop: vi.fn(),
    onSaveFailed: vi.fn(),
    onUnitsReconciled: vi.fn(),
    onRatingSettled: options.onRatingSettled ?? vi.fn(),
    onRatingScopeChange: vi.fn(),
  }
  const props = {
    card,
    active: options.active ?? true,
    readOnly: options.readOnly ?? false,
    roundId: options.roundId ?? 'round-1',
    encounter: options.encounter ?? queueEncounter(),
    retryAfterCards: 3,
    ratingScope: options.ratingScope,
    preferredZoom: options.preferredZoom,
    palaceTarget: options.palaceTarget,
    ...(options.onUserZoomChange ? { onUserZoomChange: options.onUserZoomChange } : {}),
    ...callbacks,
  }
  const renderResult = render(<FreestyleUnitReviewCardView {...props} />)
  return {
    ...callbacks,
    ...renderResult,
    rerenderCard: (next: Partial<typeof props>) => {
      renderResult.rerender(<FreestyleUnitReviewCardView {...props} {...next} />)
    },
  }
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
    capturedSavedState = null
    revealFrameCallbacks = []
    originalRequestAnimationFrame = window.requestAnimationFrame
    originalCancelAnimationFrame = window.cancelAnimationFrame
    window.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      revealFrameCallbacks.push(callback)
      return revealFrameCallbacks.length
    })
    window.cancelAnimationFrame = vi.fn()
    Object.values(apiMocks).forEach((mock) => mock.mockReset())
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
    persistMocks.persistPalaceEditor.mockReset()
    persistMocks.persistPalaceEditor.mockImplementation(async (_palaceId, state) => ({
      state,
      unitReconcile: null,
    }))
  })

  afterEach(() => {
    window.requestAnimationFrame = originalRequestAnimationFrame
    window.cancelAnimationFrame = originalCancelAnimationFrame
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

  it('keeps four disabled rating buttons visible while the session is loading', async () => {
    const card = buildCard('unit-loading-ratings')
    apiMocks.startFreestyleUnitReviewSessionApi.mockReturnValue(new Promise(() => undefined))
    renderCard(card)

    const bar = await screen.findByTestId('freestyle-rating-bar')
    expect(bar).toBeTruthy()
    for (const value of [1, 2, 3, 4]) {
      const button = screen.getByTestId(`freestyle-rating-button-${value}`) as HTMLButtonElement
      expect(button.disabled).toBe(true)
      expect(button.getAttribute('aria-label')).toContain('加载中')
    }
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
    expect(quizBindingMocks.getOpenQuestionIds).toHaveBeenCalledWith('unit-node')
    const dialog = await screen.findByTestId('node-bound-quiz-dialog')
    expect(dialog.textContent).toBe('unit-node:101,102')
  })

  it('exposes 进入编辑 in mind-map moreActions and toggles to 返回学习', async () => {
    const card = buildCard('unit-inline-edit')
    apiMocks.startFreestyleUnitReviewSessionApi.mockResolvedValue(buildSession(card.unit_id!))
    renderCard(card)

    await screen.findByTestId('flip-card-mind-map-panel')
    expect(capturedPanelProps?.displayMode).toBe('review')
    const moreActions = capturedPanelProps?.toolbarExtensions as {
      moreActions?: Array<{ label: string; onClick: () => void }>
    }
    const enter = moreActions?.moreActions?.find((item) => item.label === '进入编辑')
    expect(enter).toBeTruthy()
    expect(moreActions?.moreActions?.some((item) => item.label === '复习进度')).toBe(true)
    expect(moreActions?.moreActions?.some((item) => item.label === '复制导图')).toBe(true)
    expect(moreActions?.moreActions?.some((item) => item.label === '导出脑图')).toBe(true)

    act(() => enter!.onClick())

    await waitFor(() => {
      expect(capturedPanelProps?.displayMode).toBe('edit')
    })
    const editMore = capturedPanelProps?.toolbarExtensions as {
      moreActions?: Array<{ label: string; onClick: () => void }>
    }
    const labels = (editMore?.moreActions ?? []).map((item) => item.label)
    expect(labels).toContain('返回学习')
    expect(labels).toContain('永久标记')
    expect(labels).toContain('复习进度')
    expect(labels).toContain('复制导图')
    expect(labels).toContain('导出脑图')
    expect(screen.queryByRole('button', { name: /忘记/ })).toBeNull()

    const leave = editMore?.moreActions?.find((item) => item.label === '返回学习')
    act(() => leave!.onClick())
    await waitFor(() => {
      expect(capturedPanelProps?.displayMode).toBe('review')
    })
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

  it('saves permanent mark toggles as plain autosave and reconciles only after exiting mark mode', async () => {
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
      moreActions?: Array<{ label: string; onClick: () => void }>
    }
    act(() => editMore?.moreActions?.find((item) => item.label === '永久标记')!.onClick())
    const onEditNodeClick = capturedPanelProps?.onEditNodeClick as (
      nodes: MindMapSelection[],
    ) => void
    expect(typeof onEditNodeClick).toBe('function')

    vi.useFakeTimers()
    try {
      act(() => onEditNodeClick([selection('unit-node', '当前单元')]))
      act(() => onEditNodeClick([selection('other-unit', '其他单元')]))
      // Mid-pass toggles only debounce plain autosave — no reconcile yet.
      expect(persistMocks.persistPalaceEditor).not.toHaveBeenCalled()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2100)
      })
      expect(persistMocks.persistPalaceEditor).toHaveBeenCalledTimes(1)
      expect(persistMocks.persistPalaceEditor).toHaveBeenLastCalledWith(
        1,
        expect.objectContaining({ editor_doc: expect.any(Object) }),
        undefined,
      )
    } finally {
      vi.useRealTimers()
    }

    const markMore = capturedPanelProps?.toolbarExtensions as {
      moreActions?: Array<{ label: string; onClick: () => void }>
    }
    const exitMark = markMore?.moreActions?.find((item) => item.label.startsWith('退出永久标记'))
    expect(exitMark).toBeTruthy()
    act(() => exitMark!.onClick())

    await waitFor(() => {
      expect(persistMocks.persistPalaceEditor).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ editor_doc: expect.any(Object) }),
        expect.objectContaining({
          reconcileUnits: true,
          syncReason: 'mark_change',
        }),
      )
    })
  })

  it('flushes leave edit with return_to_review reconcile flags', async () => {
    const card = buildCard('unit-leave-reconcile')
    apiMocks.startFreestyleUnitReviewSessionApi.mockResolvedValue(buildSession(card.unit_id!))
    renderCard(card)

    await screen.findByTestId('flip-card-mind-map-panel')
    const moreActions = capturedPanelProps?.toolbarExtensions as {
      moreActions?: Array<{ label: string; onClick: () => void }>
    }
    act(() => moreActions?.moreActions?.find((item) => item.label === '进入编辑')!.onClick())
    await waitFor(() => expect(capturedPanelProps?.displayMode).toBe('edit'))

    const editMore = capturedPanelProps?.toolbarExtensions as {
      moreActions?: Array<{ label: string; onClick: () => void }>
    }
    act(() => editMore?.moreActions?.find((item) => item.label === '返回学习')!.onClick())

    await waitFor(() => {
      expect(persistMocks.persistPalaceEditor).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ editor_doc: expect.any(Object) }),
        expect.objectContaining({
          reconcileUnits: true,
          syncReason: 'return_to_review',
        }),
      )
    })
    await waitFor(() => expect(capturedPanelProps?.displayMode).toBe('review'))
  })

  it('returns to review immediately while the return save runs in the background', async () => {
    const card = buildCard('unit-optimistic-return')
    apiMocks.startFreestyleUnitReviewSessionApi.mockResolvedValue(buildSession(card.unit_id!))
    renderCard(card)

    await screen.findByTestId('flip-card-mind-map-panel')
    const moreActions = capturedPanelProps?.toolbarExtensions as {
      moreActions?: Array<{ label: string; onClick: () => void }>
    }
    act(() => moreActions?.moreActions?.find((item) => item.label === '进入编辑')!.onClick())
    await waitFor(() => expect(capturedPanelProps?.displayMode).toBe('edit'))

    let resolveSave!: (result: { state: unknown; unitReconcile: null }) => void
    const gate = new Promise<{ state: unknown; unitReconcile: null }>((res) => {
      resolveSave = res
    })
    persistMocks.persistPalaceEditor.mockImplementationOnce((_palaceId, state) => {
      capturedSavedState = state
      return gate
    })
    const editMore = capturedPanelProps?.toolbarExtensions as {
      moreActions?: Array<{ label: string; onClick: () => void }>
    }
    act(() => editMore?.moreActions?.find((item) => item.label === '返回学习')!.onClick())

    // Switches back to learning without waiting for the save to settle.
    await waitFor(() => expect(capturedPanelProps?.displayMode).toBe('review'))
    expect(screen.getByTestId('freestyle-return-saving')).toBeTruthy()

    await act(async () => {
      resolveSave({ state: capturedSavedState, unitReconcile: null })
    })
    await waitFor(() => expect(screen.queryByTestId('freestyle-return-saving')).toBeNull())
    // The card adopted the saved doc so review reflects the edited content.
    // The panel adopted the saved doc (editable state) after the flush settled.
    expect(capturedPanelProps?.editableEditorState).toBe(capturedSavedState)
  })

  it('returns to edit mode with local changes intact when the return save fails', async () => {
    const card = buildCard('unit-return-failure')
    apiMocks.startFreestyleUnitReviewSessionApi.mockResolvedValue(buildSession(card.unit_id!))
    const { onSaveFailed } = renderCard(card)

    await screen.findByTestId('flip-card-mind-map-panel')
    const moreActions = capturedPanelProps?.toolbarExtensions as {
      moreActions?: Array<{ label: string; onClick: () => void }>
    }
    act(() => moreActions?.moreActions?.find((item) => item.label === '进入编辑')!.onClick())
    await waitFor(() => expect(capturedPanelProps?.displayMode).toBe('edit'))

    persistMocks.persistPalaceEditor.mockRejectedValueOnce(new Error('保存宫殿失败'))
    const editMore = capturedPanelProps?.toolbarExtensions as {
      moreActions?: Array<{ label: string; onClick: () => void }>
    }
    act(() => editMore?.moreActions?.find((item) => item.label === '返回学习')!.onClick())

    // The optimistic review switch falls back to edit mode when the save fails.
    await waitFor(() => expect(capturedPanelProps?.displayMode).toBe('edit'))
    expect(onSaveFailed).toHaveBeenCalledWith('保存宫殿失败')
  })

  it('defers freestyle queue rebuild when re-entering edit before the return save settles', async () => {
    const card = buildCard('unit-deferred-rebuild')
    apiMocks.startFreestyleUnitReviewSessionApi.mockResolvedValue(buildSession(card.unit_id!))
    const { onUnitsReconciled } = renderCard(card)

    await screen.findByTestId('flip-card-mind-map-panel')
    const moreActions = capturedPanelProps?.toolbarExtensions as {
      moreActions?: Array<{ label: string; onClick: () => void }>
    }
    act(() => moreActions?.moreActions?.find((item) => item.label === '进入编辑')!.onClick())
    await waitFor(() => expect(capturedPanelProps?.displayMode).toBe('edit'))

    const reconcile = { changed: true, changes: [], undo_token: 'reconcile-1' }
    let resolveFirst!: (result: { state: unknown; unitReconcile: typeof reconcile }) => void
    const firstGate = new Promise<{ state: unknown; unitReconcile: typeof reconcile }>((res) => {
      resolveFirst = res
    })
    persistMocks.persistPalaceEditor.mockImplementationOnce((_palaceId, state) => {
      capturedSavedState = state
      return firstGate
    })
    const editMore = capturedPanelProps?.toolbarExtensions as {
      moreActions?: Array<{ label: string; onClick: () => void }>
    }
    act(() => editMore?.moreActions?.find((item) => item.label === '返回学习')!.onClick())
    await waitFor(() => expect(capturedPanelProps?.displayMode).toBe('review'))

    // Re-enter edit before the first return save settles.
    const reviewMore = capturedPanelProps?.toolbarExtensions as {
      moreActions?: Array<{ label: string; onClick: () => void }>
    }
    act(() => reviewMore?.moreActions?.find((item) => item.label === '进入编辑')!.onClick())
    await waitFor(() => expect(capturedPanelProps?.displayMode).toBe('edit'))

    await act(async () => {
      resolveFirst({ state: capturedSavedState, unitReconcile: reconcile })
    })
    // Reconcile finished while still editing: queue rebuild is deferred.
    expect(onUnitsReconciled).not.toHaveBeenCalled()

    // Leaving again runs the return flush and rebuilds the queue.
    let resolveSecond!: (result: { state: unknown; unitReconcile: typeof reconcile }) => void
    const secondGate = new Promise<{ state: unknown; unitReconcile: typeof reconcile }>((res) => {
      resolveSecond = res
    })
    persistMocks.persistPalaceEditor.mockImplementationOnce((_palaceId, _state) => secondGate)
    const editMoreAgain = capturedPanelProps?.toolbarExtensions as {
      moreActions?: Array<{ label: string; onClick: () => void }>
    }
    act(() => editMoreAgain?.moreActions?.find((item) => item.label === '返回学习')!.onClick())
    await waitFor(() => expect(capturedPanelProps?.displayMode).toBe('review'))
    await act(async () => {
      resolveSecond({ state: capturedSavedState, unitReconcile: reconcile })
    })
    await waitFor(() => expect(onUnitsReconciled).toHaveBeenCalled())
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

    vi.useFakeTimers()
    try {
      const onEditorStateChange = capturedPanelProps?.onEditorStateChange as (
        state: {
          editor_doc: unknown
          editor_config: object
          editor_local_config: object
          lang: string
        },
      ) => void
      const nextState = {
        editor_doc: palaceEditorDoc,
        editor_config: {},
        editor_local_config: {},
        lang: 'zh',
      }
      act(() => onEditorStateChange(nextState))
      await act(async () => {
        vi.advanceTimersByTime(2100)
        await Promise.resolve()
      })
      expect(persistMocks.persistPalaceEditor).toHaveBeenCalledWith(1, nextState, undefined)
    } finally {
      vi.useRealTimers()
    }
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
    flushRevealFrame()
    expect(
      (capturedPanelProps?.visibleEditorState as {
        editor_doc: {
          root: { children: Array<{ children: Array<{ data: { text: string } }> }> }
        }
      }).editor_doc.root.children[0]?.children[0]?.data.text,
    ).toBe('待回忆')
  })

  it('uses Shift to right-click the root and return the card to its root node', async () => {
    const card = buildCard('unit-shift-hide')
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

    const revealChild = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    })
    act(() => window.dispatchEvent(revealChild))
    flushRevealFrame()

    const hideTarget = new KeyboardEvent('keydown', {
      key: 'Shift',
      bubbles: true,
      cancelable: true,
    })
    act(() => window.dispatchEvent(hideTarget))
    expect(hideTarget.defaultPrevented).toBe(true)
    flushRevealFrame()
    expect(
      (capturedPanelProps?.visibleEditorState as {
        editor_doc: { root: { children: unknown[] } }
      }).editor_doc.root.children,
    ).toEqual([])
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

  it('starts a retry encounter from the root instead of the prior reveal state', async () => {
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
    view.rerenderCard({
      encounter: retryEncounter,
      onEnsureEncounter: vi.fn(() => retryEncounter),
    })
    await waitFor(() => expect(apiMocks.startFreestyleUnitReviewSessionApi).toHaveBeenCalledTimes(2))
    expect(
      (capturedPanelProps?.visibleEditorState as {
        editor_doc: { root: { children: unknown[] } }
      }).editor_doc.root.children,
    ).toHaveLength(0)
  })

  it('shows concrete effects for all retry queue sizes', () => {
    expect(retryPositionLabel(0)).toBe('立即重练')
    expect(retryPositionLabel(1)).toBe('1张后重练')
    expect(retryPositionLabel(2)).toBe('2张后重练')
    expect(retryPositionLabel(3)).toBe('3张后重练')
    expect(ratingEffectLabel(effects[0], 2)).toBe('2张后重练 · 重置到首学阶段')
    expect(ratingEffectLabel(effects[2], 3)).toBe('1天后复习 · 7月28日')
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
    expect(ratingEffectLabel(spread, 0)).toBe('362天后复习 · 7月25日')
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
    expect(ratingEffectLabel(legacy, 0)).toBe('1天后复习 · 7月28日')
  })

  it('says a lapsed mature unit drops to a stage instead of resetting', () => {
    // 忘记 on a unit that already passed keeps part of its ladder position, so the
    // verb comes from stage_action; only a true stage-0 landing reads as 重置.
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
    expect(ratingEffectLabel(lapsed, 3)).toBe('3张后重练 · 降至14天级')

    const heldAtLearning: UnitRatingEffectDto = { ...lapsed, target_stage_index: 0, target_interval_days: 0, stage_action: 'keep' }
    expect(ratingEffectLabel(heldAtLearning, 3)).toBe('3张后重练 · 保持首学阶段')
  })

  it('stays on the card, ignores the same rating, and atomically amends another rating', async () => {
    const card = buildCard('unit-amend')
    const session = buildSession(card.unit_id!)
    apiMocks.startFreestyleUnitReviewSessionApi.mockResolvedValue(session)
    apiMocks.rateReviewUnitApi.mockImplementation(
      (_sessionId, _unit, _encounterId, rating, operationId) =>
        Promise.resolve(ratingResult(session, rating, operationId)),
    )
    const { onBranchComplete } = renderCard(card)

    await screen.findByTestId('flip-card-mind-map-panel')
    const remembered = screen.getByRole('button', { name: /记得：1天后复习/ })
    fireEvent.click(remembered)
    await screen.findByText('已选记得 · 1天后复习 · 7月28日')
    fireEvent.click(remembered)
    expect(apiMocks.rateReviewUnitApi).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: /轻松：3天后复习/ }))
    await screen.findByText('已选轻松 · 3天后复习 · 7月30日')
    expect(apiMocks.rateReviewUnitApi).toHaveBeenCalledTimes(2)
    expect(onBranchComplete).toHaveBeenLastCalledWith(card.id, {
      restudy: false,
      rating: 4,
      retryAfterCards: 0,
    })
    expect(screen.getByTestId('flip-card-mind-map-panel')).not.toBeNull()
  })

  it('rates the palace due set through the batch command', async () => {
    const card = buildCard('unit-palace-rate')
    const session = buildSession(card.unit_id!)
    const unitResult = ratingResult(session, 3, 'batch-palace')
    apiMocks.startFreestyleUnitReviewSessionApi.mockResolvedValue(session)
    apiMocks.ratePalaceDueUnitsApi.mockResolvedValue({
      batch_id: 'batch-palace',
      palace_id: card.palace_id,
      rating: 3,
      items: [
        unitResult,
        { ...unitResult, operation_id: 'batch-palace:unit-b', unit: { ...unitResult.unit, id: 'unit-b' } },
      ],
      rated_unit_ids: [card.unit_id, 'unit-b'],
      remaining_due_count: 0,
      current: unitResult,
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
    await screen.findByText('已选记得 · 今日 2 个到期小节，各自按阶梯改期')
    expect(apiMocks.ratePalaceDueUnitsApi).toHaveBeenCalledTimes(1)
    expect(apiMocks.ratePalaceDueUnitsApi.mock.calls[0][1].includeUnitIds).toEqual([
      card.unit_id,
      'unit-b',
    ])
    expect(apiMocks.rateReviewUnitApi).not.toHaveBeenCalled()
    expect(onBranchComplete).not.toHaveBeenCalled()
    expect(onBatchCardsSettled).toHaveBeenCalledWith([
      { cardId: card.id, restudy: false, rating: 3, retryAfterCards: 0 },
      { cardId: 'card-b', restudy: false, rating: 3, retryAfterCards: 0 },
    ])
  })

  it('keeps failed sibling units in palace batch settlement for restudy', async () => {
    const card = buildCard('unit-palace-retry')
    const session = buildSession(card.unit_id!)
    const currentResult = ratingResult(session, 2, 'batch-palace-retry')
    const siblingResult = {
      ...ratingResult(session, 2, 'batch-palace-retry:unit-b'),
      operation_id: 'batch-palace-retry:unit-b',
      unit: { ...currentResult.unit, id: 'unit-b' },
    }
    apiMocks.startFreestyleUnitReviewSessionApi.mockResolvedValue(session)
    apiMocks.ratePalaceDueUnitsApi.mockResolvedValue({
      batch_id: 'batch-palace-retry',
      palace_id: card.palace_id,
      rating: 2,
      items: [currentResult, siblingResult],
      rated_unit_ids: [card.unit_id, 'unit-b'],
      remaining_due_count: 2,
      current: currentResult,
    })
    const { onBatchCardsSettled, onEncounterChange } = renderCard(card, {
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
    fireEvent.click(screen.getByTestId('freestyle-rating-button-2'))
    await waitFor(() => {
      expect(onBatchCardsSettled).toHaveBeenCalledWith([
        { cardId: card.id, restudy: true, rating: 2, retryAfterCards: 3 },
        { cardId: 'card-b', restudy: true, rating: 2, retryAfterCards: 3 },
      ])
    })
    expect(onEncounterChange).toHaveBeenCalledWith(
      'card-b',
      expect.objectContaining({
        selectedRating: 2,
        passed: false,
        retryAfterCards: 3,
      }),
    )
  })

  it('marks the tapped rating as chosen while the rate is still in flight', async () => {
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
    renderCard(card)

    await screen.findByTestId('flip-card-mind-map-panel')
    fireEvent.click(screen.getByRole('button', { name: /记得：1天后复习/ }))

    // The bar used to stay silent until the POST landed, so a slow network read
    // as a dropped tap.
    const pressed = await screen.findByTestId('freestyle-rating-pending-3')
    expect(pressed).toBeTruthy()
    expect(screen.getByTestId('freestyle-rating-button-3').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('freestyle-rating-effect-line').textContent).toContain('正在记录记得')

    await act(async () => {
      resolveRate?.(null)
    })
    await waitFor(() => {
      expect(screen.queryByTestId('freestyle-rating-pending-3')).toBeNull()
    })
    expect(screen.getByText('已选记得 · 1天后复习 · 7月28日')).toBeTruthy()
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
      fireEvent.click(screen.getByRole('button', { name: /记得：1天后复习/ }))
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
    fireEvent.click(screen.getByRole('button', { name: /记得：1天后复习/ }))

    await waitFor(() => expect(onRatingSettled).toHaveBeenCalledWith(card.id, true, 3))
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
    fireEvent.click(screen.getByRole('button', { name: /记得：1天后复习/ }))

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
    fireEvent.click(screen.getByRole('button', { name: /困难：3张后重练/ }))
    await waitFor(() => expect(apiMocks.rateReviewUnitApi).toHaveBeenCalledTimes(1))
    expect(apiMocks.closeUnitReviewEncounterApi).not.toHaveBeenCalled()

    // A new queue round may be selected while the old encounter is still open.
    // Closing must retain the encounter's server-owned round identity.
    view.rerenderCard({ active: false, roundId: 'round-2' })
    await waitFor(() => expect(apiMocks.closeUnitReviewEncounterApi).toHaveBeenCalledWith(
      session.id,
      card.unit_id,
      'encounter-1',
      expect.any(String),
      expect.any(Number),
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
    expect(apiMocks.getUnitReviewSessionApi).toHaveBeenCalledWith(`session:${card.unit_id}`)
    expect(apiMocks.startFreestyleUnitReviewSessionApi).not.toHaveBeenCalled()
    expect(
      (screen.getByRole('button', { name: /记得：1天后复习/ }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('drops a card when its frozen unit revision is stale', async () => {
    const card = buildCard('unit-stale', 3)
    apiMocks.startFreestyleUnitReviewSessionApi.mockResolvedValue(buildSession(card.unit_id!, 4))
    const { onStaleDrop, onSaveFailed } = renderCard(card)

    await waitFor(() => expect(onStaleDrop).toHaveBeenCalledWith(card.id))
    expect(onSaveFailed).not.toHaveBeenCalled()
    expect(screen.queryByTestId('flip-card-mind-map-panel')).toBeNull()
  })

  it('shows recovery actions instead of an endless loading state for a non-stale load failure', async () => {
    const card = buildCard('unit-load-failure')
    apiMocks.startFreestyleUnitReviewSessionApi.mockRejectedValue(new Error('temporary API failure'))
    const { onSaveFailed, onStaleDrop } = renderCard(card)

    await screen.findByText(/单元加载失败：temporary API failure/)
    expect(onSaveFailed).toHaveBeenCalledWith('temporary API failure')
    expect(screen.getByRole('button', { name: '重试加载' })).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '重建队列' }))
    expect(onStaleDrop).toHaveBeenCalledWith(card.id)
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

  it('drops silently when active unit review session is required', async () => {
    const card = buildCard('unit-session-required')
    apiMocks.startFreestyleUnitReviewSessionApi.mockRejectedValue({
      status: 409,
      message: 'Active unit review session required',
    })
    const { onStaleDrop, onSaveFailed } = renderCard(card)

    await waitFor(() => expect(onStaleDrop).toHaveBeenCalledWith(card.id))
    expect(onSaveFailed).not.toHaveBeenCalled()
  })
})
