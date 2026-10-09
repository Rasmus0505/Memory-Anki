import { useEffect, useRef, useState } from 'react'
import { createOperationId } from '@/modules/practice/application/feedPersistence'
import { ensureFreestyleOverlayQuizApi } from '@/modules/practice/ui/freestyle/api'
import { OverlayQuizScopeList, OverlayQuizScopeSummary } from './OverlayQuizScopeList'
import { overlayFromRound } from './overlayQuizHydrate'
import type {
  FreestyleFeedConfig,
  FreestyleOverlayQuestionKind,
  FreestyleOverlayRatingInherit,
  FreestyleOverlayScopePalaces,
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

function SetupSaveButton({
  setupDone,
  countsReady,
  onClick,
}: {
  setupDone: boolean
  countsReady: boolean
  onClick: () => void
}) {
  return (
    <Button type="button" className="w-full" disabled={!countsReady} onClick={onClick}>
      {setupDone ? '保存并继续' : '开始做题'}
    </Button>
  )
}

function PageHeading({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <button type="button" className="text-sm text-muted-foreground" onClick={onBack}>
        返回
      </button>
      <p className="text-sm font-semibold">{title}</p>
    </div>
  )
}

type SetupPage = 'hub' | 'scope' | 'order' | 'rating' | 'shortcuts'

function SetupHub({
  ratingHint,
  setupDone,
  countsReady,
  onOpen,
  onSave,
}: {
  ratingHint: string
  setupDone: boolean
  countsReady: boolean
  onOpen: (page: SetupPage) => void
  onSave: () => void
}) {
  const items = [
    ['scope', '出题范围', '这轮从哪些宫殿抽题'],
    ['order', '出题顺序', '宫殿怎么换、题型怎么排'],
    ['rating', '题目分数', ratingHint],
    ['shortcuts', '快捷键', '做题时的按键'],
  ] as const
  return (
    <div className="space-y-3">
      <div className="grid gap-2">
        {items.map(([page, label, hint]) => (
          <button
            key={page}
            type="button"
            className={cn(OPTION_CLASS, 'border-border/60 bg-background/80 hover:bg-muted/60')}
            onClick={() => onOpen(page)}
          >
            <span className="block text-sm font-semibold">{label}</span>
            <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>
          </button>
        ))}
      </div>
      <SetupSaveButton setupDone={setupDone} countsReady={countsReady} onClick={onSave} />
    </div>
  )
}

export function OverlayQuizSetupPanel({
  roundId,
  planVersion,
  storedConfig,
  setupDone,
  scopePalaces,
  palaceCount,
  onRoundSync,
  onConfirm,
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
}) {
  const [draftScope, setDraftScope] = useState(storedConfig.streams.quiz.quiz_scope)
  const [draftKinds, setDraftKinds] = useState(storedConfig.overlay_question_kinds)
  const [draftTypeOrder, setDraftTypeOrder] = useState(storedConfig.overlay_type_order)
  const [draftNesting, setDraftNesting] = useState(storedConfig.overlay_type_palace_nesting)
  const [draftInherit, setDraftInherit] = useState<FreestyleOverlayRatingInherit>(
    storedConfig.overlay_rating_inherit === 'blank' ? 'blank' : 'lowest_reviewed',
  )
  const [page, setPage] = useState<SetupPage>('hub')
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
  const save = () => onConfirm({
    quizScope: draftScope,
    overlayQuestionRange: 'all',
    overlayQuestionKinds: effectiveKinds,
    overlayTypeOrder: draftTypeOrder,
    overlayTypePalaceNesting: draftNesting,
    overlayRatingInherit: draftInherit,
  })
  const ratingHint = draftInherit === 'blank'
    ? '没排到的题，保持空白'
    : '没排到的题，跟着已复习的最低分'
  const back = () => setPage('hub')

  if (page === 'hub') {
    return (
      <SetupHub
        ratingHint={ratingHint}
        setupDone={setupDone}
        countsReady={countsReady}
        onOpen={setPage}
        onSave={save}
      />
    )
  }
  if (page === 'scope') {
    return (
      <div className="space-y-4">
        <PageHeading title="出题范围" onBack={back} />
        <OverlayQuizScopeSummary scopePalaces={scopePalaces} />
        <OverlayQuizScopeList scopePalaces={scopePalaces} />
        <SetupSaveButton setupDone={setupDone} countsReady={countsReady} onClick={save} />
      </div>
    )
  }
  if (page === 'order') {
    return (
      <div className="space-y-4">
        <PageHeading title="出题顺序" onBack={back} />
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
        <SetupSaveButton setupDone={setupDone} countsReady={countsReady} onClick={save} />
      </div>
    )
  }
  if (page === 'rating') {
    return (
      <div className="space-y-4">
        <PageHeading title="题目分数" onBack={back} />
              <p className="text-sm text-muted-foreground">
                有的题，自己的知识点这轮没排到，上面的知识点已经打过分了。
              </p>
              <div role="radiogroup" aria-label="空白题怎么显示分数" className="grid gap-2">
                <OptionButton
                  selected={draftInherit === 'lowest_reviewed'}
                  label="跟着已复习的最低分"
                  hint="旁边标上面已复习里最低的那一档。自己有分就用自己的。进度条还没刷到的，仍显示「尚未复习」。"
                  onClick={() => setDraftInherit('lowest_reviewed')}
                />
                <OptionButton
                  selected={draftInherit === 'blank'}
                  label="保持空白"
                  hint="自己没分就不标。"
                  onClick={() => setDraftInherit('blank')}
                />
              </div>
        <SetupSaveButton setupDone={setupDone} countsReady={countsReady} onClick={save} />
      </div>
    )
  }
  return (
    <div className="space-y-4">
      <PageHeading title="快捷键" onBack={back} />
      <QuizShortcutSettingsSection />
      <SetupSaveButton setupDone={setupDone} countsReady={countsReady} onClick={save} />
    </div>
  )
}
