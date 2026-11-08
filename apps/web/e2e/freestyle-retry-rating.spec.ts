import { expect, test, type Page, type Route } from './fixtures'
import type {
  FreestyleRoundActionRequest,
  FreestyleRoundPlanPayload,
  FreestyleRoundStatePayload,
} from '../src/shared/api/contracts/freestyle'

/**
 * Rating a 重练 card must leave it on screen.
 *
 * The card the learner just scored is this round's history: it may only leave
 * the feed through 结算, a cancelled occurrence, or the next study day. Dropping
 * it on the rating ack slides the next unit into the same viewport slot — the
 * "评完就消失、还自动翻页" report. This spec pins the card list, the viewport
 * slot, and the retry badge across both a failed and a passed retry.
 */

const EFFECTS = [
  { rating: 1, label: '忘记', passed: false, target_stage_index: 0, target_interval_days: 0, target_actual_interval_days: 0, target_due_date: '2026-07-27', retry_after_cards: 3, stage_action: 'reset' },
  { rating: 2, label: '困难', passed: true, target_stage_index: 1, target_interval_days: 2, target_actual_interval_days: 2, target_due_date: '2026-07-29', retry_after_cards: 0, stage_action: 'lower' },
  { rating: 3, label: '记得', passed: true, target_stage_index: 2, target_interval_days: 3, target_actual_interval_days: 3, target_due_date: '2026-07-30', retry_after_cards: 0, stage_action: 'advance' },
  { rating: 4, label: '轻松', passed: true, target_stage_index: 3, target_interval_days: 7, target_actual_interval_days: 7, target_due_date: '2026-08-03', retry_after_cards: 0, stage_action: 'advance' },
]

const ROUND_ID = 'round-e2e-retry'
const SOURCE_ID = 'review_unit:e2e-retry:r1'
const RETRY_ID = `retry:${ROUND_ID}:e2e-retry:1`
const NEXT_ID = 'review_unit:e2e-next:r1'
const NEXT_READY_AT = '2026-10-25T12:13:32.633397'

function branchCard(id: string, unitId: string, title: string) {
  return {
    id,
    type: 'mindmap_branch' as const,
    content_type: 'mindmap_branch' as const,
    palace_id: 1,
    palace_title: '重练宫殿',
    anchor_uid: unitId,
    context_path: [{ uid: 'root', text: '重练宫殿' }],
    node_uids: [unitId],
    node_count: 1,
    unit_id: unitId,
    unit_revision: 1,
    palace_title_short: title,
  }
}

function queueBody(request: { operation_id: string; round_id?: string; config: unknown }) {
  const cards = [
    branchCard(SOURCE_ID, 'e2e-retry', '源卡'),
    branchCard(NEXT_ID, 'e2e-next', '下一张'),
  ]
  return {
    operation_id: request.operation_id,
    round_id: request.round_id,
    config: request.config,
    cards,
    phase_stats: { candidate_count: cards.length, scheduled_count: cards.length, queue_limit: 20 },
    round_meta: {
      candidate_count: cards.length,
      scheduled_count: cards.length,
      queue_limit: 20,
      limit_reached: false,
      waiting_count: 1,
      next_ready_at: NEXT_READY_AT,
    },
    counts: { mindmap_branch: cards.length, anki_card: 0, quiz_question: 0, total: cards.length },
  }
}

function sessionItem(unitId: string) {
  return {
    id: `session:${unitId}`,
    palace_id: 1,
    title: '重练宫殿',
    status: 'active',
    palace: {
      id: 1,
      title: '重练宫殿',
      editor_doc: { root: { data: { uid: 'root', text: '重练宫殿' }, children: [] } },
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
      due_date: '2026-07-27',
      due: true,
      session_status: 'pending',
      retry_count: 0,
      hard_count: 0,
      again_count: 0,
      final_rating: null,
      encounter: {
        id: `enc-${unitId}`,
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

function roundPlan(): FreestyleRoundPlanPayload {
  return {
    original_cards: [
      {
        card_id: SOURCE_ID, unit_id: 'e2e-retry', unit_revision: 1, kind: 'mindmap_branch',
        palace_id: 1, palace_title: '重练宫殿', label: '源卡', entered_on: '2026-07-27',
      },
      {
        card_id: NEXT_ID, unit_id: 'e2e-next', unit_revision: 1, kind: 'mindmap_branch',
        palace_id: 1, palace_title: '重练宫殿', label: '下一张', entered_on: '2026-07-27',
      },
    ],
    presented_ids: [SOURCE_ID, RETRY_ID, NEXT_ID],
    current_card_id: SOURCE_ID,
    current_index: 0,
    completed_ids: [],
    excluded_ids: [] as string[],
    compressed_ids: [] as string[],
    occurrences: [{
      occurrence_id: RETRY_ID,
      source_card_id: SOURCE_ID,
      source_unit_id: 'e2e-retry',
      retry_attempt: 1,
      rating: null as number | null,
      insert_target_index: 1,
      status: 'inserted',
      encounter_id: '',
    }],
    encounters: {} as Record<string, { encounter_id: string; status: string; unit_revision: number; rating?: number | null }>,
    partial_settlements: [] as unknown[],
  }
}

async function installRoutes(page: Page) {
  let persisted: FreestyleRoundStatePayload | null = null
  const actions: FreestyleRoundActionRequest[] = []
  const reply = (route: Route, body: unknown, status = 200) => route.fulfill({
    status, contentType: 'application/json', body: JSON.stringify(body),
  })
  await page.route('**/api/v1/freestyle/rounds/**', async (route: Route) => {
    const pathname = new URL(route.request().url()).pathname
    const method = route.request().method()
    if (pathname.endsWith('/active') && method === 'POST') {
      if (!persisted) {
        persisted = {
          round_id: ROUND_ID,
          scope_key: 'e2e-scope',
          status: 'active',
          version: 1,
          plan_version: 1,
          config: (route.request().postDataJSON() as { config: unknown }).config as FreestyleRoundStatePayload['config'],
          current_card_id: SOURCE_ID,
          last_operation_id: 'op-active',
          updated_at: new Date().toISOString(),
          conflict: false,
          duplicate: false,
          plan: roundPlan(),
        }
      }
      return reply(route, persisted)
    }
    if (!persisted) return reply(route, { detail: 'No active round' }, 404)
    if (method === 'GET' && (pathname.endsWith('/active') || pathname.endsWith(`/${ROUND_ID}`))) {
      return reply(route, persisted)
    }
    if (pathname.endsWith('/actions') && method === 'POST') {
      const request = route.request().postDataJSON() as FreestyleRoundActionRequest
      actions.push(request)
      if (!['set_cursor', 'set_encounter', 'leave_card', 'bind_cards', 'compress_completed'].includes(request.action)) {
        return reply(route, { detail: `Unexpected round action: ${request.action}` }, 422)
      }
      if (request.action === 'set_cursor' && request.card_id) {
        persisted.current_card_id = request.card_id
        persisted.plan.current_card_id = request.card_id
        persisted.plan.current_index = persisted.plan.presented_ids.indexOf(request.card_id)
      }
      if (request.action === 'set_encounter' && request.card_id && request.encounter_id) {
        persisted.plan.encounters[request.card_id] = {
          encounter_id: request.encounter_id, status: 'open', unit_revision: 1, rating: null,
        }
      }
      persisted.version += 1
      persisted.plan_version = persisted.version
      return reply(route, persisted)
    }
    return reply(route, { detail: `Unmocked round endpoint: ${pathname}` }, 503)
  })
  await page.route('**/api/v1/freestyle/overview**', async (route: Route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        round: null,
        today: { due_count: 2, overdue_count: 0, new_palace_count: 0 },
        yesterday: { date: '2026-10-11', learned_units: 0, rated_count: 0, weak_units: [] },
        next_reviews: [],
      }),
    })
  })
  await page.route('**/api/v1/freestyle/queue/build', async (route: Route) => {
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
  await page.route('**/api/v1/review/units/*/sessions', async (route: Route) => {
    const segments = new URL(route.request().url()).pathname.split('/')
    const unitId = decodeURIComponent(segments[segments.length - 2])
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ item: sessionItem(unitId) }),
    })
  })
  await page.route('**/api/v1/freestyle/rounds/*/ratings', async (route: Route) => {
    const body = route.request().postDataJSON() as {
      operation_id: string
      rating: number
      encounter_id: string
      study_session_id: string
      unit_id: string
      unit_revision: number
      card_id?: string
    }
    const effect = EFFECTS.find((item) => item.rating === body.rating) ?? EFFECTS[2]
    const ratedCardId = body.card_id || SOURCE_ID
    const isRetry = ratedCardId === RETRY_ID
    if (persisted) {
      persisted.version += 1
      persisted.plan_version = persisted.version
      if (effect.passed) {
        persisted.plan.completed_ids = [...new Set([...persisted.plan.completed_ids, SOURCE_ID, ratedCardId])]
      }
      const occurrence = persisted.plan.occurrences.find((item) => item.occurrence_id === RETRY_ID)
      if (occurrence) {
        occurrence.rating = body.rating
        occurrence.status = isRetry ? (effect.passed ? 'completed' : 'inserted') : occurrence.status
        occurrence.encounter_id = body.encounter_id
        occurrence.available_at = effect.passed ? null : NEXT_READY_AT
      }
      persisted.plan.encounters[ratedCardId] = {
        encounter_id: body.encounter_id,
        status: effect.passed ? 'passed' : 'failed',
        unit_revision: body.unit_revision,
        rating: body.rating,
      }
      persisted.current_card_id = ratedCardId
      persisted.plan.current_card_id = ratedCardId
      persisted.plan.current_index = persisted.plan.presented_ids.indexOf(ratedCardId)
      persisted.waiting = effect.passed ? { count: 0, next_ready_at: null } : { count: 1, next_ready_at: NEXT_READY_AT }
    }
    const unit = sessionItem(body.unit_id).units[0]
    const encounter = {
      ...unit.encounter,
      id: body.encounter_id,
      selected_rating: body.rating,
      passed: effect.passed,
      retry_after_cards: effect.retry_after_cards,
      effective_operation_id: body.operation_id,
    }
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        item: {
          operation_id: body.operation_id,
          study_session_id: body.study_session_id,
          encounter_id: body.encounter_id,
          amended: false,
          unit: {
            ...unit,
            stage_index: effect.target_stage_index,
            interval_days: effect.target_interval_days,
            has_passed: effect.passed,
            due_date: effect.target_due_date,
            due: !effect.passed,
            session_status: effect.passed ? 'passed' : 'retry',
            final_rating: body.rating,
            encounter,
          },
          passed: effect.passed,
          retry_after_cards: effect.retry_after_cards,
          rating: body.rating,
          rating_label: effect.label,
          session_status: effect.passed ? 'passed' : 'retry',
          encounter,
          intraday_due_at: effect.passed ? null : NEXT_READY_AT,
          intraday_exhausted: false,
        },
        round: persisted,
      }),
    })
  })
  return { actions, getRound: () => persisted }
}

function readVisualIndex(page: Page) {
  return page.getByTestId('freestyle-feed-scroller').evaluate((el) =>
    el.clientHeight ? Math.round(el.scrollTop / el.clientHeight) : -1,
  )
}

async function startFromOverview(page: Page) {
  const start = page.getByRole('button', { name: '开始学习' })
  await expect(start).toBeEnabled()
  await start.click()
  await expect(page.getByTestId('freestyle-start-overview')).toHaveCount(0)
}

/** Whether the page under the viewport is the 重练 card. */
function activeRetry(page: Page) {
  return page.getByTestId('freestyle-feed-scroller').evaluate((el) => {
    const top = el.getBoundingClientRect().top
    const pages = Array.from(el.querySelectorAll(':scope > .fs-page'))
    const active = pages.find((node) => Math.abs(node.getBoundingClientRect().top - top) < 4)
    return Boolean(active?.querySelector('[data-testid="freestyle-retry-corner-badge"]'))
  })
}

/** Walk from the source card onto its 重练 card (cold open may already sit on it). */
async function openRetryCard(page: Page) {
  // Let the cold-open hydration paint before the learner turns a page; the cold
  // open itself is allowed to land on the earliest unrated card.
  await page.waitForTimeout(2000)
  for (let step = 0; step < 3; step += 1) {
    if (await activeRetry(page)) break
    await page.getByRole('button', { name: '下一张' }).click()
    await page.waitForTimeout(700)
  }
  await expect.poll(() => activeRetry(page)).toBe(true)
  await expect(page.getByText(/↻重练第 1 次/)).toBeVisible()
}

for (const rating of [
  { value: 1, label: '忘记' },
  { value: 3, label: '记得' },
] as const) {
  test(`keeps the 重练 card under the viewport after rating ${rating.label}`, async ({ page }, testInfo) => {
    await installRoutes(page)
    await page.goto('/freestyle')
    await startFromOverview(page)
    await openRetryCard(page)
    const retryIndex = await readVisualIndex(page)

    const button = page.getByTestId(`freestyle-rating-button-${rating.value}`)
    await expect(button).toBeEnabled()
    await button.click()
    await expect(button).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('freestyle-rating-effect-line')).toContainText(`已选${rating.label}`)
    await expect(page.getByTestId('freestyle-rating-saving-line')).toHaveCount(0)
    await expect(page.getByTestId('freestyle-rating-unsaved-line')).toHaveCount(0)

    // The just-scored 重练 stays this round's history under the viewport.
    await expect(page.getByText(/↻重练第 1 次/)).toBeVisible()
    expect(await readVisualIndex(page)).toBe(retryIndex)
    await expect(page.getByTestId('freestyle-rating-bar')).toBeVisible()
    await testInfo.attach('评分后重练卡保持原位', {
      body: await page.screenshot(),
      contentType: 'image/png',
    })
  })
}

test('a reflow after the rating ack does not turn the page onto the next unit', async ({ page }) => {
  const routes = await installRoutes(page)
  await page.goto('/freestyle')
  await startFromOverview(page)
  await openRetryCard(page)

  const retryIndex = await readVisualIndex(page)
  const cursorsBefore = routes.actions.filter((action) => action.action === 'set_cursor').length
  const remember = page.getByTestId('freestyle-rating-button-3')
  await remember.click()
  await expect(remember).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('freestyle-rating-effect-line')).toContainText('已选记得')
  await expect(page.getByTestId('freestyle-rating-saving-line')).toHaveCount(0)
  await expect(page.getByTestId('freestyle-rating-unsaved-line')).toHaveCount(0)
  // A rating ack re-renders the feed; a reflow / native snap can move the
  // scroller by a page with nobody touching the screen. That must not become a
  // page turn — the committed card is still the 重练 the learner just scored.
  await page.getByTestId('freestyle-feed-scroller').evaluate((el, index: number) => {
    el.scrollTop = el.clientHeight * (index + 1)
  }, retryIndex)
  await page.waitForTimeout(600)
  await expect.poll(() => readVisualIndex(page)).toBe(retryIndex)
  await expect(page.getByText(/↻重练第 1 次/)).toBeVisible()
  const cursors = routes.actions.filter((action) => action.action === 'set_cursor')
  expect(cursors.length).toBe(cursorsBefore)
  expect(cursors.every((action) => action.card_id !== NEXT_ID)).toBe(true)
})
