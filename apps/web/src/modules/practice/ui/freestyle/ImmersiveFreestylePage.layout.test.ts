import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string) =>
  readFileSync(resolve(process.cwd(), 'src/modules/practice/ui/freestyle', path), 'utf8')

// The page composes feed navigation and HUD chrome from split files; assert on the whole surface.
const source = [
  'ImmersiveFreestylePage.tsx',
  'hooks/useFreestyleFeedNavigation.ts',
  'components/FreestyleHudChrome.tsx',
].map(read).join('\n')

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

  it('gives the closing settlement its own scrollport on short viewports', () => {
    expect(source).toContain('data-testid="freestyle-round-complete-scroll"')
    expect(source).toContain('min-h-0 flex-1 overflow-y-auto overscroll-contain')
  })

  it('uses the right-side 完成 button to settle or walk unscored units', () => {
    expect(source).toContain('findUnscoredCompleteSeekIndices')
    expect(source).toContain('resolveFreestyleCompleteSeek')
    expect(source).toContain('onComplete={handleCompleteRound}')
    expect(source).toContain('viewingCardId')
  })

  it('keeps a visible 退出 on 小结算 because the overlay covers the pager', () => {
    expect(source).toContain('data-testid="freestyle-partial-settlement-exit"')
    expect(source).toContain('退出')
    expect(source).toContain('setPartialSettlement(null)')
  })

  it('cancels settlement by leaving the slot so later dwell still counts', () => {
    expect(source).toContain('onCancelSettlement={navigatePrevious}')
    expect(source).toContain('viewingCard: !viewingCompleteSlot && currentCard != null')
    expect(source).not.toContain('viewingCard: !roundComplete')
    expect(source).toContain('取消结算，返回上一张')
  })

  it('wires settlement 再来一轮 through nextRound config then startNextRound', () => {
    expect(source).toContain('onAnotherRound=')
    expect(source).toContain("setConfigIntent('nextRound')")
    expect(source).toContain('startNextRound')
    expect(source).toContain("mode={configIntent}")
    expect(source).toContain('onClearQuizProgress={clearConfiguredOverlayQuiz}')
    expect(source).not.toContain('promptOverlayPalaceClear')
  })

  it('does not page the feed from vertical arrows while a quiz dialog owns the keyboard', () => {
    const handler = source.slice(source.indexOf('const handleKeyDown'), source.indexOf('const viewingCardId'))
    expect(handler).toContain('isFreestyleShortcutBlocked(event.target)')
    expect(handler).toContain('getFreestyleFeedPageDirection')
    expect(handler).toContain('shouldSwallowFreestyleFeedPageKey')
  })

  it('pages cards with the dock arrows regardless of palace rating scope', () => {
    expect(source).toContain('canGoPrevious && cards.length > 0')
    expect(source).toContain('freestyleCanPageNext(')
    expect(source).not.toContain('palaceMode={ratingScope === \'palace\'}')
    expect(source).not.toContain('? canGoPreviousPalace')
    expect(source).not.toContain('? canGoNextPalace')
  })

  it('styles the 重练 badge by completed vs unfinished, not a single chrome', () => {
    expect(source).toContain('retryChromeClass')
    expect(source).toContain('liveEncounterFillDone')
    expect(source).toContain('data-completed={done ? \'true\' : \'false\'}')
  })
})
