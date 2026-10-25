import { Moon } from 'lucide-react'
import { cn } from '@/shared/lib/utils'

/**
 * 睡前复习入口。Sits above the right-side pager (the user's chosen spot), so it
 * stays where the thumb already is on the phone. The dialog it opens confirms
 * how many already-rated cards will be appended and that their grades do not
 * change the review schedule.
 */
export function FreestyleBedtimeButton({
  onClick,
  busy = false,
  className,
}: {
  onClick: () => void
  busy?: boolean
  className?: string
}) {
  return (
    <button
      type="button"
      data-testid="freestyle-bedtime-button"
      title="睡前复习"
      aria-label="睡前复习"
      aria-busy={busy || undefined}
      disabled={busy}
      className={cn(
        'ma-pressable inline-flex size-11 items-center justify-center rounded-xl text-stage-ink hover:bg-stage-line hover:text-stage-glow active:bg-stage-line-strong disabled:pointer-events-none disabled:opacity-35 sm:size-10',
        className,
      )}
      onClick={onClick}
    >
      <Moon className="size-5 sm:size-4" />
    </button>
  )
}
