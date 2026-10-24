import type { ComponentProps, ReactNode } from 'react'
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
  return (
    <>
      <div className="pointer-events-none absolute inset-x-0 top-[calc(env(safe-area-inset-top,0px)+1.85rem)] z-30 flex justify-center gap-1.5 px-[5.75rem] sm:px-36">
        <SprintMilestoneStrip overview={examOverview} milestones={milestones} className="max-w-full" />
      </div>
      <FreestyleProgressRail
        summary={progressSummary}
        scrollChannel={scrollChannel}
        onOpenPlan={onOpenPlan}
        onJump={onJump}
        overflow={progressRailOverflow}
      />
      <FreestyleQuarterTag segments={progressSummary.segments} />
      {unsavedRatingCount > 0 ? (
        <div className="pointer-events-none absolute inset-x-0 top-[calc(env(safe-area-inset-top,0px)+3.35rem)] z-30 flex justify-center px-[5.75rem] sm:px-36">
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
