import { CheckCircle2, Sparkles, XCircle } from 'lucide-react'
import type { EnglishSentenceCheckResponse } from '@/shared/api/contracts'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import {
  ENGLISH_SHORTCUT_ACTIONS,
  getShortcutLabel,
  type EnglishPracticeSettings,
} from '@/entities/preferences/model/englishPracticeSettings'
import { buildLetterSlots } from '@/features/english/englishTypingHelpers'
import { cn } from '@/shared/lib/utils'

export interface StatusNotice {
  kind: 'info' | 'success' | 'error'
  text: string
}

export type WordRailDensity = 'regular' | 'compact' | 'dense'

export function StatusBanner({ notice }: { notice: StatusNotice | null }) {
  if (!notice) return null

  const palette =
    notice.kind === 'success'
      ? 'border-success/20 bg-success/5 text-success'
      : notice.kind === 'error'
        ? 'border-destructive/20 bg-destructive/5 text-destructive'
        : 'border-info/20 bg-info/5 text-info'

  return (
    <div className={cn('rounded-2xl border px-4 py-3 text-sm', palette)}>
      <div className="flex items-center gap-2 font-medium">
        {notice.kind === 'success' ? (
          <CheckCircle2 className="size-4" />
        ) : notice.kind === 'error' ? (
          <XCircle className="size-4" />
        ) : (
          <Sparkles className="size-4" />
        )}
        {notice.text}
      </div>
    </div>
  )
}

export function WordRail({
  expectedTokens,
  wordInputs,
  wordStatuses,
  wordRevealComparableIndices,
  density = 'regular',
}: {
  expectedTokens: string[]
  wordInputs: string[]
  wordStatuses: string[]
  wordRevealComparableIndices: number[][]
  density?: WordRailDensity
}) {
  if (!expectedTokens.length) {
    return (
      <div className="rounded-2xl border border-dashed border-border/70 px-4 py-6 text-center text-sm text-muted-foreground">
        当前句没有可练习的 token。
      </div>
    )
  }

  const densityClassName =
    density === 'dense'
      ? {
          rail: 'gap-x-2.5 gap-y-2',
          token: 'px-1 py-0.5 text-lg tracking-[0.08em]',
        }
      : density === 'compact'
        ? {
            rail: 'gap-x-3.5 gap-y-2.5',
            token: 'px-1.5 py-1 text-xl tracking-[0.1em]',
          }
        : {
            rail: 'gap-x-5 gap-y-3',
            token: 'px-1.5 py-1 text-2xl tracking-[0.14em] sm:text-[1.7rem]',
          }

  return (
    <div
      className={cn('flex flex-wrap items-center content-start', densityClassName.rail)}
      data-testid="english-word-rail"
      data-density={density}
    >
      {expectedTokens.map((token, index) => {
        const status = wordStatuses[index] || 'pending'
        const slots = buildLetterSlots(
          token,
          wordInputs[index] || '',
          wordRevealComparableIndices[index] || [],
        )

        const containerStyle =
          status === 'active'
            ? 'ring-2 ring-info/40 bg-info/10 shadow-soft'
            : status === 'wrong'
              ? 'ring-2 ring-destructive/35 bg-destructive/5'
              : status === 'correct'
                ? 'bg-success/5'
                : 'bg-muted/30'

        const wordOpacity = status === 'pending' ? 'opacity-45' : ''

        return (
          <span
            key={`${token}-${index}`}
            data-testid={`english-word-${index}`}
            data-status={status}
            className={cn(
              'inline-flex items-center gap-0.5 rounded-xl font-mono transition-colors',
              densityClassName.token,
              containerStyle,
              wordOpacity,
            )}
          >
            {slots.map((slot) => {
              const slotColor =
                slot.state === 'empty'
                  ? 'text-muted-foreground/45'
                  : slot.state === 'correct'
                    ? 'text-success'
                    : slot.state === 'revealed'
                      ? 'text-warning'
                      : slot.state === 'wrong' && slot.extra
                        ? 'text-destructive/70 line-through decoration-1'
                        : slot.state === 'wrong'
                          ? 'text-destructive'
                          : slot.state === 'fixed'
                            ? 'font-semibold text-foreground'
                            : 'text-muted-foreground/45'

              return (
                <span key={slot.key} data-slot-state={slot.state} className={slotColor}>
                  {slot.state === 'empty' ? '_' : slot.char}
                </span>
              )
            })}
          </span>
        )
      })}
    </div>
  )
}

export function FinalCheckRail({
  feedback,
}: {
  feedback: EnglishSentenceCheckResponse | null
}) {
  if (!feedback || feedback.passed || feedback.tokenResults.length === 0) return null

  return (
    <div className="flex flex-wrap gap-2 rounded-2xl border border-destructive/20 bg-destructive/5 px-4 py-4">
      {feedback.tokenResults.map((item, index) => (
        <span
          key={`check-${index}`}
          className={cn(
            'inline-flex min-h-10 min-w-[58px] items-center justify-center rounded-xl border-b-2 px-3 text-sm font-medium',
            item.correct
              ? 'border-success bg-success/10 text-success'
              : 'border-destructive/70 bg-background text-destructive',
          )}
        >
          {item.input || '____'}
        </span>
      ))}
    </div>
  )
}

export function ShortcutSummary({ settings }: { settings: EnglishPracticeSettings }) {
  return (
    <div className="space-y-2">
      {ENGLISH_SHORTCUT_ACTIONS.map((action) => (
        <div key={action.id} className="flex items-center justify-between gap-3 text-sm">
          <span className="text-muted-foreground">{action.label}</span>
          <Badge variant="outline" className="font-mono text-[11px]">
            {getShortcutLabel(settings.shortcuts[action.id])}
          </Badge>
        </div>
      ))}
    </div>
  )
}

export function SidePanelTabButton({
  active,
  label,
  onClick,
}: {
  active: boolean
  label: string
  onClick: () => void
}) {
  return (
    <Button type="button" size="sm" variant={active ? 'default' : 'outline'} onClick={onClick}>
      {label}
    </Button>
  )
}
