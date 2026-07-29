import { useEffect, useRef } from 'react'
import { CheckCircle2, Sparkles, XCircle } from 'lucide-react'
import type { EnglishSentenceCheckResponse } from '@/shared/api/contracts'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import {
  ENGLISH_SHORTCUT_ACTIONS,
  getShortcutLabel,
  type EnglishPracticeSettings,
} from '@/modules/settings/public'
import { buildLetterSlots } from '@/modules/english/ui/english/englishTypingHelpers'
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
  activeWordIndex = -1,
}: {
  expectedTokens: string[]
  wordInputs: string[]
  wordStatuses: string[]
  wordRevealComparableIndices: number[][]
  density?: WordRailDensity
  activeWordIndex?: number
}) {
  const activeWordRef = useRef<HTMLSpanElement | null>(null)
  const resolvedActiveIndex =
    activeWordIndex >= 0
      ? activeWordIndex
      : wordStatuses.findIndex((status) => status === 'active')
  const activeWordStatus = resolvedActiveIndex >= 0 ? wordStatuses[resolvedActiveIndex] : undefined

  useEffect(() => {
    if (resolvedActiveIndex < 0) return
    const node = activeWordRef.current
    if (!node || typeof node.scrollIntoView !== 'function') return
    node.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
      behavior: 'smooth',
    })
  }, [resolvedActiveIndex, activeWordStatus])

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
          rail: 'gap-x-2 gap-y-2',
          token: 'gap-0.5 px-1.5 py-1',
          slot: 'min-w-[0.85rem] text-base sm:text-lg',
        }
      : density === 'compact'
        ? {
            rail: 'gap-x-3 gap-y-2.5',
            token: 'gap-0.5 px-2 py-1.5',
            slot: 'min-w-[1rem] text-xl',
          }
        : {
            rail: 'gap-x-4 gap-y-3',
            token: 'gap-1 px-2.5 py-2',
            slot: 'min-w-[1.15rem] text-2xl sm:text-[1.7rem]',
          }

  return (
    <div
      className={cn('flex flex-wrap items-center content-center justify-center', densityClassName.rail)}
      data-testid="english-word-rail"
      data-density={density}
    >
      {expectedTokens.map((token, index) => {
        const status = wordStatuses[index] || 'pending'
        const isActiveWord = index === resolvedActiveIndex || status === 'active'
        const slots = buildLetterSlots(
          token,
          wordInputs[index] || '',
          wordRevealComparableIndices[index] || [],
        )
        const caretSlotKey =
          isActiveWord
            ? slots.find((slot) => slot.state === 'empty' && !slot.extra)?.key ?? null
            : null

        const containerStyle =
          status === 'active'
            ? 'ring-2 ring-info/45 bg-info/10 shadow-soft'
            : status === 'wrong'
              ? 'ring-2 ring-destructive/40 bg-destructive/10 english-word-shake'
              : status === 'correct'
                ? 'bg-success/10 ring-1 ring-success/20 english-word-correct-flash'
                : 'bg-muted/25'

        const wordOpacity = status === 'pending' ? 'opacity-40' : ''

        return (
          <span
            key={`${token}-${index}`}
            ref={isActiveWord ? activeWordRef : undefined}
            data-testid={`english-word-${index}`}
            data-status={status}
            data-active-word={isActiveWord ? 'true' : 'false'}
            className={cn(
              'inline-flex items-end rounded-2xl font-mono transition-[background-color,box-shadow,opacity] duration-150',
              densityClassName.token,
              containerStyle,
              wordOpacity,
            )}
          >
            {slots.map((slot) => {
              const showCaret = caretSlotKey === slot.key
              const slotColor =
                slot.state === 'empty'
                  ? 'border-muted-foreground/35 text-transparent'
                  : slot.state === 'correct'
                    ? 'border-success/55 text-success english-letter-pop'
                    : slot.state === 'revealed'
                      ? 'border-warning/60 text-warning english-letter-pop'
                      : slot.state === 'wrong' && slot.extra
                        ? 'border-destructive/50 text-destructive/70 line-through decoration-1'
                        : slot.state === 'wrong'
                          ? 'border-destructive/70 text-destructive english-letter-pop'
                          : slot.state === 'fixed'
                            ? 'border-transparent font-semibold text-foreground'
                            : 'border-muted-foreground/35 text-transparent'

              return (
                <span
                  key={slot.key}
                  data-slot-state={slot.state}
                  data-caret={showCaret ? 'true' : undefined}
                  className={cn(
                    'relative inline-flex h-[1.35em] items-center justify-center border-b-2 pb-0.5 leading-none tracking-normal',
                    densityClassName.slot,
                    slot.state === 'fixed' ? 'border-b-0 px-0.5' : 'rounded-sm',
                    slotColor,
                  )}
                >
                  {slot.state === 'empty' ? '\u00A0' : slot.char}
                  {showCaret ? (
                    <span
                      aria-hidden
                      className="english-caret absolute bottom-0 left-1/2 h-[1.05em] w-[2px] -translate-x-1/2 rounded-full bg-info"
                    />
                  ) : null}
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
