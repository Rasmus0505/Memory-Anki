import { expect, test } from '@playwright/test'

test('loads the app shell and primary navigation', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByText('仪表盘').first()).toBeVisible()
  await expect(page.getByRole('link', { name: /复习/ }).first()).toBeVisible()
})
