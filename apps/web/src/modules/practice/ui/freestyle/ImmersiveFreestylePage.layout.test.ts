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
  'components/FreestyleFeedPager.tsx',
  'components/FreestylePalaceDirectoryPanel.tsx',
  'components/FreestyleBedtimeButton.tsx',
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
    // The action wrapper calls resolveFreestyleCompleteSeek and adds the tooltip
    // copy, so the page composes one decision instead of recomputing it inline.
    expect(source).toContain('resolveFreestyleCompleteAction')
    expect(source).toContain('onComplete={handlePagerComplete}')
    expect(source).toContain('viewingCardId')
  })

  it('settles the rated units when 完成 is a genuine completion, not a seek', () => {
    const handler = source.slice(
      source.indexOf('const handlePagerComplete'),
      source.indexOf('const settleAndGoOn'),
    )
    // Open round keeps the seek; a fully scored round settles instead. A
    // same-day 重练 still owed opens the closing slot without compressing:
    // 完成 must never dead-end the learner.
    expect(handler).toContain('if (roundComplete && pendingReviewCount === 0)')
    expect(handler).toContain('settleCompletedUnits()')
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

  it('never calls the round finished while 重练 is still owed today', () => {
    // Locally every presented card is scored, but the server holds same-day
    // re-checks that are not due yet: the closing slot must not celebrate.
    expect(source).toContain('const pendingReviewCount = waiting?.count ?? 0')
    expect(source).toContain('pendingReviewCount={waiting?.count ?? 0}')
    // The closing slot keeps both pages: waiting while owed, trophy when clear.
    const closing = read('FreestyleClosingSlot.tsx')
    expect(closing).toContain('pendingReviewCount > 0 ? (')
    expect(closing).toContain('<FreestyleRoundWaiting')
    expect(closing).toContain('<FreestyleRoundSettlement')
    // 完成 must still never dead-end: the slot stays the seek target.
    expect(source).toContain('handleCompleteRound()')
    expect(source).toContain('nextReviewAt')
  })

  it('keeps the pager only while the feed still has cards to page', () => {
    expect(source).toContain('!partialSettlement && !viewingCompleteSlot && cards.length > 0 ? (')
    expect(source).toContain('canCancelSettlement={cards.length > 0}')
  })

  it('asks before settling 小结算 and can be cancelled', () => {
    // The 小结算 is a Dialog, not an overlay page: it covers the pager, so the
    // only way out is its own 取消 / Esc, wired back to the page state.
    expect(source).toContain('data-testid="freestyle-partial-settlement"')
    expect(source).toContain('onExit={dismissPartialSettlement}')
    expect(source).toContain('onConfirmPartial={confirmPartialSettlement}')
    expect(source).toContain('setPartialSettlement(null)')
    const dialog = read('FreestylePartialSettlement.tsx')
    expect(dialog).toContain('<Dialog open')
    expect(dialog).toContain('onClick={onExit}>取消</Button>')
    expect(dialog).toContain('结算这 {snapshot.cardCount} 张')
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
      source.indexOf('const handleConfigOpenChange'),
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

  it('opens 随心配置 from the rail instead of a separate 本轮安排 list', () => {
    // The plan sheet is gone: the HUD/rail header replans in the config page,
    // and a rail tick on a card that left the plan falls back to that same page.
    const openPlan = source.slice(
      source.indexOf('const openPlan'),
      source.indexOf('const jumpFromProgressRail'),
    )
    expect(openPlan).toContain("setConfigIntent('replan')")
    expect(openPlan).toContain('setConfigOpen(true)')
    expect(source).not.toContain('planOpen')
    expect(source).not.toContain('onRateCards=')
    // Rail jumps still move the feed and prewarm the target preview.
    const rail = source.slice(
      source.indexOf('const jumpFromProgressRail'),
      source.indexOf('const openHistory'),
    )
    expect(rail).toContain('requestRoundPreview(cards, index, direction)')
    expect(rail).toContain('navigateToIndex(index)')
    expect(rail).toContain("setConfigIntent('replan')")
  })

  it('puts the palace directory left of the feed with a collapse switch of its own', () => {
    expect(source).toContain('<FreestylePalaceDirectoryPanel')
    expect(source).toContain('onSelectPalace={openPalaceFromDirectory}')
    expect(source).toContain('hidden={freestyleFullscreen}')
    // The panel's rail, not the app nav's, owns collapsed/expanded.
    expect(source).toContain('collapseLabel="收起宫殿目录"')
    expect(source).toContain('expandLabel="展开宫殿目录"')
  })

  it('delegates a directory click to the read-only navigation hook', () => {
    // A click must not mint an entry scope: that rebuilt the round around one
    // palace and silently dropped every other palace from the queue. The four
    // branches and the append-only join live in the hook, not in this page.
    expect(source).not.toContain('navigate(`/freestyle?palaceId=')
    expect(source).toContain('useFreestylePalaceDirectoryActions')
    expect(source).toContain('<FreestylePalaceJoinDialog')
    expect(source).toContain('onSelectPalace={openPalaceFromDirectory}')
  })

  it('places 睡前复习 above the right-side pager and confirms before appending', () => {
    expect(source).toContain('FreestyleBedtimeButton')
    expect(source).toContain('topSlot={')
    expect(source).toContain('title="睡前复习"')
    expect(source).toContain('getFreestyleBedtimeCandidatesApi')
    expect(source).toContain('appendBedtimeReview')
    expect(source).toContain('不会改动原来的复习安排')
    // The closing page hides the pager; the moon must still be reachable there.
    expect(source).toContain('viewingCompleteSlot && queueState.roundId')
  })
})
