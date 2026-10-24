import { expect, test } from './fixtures'

test('loads the app shell and primary navigation', async ({ page }) => {
  await page.goto('/dashboard')

  const mobile = (page.viewportSize()?.width ?? 1280) < 768
  await expect(page.getByRole('link', { name: '随心', exact: true }).first()).toHaveAttribute(
    'href',
    '/freestyle',
  )
  await expect(page.getByRole('link', { name: '随心 2', exact: true })).toHaveCount(0)
  await expect(page.getByRole('link', { name: '知识', exact: true }).first()).toHaveAttribute(
    'href',
    '/palaces',
  )
  if (mobile) {
    // 手机底栏只有四个主入口；创建/洞察收在“更多”里。
    await expect(page.getByRole('link', { name: '英语', exact: true }).first()).toHaveAttribute(
      'href',
      '/english/listening',
    )
    await expect(page.getByRole('link', { name: '进度', exact: true }).first()).toHaveAttribute(
      'href',
      '/progress',
    )
    await expect(page.getByRole('button', { name: '更多', exact: true })).toBeVisible()
    return
  }
  await expect(page.getByRole('link', { name: '创建', exact: true }).first()).toHaveAttribute(
    'href',
    '/palaces/new',
  )
  await expect(page.getByRole('link', { name: '洞察', exact: true }).first()).toHaveAttribute(
    'href',
    '/dashboard',
  )
})

test('redirects retired /today bookmarks to dashboard', async ({ page }) => {
  await page.goto('/today')
  await expect(page).toHaveURL(/\/dashboard/)
})

test('redirects the retired /freestyle-2 bookmark to 随心', async ({ page }) => {
  await page.goto('/freestyle-2')
  await expect(page).toHaveURL(/\/freestyle(\?|$)/)
  await expect(page.getByRole('link', { name: '随心 2', exact: true })).toHaveCount(0)
})

test('command palette opens 随心', async ({ page }) => {
  await page.goto('/dashboard')
  await page.getByRole('heading', { name: '仪表盘' }).waitFor()
  await page.locator('body').click()
  await page.keyboard.press('Control+k')
  await page.getByRole('dialog', { name: '命令面板' }).waitFor()
  await page.getByText('开始随心复习').click()
  await expect(page).toHaveURL(/\/freestyle(\?|$)/)
})
