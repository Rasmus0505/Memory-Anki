import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PalaceUnitRatingPage from './PalaceUnitRatingPage'

vi.mock('@/modules/content/ui/mindmap-editor', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/modules/content/ui/mindmap-editor')>()),
  MindMapEditorSurface: () => <div data-testid="unit-canvas" />,
}))

const apiMocks = vi.hoisted(() => ({
  getPalaceReviewUnitsApi: vi.fn(),
  getUnitReviewPreviewApi: vi.fn(),
  getPalaceLadderProgressApi: vi.fn(),
  startFreestyleUnitReviewSessionApi: vi.fn(),
  rateReviewUnitApi: vi.fn(),
  closeUnitReviewEncounterApi: vi.fn(),
  cancelUnratedUnitReviewEncounterApi: vi.fn(),
  adjustUnitScheduleApi: vi.fn(),
}))

vi.mock('@/modules/practice/ui/review/api/unitReviewApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/modules/practice/ui/review/api/unitReviewApi')>()),
  ...apiMocks,
}))

const editorDoc = {
  root: {
    data: { uid: 'root', text: '根' },
    children: [
      { data: { uid: 'unit-node', text: '要复习的内容' }, children: [] },
      { data: { uid: 'other', text: '别的单元' }, children: [] },
    ],
  },
}

const dueUnit = {
  id: 'unit-due',
  palace_id: 1,
  anchor_uid: 'unit-node',
  unit_kind: 'marked',
  title: '要复习的内容',
  node_uids: ['unit-node'],
  revision: 2,
  stage_index: 3,
  interval_days: 7,
  has_passed: true,
  due_date: '2026-10-30',
  due: true,
}

const futureUnit = {
  ...dueUnit,
  id: 'unit-future',
  anchor_uid: 'other',
  title: '别的单元',
  node_uids: ['other'],
  interval_days: 14,
  due_date: '2026-11-13',
  due: false,
}

const effects = [
  {
    rating: 1,
    label: '忘记',
    passed: false,
    target_stage_index: 0,
    target_interval_days: 0,
    target_actual_interval_days: 0,
    target_due_date: '2026-10-30',
    retry_after_cards: 3,
    retry_after_minutes: 10,
    intraday_kind: 'retry',
    stage_action: 'reset',
  },
  {
    rating: 2,
    label: '困难',
    passed: true,
    target_stage_index: 3,
    target_interval_days: 7,
    target_actual_interval_days: 7,
    target_due_date: '2026-11-06',
    retry_after_cards: 0,
    stage_action: 'keep',
  },
  {
    rating: 3,
    label: '记得',
    passed: true,
    target_stage_index: 4,
    target_interval_days: 17,
    target_actual_interval_days: 17,
    target_due_date: '2026-11-16',
    retry_after_cards: 0,
    stage_action: 'advance',
  },
  {
    rating: 4,
    label: '轻松',
    passed: true,
    target_stage_index: 5,
    target_interval_days: 24,
    target_actual_interval_days: 24,
    target_due_date: '2026-11-23',
    retry_after_cards: 0,
    stage_action: 'advance',
  },
]

function projection() {
  return {
    palace_id: 1,
    title: '测试宫殿',
    mark_required: false,
    unit_count: 2,
    due_unit_count: 1,
    next_review_date: '2026-10-30',
    review_status: 'due',
    units: [dueUnit, futureUnit],
  }
}

function sessionFor(unit: typeof dueUnit, withEncounter: boolean) {
  return {
    id: 'session-1',
    palace_id: 1,
    title: '测试宫殿',
    status: 'active',
    palace: { id: 1, title: '测试宫殿', editor_doc: editorDoc },
    units: [
      {
        ...unit,
        session_status: 'pending',
        retry_count: 0,
        hard_count: 0,
        again_count: 0,
        final_rating: null,
        encounter: withEncounter
          ? {
              id: 'encounter-1',
              round_id: 'round-1',
              sequence: 0,
              status: 'open',
              selected_rating: null,
              passed: null,
              retry_after_cards: 0,
              effective_operation_id: null,
              closed_at: null,
              rating_effects: effects,
            }
          : null,
      },
    ],
    pending_unit_count: 1,
    completed_unit_count: 0,
  }
}

function renderPage(path = '/palaces/1/units') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/palaces/:id/units" element={<PalaceUnitRatingPage />} />
        <Route path="/palaces/:id/edit" element={<div>editor</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  Object.values(apiMocks).forEach((mock) => mock.mockReset())
  apiMocks.getPalaceReviewUnitsApi.mockResolvedValue(projection())
  apiMocks.getUnitReviewPreviewApi.mockResolvedValue(sessionFor(dueUnit, false))
  apiMocks.getPalaceLadderProgressApi.mockResolvedValue({
    palace_id: 1,
    title: '测试宫殿',
    ladder: [0, 1, 3, 7, 14, 30, 60, 120, 240, 365],
    scope: 'unit',
    current: {
      unit_id: dueUnit.id,
      title: dueUnit.title,
      stage_index: 3,
      interval_days: 7,
      due_date: dueUnit.due_date,
      due: true,
      has_passed: true,
      horizon: 'today',
    },
    palace: {
      unit_count: 2,
      due_count: 1,
      weakest_stage_index: 0,
      stage_histogram: [0, 0, 0, 1, 0, 0, 0, 0, 0, 0],
      due_horizon: { today: 1, d3: 0, week: 0, month: 1, later: 0 },
      next_review_date: '2026-10-30',
      review_status: 'due',
      mark_required: false,
    },
    unit_range_stats: {
      range: 'all',
      per_stage: [],
      total_reviews: 0,
      rating_share: { forgot: 0, hard: 0, remember: 0, easy: 0 },
    },
    palace_range_stats: {
      range: 'all',
      per_stage: [],
      total_reviews: 0,
      rating_share: { forgot: 0, hard: 0, remember: 0, easy: 0 },
    },
    selected_range_summary: {},
    palace_all_time_summary: {},
  })
  apiMocks.startFreestyleUnitReviewSessionApi.mockResolvedValue(
    sessionFor(dueUnit, true) as never,
  )
  apiMocks.rateReviewUnitApi.mockResolvedValue({
    operation_id: 'op-1',
    study_session_id: 'session-1',
    encounter_id: 'encounter-1',
    amended: false,
    unit: {
      ...dueUnit,
      interval_days: 17,
      stage_index: 4,
      due_date: '2026-11-16',
      due: false,
      final_rating: 3,
    },
    passed: true,
    retry_after_cards: 0,
    rating: 3,
    rating_label: '记得',
    session_status: 'passed',
    encounter: sessionFor(dueUnit, true).units[0].encounter,
  } as never)
  apiMocks.closeUnitReviewEncounterApi.mockResolvedValue({} as never)
  apiMocks.cancelUnratedUnitReviewEncounterApi.mockResolvedValue({} as never)
  apiMocks.adjustUnitScheduleApi.mockResolvedValue({} as never)
})

describe('PalaceUnitRatingPage', () => {
  it('opens the due unit, previews each grade, and books the rating', async () => {
    renderPage()

    expect(await screen.findByTestId('unit-rating-row-unit-due')).toBeTruthy()
    expect(screen.getByTestId('unit-rating-row-unit-future')).toBeTruthy()
    expect(await screen.findByTestId('unit-canvas')).toBeTruthy()
    await waitFor(() =>
      expect(apiMocks.startFreestyleUnitReviewSessionApi).toHaveBeenCalledTimes(1),
    )

    // Each key says where the unit moves: booked gap → next gap, then the date.
    const remember = await screen.findByRole('button', { name: /记得：7天 → 17天 · 11月16日/ })
    expect(remember).toBeTruthy()
    fireEvent.click(remember)
    await waitFor(() => expect(apiMocks.rateReviewUnitApi).toHaveBeenCalledTimes(1))
    expect(apiMocks.rateReviewUnitApi.mock.calls[0][3]).toBe(3)
    // The list row adopts the booking without refetching the projection.
    await waitFor(() =>
      expect(screen.getByTestId('unit-rating-row-unit-due').textContent).toContain('间隔 17天'),
    )
  })

  it('refuses to rate a unit that is not due and says why', async () => {
    renderPage('/palaces/1/units?unit=unit-future')

    const row = await screen.findByTestId('unit-rating-row-unit-future')
    expect(row.getAttribute('data-active')).toBe('true')
    expect(apiMocks.startFreestyleUnitReviewSessionApi).not.toHaveBeenCalled()
    const reason = await screen.findByText(/11月13日 才到期 · 可在上方进度条调整进度/)
    expect(reason).toBeTruthy()
    expect(screen.getByRole('button', { name: /记得：/ }).hasAttribute('disabled')).toBe(true)
  })

  it('closes the open encounter when the learner switches units', async () => {
    renderPage()

    await screen.findByTestId('unit-rating-row-unit-due')
    await waitFor(() =>
      expect(apiMocks.startFreestyleUnitReviewSessionApi).toHaveBeenCalledTimes(1),
    )
    fireEvent.click(screen.getByTestId('unit-rating-row-unit-future'))

    await waitFor(() =>
      expect(apiMocks.cancelUnratedUnitReviewEncounterApi).toHaveBeenCalledTimes(1),
    )
  })
})
