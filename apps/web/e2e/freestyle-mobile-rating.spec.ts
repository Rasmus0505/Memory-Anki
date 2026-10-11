import { expect, test } from './fixtures'

const viewports = [
  { width: 375, height: 812 },
  { width: 390, height: 844 },
]

for (const viewport of viewports) {
  test(`keeps the loading rating bar visible at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('mobile'), 'mobile layout regression')
    await page.setViewportSize(viewport)

    await page.route('**/api/v1/freestyle/queue/build', async (route) => {
      const request = route.request().postDataJSON() as {
        operation_id: string
        round_id: string
        config: unknown
      }
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          operation_id: request.operation_id,
          round_id: request.round_id,
          config: request.config,
          cards: [{
            id: 'review_unit:e2e-mobile:r1',
            type: 'mindmap_branch',
            content_type: 'mindmap_branch',
            palace_id: 1,
            palace_title: '移动端评分宫殿',
            anchor_uid: 'unit',
            context_path: [{ uid: 'root', text: '移动端评分宫殿' }],
            node_uids: ['unit'],
            node_count: 1,
            unit_id: 'e2e-mobile',
            unit_revision: 1,
          }],
          phase_stats: { candidate_count: 1, scheduled_count: 1, queue_limit: 20 },
          round_meta: { candidate_count: 1, scheduled_count: 1, queue_limit: 20, limit_reached: false },
          counts: { mindmap_branch: 1, anki_card: 0, quiz_question: 0, total: 1 },
        }),
      })
    })
    // Input remains available while the glance opens, but no score is recorded yet.
    await page.route('**/api/v1/review/units/e2e-mobile/sessions', () => new Promise(() => undefined))
    let ratingPosts = 0
    await page.route('**/api/v1/freestyle/rounds/*/ratings', async (route) => {
      ratingPosts += 1
      await route.fulfill({ status: 500, body: 'Unexpected score before session readiness' })
    })

    await page.goto('/freestyle')

    const ratingBar = page.getByTestId('freestyle-rating-bar')
    await expect(ratingBar).toBeVisible()
    for (const rating of [1, 2, 3, 4]) {
      const button = page.getByTestId(`freestyle-rating-button-${rating}`)
      await expect(button).toBeVisible()
      await expect(button).toBeEnabled()
    }
    const remove = page.getByTestId('freestyle-rating-button-remove')
    await expect(remove).toBeVisible()
    await expect(remove).toBeEnabled()

    const barBox = await ratingBar.boundingBox()
    const nextButtonBox = await page.getByRole('button', { name: '下一张' }).boundingBox()
    expect(barBox).not.toBeNull()
    expect(nextButtonBox).not.toBeNull()
    expect((barBox?.y ?? 0) + (barBox?.height ?? 0)).toBeLessThanOrEqual(viewport.height)
    expect((nextButtonBox?.y ?? viewport.height) + (nextButtonBox?.height ?? 0)).toBeLessThanOrEqual(barBox?.y ?? 0)

    const remember = page.getByTestId('freestyle-rating-button-3')
    await remember.click()
    await expect(remember).toHaveAttribute('aria-pressed', 'true')
    await expect(ratingBar).toBeVisible()
    await expect(page.getByTestId('freestyle-round-complete')).not.toBeVisible()
    await expect(page.getByText(/今日到期已清/)).not.toBeVisible()
    expect(ratingPosts).toBe(0)
  })
}
