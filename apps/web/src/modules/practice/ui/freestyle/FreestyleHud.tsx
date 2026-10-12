import type { ComponentProps, ReactNode } from 'react'
import type { useExamOverview } from '@/modules/exam/public'
import { ExamCountdownChip } from '@/modules/exam/public'
import { FreestyleProgressRail } from '@/modules/practice/ui/freestyle/components/FreestyleProgressRail'
import { FreestyleQuarterTag } from '@/modules/practice/ui/freestyle/components/FreestyleQuarterTag'
import {
  FreestyleStaleRecoveryPanel,
  FreestyleTopNotices,
  FreestyleWorkspaceSwitcher,
} from '@/modules/practice/ui/freestyle/components/FreestyleHudChrome'
import { FreestyleChannelHint } from '@/modules/practice/ui/freestyle/components/FreestyleChannelHint'
import { FreestylePalaceClearedBanner } from '@/modules/practice/ui/freestyle/components/FreestylePalaceClearedBanner'
import type { FreestyleWorkspaceId } from '@/modules/practice/public'

type ProgressRailProps = ComponentProps<typeof FreestyleProgressRail>
type PalaceClearance = ComponentProps<typeof FreestylePalaceClearedBanner>['clearance']
type ChannelHintProps = ComponentProps<typeof FreestyleChannelHint>

export function FreestyleHud({
  examOverview,
  progressSummary,
  scrollChannel,
  workspaceSwitcherSlot,
  progressRailOverflow,
  onOpenPlan,
  onJump,
  channelAppliedHint,
  onDismissChannelApplied,
  saveError,
  onDismissSaveError,
  palaceClearance,
  onDismissPalaceClearance,
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
  progressSummary: ProgressRailProps['summary']
  scrollChannel: ProgressRailProps['scrollChannel']
  workspaceSwitcherSlot: FreestyleWorkspaceId | null
  progressRailOverflow: ReactNode
  onOpenPlan: () => void
  onJump: ProgressRailProps['onJump']
  channelAppliedHint: string
  onDismissChannelApplied: () => void
  saveError: string
  onDismissSaveError: () => void
  palaceClearance: PalaceClearance | null
  onDismissPalaceClearance: () => void
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
        {examOverview?.settings.exam_date ? <ExamCountdownChip overview={examOverview} className="pointer-events-auto max-w-full" /> : null}
      </div>
      <FreestyleProgressRail
        summary={progressSummary}
        scrollChannel={scrollChannel}
        workspaceSwitcher={workspaceSwitcherSlot != null ? <FreestyleWorkspaceSwitcher slot={workspaceSwitcherSlot} /> : null}
        onOpenPlan={onOpenPlan}
        onJump={onJump}
        overflow={progressRailOverflow}
      />
      <FreestyleQuarterTag segments={progressSummary.segments} />

      <FreestyleTopNotices
        channelAppliedHint={channelAppliedHint}
        onDismissChannelApplied={onDismissChannelApplied}
        saveError={saveError}
        onDismissSaveError={onDismissSaveError}
      />

      {palaceClearance ? (
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
