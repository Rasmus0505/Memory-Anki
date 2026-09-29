import { test as base } from '@playwright/test'

/**
 * Hermetic e2e: every /api request is answered here. Unmocked calls get a 503 so
 * the app takes its offline path; specs add their own `page.route` on top
 * (later routes win). Nothing can reach the live service or its data.
 */
export const test = base.extend<{ hermeticApi: void }>({
  hermeticApi: [
    async ({ page }, use) => {
      await page.route('**/api/**', (route) =>
        route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ detail: 'e2e: api offline' }),
        }),
      )
      await use()
    },
    { auto: true },
  ],
})

export { expect } from '@playwright/test'
