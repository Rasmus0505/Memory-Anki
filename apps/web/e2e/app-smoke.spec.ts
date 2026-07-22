import { expect, test } from '@playwright/test'

test('loads the app shell and primary navigation', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('link', { name: '随心', exact: true })).toHaveAttribute('href', '/freestyle')
  await expect(page.getByRole('link', { name: '知识', exact: true })).toHaveAttribute('href', '/palaces')
  await expect(page.getByRole('link', { name: '创建', exact: true })).toHaveAttribute('href', '/palaces/new')
  await expect(page.getByRole('link', { name: '洞察', exact: true })).toHaveAttribute('href', '/')
})
