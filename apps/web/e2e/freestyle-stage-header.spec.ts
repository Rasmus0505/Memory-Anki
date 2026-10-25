import { expect, test, type Page } from './fixtures'

/**
 * Layout contract for the immersive stage header.
 *
 * The header is one in-flow band: a progress hairline, palace + round count +
 * actions, and a single truncated milestone line. The card sheet starts at the
 * header's bottom edge (nothing floats over it), and inside the sheet the map
 * toolbar owns the top edge with the unit title row beneath it.
 *
 * Hermetic: every /api call is answered here; the fixture 503s the rest.
 */

const EFFECTS = [
  { rating: 1, label: '忘记', passed: false, target_stage_index: 0, target_interval_days: 0, target_actual_interval_days: 0, target_due_date: '2026-10-25', retry_after_cards: 3, stage_action: 'reset' },
  { rating: 2, label: '困难', passed: false, target_stage_index: 0, target_interval_days: 0, target_actual_interval_days: 0, target_due_date: '2026-10-25', retry_after_cards: 3, stage_action: 'keep' },
  { rating: 3, label: '记得', passed: true, target_stage_index: 2, target_interval_days: 3, target_actual_interval_days: 3, target_due_date: '2026-10-28', retry_after_cards: 0, stage_action: 'advance' },
  { rating: 4, label: '轻松', passed: true, target_stage_index: 3, target_interval_days: 7, target_actual_interval_days: 7, target_due_date: '2026-11-01', retry_after_cards: 0, stage_action: 'advance' },
]

const DOC = {
  root: {
    data: { uid: 'root', text: '中国教育史' },
    children: [{
      data: { uid: 'sec2', text: '第二节 汉代的学校教育制度' },
      children: [
        { data: { uid: 'u1', text: '地方官学' }, children: [] },
        { data: { uid: 'u2', text: '太学：中央官学' }, children: [] },
      ],
    }],
  },
}

function queueBody(request: { operation_id: string; round_id: string; config: unknown }) {
  return {
    operation_id: request.operation_id,
    round_id: request.round_id,
    config: request.config,
    cards: [{
      id: 'review_unit:e2e-header:r1',
      type: 'mindmap_branch',
      content_type: 'mindmap_branch',
      palace_id: 1,
      palace_title: '中国教育史',
      anchor_uid: 'u1',
      context_path: [
        { uid: 'root', text: '中国教育史' },
        { uid: 'sec2', text: '第二节 汉代的学校教育制度' },
      ],
      node_uids: ['u1'],
      node_count: 1,
      unit_id: 'e2e-header',
      unit_revision: 1,
    }],
    phase_stats: { candidate_count: 55, scheduled_count: 55, queue_limit: 60 },
    round_meta: { candidate_count: 55, scheduled_count: 55, queue_limit: 60, limit_reached: false },
    counts: { mindmap_branch: 1, anki_card: 0, quiz_question: 0, total: 1 },
  }
}

function sessionBody() {
  return {
    id: 'session:e2e-header',
    palace_id: 1,
    title: '中国教育史',
    status: 'active',
    palace: { id: 1, title: '中国教育史', editor_doc: DOC },
    units: [{
      id: 'e2e-header',
      palace_id: 1,
      anchor_uid: 'u1',
      unit_kind: 'marked',
      title: '地方官学',
      node_uids: ['u1'],
      revision: 1,
      stage_index: 2,
      interval_days: 6,
      has_passed: true,
      due_date: '2026-10-25',
      due: true,
      session_status: 'pending',
      retry_count: 0,
      hard_count: 0,
      again_count: 0,
      final_rating: null,
      encounter: {
        id: 'encounter-e2e-header',
        round_id: 'round-e2e-header',
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

async function installRoutes(page: Page) {
  await page.route('**/api/v1/exam/overview**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      settings: { exam_date: '2026-12-21' },
      today: '2026-10-25',
      days_left: 57,
      totals: {},
      subjects: [],
      stars: [],
      palaces: [],
      chapters: [],
      weak: [],
      retention: { projected: [], observed: [] },
      star_rule: { source_derived: '', description: '' },
    }),
  }))
  await page.route('**/api/v1/freestyle/overview**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      round: { round_id: 'round-e2e-header', counts: { remaining_units: 55, remaining_palaces: 6 } },
      today: { due_count: 55, due_palace_count: 6, overdue_count: 0, new_unit_count: 12, new_palace_count: 1 },
      yesterday: { date: '2026-10-24', learned_units: 18, rated_count: 24, weak_units: [] },
      next_reviews: [],
      milestones: {
        today: '2026-10-25',
        overdue_count: 0,
        groups: [
          { date: '2026-10-31', days_left: 6, items: [{ id: 'm1', title: '中国教育史完成', category: '', detail: '' }] },
          { date: '2026-11-05', days_left: 11, items: [{ id: 'm2', title: '教育学原理完成', category: '', detail: '' }] },
        ],
      },
    }),
  }))
  await page.route('**/api/v1/freestyle/queue/build', (route) => {
    const request = route.request().postDataJSON() as { operation_id: string; round_id: string; config: unknown }
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(queueBody(request)) })
  })
  await page.route('**/api/v1/review/units/e2e-header/sessions', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ item: sessionBody() }),
  }))
  await page.route('**/api/v1/review/session/**/close', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      item: {
        operation_id: 'close',
        encounter: { ...sessionBody().units[0].encounter, status: 'closed' },
        passed: true,
        retry_after_cards: 0,
        session_status: 'passed',
        completion: null,
      },
    }),
  }))
}

for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
  test(`stage header owns the top band at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await installRoutes(page)
    await page.goto('/freestyle')
    const start = page.getByRole('button', { name: /^(开始学习|直接开始学习)$/ })
    await expect(start).toBeVisible()
    await start.click()
    await expect(page.getByTestId('freestyle-start-overview')).toHaveCount(0)
    await expect(page.getByTestId('freestyle-rating-bar')).toBeVisible()

    // The card's sheet starts exactly at the header's bottom edge: no overlay
    // reserve, no floating milestone pill on top of the title row.
    const header = await page.getByTestId('freestyle-stage-header').boundingBox()
    const feed = await page.getByTestId('freestyle-feed-scroller').boundingBox()
    expect(header).not.toBeNull()
    expect(feed).not.toBeNull()
    expect(header!.height).toBeLessThanOrEqual(100)
    expect(Math.abs((header!.y + header!.height) - feed!.y)).toBeLessThanOrEqual(2)

    // The one-line milestone never wraps into a block.
    const milestone = await page.getByTestId('freestyle-milestone-line').boundingBox()
    expect(milestone).not.toBeNull()
    expect(milestone!.height).toBeLessThanOrEqual(24)

    // Inside the sheet: map toolbar first, unit title row under it.
    const toolbar = await page.getByRole('button', { name: '适应整树' }).boundingBox()
    const identity = await page.getByTestId('flip-progress-badge').boundingBox()
    expect(toolbar).not.toBeNull()
    expect(identity).not.toBeNull()
    expect(toolbar!.y).toBeLessThan(identity!.y)
    expect(identity!.y).toBeGreaterThanOrEqual(feed!.y)
  })
}
