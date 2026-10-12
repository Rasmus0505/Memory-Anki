import { Flame } from 'lucide-react'
import { useFreestyleCombo } from '@/modules/practice/ui/freestyle/model/freestyleComboStore'
import { cn } from '@/shared/lib/utils'

const COMBO_VISIBLE_FROM = 2

function comboHeat(combo: number) {
  if (combo >= 20) return 'freestyle-combo-heat-4'
  if (combo >= 12) return 'freestyle-combo-heat-3'
  if (combo >= 8) return 'freestyle-combo-heat-2'
  if (combo >= 4) return 'freestyle-combo-heat-1'
  return 'freestyle-combo-heat-0'
}

// A reset fades out quietly: 忘记 is information, never a lost streak.
// Motion is CSS-only; keyed remounts replay the entrance, digit roll and milestone pulse.
export function FreestyleComboChip({ reducedMotion = false }: { reducedMotion?: boolean }) {
  const { combo, milestoneIndex, nonce } = useFreestyleCombo()
  const visible = combo >= COMBO_VISIBLE_FROM
  const milestone = milestoneIndex != null
  const animate = !reducedMotion

  return (
    <div className="pointer-events-none absolute -top-9 right-3 z-20 sm:-top-10" aria-live="polite">
      {visible ? (
        <div
          data-testid="freestyle-combo-chip"
          data-combo={combo}
          className={cn(
            'freestyle-combo-chip flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-bold tabular-nums',
            comboHeat(combo),
            animate && 'freestyle-combo-chip-in',
          )}
        >
          <span
            key={milestone ? `m-${nonce}` : 'flame'}
            className={cn(
              'freestyle-combo-flame inline-flex',
              milestone && animate && 'freestyle-combo-flame-kick',
            )}
          >
            <Flame className="size-3.5" aria-hidden />
          </span>
          <span className="relative inline-flex h-4 min-w-[1.25rem] overflow-hidden">
            <span key={combo} className={cn('block leading-4', animate && 'freestyle-combo-digit-in')}>
              {combo}
            </span>
          </span>
          <span className="text-[10px] font-semibold opacity-80">连击</span>
          {milestone && animate ? (
            <span
              key={`ring-${nonce}`}
              className="freestyle-combo-ring freestyle-combo-ring-pulse absolute inset-0 rounded-full"
              aria-hidden
            />
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
