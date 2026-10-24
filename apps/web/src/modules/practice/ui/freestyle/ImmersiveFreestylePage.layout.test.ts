import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string) =>
  readFileSync(resolve(process.cwd(), 'src/modules/practice/ui/freestyle', path), 'utf8')

// The page composes feed, HUD, card area, dialogs and settlements from split files; assert on the whole surface.
const source = [
  'ImmersiveFreestylePage.tsx',
  'freestylePageHelpers.ts',
  'StaleUnitReviewCard.tsx',
  'FreestyleRetryCornerBadge.tsx',
  'FreestyleHud.tsx',
  'FreestylePageDialogs.tsx',
  'FreestyleFeedCard.tsx',
  'FreestyleCardArea.tsx',
  'FreestyleClosingSlot.tsx',
  'FreestylePartialSettlement.tsx',
  'FreestyleEdgeHint.tsx',
  'FreestyleBottomActions.tsx',
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
    expect(source).toContain('onComplete={handlePagerComplete}')
    expect(source).toContain('viewingCardId')
  })

  it('settles the rated units when 完成 is a genuine completion, not a seek', () => {
    const handler = source.slice(
      source.indexOf('const handlePagerComplete'),
      source.indexOf('const openConfigFromPlan'),
    )
    // Open round keeps the seek; a fully scored round settles instead.
    expect(handler).toContain('roundComplete && settleCompletedUnits()')
    expect(handler).toContain('handleCompleteRound()')
    const settle = source.slice(
      source.indexOf('const settleCompletedUnits'),
      source.indexOf('const handlePagerComplete'),
    )
    // Same ledger write as 结算已完成单元, so the rail/plan/feed lose those units.
    expect(settle).toContain('buildCompletedSettlement()')
    expect(settle).toContain('compressCompletedPlanCards(snapshot)')
    expect(settle).not.toContain('setPartialSettlement(snapshot)')
  })

  it('keeps the pager only while the feed still has cards to page', () => {
    expect(source).toContain('!partialSettlement && !viewingCompleteSlot && cards.length > 0 ? (')
    expect(source).toContain('canCancelSettlement={cards.length > 0}')
  })

  it('keeps a visible 退出 on 小结算 because the overlay covers the pager', () => {
    expect(source).toContain('data-testid="freestyle-partial-settlement-exit"')
    expect(source).toContain('退出')
    expect(source).toContain('setPartialSettlement(null)')
  })

  it('cancels settlement by leaving the slot', () => {
    expect(source).toContain('onCancelSettlement={navigatePrevious}')
    expect(source).toContain('viewingCompleteSlot || partialSettlement != null')
    expect(source).toContain('取消结算，返回上一张')
  })

  it('settles the closing page through the same two-action contract', () => {
    // The page no longer carries a second "结束本次学习" surface: 结算 is the end.
    expect(source).not.toContain('FreestyleStudySettlement')
    expect(source).not.toContain('studySettlementOpen')
    expect(source).toContain('onSettle={settleAndGoOn}')
    expect(source).toContain('onClearQuizProgress={clearConfiguredOverlayQuiz}')
    expect(source).not.toContain('promptOverlayPalaceClear')
  })

  it('settles then starts the next round instead of offering 再来一轮', () => {
    const settle = source.slice(
      source.indexOf('const settleAndGoOn'),
      source.indexOf('const openConfigFromPlan'),
    )
    // 结算 is the next round: /rounds/start completes the active round, so the
    // old queue cannot survive it and no compress write has to race that build.
    expect(settle).toContain('startNextRound(config)')
    expect(settle).toContain('pendingNextRoundRef.current = true')
    expect(source).not.toContain('onAnotherRound=')
    expect(source).not.toContain("setConfigIntent('nextRound')")
    // An empty next round lands on 今天的学习 rather than a blank stage.
    expect(source).toContain('setStartOverviewOpen(true)')
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
    // Scored-ness comes from the single score kernel, not a call-site reassembly.
    expect(source).toContain('isOccurrenceScored(card.id')
    expect(source).toContain('data-completed={done ? \'true\' : \'false\'}')
  })

  it('rates 本轮安排 rows in the background without moving the feed', () => {
    const handler = source.slice(
      source.indexOf('const handlePlanRateCard'),
      source.indexOf('const handleCompressCompleted'),
    )
    expect(handler).toContain('rateCards(')
    expect(handler).not.toContain('navigateToIndex')
    expect(handler).not.toContain('jumpFromProgressRail')
    expect(source).not.toContain('sheetRatingRequest')
    expect(source).toContain('onRateCards={handlePlanRateCards}')
  })
})
