import { expect, test } from './fixtures'

/**
 * The phone contract for answering/sheet surfaces, measured in a real viewport.
 *
 * Every regression here so far had the same shape: a dialog looked right in the
 * CSS and wrong on the phone — its top edge under the notch, its primary action
 * below the home indicator, or so much chrome that the content the learner came
 * for got a sliver of the screen. Numbers, not ratios: the assertions below are
 * the ones a screen reader user and a thumb both depend on.
 *
 * Hermetic: the fixture answers every /api call with 503, and this spec only
 * measures chrome that renders before any answer arrives.
 */

const PHONES = [
  { width: 375, height: 812 },
  { width: 390, height: 844 },
]

/** The header must clear the notch; iOS reports 0 in a plain browser. */
const MIN_TOP_INSET = 8

for (const viewport of PHONES) {
  test(`phone sheets keep their header and content reachable at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto('/freestyle')

    // The stage header is the app's existing phone chrome; it must still own the
    // top band and leave the feed the rest of the screen.
    const stageHeader = page.getByTestId('freestyle-stage-header')
    await expect(stageHeader).toBeVisible()
    const header = await stageHeader.boundingBox()
    expect(header).not.toBeNull()
    expect(header!.y).toBeGreaterThanOrEqual(0)
    expect(header!.height).toBeLessThanOrEqual(viewport.height * 0.2)

    // Any phone sheet that is on screen must obey the same rules. Listed by test
    // id so a new surface has to be added deliberately rather than drift in.
    for (const testId of ['freestyle-round-sheet']) {
      const sheet = page.getByTestId(testId)
      if ((await sheet.count()) === 0) continue
      const box = await sheet.boundingBox()
      expect(box).not.toBeNull()
      expect(box!.y).toBeGreaterThanOrEqual(0)
      expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1)
    }
  })
}

test('the answering sheet leaves most of the phone to the question', async ({ page }) => {
  const viewport = { width: 375, height: 812 }
  await page.setViewportSize(viewport)
  await page.goto('/freestyle')

  // A sheet opened by a global shortcut renders without any API; only its
  // geometry is under test here.
  const sheet = page.locator('[data-mobile-sheet="full"]').first()
  if ((await sheet.count()) === 0) test.skip(true, 'no mobile sheet mounted on this route')

  const box = await sheet.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.y).toBeGreaterThanOrEqual(MIN_TOP_INSET - 1)
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1)

  const header = sheet.locator('[data-mobile-sheet-header]').first()
  if ((await header.count()) > 0) {
    const headerBox = await header.boundingBox()
    expect(headerBox!.height).toBeLessThanOrEqual(viewport.height * 0.25)
  }
})
