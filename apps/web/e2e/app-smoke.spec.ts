import { expect, test } from '@playwright/test'

test('loads the app shell and primary navigation', async ({ page }) => {
  await page.goto('/dashboard')

  await expect(page.getByRole('link', { name: '随心', exact: true }).first()).toHaveAttribute(
    'href',
    '/freestyle',
  )
  await expect(page.getByRole('link', { name: '随心 2', exact: true })).toHaveCount(0)
  await expect(page.getByRole('link', { name: '知识', exact: true }).first()).toHaveAttribute(
    'href',
    '/palaces',
  )
  await expect(page.getByRole('link', { name: '创建', exact: true }).first()).toHaveAttribute(
    'href',
    '/palaces/new',
  )
  await expect(page.getByRole('link', { name: '洞察', exact: true }).first()).toHaveAttribute(
    'href',
    '/dashboard',
  )
})

test('redirects /today to dashboard and keeps /freestyle-2 reachable', async ({ page }) => {
  await page.goto('/today')
  await expect(page).toHaveURL(/\/dashboard/)

  await page.goto('/freestyle-2')
  await expect(page).toHaveURL(/\/freestyle-2/)
  await expect(page.getByTestId('freestyle-workspace-switcher')).toBeVisible()
  await expect(page.getByRole('link', { name: '随心 2', exact: true }).first()).toHaveAttribute(
    'href',
    '/freestyle-2',
  )
})

test('command palette opens 随心 2', async ({ page }) => {
  await page.goto('/dashboard')
  await page.getByRole('heading', { name: '仪表盘' }).waitFor()
  await page.locator('body').click()
  await page.keyboard.press('Control+k')
  await page.getByRole('dialog', { name: '命令面板' }).waitFor()
  await page.getByText('打开随心 2').click()
  await expect(page).toHaveURL(/\/freestyle-2/)
})
