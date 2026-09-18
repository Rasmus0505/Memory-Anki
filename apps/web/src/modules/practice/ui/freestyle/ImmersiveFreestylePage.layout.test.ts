import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(
  resolve(process.cwd(), 'src/modules/practice/ui/freestyle/ImmersiveFreestylePage.tsx'),
  'utf8',
)

describe('ImmersiveFreestylePage layout', () => {
  it('locks the snap scroller to one viewport without min-h-full cards', () => {
    expect(source).toContain('data-testid="freestyle-feed-scroller"')
    expect(source).toContain('min-h-0 flex-1 snap-y snap-mandatory')
    expect(source).toContain('h-full min-h-0 shrink-0 flex-col snap-start snap-always')
    expect(source).not.toContain('min-h-full')
  })

  it('keeps the closing slot reachable from the last unit', () => {
    expect(source).toContain('clampFreestyleFeedIndex')
    expect(source).toContain('isFreestyleCompleteSlot')
    expect(source).toContain('freestyleFeedSlotCount')
    expect(source).toContain('viewingCompleteSlot')
  })

  it('pages cards with the dock arrows regardless of palace rating scope', () => {
    expect(source).toContain('canGoPrevious && cards.length > 0')
    expect(source).toContain('visualIndex < feedSlotCount - 1')
    expect(source).not.toContain('palaceMode={ratingScope === \'palace\'}')
    expect(source).not.toContain('? canGoPreviousPalace')
    expect(source).not.toContain('? canGoNextPalace')
  })
})
