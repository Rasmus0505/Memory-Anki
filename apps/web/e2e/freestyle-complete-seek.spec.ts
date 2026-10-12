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
const EFFECTS = [
  { rating: 1, label: '忘记', passed: false, target_stage_index: 0, target_interval_days: 0, target_actual_interval_days: 0, target_due_date: '2026-07-27', retry_after_cards: 3, stage_action: 'reset' },
  { rating: 2, label: '困难', passed: false, target_stage_index: 0, target_interval_days: 0, target_actual_interval_days: 0, target_due_date: '2026-07-27', retry_after_cards: 3, stage_action: 'keep' },
  { rating: 3, label: '记得', passed: true, target_stage_index: 1, target_interval_days: 1, target_actual_interval_days: 1, target_due_date: '2026-07-28', retry_after_cards: 0, stage_action: 'advance' },
  { rating: 4, label: '轻松', passed: true, target_stage_index: 2, target_interval_days: 3, target_actual_interval_days: 3, target_due_date: '2026-07-30', retry_after_cards: 0, stage_action: 'advance' },
]

const UNITS = ['e2e-a', 'e2e-b', 'e2e-c', 'e2e-d']
const ROUND_ID = 'round-e2e-seek'

function queueBody(request: { operation_id: string; round_id?: string; config: unknown }) {
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
    round_meta: { candidate_count: UNITS.length, scheduled_count: UNITS.length, queue_limit: 20, limit_reached: false },
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

async function installRoutes(page: Page, options: { clearFails?: boolean } = {}) {
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
      return reply(route, { detail: 'This scenario must not start another round' }, 422)
    }
    if (pathname.endsWith('/active') && method === 'POST') {
      const request = route.request().postDataJSON() as FreestyleRoundActiveRequest
      if (!persisted) {
        const cards = queueBody(request).cards
        persisted = {
          round_id: ROUND_ID, scope_key: request.scope_key, status: 'active',
          version: 1, plan_version: 1, config: request.config, workspace: 'primary',
          current_card_id: cards[0].id, last_operation_id: request.operation_id,
          updated_at: new Date().toISOString(), conflict: false, duplicate: false,
          plan: {
            original_cards: cards.map((card) => ({
              card_id: card.id, unit_id: card.unit_id, unit_revision: 1,
              kind: card.type, palace_id: 1, palace_title: card.palace_title,
              label: `单元 ${card.unit_id}`, entered_on: '2026-07-27',
            })),
            presented_ids: cards.map((card) => card.id), current_card_id: cards[0].id,
            current_index: 0, completed_ids: [], excluded_ids: [], compressed_ids: [],
            occurrences: [], encounters: {}, partial_settlements: [],
          },
        }
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
      if (!['set_cursor', 'set_encounter', 'leave_card', 'bind_cards'].includes(request.action)) {
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
  await page.route('**/api/v1/freestyle/queue/build', async (route: Route) => {
    const request = route.request().postDataJSON() as {
      operation_id: string
      round_id: string
      config: unknown
    }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(queueBody(request)) })
  })
  await page.route('**/api/v1/review/units/*/sessions', async (route: Route) => {
    const segments = new URL(route.request().url()).pathname.split('/')
    const unitId = decodeURIComponent(segments[segments.length - 2])
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ item: sessionItem(unitId) }),
    })
  })
  return { activeRoundIds, actions, clearRequests, starts, getRound: () => persisted }
}

function readVisualIndex(page: Page) {
  return page.getByTestId('freestyle-feed-scroller').evaluate((el) =>
    el.clientHeight ? Math.round(el.scrollTop / el.clientHeight) : -1,
  )
}

test('完成 walks the unscored cards one by one and wraps', async ({ page }) => {
  await installRoutes(page)
  await page.goto('/freestyle')

  const scroller = page.getByTestId('freestyle-feed-scroller')
  await expect(scroller).toBeVisible()
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
