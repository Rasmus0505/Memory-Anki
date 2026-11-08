import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createOperationId } from '@/modules/practice/application/feedPersistence'
import { ensureFreestyleOverlayQuizApi, setFreestyleOverlaySkippedPalacesApi } from '@/modules/practice/ui/freestyle/api'
import {
  OVERLAY_QUESTION_RANGE_LABELS,
  overlayQuestionRangeHint,
} from '@/modules/practice/ui/freestyle/model/overlayQuizRange'
import { OverlayQuizScopeList, OverlayQuizScopeSummary } from './OverlayQuizScopeList'
import { overlayFromRound } from './overlayQuizHydrate'
import type {
  FreestyleFeedConfig,
  FreestyleOverlayQuestionKind,
  FreestyleOverlayQuestionRange,
  FreestyleOverlayRatingInherit,
  FreestyleOverlayScopePalaces,
  FreestyleOverlayTypeOrder,
  FreestyleOverlayTypePalaceNesting,
  FreestyleQuizScope,
  FreestyleRoundStatePayload,
} from '@/shared/api/contracts'
import { QuizShortcutSettingsSection, useQuizOptionShuffleSettings } from '@/modules/quiz/public'
import { Switch } from '@/shared/components/ui/switch'
import { Button } from '@/shared/components/ui/button'
import { cn } from '@/shared/lib/utils'

export type OverlayQuizSetupChoice = {
  quizScope: FreestyleQuizScope
  overlayQuestionRange: FreestyleOverlayQuestionRange
  overlayQuestionKinds: FreestyleOverlayQuestionKind[]
  overlayTypeOrder: FreestyleOverlayTypeOrder
  overlayTypePalaceNesting: FreestyleOverlayTypePalaceNesting
  overlayRatingInherit: FreestyleOverlayRatingInherit
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
  hint?: string
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
      {hint ? <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{hint}</span> : null}
    </button>
  )
}

function Section({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <section className="space-y-2.5 border-b border-border/50 pb-4 last:border-b-0 last:pb-0">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </section>
  )
}

function SetupSaveButton({
  setupDone,
  countsReady,
  directMode,
  onClick,
}: {
  setupDone: boolean
  countsReady: boolean
  directMode: boolean
  onClick: () => void
}) {
  return (
    <Button type="button" className="w-full" disabled={!countsReady} onClick={onClick}>
      {directMode ? '完成配置' : setupDone ? '保存并继续' : '开始做题'}
    </Button>
  )
}

/**
 * The whole 做题 setup in one scroll: range, order, score display and
 * shortcuts. It used to be a hub plus four separate pages, which hid the
 * single most important choice (where the questions come from) behind a tap.
 */
export function OverlayQuizSetupPanel({
  roundId,
  planVersion,
  storedConfig,
  setupDone,
  scopePalaces,
  palaceCount,
  onRoundSync,
  onConfirm,
  directMode = false,
  directQuestionCount = 0,
  onClose,
}: {
  roundId: string
  planVersion: number
  storedConfig: FreestyleFeedConfig
  setupDone: boolean
  /** Authoritative scope from the backend pack. Never re-derived here. */
  scopePalaces: FreestyleOverlayScopePalaces | null
  /** Round-scoped palace count: gates the 宫殿/题型 nesting choice only. */
  palaceCount: number
  onRoundSync: (round: FreestyleRoundStatePayload) => void
  onConfirm: (choice: OverlayQuizSetupChoice) => void
  directMode?: boolean
  directQuestionCount?: number
  onClose?: () => void
}) {
  const [draftRange, setDraftRange] = useState<FreestyleOverlayQuestionRange>(
    storedConfig.streams.quiz.overlay_question_range,
  )
  const [draftScope, setDraftScope] = useState(storedConfig.streams.quiz.quiz_scope)
  const [draftKinds, setDraftKinds] = useState(storedConfig.overlay_question_kinds)
  const [draftTypeOrder, setDraftTypeOrder] = useState(storedConfig.overlay_type_order)
  const [draftNesting, setDraftNesting] = useState(storedConfig.overlay_type_palace_nesting)
  const [draftInherit, setDraftInherit] = useState<FreestyleOverlayRatingInherit>(
    storedConfig.overlay_rating_inherit === 'blank' ? 'blank' : 'lowest_reviewed',
  )
  const [kindCounts, setKindCounts] = useState({ objective: 0, subjective: 0 })
  const [countsReady, setCountsReady] = useState(false)
  const { settings: optionShuffleSettings, updateSettings: updateOptionShuffleSettings } = useQuizOptionShuffleSettings()
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
    draftRange,
  ].join('|')

  // The active range changes which kinds exist; do not let a stale count keep
  // the save button live with a kind that the new pool does not contain.
  useEffect(() => {
    setCountsReady(false)
  }, [draftRange])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (!roundId) {
        setCountsReady(true)
        return
      }
      try {
        const base = configRef.current
        const previewConfig = {
          ...base,
          overlay_question_range: draftRange,
          streams: {
            ...base.streams,
            quiz: { ...base.streams.quiz, overlay_question_range: draftRange },
          },
        }
        const round = await ensureFreestyleOverlayQuizApi(roundId, {
          operation_id: createOperationId(),
          expected_version: planVersionRef.current,
          config: previewConfig,
        })
        if (cancelled) return
        const returnedVersion = typeof round.plan_version === 'number' && round.plan_version > 0
          ? round.plan_version
          : round.version
        if (typeof returnedVersion === 'number' && returnedVersion > 0) {
          planVersionRef.current = returnedVersion
        }
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
  }, [countKey, draftRange, onRoundSync, roundId])

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
  const save = () => onConfirm({
    quizScope: draftScope,
    overlayQuestionRange: draftRange,
    overlayQuestionKinds: effectiveKinds,
    overlayTypeOrder: draftTypeOrder,
    overlayTypePalaceNesting: draftNesting,
    overlayRatingInherit: draftInherit,
  })
  // Deleting or restoring palaces is a server write: the returned round carries
  // the rebuilt scope report, so the list re-renders from the backend's answer.
  const setPalacesSkipped = async (palaceIds: number[], skipped: boolean) => {
    const round = await setFreestyleOverlaySkippedPalacesApi(roundId, {
      operation_id: createOperationId(),
      expected_version: planVersionRef.current,
      palace_ids: palaceIds,
      skipped,
    })
    onRoundSync(round)
  }

  return (
    <div className="space-y-4">
      {directMode ? (
        <Section title="出题范围">
          <p className="rounded-xl border border-border/60 bg-background/80 px-3.5 py-3 text-sm">
            {directQuestionCount > 0
              ? `当前卡片关联的 ${directQuestionCount} 道题`
              : '当前没有关联题目'}
          </p>
        </Section>
      ) : (
        <>
          <Section title="出题范围">
            <div role="radiogroup" aria-label="出题范围" className="grid gap-2 sm:grid-cols-2">
              {(['round_units', 'whole_palace'] as const).map((range) => (
                <OptionButton
                  key={range}
                  selected={draftRange === range}
                  label={OVERLAY_QUESTION_RANGE_LABELS[range]}
                  hint={overlayQuestionRangeHint(range)}
                  onClick={() => setDraftRange(range)}
                />
              ))}
            </div>
            <OverlayQuizScopeSummary scopePalaces={scopePalaces} range={draftRange} />
            <OverlayQuizScopeList scopePalaces={scopePalaces} onSetSkipped={setPalacesSkipped} />
          </Section>

          <Section title="出题顺序">
            <div role="radiogroup" aria-label="宫殿间顺序" className="grid gap-2 sm:grid-cols-2">
              {([
                ['cross_palace_random', '跨宫殿乱序'],
                ['single_palace_random', '一个宫殿刷完再换'],
              ] as const).map(([value, label]) => (
                <OptionButton key={value} selected={draftScope === value} label={label} onClick={() => setDraftScope(value)} />
              ))}
            </div>
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">当前出哪些题</p>
              {availableKinds.length ? (
                <div role="group" aria-label="题型" className="grid gap-2 sm:grid-cols-2">
                  {availableKinds.map((kind) => {
                    const checked = effectiveKinds.includes(kind)
                    const label = kind === 'subjective' ? '主观' : '客观'
                    return (
                      <label
                        key={kind}
                        className={cn(
                          'flex cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-2.5 text-sm',
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
                  ['interleave', '混合插入'],
                  ['objective_then_subjective', '先客观后主观'],
                  ['subjective_then_objective', '先主观后客观'],
                ] as const).map(([value, label]) => (
                  <OptionButton key={value} selected={draftTypeOrder === value} label={label} onClick={() => setDraftTypeOrder(value)} />
                ))}
              </div>
            ) : null}
            {showNesting ? (
              <div role="radiogroup" aria-label="宫殿和题型谁优先" className="grid gap-2">
                {([
                  ['palace_then_type', '这座宫殿两类都刷完再换'],
                  ['type_then_palace', '先刷完所有宫殿的一类'],
                ] as const).map(([value, label]) => (
                  <OptionButton key={value} selected={draftNesting === value} label={label} onClick={() => setDraftNesting(value)} />
                ))}
              </div>
            ) : null}
          </Section>

          <Section title="题目分数">
            <div role="radiogroup" aria-label="空白题怎么显示分数" className="grid gap-2 sm:grid-cols-2">
              <OptionButton
                selected={draftInherit === 'lowest_reviewed'}
                label="跟着已复习的最低分"
                hint="自己有分就用自己的；进度条没刷到的仍显示「本轮尚未复习」。"
                onClick={() => setDraftInherit('lowest_reviewed')}
              />
              <OptionButton
                selected={draftInherit === 'blank'}
                label="保持空白"
                hint="自己没分就不标。"
                onClick={() => setDraftInherit('blank')}
              />
            </div>
          </Section>
        </>
      )}

      <details className="rounded-xl border border-border/60 bg-background/80 px-3.5 py-3">
        <summary className="cursor-pointer text-sm font-semibold">快捷键</summary>
        <div className="pt-3">
          <QuizShortcutSettingsSection />
        </div>
      </details>

      <Section title="选项顺序">
        <div className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-background/80 px-3.5 py-3">
          <p className="text-sm font-semibold">自动打乱选项</p>
          <Switch
            checked={optionShuffleSettings.enabled}
            aria-label="自动打乱选项"
            onCheckedChange={(enabled) => updateOptionShuffleSettings({ ...optionShuffleSettings, enabled })}
          />
        </div>
      </Section>

      <div className="sticky bottom-0 z-10 border-t border-border/50 bg-background/95 py-3 backdrop-blur">
        <SetupSaveButton
          setupDone={setupDone}
          countsReady={directMode || countsReady}
          directMode={directMode}
          onClick={directMode ? (onClose ?? (() => undefined)) : save}
        />
      </div>
    </div>
  )
}
