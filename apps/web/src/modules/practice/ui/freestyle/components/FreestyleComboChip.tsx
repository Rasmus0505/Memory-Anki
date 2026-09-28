import { AnimatePresence, motion } from 'motion/react'
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
export function FreestyleComboChip({ reducedMotion = false }: { reducedMotion?: boolean }) {
  const { combo, milestoneIndex, nonce } = useFreestyleCombo()
  const visible = combo >= COMBO_VISIBLE_FROM
  const milestone = milestoneIndex != null

  return (
    <div className="pointer-events-none absolute -top-9 right-3 z-20 sm:-top-10" aria-live="polite">
      <AnimatePresence>
        {visible ? (
          <motion.div
            key="combo"
            data-testid="freestyle-combo-chip"
            data-combo={combo}
            className={cn(
              'freestyle-combo-chip flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-bold tabular-nums',
              comboHeat(combo),
              milestone && !reducedMotion && 'freestyle-combo-aura',
            )}
            initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.8 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 4, scale: 0.9, transition: { duration: 0.35 } }}
            transition={{ type: 'spring', stiffness: 520, damping: 26 }}
          >
            <motion.span
              key={milestone ? `m-${nonce}` : 'flame'}
              className="freestyle-combo-flame inline-flex"
              initial={milestone && !reducedMotion ? { scale: 0.6, rotate: -20 } : false}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 600, damping: 12 }}
            >
              <Flame className="size-3.5" aria-hidden />
            </motion.span>
            <span className="relative inline-flex h-4 min-w-[1.25rem] overflow-hidden">
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span
                  key={combo}
                  className="block leading-4"
                  initial={reducedMotion ? { opacity: 0 } : { y: 12, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={reducedMotion ? { opacity: 0 } : { y: -12, opacity: 0 }}
                  transition={{ type: 'spring', stiffness: 700, damping: 30 }}
                >
                  {combo}
                </motion.span>
              </AnimatePresence>
            </span>
            <span className="text-[10px] font-semibold opacity-80">连击</span>
            {milestone && !reducedMotion ? (
              <motion.span
                key={`ring-${nonce}`}
                className="freestyle-combo-ring absolute inset-0 rounded-full"
                initial={{ scale: 1, opacity: 0.9 }}
                animate={{ scale: 1.9, opacity: 0 }}
                transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
                aria-hidden
              />
            ) : null}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}
