import { expect, test } from '@playwright/test'

test('loads the app shell and primary navigation', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('link', { name: '今日学习' })).toHaveAttribute('href', '/freestyle')
  await expect(page.getByRole('link', { name: '复习分析' })).toHaveAttribute('href', '/')
  await expect(page.getByRole('link', { name: '系统设置' })).toHaveAttribute('href', '/profile')
})
