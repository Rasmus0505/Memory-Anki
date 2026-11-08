import { expect, test, type Page } from './fixtures'

/** 手机弹窗必须实际打开再测量；不能因没找到弹窗而跳过。所有 API 均密封。 */
const PHONES = [
  { width: 375, height: 812 },
  { width: 390, height: 844 },
]

async function leaveFailedOverview(page: Page) {
  await expect(page.getByText('概览暂时读取失败，仍可直接开始学习。')).toBeVisible()
  await page.getByRole('button', { name: '直接开始学习', exact: true }).click()
  await expect(page.getByTestId('freestyle-start-overview')).toHaveCount(0)
}

for (const viewport of PHONES) {
  test(`phone configuration keeps its header and actions reachable at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto('/freestyle')
    await leaveFailedOverview(page)

    const stageHeader = page.getByTestId('freestyle-stage-header')
    await expect(stageHeader).toBeVisible()
    const header = await stageHeader.boundingBox()
    expect(header).not.toBeNull()
    expect(header!.y).toBeGreaterThanOrEqual(0)
    expect(header!.height).toBeLessThanOrEqual(viewport.height * 0.2)

    await page.getByRole('button', { name: '随心配置', exact: true }).click()
    const sheet = page.getByRole('dialog', { name: '随心配置', exact: true })
    await expect(sheet).toBeVisible()
    const box = await sheet.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.y).toBeGreaterThanOrEqual(0)
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1)
    const save = sheet.getByRole('button', { name: '保存配置并重排', exact: true })
    await expect(save).toBeVisible()
    const saveBox = await save.boundingBox()
    expect(saveBox!.y + saveBox!.height).toBeLessThanOrEqual(viewport.height + 1)
    await sheet.getByRole('button', { name: '关闭', exact: true }).click()
    await expect(sheet).toBeHidden()
  })
}

test('quiz window leaves most of the phone to scrollable content while the card opens', async ({ page }, testInfo) => {
  const viewport = { width: 375, height: 812 }
  await page.setViewportSize(viewport)
  await page.route('**/api/v1/freestyle/queue/build', async (route) => {
    const request = route.request().postDataJSON()
    const cards = [{
      id: 'review_unit:e2e-sheet:r1',
      type: 'mindmap_branch',
      content_type: 'mindmap_branch',
      palace_id: 1,
      palace_title: '手机弹窗宫殿',
      anchor_uid: 'unit',
      context_path: [{ uid: 'root', text: '手机弹窗宫殿' }],
      node_uids: ['unit'],
      node_count: 1,
      unit_id: 'e2e-sheet',
      unit_revision: 1,
    }]
    await route.fulfill({
      json: {
        operation_id: request.operation_id,
        round_id: request.round_id,
        config: request.config,
        cards,
        phase_stats: { candidate_count: 1, scheduled_count: 1, queue_limit: 20 },
        round_meta: { candidate_count: 1, scheduled_count: 1, queue_limit: 20, limit_reached: false },
        counts: { mindmap_branch: 1, anki_card: 0, quiz_question: 0, total: 1 },
      },
    })
  })
  // 做题窗口独立于卡片会话，不能等会话打开才出现入口。
  await page.route('**/api/v1/review/units/e2e-sheet/sessions', () => new Promise(() => undefined))
  await page.goto('/freestyle')
  await leaveFailedOverview(page)
  await page.getByTestId('freestyle-quiz-while-opening').click()
  const sheet = page.getByTestId('freestyle-scope-quiz-dialog')
  await expect(sheet).toBeVisible()
  const box = await sheet.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.y).toBeGreaterThanOrEqual(7)
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height - 7)

  // 初次进入显示做题配置；这里测窗口及滚动内容区，不冒充真实题干验证。
  const content = sheet.locator('div.overflow-y-auto').first()
  await expect(content).toBeVisible()
  const contentBox = await content.boundingBox()
  expect(contentBox!.height).toBeGreaterThanOrEqual(viewport.height * 2 / 3)
  expect(contentBox!.y).toBeGreaterThanOrEqual(box!.y)
  expect(contentBox!.y + contentBox!.height).toBeLessThanOrEqual(box!.y + box!.height + 1)
  await testInfo.attach('手机做题窗口保留主要内容区', {
    body: await page.screenshot(), contentType: 'image/png',
  })
  await sheet.getByRole('button', { name: '关闭弹窗', exact: true }).click()
  await expect(sheet).toBeHidden()
})
