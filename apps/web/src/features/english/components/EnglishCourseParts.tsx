import { CheckCircle2, Sparkles, XCircle } from 'lucide-react'
import type { EnglishSentenceCheckResponse } from '@/shared/api/contracts'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import {
  ENGLISH_SHORTCUT_ACTIONS,
  getShortcutLabel,
  type EnglishPracticeSettings,
} from '@/features/english/englishPracticeSettings'
import { buildLetterSlots } from '@/features/english/englishTypingHelpers'

export interface StatusNotice {
  kind: 'info' | 'success' | 'error'
  text: string
}

export function StatusBanner({ notice }: { notice: StatusNotice | null }) {
  if (!notice) return null

  const palette =
    notice.kind === 'success'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
      : notice.kind === 'error'
        ? 'border-rose-200 bg-rose-50 text-rose-700'
        : 'border-sky-200 bg-sky-50 text-sky-700'

  return (
    <div className={`rounded-2xl border px-4 py-3 text-sm ${palette}`}>
      <div className="flex items-center gap-2 font-medium">
        {notice.kind === 'success' ? (
          <CheckCircle2 className="h-4 w-4" />
        ) : notice.kind === 'error' ? (
          <XCircle className="h-4 w-4" />
        ) : (
          <Sparkles className="h-4 w-4" />
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
}: {
  expectedTokens: string[]
  wordInputs: string[]
  wordStatuses: string[]
  wordRevealComparableIndices: number[][]
}) {
  if (!expectedTokens.length) {
    return (
      <div className="rounded-2xl border border-dashed border-border/70 px-4 py-6 text-center text-sm text-muted-foreground">
        当前句没有可练习的 token。
      </div>
    )
  }

  return (
    <div className="flex flex-wrap gap-3" data-testid="english-word-rail">
      {expectedTokens.map((token, index) => {
        const status = wordStatuses[index] || 'pending'
        const slots = buildLetterSlots(token, wordInputs[index] || '', wordRevealComparableIndices[index] || [])
        const wordShellClassName =
          status === 'correct'
            ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
            : status === 'wrong'
              ? 'border-rose-300 bg-rose-50 text-rose-800'
              : status === 'active'
                ? 'border-sky-300 bg-sky-50 text-sky-800 shadow-[0_0_0_1px_rgba(14,165,233,0.08)]'
                : 'border-border/70 bg-background/80 text-muted-foreground'

        return (
          <div
            key={`${token}-${index}`}
            data-testid={`english-word-${index}`}
            data-status={status}
            className={`min-w-[120px] rounded-2xl border px-3 py-3 transition-colors ${wordShellClassName}`}
          >
            <div className="flex flex-wrap justify-center gap-1">
              {slots.map((slot) => {
                const slotClassName =
                  slot.state === 'correct'
                    ? 'border-emerald-300 bg-emerald-100 text-emerald-800'
                    : slot.state === 'wrong'
                      ? 'border-rose-300 bg-rose-100 text-rose-800'
                      : slot.state === 'revealed'
                        ? 'border-amber-300 bg-amber-100 text-amber-800'
                        : slot.state === 'fixed'
                          ? 'border-transparent bg-transparent text-muted-foreground'
                          : 'border-border/70 bg-background text-transparent'
                return (
                  <span
                    key={slot.key}
                    data-slot-state={slot.state}
                    className={`inline-flex h-10 min-w-8 items-center justify-center rounded-xl border px-2 font-mono text-base font-semibold ${
                      slot.extra ? 'min-w-7' : ''
                    } ${slotClassName}`}
                  >
                    {slot.char}
                  </span>
                )
              })}
            </div>
          </div>
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
    <div className="flex flex-wrap gap-2 rounded-2xl border border-rose-200 bg-rose-50/70 px-4 py-4">
      {feedback.tokenResults.map((item, index) => (
        <span
          key={`check-${index}`}
          className={`inline-flex min-h-10 min-w-[58px] items-center justify-center rounded-xl border-b-2 px-3 text-sm font-medium ${
            item.correct
              ? 'border-emerald-500 bg-emerald-100 text-emerald-700'
              : 'border-rose-400 bg-white text-rose-700'
          }`}
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
