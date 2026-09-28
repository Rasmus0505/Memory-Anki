import { useEffect, useRef, useState } from 'react'
import { createOperationId } from '@/modules/practice/application/feedPersistence'
import { ensureFreestyleOverlayQuizApi } from '@/modules/practice/ui/freestyle/api'
import { overlayFromRound } from './overlayQuizHydrate'
import type {
  FreestyleFeedConfig,
  FreestyleOverlayQuestionKind,
  FreestyleOverlayTypeOrder,
  FreestyleOverlayTypePalaceNesting,
  FreestyleQuizScope,
  FreestyleRoundStatePayload,
} from '@/shared/api/contracts'
import { QuizShortcutSettingsSection } from '@/modules/quiz/public'
import { Button } from '@/shared/components/ui/button'
import { cn } from '@/shared/lib/utils'

export type OverlayQuizSetupChoice = {
  quizScope: FreestyleQuizScope
  overlayQuestionRange: 'all'
  overlayQuestionKinds: FreestyleOverlayQuestionKind[]
  overlayTypeOrder: FreestyleOverlayTypeOrder
  overlayTypePalaceNesting: FreestyleOverlayTypePalaceNesting
}

const OPTION_CLASS = 'rounded-xl border px-3.5 py-3 text-left transition-colors'

function OptionButton({
  selected,
  label,
  hint,
  onClick,
}: {
  selected: boolean
  label: string
  hint: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      className={cn(OPTION_CLASS, selected ? 'border-primary bg-primary/10' : 'border-border/60 bg-background/80 hover:bg-muted/60')}
      onClick={onClick}
    >
      <span className="block text-sm font-semibold">{label}</span>
      <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>
    </button>
  )
}

export function OverlayQuizSetupPanel({
  roundId,
  planVersion,
  storedConfig,
  setupDone,
  rangeLabel,
  palaceCount,
  onRoundSync,
  onConfirm,
}: {
  roundId: string
  planVersion: number
  storedConfig: FreestyleFeedConfig
  setupDone: boolean
  rangeLabel: string
  palaceCount: number
  onRoundSync: (round: FreestyleRoundStatePayload) => void
  onConfirm: (choice: OverlayQuizSetupChoice) => void
}) {
  const [draftScope, setDraftScope] = useState(storedConfig.streams.quiz.quiz_scope)
  const [draftKinds, setDraftKinds] = useState(storedConfig.overlay_question_kinds)
  const [draftTypeOrder, setDraftTypeOrder] = useState(storedConfig.overlay_type_order)
  const [draftNesting, setDraftNesting] = useState(storedConfig.overlay_type_palace_nesting)
  const [kindCounts, setKindCounts] = useState({ objective: 0, subjective: 0 })
  const [countsReady, setCountsReady] = useState(false)
  const configRef = useRef(storedConfig)
  const planVersionRef = useRef(planVersion)
  configRef.current = storedConfig
  planVersionRef.current = planVersion
  const countKey = [
    roundId,
    storedConfig.seed,
    storedConfig.streams.quiz.quiz_scope,
    storedConfig.overlay_question_kinds.join(','),
    storedConfig.overlay_type_order,
    storedConfig.overlay_type_palace_nesting,
  ].join('|')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (!roundId) {
        setCountsReady(true)
        return
      }
      try {
        const round = await ensureFreestyleOverlayQuizApi(roundId, {
          operation_id: createOperationId(),
          expected_version: planVersionRef.current,
          config: configRef.current,
        })
        if (cancelled) return
        onRoundSync(round)
        const next = overlayFromRound(round)
        setKindCounts(next?.kind_counts ?? { objective: 0, subjective: 0 })
      } catch {
        if (!cancelled) setKindCounts({ objective: 0, subjective: 0 })
      } finally {
        if (!cancelled) setCountsReady(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [countKey, onRoundSync, roundId])

  const availableKinds = (['objective', 'subjective'] as const).filter((kind) => (kindCounts[kind] ?? 0) > 0)
  const selectedAvailable = availableKinds.filter((kind) => draftKinds.includes(kind))
  const effectiveKinds = selectedAvailable.length
    ? selectedAvailable
    : availableKinds.length
      ? [...availableKinds]
      : draftKinds
  const showTypeOrder = availableKinds.length === 2 && availableKinds.every((kind) => effectiveKinds.includes(kind))
  const showNesting = showTypeOrder
    && draftTypeOrder !== 'interleave'
    && draftScope === 'single_palace_random'
    && palaceCount > 1
  const toggleKind = (kind: FreestyleOverlayQuestionKind) => {
    setDraftKinds((current) => {
      const selected = availableKinds.filter((item) => current.includes(item))
      const active = selected.length ? selected : [...availableKinds]
      if (active.includes(kind)) {
        if (active.length <= 1) return active
        return active.filter((item) => item !== kind)
      }
      return availableKinds.filter((item) => active.includes(item) || item === kind)
    })
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{rangeLabel}。只出这些宫殿的题，不会改训练方向。</p>
      <div role="radiogroup" aria-label="宫殿间顺序" className="grid gap-2">
        {([
          ['cross_palace_random', '跨宫殿乱序', '每道题可能来自不同宫殿'],
          ['single_palace_random', '一个宫殿刷完再换', '先刷完一座宫殿的题再换下一座'],
        ] as const).map(([value, label, hint]) => (
          <OptionButton key={value} selected={draftScope === value} label={label} hint={hint} onClick={() => setDraftScope(value)} />
        ))}
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium">当前出哪些题</p>
        {availableKinds.length ? (
          <div role="group" aria-label="题型" className="grid gap-2">
            {availableKinds.map((kind) => {
              const checked = effectiveKinds.includes(kind)
              const label = kind === 'subjective' ? '主观' : '客观'
              return (
                <label
                  key={kind}
                  className={cn(
                    'flex cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-3 text-sm',
                    checked ? 'border-primary bg-primary/10' : 'border-border/60 bg-background/80',
                  )}
                >
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={checked}
                    aria-label={`${label}（${kindCounts[kind] ?? 0}）`}
                    onChange={() => toggleKind(kind)}
                  />
                  <span className="font-semibold">{label}</span>
                  <span className="text-xs text-muted-foreground">{kindCounts[kind] ?? 0} 题</span>
                </label>
              )
            })}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            {countsReady ? '当前没有客观题或主观题' : '正在统计当前题目…'}
          </p>
        )}
      </div>
      {showTypeOrder ? (
        <div role="radiogroup" aria-label="题型顺序" className="grid gap-2">
          {([
            ['interleave', '混合插入', '客观题和主观题交错出现'],
            ['objective_then_subjective', '先客观后主观', '先刷完客观题，再刷主观题'],
            ['subjective_then_objective', '先主观后客观', '先刷完主观题，再刷客观题'],
          ] as const).map(([value, label, hint]) => (
            <OptionButton key={value} selected={draftTypeOrder === value} label={label} hint={hint} onClick={() => setDraftTypeOrder(value)} />
          ))}
        </div>
      ) : null}
      {showNesting ? (
        <div role="radiogroup" aria-label="宫殿和题型谁优先" className="grid gap-2">
          {([
            ['palace_then_type', '这座宫殿两类都刷完再换', '一座宫殿里先按题型刷完，再换下一座'],
            ['type_then_palace', '先刷完所有宫殿的一类', '先把所有宫殿的一类题刷完，再刷另一类'],
          ] as const).map(([value, label, hint]) => (
            <OptionButton key={value} selected={draftNesting === value} label={label} hint={hint} onClick={() => setDraftNesting(value)} />
          ))}
        </div>
      ) : null}
      <Button
        type="button"
        className="w-full"
        disabled={!countsReady}
        onClick={() => onConfirm({
          quizScope: draftScope,
          overlayQuestionRange: 'all',
          overlayQuestionKinds: effectiveKinds,
          overlayTypeOrder: draftTypeOrder,
          overlayTypePalaceNesting: draftNesting,
        })}
      >
        {setupDone ? '保存并继续' : '开始做题'}
      </Button>
      <QuizShortcutSettingsSection />
    </div>
  )
}
