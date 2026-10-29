import { expect, test, type Page, type Route } from './fixtures'
import type {
  FreestyleRoundActionRequest,
  FreestyleRoundActiveRequest,
  FreestyleRoundStatePayload,
} from '../src/shared/api/contracts/freestyle'

/**
 * Hermetic guard for the right-side 完成 button while a round is still open:
 * each press walks to the next unscored card in queue order and wraps.
 * The persisted round is authoritative across finish, resume and page reload.
 * All APIs stay hermetic; unsupported round mutations fail rather than silently
 * pretending a successful persistence operation.
 */
// FSRS books every rating at a real interval; `target_stage_index` is only the
// compat projection of `target_interval_days`.
const EFFECTS = [
  { rating: 1, label: '忘记', passed: false, target_stage_index: 0, target_interval_days: 0, target_actual_interval_days: 0, target_due_date: '2026-07-27', retry_after_cards: 3, stage_action: 'reset' },
  { rating: 2, label: '困难', passed: true, target_stage_index: 1, target_interval_days: 2, target_actual_interval_days: 2, target_due_date: '2026-07-29', retry_after_cards: 0, stage_action: 'lower' },
  { rating: 3, label: '记得', passed: true, target_stage_index: 2, target_interval_days: 3, target_actual_interval_days: 3, target_due_date: '2026-07-30', retry_after_cards: 0, stage_action: 'advance' },
  { rating: 4, label: '轻松', passed: true, target_stage_index: 3, target_interval_days: 7, target_actual_interval_days: 7, target_due_date: '2026-08-03', retry_after_cards: 0, stage_action: 'advance' },
]

const UNITS = ['e2e-a', 'e2e-b', 'e2e-c', 'e2e-d']
const ROUND_ID = 'round-e2e-seek'

const NEXT_READY_AT = '2026-10-25T12:13:32.633397'

function queueBody(
  request: { operation_id: string; round_id?: string; config: unknown },
  waiting = 0,
) {
  return {
    operation_id: request.operation_id,
    round_id: request.round_id,
    config: request.config,
    cards: UNITS.map((unit) => ({
      id: `review_unit:${unit}:r1`,
      type: 'mindmap_branch',
      content_type: 'mindmap_branch',
      palace_id: 1,
      palace_title: '寻位宫殿',
      anchor_uid: unit,
      context_path: [{ uid: 'root', text: '寻位宫殿' }],
      node_uids: [unit],
      node_count: 1,
      unit_id: unit,
      unit_revision: 1,
    })),
    phase_stats: { candidate_count: UNITS.length, scheduled_count: UNITS.length, queue_limit: 20 },
    round_meta: {
      candidate_count: UNITS.length,
      scheduled_count: UNITS.length,
      queue_limit: 20,
      limit_reached: false,
      ...(waiting > 0 ? { waiting_count: waiting, next_ready_at: NEXT_READY_AT } : {}),
    },
    counts: { mindmap_branch: UNITS.length, anki_card: 0, quiz_question: 0, total: UNITS.length },
  }
}

function sessionItem(unitId: string) {
  return {
    id: `session:${unitId}`,
    palace_id: 1,
    title: '寻位宫殿',
    status: 'active',
    palace: {
      id: 1,
      title: '寻位宫殿',
      editor_doc: { root: { data: { uid: 'root', text: '寻位宫殿' }, children: [] } },
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
        round_id: 'round-e2e-seek',
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

async function installRoutes(
  page: Page,
  options: {
    clearFails?: boolean
    completedCount?: number
    rateable?: boolean
    /** Allow 结算 to open the next round; otherwise /start is rejected. */
    startable?: boolean
    /** Same-day 回顾 still owed: the round has no servable card left to rate. */
    waiting?: number
  } = {},
) {
  let persisted: FreestyleRoundStatePayload | null = null
  const activeRoundIds: string[] = []
  const actions: string[] = []
  const clearRequests: unknown[] = []
  const starts: string[] = []
  const reply = (route: Route, body: unknown, status = 200) => route.fulfill({
    status, contentType: 'application/json', body: JSON.stringify(body),
  })
  await page.route('**/api/v1/freestyle/rounds/**', async (route: Route) => {
    const pathname = new URL(route.request().url()).pathname
    const method = route.request().method()
    if (pathname.endsWith('/start')) {
      starts.push(pathname)
      if (!options.startable) {
        return reply(route, { detail: 'This scenario must not start another round' }, 422)
      }
      // 结算 starts the next round with the saved config.
      const request = route.request().postDataJSON() as FreestyleRoundActiveRequest
      persisted = {
        round_id: `${ROUND_ID}-next`, scope_key: request.scope_key, status: 'active',
        version: 1, plan_version: 1, config: request.config, workspace: 'primary',
        current_card_id: null, last_operation_id: request.operation_id,
        updated_at: new Date().toISOString(), conflict: false, duplicate: false,
        plan: {
          original_cards: [], presented_ids: [], current_card_id: null, current_index: 0,
          completed_ids: [], excluded_ids: [], compressed_ids: [],
          occurrences: [], encounters: {}, partial_settlements: [],
        },
      }
      return reply(route, persisted)
    }
    if (pathname.endsWith('/active') && method === 'POST') {
      const request = route.request().postDataJSON() as FreestyleRoundActiveRequest
      if (!persisted) {
        const cards = queueBody(request).cards
        const completedCount = options.completedCount ?? 0
        const cursorIndex = completedCount > 0 ? completedCount - 1 : 0
        persisted = {
          round_id: ROUND_ID, scope_key: request.scope_key, status: 'active',
          version: 1, plan_version: 1, config: request.config, workspace: 'primary',
          current_card_id: cards[cursorIndex].id, last_operation_id: request.operation_id,
          updated_at: new Date().toISOString(), conflict: false, duplicate: false,
          plan: {
            original_cards: cards.map((card) => ({
              card_id: card.id, unit_id: card.unit_id, unit_revision: 1,
              kind: card.type, palace_id: 1, palace_title: card.palace_title,
              label: `单元 ${card.unit_id}`, entered_on: '2026-07-27',
            })),
            presented_ids: cards.map((card) => card.id), current_card_id: cards[cursorIndex].id,
            current_index: cursorIndex,
            completed_ids: cards.slice(0, completedCount).map((card) => card.id),
            excluded_ids: [], compressed_ids: [],
            occurrences: [], encounters: {}, partial_settlements: [],
          },
        }
      }
      if (options.waiting) {
        persisted.waiting = { count: options.waiting, next_ready_at: NEXT_READY_AT }
      }
      activeRoundIds.push(persisted.round_id)
      return reply(route, persisted)
    }
    if (!persisted) return reply(route, { detail: 'No active round' }, 404)
    if (method === 'GET' && (pathname.endsWith('/active') || pathname.endsWith(`/${ROUND_ID}`))) {
      activeRoundIds.push(persisted.round_id)
      return reply(route, persisted)
    }
    if (pathname.endsWith('/actions') && method === 'POST') {
      const request = route.request().postDataJSON() as FreestyleRoundActionRequest
      actions.push(request.action)
      if (!['set_cursor', 'set_encounter', 'leave_card', 'bind_cards', 'compress_completed'].includes(request.action)) {
        return reply(route, { detail: `Unexpected round action: ${request.action}` }, 422)
      }
      if (request.action === 'compress_completed') {
        // The server settles every scored group and echoes the ids back.
        const settled = [...persisted.plan.presented_ids]
        persisted.plan.compressed_ids = [...new Set([...persisted.plan.compressed_ids, ...settled])]
        persisted.plan.partial_settlements = request.partial_settlement
          ? [...persisted.plan.partial_settlements, request.partial_settlement]
          : persisted.plan.partial_settlements
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
      persisted.last_operation_id = request.operation_id
      persisted.version += 1
      persisted.plan_version = persisted.version
      return reply(route, persisted)
    }
    if (pathname.endsWith('/overlay-quiz/drop-palaces')) {
      clearRequests.push(route.request().postDataJSON())
      return reply(route, { detail: 'e2e: explicit clear rejected' }, options.clearFails ? 500 : 422)
    }
    return reply(route, { detail: `Unmocked round endpoint: ${pathname}` }, 503)
  })
  await page.route('**/api/v1/freestyle/overview**', async (route: Route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        round: null,
        today: { due_count: UNITS.length, overdue_count: 0, new_palace_count: 0 },
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
      body: JSON.stringify(queueBody(request, options.waiting ?? 0)),
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
  if (options.rateable) {
    await page.route('**/api/v1/freestyle/rounds/*/ratings', async (route: Route) => {
      const body = route.request().postDataJSON() as {
        operation_id: string
        rating: number
        encounter_id: string
        study_session_id: string
        unit_id: string
        unit_revision: number
      }
      const effect = EFFECTS.find((item) => item.rating === body.rating) ?? EFFECTS[2]
      const cardId = `review_unit:${body.unit_id}:r1`
      if (persisted) {
        persisted.plan.completed_ids = [...new Set([...persisted.plan.completed_ids, cardId])]
        persisted.plan.current_card_id = cardId
        persisted.plan.current_index = persisted.plan.presented_ids.indexOf(cardId)
        persisted.current_card_id = cardId
        persisted.version += 1
        persisted.plan_version = persisted.version
      }
      const unit = sessionItem(body.unit_id).units[0]
      const encounter = {
        ...unit.encounter,
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
          },
          round: persisted,
        }),
      })
    })
  }
  return { activeRoundIds, actions, clearRequests, starts, getRound: () => persisted }
}

function readVisualIndex(page: Page) {
  return page.getByTestId('freestyle-feed-scroller').evaluate((el) =>
    el.clientHeight ? Math.round(el.scrollTop / el.clientHeight) : -1,
  )
}

/** The start overview gates the whole stage until 开始学习 closes it. */
async function startFromOverview(page: Page) {
  const start = page.getByRole('button', { name: '开始学习' })
  await expect(start).toBeEnabled()
  await start.click()
  await expect(page.getByTestId('freestyle-start-overview')).toHaveCount(0)
}

/**
 * The pager is one vertical column on the right edge, centred on the card —
 * the same control on PWA and desktop, never a strip over the rating dock.
 */
async function expectPagerOnRightColumn(page: Page) {
  const pagerBox = await page.getByTestId('freestyle-feed-pager').boundingBox()
  const stageBox = await page.getByTestId('freestyle-feed-scroller').boundingBox()
  expect(pagerBox).not.toBeNull()
  expect(stageBox).not.toBeNull()
  const pagerCenter = pagerBox!.y + pagerBox!.height / 2
  const stageCenter = stageBox!.y + stageBox!.height / 2
  expect(Math.abs(pagerCenter - stageCenter)).toBeLessThan(24)
  expect(pagerBox!.x + pagerBox!.width).toBeGreaterThanOrEqual(stageBox!.x + stageBox!.width - 16)
  expect(pagerBox!.height).toBeGreaterThan(pagerBox!.width)
}

test('完成 walks the unscored cards one by one and wraps', async ({ page }) => {
  await installRoutes(page)
  await page.goto('/freestyle')
  await startFromOverview(page)

  const scroller = page.getByTestId('freestyle-feed-scroller')
  await expect(scroller).toBeVisible()
  await expectPagerOnRightColumn(page)
  const complete = page.getByRole('button', { name: '完成' })
  await expect(complete).toBeEnabled()

  await expect.poll(() => readVisualIndex(page)).toBe(0)
  // The initial silent queue rebuild can land after an early click and revert it.
  await page.waitForLoadState('networkidle')

  await complete.click()
  await expect.poll(() => readVisualIndex(page)).toBe(1)

  await complete.click()
  await expect.poll(() => readVisualIndex(page)).toBe(2)

  await complete.click()
  await expect.poll(() => readVisualIndex(page)).toBe(3)

  await complete.click()
  await expect.poll(() => readVisualIndex(page)).toBe(0)
})

test('完成 on a fully scored round settles the rated units and clears the queue', async ({ page }) => {
  const routes = await installRoutes(page, {
    completedCount: UNITS.length - 1,
    rateable: true,
    startable: true,
  })
  await page.goto('/freestyle')
  await startFromOverview(page)

  // The round still has one unscored unit, so 完成 seeks it instead of settling.
  const pager = page.getByTestId('freestyle-feed-pager')
  await expect.poll(() => readVisualIndex(page)).toBe(UNITS.length - 1)

  // Rate the last unit: every presented card is now scored.
  const remember = page.getByTestId('freestyle-rating-button-3')
  await expect(remember).toBeEnabled()
  await remember.evaluate((button: HTMLButtonElement) => button.click())
  await expect(remember).toHaveAttribute('aria-pressed', 'true')

  // Pressing 完成 here is a real completion, so it settles the rated units
  // instead of only scrolling to the summary.
  const complete = pager.getByRole('button', { name: '完成' })
  await expect(complete).toBeEnabled()
  await complete.click()

  // The rated units leave the rail, the plan and the swipe feed: only the
  // closing settlement is left, and there is no card to page back to.
  await expect(page.getByTestId('freestyle-round-complete')).toBeVisible()
  await expect(page.getByTestId('freestyle-progress-segment')).toHaveCount(0)
  await expect(page.getByTestId('freestyle-feed-pager')).toHaveCount(0)
  await expect(page.getByTestId('freestyle-round-cancel-settlement')).toHaveCount(0)
  expect(routes.actions).toContain('compress_completed')

  // The closing page keeps exactly two actions, and 结算 goes straight on to
  // the next round without asking for the quiz choice first.
  const settlement = page.getByTestId('freestyle-round-complete')
  await expect(settlement.getByTestId('freestyle-round-settle')).toBeEnabled()
  await expect(settlement.getByRole('button', { name: '再来一轮' })).toHaveCount(0)
  await settlement.getByTestId('freestyle-round-settle').click()
  await expect.poll(() => routes.starts.length).toBe(1)
})

test('完成 never dead-ends while a 20 分钟回顾 is still owed', async ({ page }) => {
  // The state the learner reported: every presented card scored, but two same-day
  // re-checks are still booked for later. The button used to disable itself here.
  const routes = await installRoutes(page, {
    completedCount: UNITS.length - 1,
    rateable: true,
    startable: true,
    waiting: 2,
  })
  await page.goto('/freestyle')
  await startFromOverview(page)

  await expect.poll(() => readVisualIndex(page)).toBe(UNITS.length - 1)
  const remember = page.getByTestId('freestyle-rating-button-3')
  await expect(remember).toBeEnabled()
  await remember.evaluate((button: HTMLButtonElement) => button.click())
  await expect(remember).toHaveAttribute('aria-pressed', 'true')

  const complete = page.getByTestId('freestyle-feed-pager').getByRole('button', { name: '完成' })
  await expect(complete).toBeEnabled()
  await complete.click()

  // It opens the closing page instead of compressing groups the server still
  // holds, and names what is still owed so 结算 is an informed choice.
  await expect(page.getByTestId('freestyle-round-complete')).toBeVisible()
  await expect(page.getByTestId('freestyle-round-pending-reviews')).toContainText('还有 2 张稍后回顾')
  expect(routes.actions).not.toContain('compress_completed')
})
