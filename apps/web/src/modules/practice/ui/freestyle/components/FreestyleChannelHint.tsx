import { X } from 'lucide-react'
import type { ChannelState } from '@/modules/practice/ui/freestyle/model/freestyleChallengeChannel'
import { cn } from '@/shared/lib/utils'

/**
 * The channel hint: one line in the periphery when the round has drifted out of the
 * challenge–skill band, with the correction available in one tap.
 *
 * Sits above the rating bar rather than at screen center, and is dismissible, because
 * a suggestion the learner has already declined becomes an interruption if it returns.
 * It never appears to say things are going well — see shouldSurfaceChannelHint.
 */
export function FreestyleChannelHint({
  state,
  hint,
  actionLabel,
  busy,
  onApply,
  onDismiss,
}: {
  state: Exclude<ChannelState, 'flow' | 'unknown'>
  hint: string
  actionLabel: string
  busy?: boolean
  onApply: () => void
  onDismiss: () => void
}) {
  return (
    <div
      data-testid="freestyle-channel-hint"
      data-state={state}
      role="status"
      // Above the rating bar: the bottom edge belongs to rating, and the top holds the
      // rail + timer. This band is otherwise empty.
      className="pointer-events-none absolute inset-x-0 bottom-[5.25rem] z-20 flex justify-center px-3 sm:bottom-[5.75rem]"
    >
      <div
        className={cn(
          'pointer-events-auto flex max-w-[min(26rem,100%)] items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] shadow-lg backdrop-blur-md sm:text-xs',
          state === 'anxious'
            ? 'border-sky-300/25 bg-sky-950/85 text-sky-100'
            : 'border-amber-300/25 bg-amber-950/85 text-amber-100',
        )}
      >
        <span className="min-w-0 truncate">{hint}</span>
        <button
          type="button"
          data-testid="freestyle-channel-hint-apply"
          disabled={busy}
          aria-busy={busy}
          className={cn(
            'shrink-0 rounded-full px-2.5 py-1 font-medium transition-colors disabled:opacity-50',
            state === 'anxious'
              ? 'bg-sky-300/20 hover:bg-sky-300/30 active:bg-sky-300/40'
              : 'bg-amber-300/20 hover:bg-amber-300/30 active:bg-amber-300/40',
          )}
          onClick={onApply}
        >
          {actionLabel}
        </button>
        <button
          type="button"
          data-testid="freestyle-channel-hint-dismiss"
          title="不用了"
          aria-label="不用了"
          className="shrink-0 rounded-full p-1 opacity-60 transition-opacity hover:opacity-100"
          onClick={onDismiss}
        >
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  )
}
