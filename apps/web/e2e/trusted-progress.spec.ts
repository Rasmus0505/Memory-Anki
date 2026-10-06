import { expect, test } from './fixtures'

test('retains unsaved answers across reload and reports recovery honestly', async ({ page }, testInfo) => {
  let online = false
  let saved = false
  const snapshot = {
    items: { '41': { palaceId: 7, state: { resolved: true, correct: true }, updatedAt: '2026-10-07T00:00:00.000Z' } },
    clears: { all: null, palaces: {}, questions: {} },
  }
  await page.addInitScript((value) => {
    if (!localStorage.getItem('memory-anki.quiz.practice-progress.v1')) {
      localStorage.setItem('memory-anki.quiz.practice-progress.v1', JSON.stringify(value))
    }
  }, snapshot)
  await page.route('**/api/v1/quiz/practice-progress', async (route) => {
    const request = route.request()
    if (request.method() === 'PUT' && !online) {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'offline' }) })
      return
    }
    const items = request.method() === 'PUT'
      ? (request.postDataJSON() as { items: unknown[] }).items
      : saved ? [{ question_id: 41, palace_id: 7, state: { resolved: true }, updated_at: '2026-10-07T00:00:00.000Z' }] : []
    if (request.method() === 'PUT') saved = true
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      items, clears: { all: null, palaces: {}, questions: {} },
    }) })
  })
  await page.goto('/dashboard')
  const warning = page.getByText('做题进度尚未同步，换设备前请确认同步完成。', { exact: true })
  await expect(warning).toBeVisible({ timeout: 15_000 })
  await page.screenshot({ path: testInfo.outputPath('pending-progress.png'), fullPage: true })
  await page.reload()
  await expect(warning).toBeVisible({ timeout: 15_000 })
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('memory-anki.quiz.practice-progress.v1') || '{}').items['41'].state.resolved)).toBe(true)
  online = true
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await expect.poll(() => saved).toBe(true)
  await expect(warning).toHaveCount(0)
})
