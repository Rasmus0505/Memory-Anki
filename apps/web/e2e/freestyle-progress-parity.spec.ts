import { expect, test, type Page, type Route } from './fixtures'
import type {
  FreestyleRoundActiveRequest,
  FreestyleRoundStatePayload,
} from '../src/shared/api/contracts/freestyle'

/**
 * Position and progress invariants for the immersive feed.
 *
 * These are the symptoms the learner reports: "the card changed under my finger",
 * "the rail and the round sheet disagree about how much is left". Every /api call
 * is answered locally, so nothing reaches the live study service.
 */

const EFFECTS = [
  { rating: 1, label: '忘记', passed: false, target_stage_index: 0, target_interval_days: 0, target_actual_interval_days: 0, target_due_date: '2026-11-02', retry_after_cards: 3, stage_action: 'reset' },
  { rating: 2, label: '困难', passed: true, target_stage_index: 1, target_interval_days: 2, target_actual_interval_days: 2, target_due_date: '2026-11-04', stage_action: 'lower', retry_after_cards: 0 },
  { rating: 3, label: '记得', passed: true, target_stage_index: 2, target_interval_days: 3, target_actual_interval_days: 3, target_due_date: '2026-11-05', stage_action: 'advance', retry_after_cards: 0 },
  { rating: 4, label: '轻松', passed: true, target_stage_index: 3, target_interval_days: 7, target_actual_interval_days: 7, target_due_date: '2026-11-09', stage_action: 'advance', retry_after_cards: 0 },
]

const UNITS = ['e2e-pos-a', 'e2e-pos-b']
const ROUND_ID = 'round-e2e-pos'

function cards() {
  return UNITS.map((unit) => ({
    id: `review_unit:${unit}:r1`,
    type: 'mindmap_branch',
    content_type: 'mindmap_branch',
    palace_id: 1,
    palace_title: '位置宫殿',
    anchor_uid: unit,
    context_path: [{ uid: 'root', text: '位置宫殿' }],
    node_uids: [unit],
    node_count: 1,
    unit_id: unit,
    unit_revision: 1,
  }))
}

function queueBody(request: { operation_id: string; round_id?: string; config: unknown }) {
  return {
    operation_id: request.operation_id,
    round_id: request.round_id,
    config: request.config,
    cards: cards(),
    phase_stats: { candidate_count: UNITS.length, scheduled_count: UNITS.length, queue_limit: 20 },
    round_meta: {
      candidate_count: UNITS.length,
      scheduled_count: UNITS.length,
      queue_limit: 20,
      limit_reached: false,
    },
    counts: {
      mindmap_branch: UNITS.length,
      anki_card: 0,
      quiz_question: 0,
      total: UNITS.length,
    },
  }
}

function sessionItem(unitId: string) {
  return {
    id: `session:${unitId}`,
    palace_id: 1,
    title: '位置宫殿',
    status: 'active',
    palace: {
      id: 1,
      title: '位置宫殿',
      editor_doc: {
        root: {
          data: { uid: 'root', text: '位置宫殿' },
          children: [{ data: { uid: unitId, text: unitId }, children: [] }],
        },
      },
    },
    units: [{
      id: unitId,
      palace_id: 1,
      anchor_uid: unitId,
      unit_kind: 'marked',
      title: `单元 ${unitId}`,
      node_uids: [unitId],
      revision: 1,
      stage_index: 0,
      interval_days: 0,
      has_passed: false,
      due_date: '2026-11-01',
      due: true,
      session_status: 'pending',
      retry_count: 0,
      hard_count: 0,
      again_count: 0,
      final_rating: null,
      encounter: {
        id: `encounter-${unitId}`,
        round_id: ROUND_ID,
        sequence: 0,
        status: 'open',
        selected_rating: null,
        passed: null,
        retry_after_cards: 0,
        effective_operation_id: null,
        closed_at: null,
        rating_effects: EFFECTS,
      },
    }],
    pending_unit_count: 1,
    completed_unit_count: 0,
  }
}

function newRound(request: FreestyleRoundActiveRequest): FreestyleRoundStatePayload {
  const queue = queueBody(request)
  return {
    round_id: ROUND_ID,
    scope_key: request.scope_key,
    status: 'active',
    version: 1,
    plan_version: 1,
    config: request.config,
    workspace: 'primary',
    current_card_id: queue.cards[0].id,
    last_operation_id: request.operation_id,
    updated_at: '2026-11-01T00:00:00Z',
    conflict: false,
    duplicate: false,
    plan: {
      original_cards: queue.cards.map((card) => ({
        card_id: card.id,
        unit_id: card.unit_id,
        unit_revision: 1,
        kind: card.type,
        palace_id: 1,
        palace_title: card.palace_title,
        label: `单元 ${card.unit_id}`,
        entered_on: '2026-11-01',
      })),
      presented_ids: queue.cards.map((card) => card.id),
      current_card_id: queue.cards[0].id,
      current_index: 0,
      completed_ids: [],
      excluded_ids: [],
      compressed_ids: [],
      occurrences: [],
      encounters: {},
      partial_settlements: [],
    } as FreestyleRoundStatePayload['plan'],
  }
}

async function installRoutes(page: Page) {
  let round: FreestyleRoundStatePayload | null = null
  const builds: string[] = []

  await page.route('**/api/v1/freestyle/overview**', (route: Route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        round: null,
        today: { due_count: UNITS.length, overdue_count: 0, new_palace_count: 0 },
        yesterday: { date: '2026-11-01', learned_units: 0, rated_count: 0, weak_units: [] },
        next_reviews: [],
      }),
    }),
  )
  await page.route('**/api/v1/freestyle/queue/build', (route: Route) => {
    builds.push('build')
    const request = route.request().postDataJSON() as {
      operation_id: string
      round_id?: string
      config: unknown
    }
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(queueBody(request)),
    })
  })
  await page.route('**/api/v1/freestyle/rounds/**', (route: Route) => {
    const path = new URL(route.request().url()).pathname
    const method = route.request().method()
    if (path.endsWith('/active') && method === 'POST') {
      if (!round) round = newRound(route.request().postDataJSON() as FreestyleRoundActiveRequest)
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(round) })
    }
    if (!round) {
      return route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'No active round' }),
      })
    }
    if (path.endsWith('/actions') && method === 'POST') {
      const body = route.request().postDataJSON() as { action?: string; card_id?: string }
      if (body.action === 'leave_card' && body.card_id) {
        const index = round.plan.presented_ids.indexOf(body.card_id)
        round.plan.current_card_id = round.plan.presented_ids[index + 1] ?? body.card_id
        round.plan.current_index = Math.max(0, index + 1)
        round.current_card_id = round.plan.current_card_id
      }
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(round) })
    }
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(round) })
  })
  await page.route('**/api/v1/review/units/*/sessions', (route: Route) => {
    const segments = new URL(route.request().url()).pathname.split('/')
    const unitId = decodeURIComponent(segments[segments.length - 2])
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ item: sessionItem(unitId) }),
    })
  })

  return { builds }
}

async function startFromOverview(page: Page) {
  const start = page.getByRole('button', { name: '开始学习' })
  await expect(start).toBeEnabled()
  await start.click()
  await expect(page.getByTestId('freestyle-start-overview')).toHaveCount(0)
}

function visualIndex(page: Page) {
  return page.getByTestId('freestyle-feed-scroller').evaluate((el) =>
    el.clientHeight ? Math.round(el.scrollTop / el.clientHeight) : -1,
  )
}

test('rating a card keeps it in the viewport and does not rebuild the queue', async ({ page }) => {
  const routes = await installRoutes(page)
  const rated: number[] = []
  await page.route('**/api/v1/freestyle/rounds/*/ratings', async (route: Route) => {
    const body = route.request().postDataJSON() as {
      rating: number
      unit_id: string
      operation_id: string
      encounter_id: string
      study_session_id: string
    }
    rated.push(body.rating)
    const effect = EFFECTS.find((item) => item.rating === body.rating) ?? EFFECTS[2]
    const unit = sessionItem(body.unit_id).units[0]
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        item: {
          operation_id: body.operation_id,
          study_session_id: body.study_session_id,
          encounter_id: body.encounter_id,
          amended: false,
          unit,
          passed: effect.passed,
          retry_after_cards: effect.retry_after_cards,
          rating: body.rating,
          rating_label: effect.label,
          session_status: effect.passed ? 'passed' : 'retry',
          encounter: {
            ...unit.encounter,
            selected_rating: body.rating,
            passed: effect.passed,
            effective_operation_id: body.operation_id,
          },
        },
        round: null,
      }),
    })
  })

  await page.goto('/freestyle')
  await startFromOverview(page)
  await expect(page.getByTestId('freestyle-rating-bar')).toBeVisible()

  const buildsBefore = routes.builds.length
  const indexBefore = await visualIndex(page)

  await page.getByTestId('freestyle-rating-button-3').click()
  await expect.poll(() => rated.length).toBe(1)

  // 记得 is a pass: the learner stays on the card they just graded until they
  // press 下一张, and no rebuild replaced the queue underneath them.
  expect(await visualIndex(page)).toBe(indexBefore)
  expect(routes.builds.length).toBe(buildsBefore)
})

test('the round sheet and the rail agree on how many cards the round has', async ({ page }) => {
  await installRoutes(page)
  await page.goto('/freestyle')
  await startFromOverview(page)
  await expect(page.getByTestId('freestyle-rating-bar')).toBeVisible()

  // The rail's own label is the learner-facing "1/2"; it must agree with the
  // sheet rather than counting a different pool.
  const rail = page.getByTestId('freestyle-progress-rail')
  await expect(rail).toBeVisible()
  await expect(rail).toHaveAttribute('aria-label', /本轮进度 \d+\/2/)

  await page.getByTestId('freestyle-progress-hud').click()
  const sheet = page.getByTestId('freestyle-round-sheet')
  await expect(sheet).toBeVisible()
  // The sheet counts the same pool the rail does: two scheduled cards for this
  // round, not the palace total and not the pre-filter candidate count.
  await expect(sheet).toContainText(`本轮 ${UNITS.length} 张`)
})
