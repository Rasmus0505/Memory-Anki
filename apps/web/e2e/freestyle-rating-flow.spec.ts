import { expect, test, type Page, type Route } from './fixtures'

/**
 * Hermetic click-through of non-blocking ratings and a skippable round end.
 * The fixture answers every other /api call with 503, so nothing reaches the
 * live study service.
 */

const EFFECTS = [
  { rating: 1, label: '忘记', passed: false, target_stage_index: 0, target_interval_days: 0, target_actual_interval_days: 0, target_due_date: '2026-07-27', retry_after_cards: 3, stage_action: 'reset' },
  { rating: 2, label: '困难', passed: false, target_stage_index: 0, target_interval_days: 0, target_actual_interval_days: 0, target_due_date: '2026-07-27', retry_after_cards: 3, stage_action: 'keep' },
  { rating: 3, label: '记得', passed: true, target_stage_index: 1, target_interval_days: 1, target_actual_interval_days: 1, target_due_date: '2026-07-28', retry_after_cards: 0, stage_action: 'advance' },
  { rating: 4, label: '轻松', passed: true, target_stage_index: 2, target_interval_days: 3, target_actual_interval_days: 3, target_due_date: '2026-07-30', retry_after_cards: 0, stage_action: 'advance' },
]

interface RateBody {
  operation_id: string
  rating: number
  encounter_id: string
  study_session_id: string
  unit_id: string
  unit_revision: number
  round_id?: string
}

function queueBody(request: { operation_id: string; round_id: string; config: unknown }) {
  return {
    operation_id: request.operation_id,
    round_id: request.round_id,
    config: request.config,
    cards: [{
      id: 'review_unit:e2e-rate:r1',
      type: 'mindmap_branch',
      content_type: 'mindmap_branch',
      palace_id: 1,
      palace_title: '评分流宫殿',
      anchor_uid: 'unit',
      context_path: [{ uid: 'root', text: '评分流宫殿' }],
      node_uids: ['unit'],
      node_count: 1,
      unit_id: 'e2e-rate',
      unit_revision: 1,
    }],
    phase_stats: { candidate_count: 1, scheduled_count: 1, queue_limit: 20 },
    round_meta: { candidate_count: 1, scheduled_count: 1, queue_limit: 20, limit_reached: false },
    counts: { mindmap_branch: 1, anki_card: 0, quiz_question: 0, total: 1 },
  }
}

function sessionItem(body: { unit_revision?: number; round_id?: string; encounter_id?: string }) {
  const encounterId = body.encounter_id || 'encounter-e2e-rate'
  const roundId = body.round_id || 'round-e2e-rate'
  return {
    id: 'session:e2e-rate',
    palace_id: 1,
    title: '评分流宫殿',
    status: 'active',
    palace: {
      id: 1,
      title: '评分流宫殿',
      editor_doc: {
        root: {
          data: { uid: 'root', text: '评分流宫殿' },
          children: [{ data: { uid: 'unit', text: '当前单元' }, children: [] }],
        },
      },
    },
    units: [{
      id: 'e2e-rate',
      palace_id: 1,
      anchor_uid: 'unit',
      unit_kind: 'marked',
      title: '当前复习单元',
      node_uids: ['unit'],
      revision: body.unit_revision ?? 1,
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
      encounter: {
        id: encounterId,
        round_id: roundId,
        sequence: 0,
        status: 'open',
        selected_rating: null,
        passed: null,
        retry_after_cards: 0,
        effective_operation_id: null,
        effective_seconds: null,
        closed_at: null,
        rating_effects: EFFECTS,
      },
    }],
    pending_unit_count: 1,
    completed_unit_count: 0,
  }
}

function ratingItem(body: RateBody) {
  const effect = EFFECTS.find((item) => item.rating === body.rating) ?? EFFECTS[2]
  const encounter = {
    id: body.encounter_id,
    round_id: body.round_id || 'round-e2e-rate',
    sequence: 0,
    status: 'open' as const,
    selected_rating: body.rating,
    passed: effect.passed,
    retry_after_cards: effect.retry_after_cards,
    effective_operation_id: body.operation_id,
    effective_seconds: null,
    closed_at: null,
    rating_effects: EFFECTS,
  }
  return {
    operation_id: body.operation_id,
    study_session_id: body.study_session_id || 'session:e2e-rate',
    encounter_id: body.encounter_id,
    amended: false,
    unit: {
      id: body.unit_id,
      palace_id: 1,
      anchor_uid: 'unit',
      unit_kind: 'marked',
      title: '当前复习单元',
      node_uids: ['unit'],
      revision: body.unit_revision,
      stage_index: effect.target_stage_index,
      interval_days: effect.target_interval_days,
      has_passed: effect.passed,
      due_date: effect.target_due_date,
      due: !effect.passed,
      session_status: effect.passed ? 'passed' : 'retry',
      retry_count: 0,
      hard_count: 0,
      again_count: 0,
      final_rating: body.rating,
      encounter,
    },
    passed: effect.passed,
    retry_after_cards: effect.retry_after_cards,
    rating: body.rating,
    rating_label: effect.label,
    session_status: effect.passed ? 'passed' : 'retry',
    encounter,
  }
}

async function installCardRoutes(page: Page) {
  await page.route('**/api/v1/freestyle/queue/build', async (route) => {
    const request = route.request().postDataJSON() as {
      operation_id: string
      round_id: string
      config: unknown
    }
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(queueBody(request)),
    })
  })
  await page.route('**/api/v1/review/units/e2e-rate/sessions', async (route) => {
    const body = (route.request().postDataJSON() ?? {}) as {
      unit_revision?: number
      round_id?: string
      encounter_id?: string
    }
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ item: sessionItem(body) }),
    })
  })
  await page.route('**/api/v1/review/session/**/close', async (route) => {
    const session = sessionItem({})
    const encounter = { ...session.units[0].encounter, status: 'closed', closed_at: '2026-07-27T00:00:00Z' }
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        item: {
          operation_id: 'close-e2e-rate',
          encounter,
          passed: true,
          retry_after_cards: 0,
          session_status: 'passed',
          completion: null,
        },
      }),
    })
  })
}

function holdRatings(page: Page) {
  const held: Array<{ body: RateBody; release: (status?: number) => void }> = []
  const installed = page.route('**/api/v1/freestyle/rounds/*/ratings', async (route: Route) => {
    const body = route.request().postDataJSON() as RateBody
    await new Promise<void>((resolve) => {
      held.push({
        body,
        release: (status = 200) => {
          const payload = status === 200
            ? { item: ratingItem(body), round: { plan_version: 2, version: 2, round_id: body.round_id, conflict: false } }
            : { detail: 'network down' }
          void route.fulfill({
            status,
            contentType: 'application/json',
            body: JSON.stringify(payload),
          }).then(resolve, resolve)
        },
      })
    })
  })
  return { held, installed }
}

test('paints a grade immediately, queues the next tap, then opens a skippable round end', async ({ page }) => {
  await installCardRoutes(page)
  const { held } = holdRatings(page)
  await page.goto('/freestyle')

  const remember = page.getByTestId('freestyle-rating-button-3')
  const easy = page.getByTestId('freestyle-rating-button-4')
  await expect(remember).toBeEnabled()
  await remember.click()
  await expect(remember).toHaveAttribute('aria-pressed', 'true')
  await expect(remember).toBeEnabled()
  await expect(page.getByTestId('freestyle-rating-effect-line')).toContainText('已选记得')
  await expect.poll(() => held.length).toBe(1)

  // The selected grade animates the dock, so a second pointer click can miss
  // the stability check. The 1–4 shortcut is the same rate path and stays live
  // while the first request is still held.
  await page.keyboard.press('4')
  await expect(easy).toHaveAttribute('aria-pressed', 'true')
  await expect(easy).toBeEnabled()
  await expect(remember).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByTestId('freestyle-rating-effect-line')).toContainText('已选轻松')
  expect(held.length).toBe(1)

  held[0].release()
  await expect.poll(() => held.length).toBe(2)
  await expect(easy).toBeEnabled()
  await expect(easy).toHaveAttribute('aria-pressed', 'true')
  held[1].release()
  await expect(easy).toBeEnabled()

  const next = page.getByRole('button', { name: '下一张' })
  await expect(next).toBeEnabled()
  await next.click()
  const settlement = page.getByTestId('freestyle-round-complete')
  await expect(settlement.getByText('今日到期已清')).toBeVisible()
  await settlement.getByTestId('freestyle-round-skip-show').click()
  await expect(settlement.getByText('今日到期已清')).toBeVisible()
  await settlement.getByTestId('freestyle-round-another').click()
  await expect(page.getByTestId('freestyle-round-config-dialog')).toBeVisible()
})

test('rolls the grade back when the rating request fails', async ({ page }) => {
  await installCardRoutes(page)
  const { held } = holdRatings(page)
  await page.goto('/freestyle')

  const remember = page.getByTestId('freestyle-rating-button-3')
  await expect(remember).toBeEnabled()
  await remember.click()
  await expect(remember).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => held.length).toBe(1)

  held[0].release(400)
  await expect(remember).toHaveAttribute('aria-pressed', 'false')
  await expect(remember).toBeEnabled()
  await expect(page.getByRole('alert').filter({ hasText: 'network down' })).toBeVisible()
  await expect(page.getByRole('button', { name: '下一张' })).toBeDisabled()
})
