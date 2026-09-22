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

  it('uses the right-side 完成 button to settle or seek unfinished work', () => {
    expect(source).toContain('findEarliestUnhandledIndex')
    expect(source).toContain('resolveFreestyleCompleteSeek')
    expect(source).toContain('onComplete={handleCompleteRound}')
    expect(source).toContain('viewingCardId')
  })

  it('wires settlement 再来一轮 through nextRound config then startNextRound', () => {
    expect(source).toContain('onAnotherRound=')
    expect(source).toContain("setConfigIntent('nextRound')")
    expect(source).toContain('startNextRound')
    expect(source).toContain("mode={configIntent}")
    expect(source).toContain('onClearQuizProgress={clearConfiguredOverlayQuiz}')
    expect(source).not.toContain('promptOverlayPalaceClear')
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
