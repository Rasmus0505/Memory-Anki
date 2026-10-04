import { expect, test, type Page, type Route } from './fixtures'

/**
 * Hermetic guard for the right-side 完成 button while a round is still open:
 * each press walks to the next unscored card in queue order and wraps. (The
 * removed-card exclusion is unit-tested in
 * `hooks/useFreestyleFeedNavigation.complete.test.tsx` and `unitProgressState`;
 * 移除本队列 cannot be driven here because every other /api call is 503, which
 * remounts the rating bar between the arm and confirm presses.)
 */
const EFFECTS = [
  { rating: 1, label: '忘记', passed: false, target_stage_index: 0, target_interval_days: 0, target_actual_interval_days: 0, target_due_date: '2026-07-27', retry_after_cards: 3, stage_action: 'reset' },
  { rating: 2, label: '困难', passed: false, target_stage_index: 0, target_interval_days: 0, target_actual_interval_days: 0, target_due_date: '2026-07-27', retry_after_cards: 3, stage_action: 'keep' },
  { rating: 3, label: '记得', passed: true, target_stage_index: 1, target_interval_days: 1, target_actual_interval_days: 1, target_due_date: '2026-07-28', retry_after_cards: 0, stage_action: 'advance' },
  { rating: 4, label: '轻松', passed: true, target_stage_index: 2, target_interval_days: 3, target_actual_interval_days: 3, target_due_date: '2026-07-30', retry_after_cards: 0, stage_action: 'advance' },
]

const UNITS = ['e2e-a', 'e2e-b', 'e2e-c', 'e2e-d']

function queueBody(request: { operation_id: string; round_id: string; config: unknown }) {
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
        effective_seconds: null,
        closed_at: null,
        rating_effects: EFFECTS,
      },
    }],
    pending_unit_count: 1,
    completed_unit_count: 0,
  }
}

async function installRoutes(page: Page) {
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

  await complete.click()
  await expect.poll(() => readVisualIndex(page)).toBe(1)

  await complete.click()
  await expect.poll(() => readVisualIndex(page)).toBe(2)

  await complete.click()
  await expect.poll(() => readVisualIndex(page)).toBe(3)

  await complete.click()
  await expect.poll(() => readVisualIndex(page)).toBe(0)
})
