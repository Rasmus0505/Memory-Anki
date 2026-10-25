import { useLayoutEffect, useRef, type ComponentProps, type ReactNode } from 'react'
import type { FreestyleMilestoneUpcoming } from '@/shared/api/contracts'
import type { useExamOverview } from '@/modules/exam/public'
import { SprintMilestoneStrip } from '@/modules/exam/public'
import { FreestyleProgressRail } from '@/modules/practice/ui/freestyle/components/FreestyleProgressRail'
import { FreestyleQuarterTag } from '@/modules/practice/ui/freestyle/components/FreestyleQuarterTag'
import {
  FreestyleStaleRecoveryPanel,
  FreestyleTopNotices,
} from '@/modules/practice/ui/freestyle/components/FreestyleHudChrome'
import { FreestyleChannelHint } from '@/modules/practice/ui/freestyle/components/FreestyleChannelHint'
import { FreestylePalaceClearedBanner } from '@/modules/practice/ui/freestyle/components/FreestylePalaceClearedBanner'

type ProgressRailProps = ComponentProps<typeof FreestyleProgressRail>
type PalaceClearance = ComponentProps<typeof FreestylePalaceClearedBanner>['clearance']
type ChannelHintProps = ComponentProps<typeof FreestyleChannelHint>

export function FreestyleHud({
  examOverview,
  milestones,
  palaceTitle = '',
  progressSummary,
  scrollChannel,
  progressRailOverflow,
  onOpenPlan,
  onJump,
  channelAppliedHint,
  onDismissChannelApplied,
  saveError,
  onDismissSaveError,
  unsavedRatingCount = 0,
  onRetryUnsavedRatings,
  palaceClearance,
  onDismissPalaceClearance,
  settlementVisible = false,
  channelHintVisible,
  activeChannelAdjustment,
  channelState,
  channelBusy,
  onApplyChannelAdjustment,
  onDismissChannelHint,
  staleCircuitOpen,
  showStaleRecovery,
  onSkipStaleRecovery,
  onRebuildStaleRecovery,
  onOpenStaleConfig,
}: {
  examOverview: ReturnType<typeof useExamOverview>['data']
  milestones: FreestyleMilestoneUpcoming | null
  /** Palace of the card on screen: the header says where you are, the sheet says what. */
  palaceTitle?: string
  progressSummary: ProgressRailProps['summary']
  scrollChannel: ProgressRailProps['scrollChannel']
  progressRailOverflow: ReactNode
  onOpenPlan: () => void
  onJump: ProgressRailProps['onJump']
  channelAppliedHint: string
  onDismissChannelApplied: () => void
  saveError: string
  onDismissSaveError: () => void
  /** Ratings of this round that are 未保存. Shown until zero; tapping retries them. */
  unsavedRatingCount?: number
  onRetryUnsavedRatings?: () => void
  palaceClearance: PalaceClearance | null
  onDismissPalaceClearance: () => void
  /** The closing page reports the palace itself; card-level chips stay off it. */
  settlementVisible?: boolean
  channelHintVisible: boolean
  activeChannelAdjustment: { hint: ChannelHintProps['hint']; actionLabel: ChannelHintProps['actionLabel'] } | null
  channelState: 'anxious' | 'bored'
  channelBusy: boolean
  onApplyChannelAdjustment: ChannelHintProps['onApply']
  onDismissChannelHint: ChannelHintProps['onDismiss']
  staleCircuitOpen: boolean
  showStaleRecovery: boolean
  onSkipStaleRecovery: () => void
  onRebuildStaleRecovery: () => void
  onOpenStaleConfig: () => void
}) {
  // The header is in flow, so the card below it needs no magic top padding.
  // Overlays (notices, banners, edge hints) sit under it and read this height.
  const headerRef = useRef<HTMLElement | null>(null)
  useLayoutEffect(() => {
    const node = headerRef.current
    if (!node) return
    const stage = node.parentElement
    const publish = () => {
      const height = node.getBoundingClientRect().height
      if (!(height > 0)) return
      stage?.style.setProperty('--fs-hud-h', `${Math.round(height)}px`)
      // Centring the pager on the card area means shifting it by half the header.
      stage?.style.setProperty('--fs-hud-half', `${Math.round(height / 2)}px`)
    }
    publish()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(publish)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  return (
    <>
      {/* One in-flow header owns the top of the stage: progress hairline, then
          where-you-are + round count + actions, then one truncated milestone
          line. Nothing here floats over the card any more; the card starts
          exactly below this band. `--fs-hud-h` is measured here and is the only
          offset source for the overlays that sit under it. */}
      <header
        ref={headerRef}
        data-testid="freestyle-stage-header"
        className="relative z-20 flex shrink-0 flex-col border-b border-stage-line/70 bg-stage/95 pt-[env(safe-area-inset-top,0px)]"
      >
        <FreestyleProgressRail
          summary={progressSummary}
          scrollChannel={scrollChannel}
          onOpenPlan={onOpenPlan}
          onJump={onJump}
          overflow={progressRailOverflow}
          titleSlot={palaceTitle ? (
            <span className="flex min-w-0 items-center gap-1.5 text-[11px] font-medium text-stage-ink/80">
              <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-stage-glow/85" />
              <span className="truncate">{palaceTitle}</span>
            </span>
          ) : null}
          milestoneSlot={(
            <SprintMilestoneStrip compact overview={examOverview} milestones={milestones} />
          )}
        />
      </header>
      <FreestyleQuarterTag segments={progressSummary.segments} />
      {unsavedRatingCount > 0 ? (
        <div className="pointer-events-none absolute inset-x-0 top-[calc(var(--fs-hud-h,4.5rem)+0.25rem)] z-30 flex justify-center px-10 sm:px-36">
          <button
            type="button"
            data-testid="freestyle-unsaved-ratings"
            className="pointer-events-auto rounded-full border border-rate-again/45 bg-stage-raised px-3 py-1 text-xs font-medium text-stage-ink shadow-sm"
            title="点一下重新保存"
            onClick={onRetryUnsavedRatings}
          >
            {unsavedRatingCount} 项没存上 · 点此重试
          </button>
        </div>
      ) : null}

      <FreestyleTopNotices
        channelAppliedHint={channelAppliedHint}
        onDismissChannelApplied={onDismissChannelApplied}
        saveError={saveError}
        onDismissSaveError={onDismissSaveError}
      />

      {/* The closing page owns the top of the stage; a card-level clear chip
          would sit on top of the summary it is already reporting. */}
      {palaceClearance && !settlementVisible ? (
        <FreestylePalaceClearedBanner
          clearance={palaceClearance}
          onDismiss={onDismissPalaceClearance}
        />
      ) : null}

      {channelHintVisible && activeChannelAdjustment ? (
        <FreestyleChannelHint
          state={channelState}
          hint={activeChannelAdjustment.hint}
          actionLabel={activeChannelAdjustment.actionLabel}
          busy={channelBusy}
          onApply={onApplyChannelAdjustment}
          onDismiss={onDismissChannelHint}
        />
      ) : null}

      {staleCircuitOpen && showStaleRecovery ? (
        <FreestyleStaleRecoveryPanel
          onSkip={onSkipStaleRecovery}
          onRebuild={onRebuildStaleRecovery}
          onOpenConfig={onOpenStaleConfig}
        />
      ) : null}
    </>
  )
}
