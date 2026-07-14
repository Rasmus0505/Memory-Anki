import { expect, test } from '@playwright/test'

test.use({ serviceWorkers: 'block' })

test('fills the iOS PWA visual viewport and exits through the canvas control', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-webkit')

  await page.addInitScript(() => {
    const originalMatchMedia = window.matchMedia.bind(window)
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (query: string) => {
        if (query === '(display-mode: standalone)') {
          return {
            matches: true,
            media: query,
            onchange: null,
            addEventListener() {},
            removeEventListener() {},
            addListener() {},
            removeListener() {},
            dispatchEvent: () => true,
          }
        }
        return originalMatchMedia(query)
      },
    })
    Object.defineProperty(Element.prototype, 'requestFullscreen', {
      configurable: true,
      value: () => {
        const state = window as Window & { __mindMapNativeFullscreenRequests?: number }
        state.__mindMapNativeFullscreenRequests = (state.__mindMapNativeFullscreenRequests ?? 0) + 1
        return Promise.resolve()
      },
    })
  })

  await page.route('**/api/v1/palaces/1/editor*', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        palace: {
          id: 1,
          title: 'PWA 全屏测试',
          description: '',
          mastered: false,
          attachments: [],
          chapters: [],
        },
        editor_doc: {
          root: {
            data: { text: 'PWA 全屏测试', uid: 'root' },
            children: [{ data: { text: '知识点', uid: 'child' }, children: [] }],
          },
        },
        editor_config: {},
        editor_local_config: {},
        lang: 'zh',
      }),
    })
  })

  await page.goto('/palaces/1')
  const fullscreenButton = page.getByRole('button', { name: '全屏编辑' })
  await expect(fullscreenButton).toBeVisible()
  await expect(page.getByRole('button', { name: '半屏编辑' })).toHaveCount(0)

  await fullscreenButton.click()

  const frame = page.getByTestId('mindmap-frame-native')
  await expect(frame).toHaveAttribute('data-presentation-mode', 'viewport')
  const viewport = page.viewportSize()
  const box = await frame.boundingBox()
  expect(viewport).not.toBeNull()
  expect(box).not.toBeNull()
  expect(Math.abs((box?.x ?? 0))).toBeLessThanOrEqual(1)
  expect(Math.abs((box?.y ?? 0))).toBeLessThanOrEqual(1)
  expect(Math.abs((box?.width ?? 0) - (viewport?.width ?? 0))).toBeLessThanOrEqual(1)
  expect(Math.abs((box?.height ?? 0) - (viewport?.height ?? 0))).toBeLessThanOrEqual(1)
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __mindMapNativeFullscreenRequests?: number }
  ).__mindMapNativeFullscreenRequests ?? 0)).toBe(0)

  await page.getByTitle('退出全屏').click()
  await expect(frame).toHaveAttribute('data-presentation-mode', 'embedded')
  await expect(frame).toHaveAttribute('data-fullscreen', 'false')
})
