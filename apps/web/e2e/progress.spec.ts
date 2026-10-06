import { resolve } from 'node:path'
import { test, expect, type Page } from './fixtures'
import { emptyProgressFixture, progressFixture } from './progressFixture'

async function mockProgress(page: Page, body = progressFixture) {
  await page.route('**/api/v1/dashboard/learning-progress', (route) => route.fulfill({ json: body }))
}

test('progress hierarchy, views, scopes and leaf details survive reload', async ({ page }) => {
  await mockProgress(page)
  await page.goto('/progress')
  await expect(page.getByRole('heading', { name: '进度', exact: true })).toBeVisible()
  await expect(page.getByRole('img', { name: '复习覆盖率 56%' })).toBeVisible()
  const overview = page.getByRole('region', { name: '当前范围学习概览' })
  await expect(overview).toContainText('已复习 5')
  await expect(overview).toContainText('尚无记录 4')
  await page.getByLabel('批量展开层级').selectOption('3')
  await expect(page.getByRole('button', { name: '查看心动周期详情', exact: true })).toBeVisible()
  await page.getByLabel('批量展开层级').selectOption('0')
  await expect(page.getByRole('button', { name: '查看心动周期详情', exact: true })).toHaveCount(0)
  for (const name of ['临床医学', '心血管系统', '循环生理', '心动周期']) {
    await page.getByRole('button', { name: `展开${name}`, exact: true }).click()
  }
  await page.getByRole('button', { name: '查看心室收缩期详情', exact: true }).click()
  const details = page.getByRole('complementary', { name: '进度详情' })
  await expect(details.getByRole('heading', { name: '心室收缩期' })).toBeVisible()
  await expect(details).toContainText('临床医学 / 心血管系统 / 循环生理 / 心动周期')
  await expect(details.getByRole('link', { name: '进入所属宫殿复习' })).toHaveAttribute('href', '/palaces/11/review')
  await page.getByRole('button', { name: '查看心血管系统详情', exact: true }).click()
  await page.getByRole('button', { name: '聚焦这一范围' }).click()
  await expect(page).toHaveURL(/scope=palace%3A11/)
  await page.getByRole('button', { name: '分布', exact: true }).click()
  const matrix = page.getByLabel('记忆点分布')
  await expect(matrix.getByRole('button')).toHaveCount(5)
  await matrix.getByRole('button', { name: /心室舒张期/ }).click()
  await expect(details.getByRole('heading', { name: '心室舒张期' })).toBeVisible()
  await page.getByRole('button', { name: '题目', exact: true }).click()
  await expect(page).toHaveURL(/scope=palace%3A11/)
  await expect(page.getByRole('img', { name: '循环生理已作答 7，共 12 题' })).toBeVisible()
  await page.getByRole('button', { name: '分布', exact: true }).click()
  await page.reload()
  await expect(matrix.getByRole('button')).toHaveCount(5)
  await expect(details.getByRole('heading', { name: '心室舒张期' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: '进度范围' })).toContainText('心血管系统')
})

test('search and filters change rows without changing scope totals', async ({ page }) => {
  await mockProgress(page)
  await page.goto('/progress?view=matrix')
  const matrix = page.getByLabel('记忆点分布')
  await expect(matrix.getByRole('button')).toHaveCount(9)
  await page.getByLabel('搜索当前范围').fill('心室')
  await expect(matrix.getByRole('button')).toHaveCount(2)
  await page.getByLabel('筛选进度').selectOption('due')
  await expect(matrix.getByRole('button')).toHaveCount(1)
  await expect(matrix.getByRole('button', { name: /心室收缩期/ })).toBeVisible()
  await page.getByLabel('排序方式').selectOption('due')
  await page.reload()
  await expect(page.getByLabel('搜索当前范围')).toHaveValue('心室')
  await expect(page.getByLabel('筛选进度')).toHaveValue('due')
  await expect(page.getByLabel('排序方式')).toHaveValue('due')
  await expect(page.getByRole('img', { name: '复习覆盖率 56%' })).toBeVisible()
  await page.getByLabel('搜索当前范围').fill('不存在的内容')
  await expect(page.getByRole('heading', { name: '这里暂时没有符合条件的内容' })).toBeVisible()
  await page.getByRole('button', { name: '清除筛选' }).click()
  await expect(matrix.getByRole('button')).toHaveCount(9)
})

test('empty progress gives a knowledge entry and offline progress can retry', async ({ page }) => {
  await mockProgress(page, emptyProgressFixture)
  await page.goto('/progress')
  await expect(page.getByRole('heading', { name: '你的学习全景，从第一座宫殿开始' })).toBeVisible()
  await expect(page.getByRole('link', { name: '前往知识书架' })).toHaveAttribute('href', '/palaces')
  await page.unroute('**/api/v1/dashboard/learning-progress')
  await page.reload()
  await expect(page.getByRole('alert')).toContainText('暂时无法读取学习进度')
  await mockProgress(page)
  await page.getByRole('button', { name: '重新加载' }).click()
  await expect(page.getByRole('button', { name: '展开临床医学' })).toBeVisible()
})

test('dark matrix fixture retains readable progress states', async ({ page }, testInfo) => {
  await mockProgress(page)
  if (testInfo.project.name === 'desktop-chromium') await page.setViewportSize({ width: 1536, height: 1150 })
  await page.goto('/progress?view=matrix')
  await expect(page.getByLabel('记忆点分布').getByRole('button')).toHaveCount(9)
  await page.evaluate(() => document.documentElement.classList.add('dark'))
  await expect(page.locator('html')).toHaveClass(/dark/)
  await page.getByLabel('记忆点分布').getByRole('button', { name: /心室收缩期/ }).click()
  await expect(page.getByRole('complementary', { name: '进度详情' }).getByRole('heading', { name: '心室收缩期' })).toBeVisible()
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  if (testInfo.project.name === 'desktop-chromium') {
    await page.evaluate(() => document.fonts.ready)
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.screenshot({ path: resolve(process.cwd(), '../../deliverables/progress-matrix-dark.png'), fullPage: false, animations: 'disabled' })
  }
})

test('fixture screenshots show desktop and mobile progress without horizontal overflow', async ({ page }, testInfo) => {
  await mockProgress(page)
  if (testInfo.project.name === 'desktop-chromium') await page.setViewportSize({ width: 1536, height: 1150 })
  await page.goto('/progress')
  await page.getByRole('button', { name: '展开临床医学' }).click()
  await page.getByRole('button', { name: '展开心血管系统' }).click()
  await expect(page.getByRole('button', { name: '查看循环生理详情' })).toBeVisible()
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  if (testInfo.project.name === 'desktop-chromium' || testInfo.project.name === 'mobile-chromium') {
    await page.evaluate(() => document.fonts.ready)
    const device = testInfo.project.name === 'desktop-chromium' ? 'desktop' : 'mobile'
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.screenshot({ path: resolve(process.cwd(), '../../deliverables', `progress-${device}.png`), fullPage: device === 'mobile', animations: 'disabled' })
  }
})
