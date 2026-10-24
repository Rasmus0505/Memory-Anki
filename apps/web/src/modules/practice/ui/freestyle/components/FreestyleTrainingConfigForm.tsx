import type { ReactNode } from 'react'
import { Brain, Blend, ListChecks } from 'lucide-react'
import {
  FREESTYLE_UI_TRAINING_MODES,
  FREESTYLE_UI_TRAINING_STREAMS,
  sanitizeFreestyleFeedConfig,
} from '@/modules/practice/domain/feedConfig'
import type {
  FreestyleFeedConfig,
  FreestylePalaceOrder,
  FreestyleQuizOrder,
  FreestyleTrainingMode,
  FreestyleUnitOrder,
} from '@/shared/api/contracts'
import {
  allFreestylePalaceIdsFromSubjects,
  filterSubjectsForStream,
  namedFreestyleSubjectIds,
  type FreestylePalaceScopeSubject,
} from '@/modules/practice/ui/freestyle/model/freestyle-palace-scope'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { cn } from '@/shared/lib/utils'

const FIELD_CLASS = 'h-10 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm'

export type StreamKey = 'memory_palace' | 'quiz'
type UiMode = Exclude<FreestyleTrainingMode, 'english'>
type StreamConfig = FreestyleFeedConfig['streams']['memory_palace'] | FreestyleFeedConfig['streams']['quiz']

const MODE_OPTIONS: Array<{
  value: UiMode
  label: string
  description: string
  icon: typeof Brain
}> = [
  { value: 'memory_palace', label: '记忆宫殿', description: '翻节点回忆结构和关系', icon: Brain },
  { value: 'quiz', label: '刷题', description: '只做题，不出现宫殿卡', icon: ListChecks },
  { value: 'mixed', label: '混合模式', description: '组合记忆宫殿和刷题', icon: Blend },
]

const PALACE_ORDER_OPTIONS: Array<{ value: FreestylePalaceOrder; label: string; hint: string }> = [
  { value: 'finish_palace_then_next', label: '一个刷完再换', hint: '把一座宫殿的到期单元刷完，再进入下一座。' },
  { value: 'interleave_palaces', label: '多宫殿轮流', hint: '在几座宫殿之间来回穿插，同一宫殿不会连续出现。' },
  { value: 'exam_priority', label: '考试优先', hint: '高星、易忘的宫殿先出现。' },
]

const UNIT_ORDER_OPTIONS: Array<{ value: FreestyleUnitOrder; label: string; hint: string }> = [
  { value: 'structured', label: '按知识结构', hint: '宫殿内的单元按原本的结构顺序出现。' },
  { value: 'random', label: '随机打乱', hint: '宫殿内的单元打乱顺序，同一种子结果一致。' },
]

const QUIZ_ORDER_OPTIONS: Array<{ value: FreestyleQuizOrder; label: string; hint: string }> = [
  { value: 'new_first', label: '优先新学，后复习', hint: '没做过的题先出，做过的题接在后面。' },
  { value: 'random', label: '随机', hint: '所有题目打乱顺序，不区分新旧。' },
]

const MIX_STRATEGY_OPTIONS: Array<{ value: FreestyleFeedConfig['mix']['strategy']; label: string; hint: string }> = [
  { value: 'ratio', label: '按比例穿插', hint: '两类内容按下面的比例交替出现。' },
  { value: 'random', label: '全局随机', hint: '两类内容完全打乱，比例不生效。' },
  { value: 'sequential', label: '分段完成', hint: '先完成一类，再进入另一类。' },
]

export const STREAM_LABELS: Record<StreamKey, string> = {
  memory_palace: '记忆宫殿',
  quiz: '刷题',
}

function Section({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children?: ReactNode
}) {
  return (
    <section className="space-y-3 rounded-xl border border-border/60 bg-card/40 p-4">
      <div>
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {description ? <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </section>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="grid gap-1.5 text-sm">
      <span className="font-medium">{label}</span>
      {children}
      {hint ? <span className="text-xs leading-5 text-muted-foreground">{hint}</span> : null}
    </label>
  )
}

function OptionCards<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: Array<{ value: T; label: string; hint: string }>
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div role="radiogroup" aria-label={label} className="grid gap-2">
      {options.map((option) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            className={cn(
              'rounded-xl border px-3.5 py-2.5 text-left transition-colors',
              selected ? 'border-primary bg-primary/10' : 'border-border/60 bg-background/80 hover:bg-muted/60',
            )}
            onClick={() => onChange(option.value)}
          >
            <span className={cn('block text-sm font-semibold', selected && 'text-primary')}>{option.label}</span>
            <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{option.hint}</span>
          </button>
        )
      })}
    </div>
  )
}

function updateStream(config: FreestyleFeedConfig, stream: StreamKey, patch: Record<string, unknown>) {
  return sanitizeFreestyleFeedConfig({
    ...config,
    streams: {
      ...config.streams,
      [stream]: { ...config.streams[stream], ...patch },
    },
  })
}

export function visibleTrainingMode(config: FreestyleFeedConfig): UiMode {
  return config.training_mode === 'english' ? 'memory_palace' : config.training_mode
}

export function activeStreamsOf(config: FreestyleFeedConfig, mode: UiMode): StreamKey[] {
  if (mode !== 'mixed') return [mode]
  return config.mixed_modes.filter((item): item is StreamKey => item === 'memory_palace' || item === 'quiz')
}

function selectedSubjectIdsOf(stream: StreamConfig, subjects: FreestylePalaceScopeSubject[]) {
  if (stream.subject_ids.length) return stream.subject_ids
  if (stream.subject_scope === 'english') {
    return namedFreestyleSubjectIds(subjects.filter((subject) => subject.title.trim() === '英语'))
  }
  if (stream.subject_scope === 'non_english') {
    return namedFreestyleSubjectIds(subjects.filter((subject) => subject.title.trim() !== '英语'))
  }
  return []
}

function subjectFilterLabel(stream: StreamConfig, subjects: FreestylePalaceScopeSubject[]) {
  const filtered = filterSubjectsForStream(subjects, stream)
  if (!stream.subject_ids.length && stream.subject_scope === 'all') return '全部学科'
  if (!filtered.length) return stream.subject_scope === 'english' ? '英语' : '已选学科'
  return filtered.map((subject) => subject.title).join('、')
}

function streamPalaceCount(stream: StreamConfig, subjects: FreestylePalaceScopeSubject[]) {
  if (stream.specific_palace_ids.length) return stream.specific_palace_ids.length
  return allFreestylePalaceIdsFromSubjects(filterSubjectsForStream(subjects, stream)).length
}

function labelOf(value: string, options: ReadonlyArray<{ value: string; label: string }>) {
  return options.find((item) => item.value === value)?.label ?? ''
}

export interface RoundConfigSummaryRow {
  label: string
  value: string
}

/** Plain-language readout of what the current draft will produce, shown above the form. */
export function summarizeRoundConfig(
  config: FreestyleFeedConfig,
  subjects: FreestylePalaceScopeSubject[],
): RoundConfigSummaryRow[] {
  const mode = visibleTrainingMode(config)
  const streams = activeStreamsOf(config, mode)
  const rows: RoundConfigSummaryRow[] = [
    {
      label: '内容',
      value: mode === 'mixed'
        ? `${streams.map((stream) => STREAM_LABELS[stream]).join(' + ')}（${labelOf(config.mix.strategy, MIX_STRATEGY_OPTIONS)}）`
        : STREAM_LABELS[streams[0]],
    },
  ]
  if (streams.includes('memory_palace')) {
    const palace = config.streams.memory_palace
    rows.push({
      label: '宫殿',
      value: `${subjectFilterLabel(palace, subjects)} · ${streamPalaceCount(palace, subjects)} 座，${labelOf(palace.palace_order, PALACE_ORDER_OPTIONS)}，单元${labelOf(palace.unit_order, UNIT_ORDER_OPTIONS)}`,
    })
  }
  if (streams.includes('quiz')) {
    const quiz = config.streams.quiz
    rows.push({
      label: '题目',
      value: `本轮宫殿中 ${quiz.specific_palace_ids.length || streamPalaceCount(config.streams.memory_palace, subjects)} 座，${labelOf(quiz.order, QUIZ_ORDER_OPTIONS)}`,
    })
  }
  if (streams.includes('memory_palace')) {
    const palace = config.streams.memory_palace
    const unitOrderText = palace.unit_order === 'random' ? '随机打乱顺序' : '按知识结构顺序'
    rows.push({
      label: '复习顺序',
      value: `先学没学过的单元，再复习到期单元；宫殿内${unitOrderText}出现`,
    })
  }
  return rows
}

function SubjectChips({
  subjects,
  selectedIds,
  onChange,
}: {
  subjects: FreestylePalaceScopeSubject[]
  selectedIds: number[]
  onChange: (ids: number[]) => void
}) {
  const namedSubjects = subjects.filter((subject): subject is FreestylePalaceScopeSubject & { id: number } => subject.id != null)
  const allSelected = selectedIds.length === 0
  const toggle = (id: number) => {
    if (allSelected) {
      onChange([id])
      return
    }
    const next = selectedIds.includes(id)
      ? selectedIds.filter((item) => item !== id)
      : [...selectedIds, id]
    onChange(next.length === 0 ? [] : next)
  }
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="学科">
      <button
        type="button"
        className={cn(
          'min-h-11 rounded-full border px-4 text-sm font-medium transition-colors',
          allSelected ? 'border-primary bg-primary/10 text-primary' : 'border-border/60 bg-background/80 hover:bg-muted/60',
        )}
        aria-pressed={allSelected}
        onClick={() => onChange([])}
      >
        全选
      </button>
      {namedSubjects.map((subject) => {
        const selected = allSelected || selectedIds.includes(subject.id)
        return (
          <button
            key={subject.key}
            type="button"
            className={cn(
              'min-h-11 rounded-full border px-4 text-sm font-medium transition-colors',
              selected ? 'border-primary bg-primary/10 text-primary' : 'border-border/60 bg-background/80 hover:bg-muted/60',
            )}
            aria-pressed={selected}
            onClick={() => toggle(subject.id)}
          >
            {subject.title}
          </button>
        )
      })}
      {!namedSubjects.length ? (
        <span className="self-center text-xs text-muted-foreground">暂无学科</span>
      ) : null}
    </div>
  )
}

export function FreestyleTrainingConfigForm({
  config,
  scopeSubjects,
  onChange,
  onOpenPalacePicker,
  scopeLocked = false,
}: {
  config: FreestyleFeedConfig
  scopeSubjects: FreestylePalaceScopeSubject[]
  onChange: (config: FreestyleFeedConfig) => void
  onOpenPalacePicker: (stream: StreamKey) => void
  scopeLocked?: boolean
}) {
  const selectedMode = visibleTrainingMode(config)
  const activeStreams = activeStreamsOf(config, selectedMode)
  const set = (patch: Partial<FreestyleFeedConfig>) => onChange(sanitizeFreestyleFeedConfig({ ...config, ...patch }))
  const changeMode = (mode: UiMode) => {
    if (mode === 'mixed') {
      const next = config.mixed_modes.filter((item): item is StreamKey =>
        item === 'memory_palace' || item === 'quiz',
      )
      set({ training_mode: mode, mixed_modes: next.length >= 2 ? next : ['memory_palace', 'quiz'] })
      return
    }
    set({ training_mode: mode, mixed_modes: [mode] })
  }
  const toggleMixedStream = (stream: StreamKey, checked: boolean) => {
    const current = config.mixed_modes.filter((item): item is StreamKey =>
      item === 'memory_palace' || item === 'quiz',
    )
    const next = checked
      ? [...new Set([...current, stream])]
      : current.filter((item) => item !== stream)
    if (next.length === 0) {
      set({ training_mode: 'memory_palace', mixed_modes: ['memory_palace'] })
      return
    }
    if (next.length === 1) {
      set({ training_mode: next[0], mixed_modes: next })
      return
    }
    set({ training_mode: 'mixed', mixed_modes: next })
  }
  // Subjects define the round's palaces, so picking them resets both streams to the same palaces.
  const applySubjects = (subjectIds: number[]) => {
    const patch = { subject_ids: subjectIds, subject_scope: 'all' as const, specific_palace_ids: [] as number[] }
    onChange(sanitizeFreestyleFeedConfig({
      ...config,
      streams: {
        ...config.streams,
        memory_palace: { ...config.streams.memory_palace, ...patch },
        quiz: { ...config.streams.quiz, ...patch },
      },
    }))
  }

  // Quiz draws only from the round's palaces, so its scope is a narrowing of the memory palace scope.
  const roundPalaceCount = streamPalaceCount(config.streams.memory_palace, scopeSubjects)

  const renderScopeArea = (stream: StreamKey) => {
    if (scopeLocked) {
      return <div className="rounded-xl border border-border/60 bg-background/80 px-3.5 py-3 text-sm">只复习当前宫殿</div>
    }
    const value = config.streams[stream]
    const isQuiz = stream === 'quiz'
    const countText = value.specific_palace_ids.length
      ? `已选 ${value.specific_palace_ids.length} 座`
      : `共 ${isQuiz ? roundPalaceCount : streamPalaceCount(value, scopeSubjects)} 座`
    return (
      <div className="space-y-3">
        {isQuiz ? null : (
          <div className="space-y-1.5">
            <div className="text-xs font-medium text-muted-foreground">学科</div>
            <SubjectChips
              subjects={scopeSubjects}
              selectedIds={selectedSubjectIdsOf(value, scopeSubjects)}
              onChange={applySubjects}
            />
          </div>
        )}
        <div className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-background/80 px-3.5 py-3">
          <div className="min-w-0">
            <div className="text-sm font-medium">宫殿</div>
            <div className="mt-1 text-xs leading-5 text-muted-foreground">
              {isQuiz ? `只能从本轮的 ${roundPalaceCount} 座宫殿中选 · ` : null}
              {countText}
            </div>
          </div>
          <Button type="button" size="sm" variant="outline" onClick={() => onOpenPalacePicker(stream)}>
            <ListChecks className="size-3.5" />选择宫殿
          </Button>
        </div>
      </div>
    )
  }

  const renderPalaceStream = () => {
    const value = config.streams.memory_palace
    return (
      <Section title="记忆宫殿怎么刷" description="只生成结构复习单元，不生成 Anki 正反面卡。">
        <div className="space-y-3">
          <div className="space-y-1.5">
            <div className="text-xs font-medium text-muted-foreground">范围</div>
            {renderScopeArea('memory_palace')}
          </div>
          <div className="space-y-1.5">
            <div className="text-xs font-medium text-muted-foreground">范围内有多座宫殿时</div>
            <OptionCards
              label="多个宫殿时"
              options={PALACE_ORDER_OPTIONS}
              value={value.palace_order}
              onChange={(next) => onChange(updateStream(config, 'memory_palace', { palace_order: next }))}
            />
          </div>
          <div className="space-y-1.5">
            <div className="text-xs font-medium text-muted-foreground">宫殿内单元的出现顺序</div>
            <OptionCards
              label="宫殿内单元顺序"
              options={UNIT_ORDER_OPTIONS}
              value={value.unit_order}
              onChange={(next) => onChange(updateStream(config, 'memory_palace', { unit_order: next }))}
            />
          </div>
        </div>
      </Section>
    )
  }

  const renderQuizStream = () => {
    const value = config.streams.quiz
    return (
      <Section title="刷题怎么出" description="本流只出现题目，不会出现宫殿评分卡。">
        <div className="space-y-3">
          <div className="space-y-1.5">
            <div className="text-xs font-medium text-muted-foreground">题目范围（可跨所有学科和宫殿）</div>
            {renderScopeArea('quiz')}
          </div>
          <div className="space-y-1.5">
            <div className="text-xs font-medium text-muted-foreground">出题顺序</div>
            <OptionCards
              label="刷题出题顺序"
              options={QUIZ_ORDER_OPTIONS}
              value={value.order}
              onChange={(next) => onChange(updateStream(config, 'quiz', { order: next }))}
            />
          </div>
        </div>
      </Section>
    )
  }

  return (
    <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2">
      <div className="space-y-4">
        <Section title="训练方向" description="先决定这一轮主要做什么。">
          <div role="radiogroup" aria-label="训练方向" className="grid grid-cols-1 gap-2">
            {MODE_OPTIONS.filter((option) => FREESTYLE_UI_TRAINING_MODES.includes(option.value)).map((option) => {
              const Icon = option.icon
              const selected = selectedMode === option.value
              return (
                <button key={option.value} type="button" role="radio" aria-checked={selected} className={cn('flex min-h-14 items-center gap-3 rounded-xl border px-3.5 py-2.5 text-left transition-colors', selected ? 'border-primary bg-primary/10' : 'border-border/60 bg-background/80 hover:bg-muted/60')} onClick={() => changeMode(option.value)}>
                  <Icon className={cn('size-5 shrink-0', selected ? 'text-primary' : 'text-muted-foreground')} />
                  <span className="min-w-0"><span className="block text-sm font-semibold">{option.label}</span><span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{option.description}</span></span>
                </button>
              )
            })}
          </div>
          {selectedMode === 'mixed' ? (
            <div className="space-y-3 border-t border-border/60 pt-3">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {FREESTYLE_UI_TRAINING_STREAMS.map((stream) => (
                  <label key={stream} className={cn('flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2.5 text-sm', config.mixed_modes.includes(stream) ? 'border-primary/50 bg-primary/8' : 'border-border/60 bg-background/80')}>
                    <input type="checkbox" className="size-4 accent-primary" checked={config.mixed_modes.includes(stream)} aria-label={STREAM_LABELS[stream]} onChange={(event) => toggleMixedStream(stream, event.target.checked)} />
                    <span>{STREAM_LABELS[stream]}</span>
                  </label>
                ))}
              </div>
              <Field label="组合策略" hint={MIX_STRATEGY_OPTIONS.find((item) => item.value === config.mix.strategy)?.hint}>
                <select className={FIELD_CLASS} value={config.mix.strategy} onChange={(event) => set({ mix: { ...config.mix, strategy: event.target.value as FreestyleFeedConfig['mix']['strategy'] } })}>
                  {MIX_STRATEGY_OPTIONS.map((item) => (
                    <option key={item.value} value={item.value}>{item.label}</option>
                  ))}
                </select>
              </Field>
              {config.mix.strategy === 'ratio' ? (
                <div className="grid grid-cols-2 gap-3">
                  {activeStreams.map((stream) => (
                    <Field key={stream} label={`${STREAM_LABELS[stream]}比例`} hint="数字越大，出现越多。">
                      <Input type="number" min={1} max={10} value={config.mix.ratios[stream]} onChange={(event) => set({ mix: { ...config.mix, ratios: { ...config.mix.ratios, [stream]: Number(event.target.value) } } })} />
                    </Field>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </Section>

        <Section title="固定顺序" description="先学没学过的单元，再复习到期单元；宫殿内按你选择的顺序出现（按知识结构就是从脑图最上面往下，逾期不会插队）。这一规则不可调整。" />

        <details className="rounded-xl border border-border/60 bg-card/40 p-4">
          <summary className="cursor-pointer text-sm font-semibold">高级设置</summary>
          <div className="mt-3 grid grid-cols-1 gap-3">
            <Field label="随机种子" hint="相同种子会得到相同的随机顺序。">
              <Input type="number" min={1} value={config.seed} onChange={(event) => set({ seed: Number(event.target.value) })} />
            </Field>
            {activeStreams.includes('quiz') && activeStreams.includes('memory_palace') ? (
              <Field label="绑定题目位置" hint="宫殿节点上绑定的题目，放在哪里出现。">
                <select className={FIELD_CLASS} value={config.bound_quiz_placement} onChange={(event) => set({ bound_quiz_placement: event.target.value as FreestyleFeedConfig['bound_quiz_placement'] })}>
                  <option value="into_mix">计入混合比例</option>
                  <option value="follow_unit">跟随所属单元</option>
                  <option value="quiz_stream">进入题目流</option>
                </select>
              </Field>
            ) : null}
          </div>
        </details>
      </div>

      <div className="space-y-4">
        {activeStreams.includes('memory_palace') ? renderPalaceStream() : null}
        {activeStreams.includes('quiz') ? renderQuizStream() : null}
      </div>
    </div>
  )
}
