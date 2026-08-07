import { useMemo, type ReactNode } from 'react'
import { Brain, Blend, Languages, ListChecks } from 'lucide-react'
import {
  DEFAULT_QUIZ_MASTERY_BUCKETS,
  FREESTYLE_TRAINING_STREAMS,
  sanitizeFreestyleFeedConfig,
} from '@/modules/practice/domain/feedConfig'
import type {
  FreestyleFeedConfig,
  FreestyleTrainingMode,
  FreestyleTrainingStream,
} from '@/shared/api/contracts'
import { allFreestylePalaceIdsFromSubjects, type FreestylePalaceScopeSubject } from '@/modules/practice/ui/freestyle/model/freestyle-palace-scope'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { Switch } from '@/shared/components/ui/switch'
import { cn } from '@/shared/lib/utils'

const FIELD_CLASS = 'h-10 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm'

const MODE_OPTIONS: Array<{
  value: FreestyleTrainingMode
  label: string
  description: string
  icon: typeof Brain
}> = [
  { value: 'memory_palace', label: '记忆宫殿', description: '翻节点回忆结构和关系', icon: Brain },
  { value: 'quiz', label: '刷题', description: '只做题，不出现宫殿卡', icon: ListChecks },
  { value: 'english', label: '英语宫殿', description: '只进入英语学科宫殿', icon: Languages },
  { value: 'mixed', label: '混合模式', description: '自由组合前面三种内容', icon: Blend },
]

const STREAM_LABELS: Record<FreestyleTrainingStream, string> = {
  memory_palace: '记忆宫殿',
  quiz: '刷题',
  english: '英语宫殿',
}

const MASTERY_OPTIONS = [
  ['unseen', '没做过', '从未作答的题'],
  ['weak', '错的 / 薄弱', '正确率低或近期容易错'],
  ['reinforce', '需巩固', '半熟、还要再练'],
  ['stable', '已掌握', '已经比较稳的题'],
] as const

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
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

function ToggleRow({ label, description, checked, onCheckedChange }: {
  label: string
  description?: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <label className="flex min-h-12 cursor-pointer items-center justify-between gap-4 rounded-xl border border-border/60 bg-background/80 px-3.5 py-3">
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        {description ? <span className="mt-1 block text-xs leading-5 text-muted-foreground">{description}</span> : null}
      </span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} aria-label={label} />
    </label>
  )
}

function updateStream(config: FreestyleFeedConfig, stream: FreestyleTrainingStream, patch: Record<string, unknown>) {
  return sanitizeFreestyleFeedConfig({
    ...config,
    streams: {
      ...config.streams,
      [stream]: { ...config.streams[stream], ...patch },
    },
  })
}

function toggleMastery(config: FreestyleFeedConfig, bucket: FreestyleFeedConfig['streams']['quiz']['mastery_buckets'][number], checked: boolean) {
  const current = config.streams.quiz.mastery_buckets
  const next = checked ? [...new Set([...current, bucket])] : current.filter((item) => item !== bucket)
  return updateStream(config, 'quiz', {
    mastery_buckets: next.length > 0 ? next : [...DEFAULT_QUIZ_MASTERY_BUCKETS],
  })
}

export function FreestyleTrainingConfigForm({
  config,
  scopeSubjects,
  onChange,
  onOpenPalacePicker,
}: {
  config: FreestyleFeedConfig
  scopeSubjects: FreestylePalaceScopeSubject[]
  onChange: (config: FreestyleFeedConfig) => void
  onOpenPalacePicker: (stream: FreestyleTrainingStream) => void
}) {
  const activeStreams = config.training_mode === 'mixed' ? config.mixed_modes : [config.training_mode]
  const selectedMode = config.training_mode
  const availablePalaceCount = useMemo(
    () => allFreestylePalaceIdsFromSubjects(scopeSubjects).length,
    [scopeSubjects],
  )
  const set = (patch: Partial<FreestyleFeedConfig>) => onChange(sanitizeFreestyleFeedConfig({ ...config, ...patch }))
  const changeMode = (mode: FreestyleTrainingMode) => {
    if (mode === 'mixed') {
      const next: FreestyleTrainingStream[] = config.mixed_modes.length >= 2
        ? config.mixed_modes
        : ['memory_palace', 'quiz']
      set({ training_mode: mode, mixed_modes: next })
      return
    }
    set({ training_mode: mode, mixed_modes: [mode] })
  }
  const toggleMixedStream = (stream: FreestyleTrainingStream, checked: boolean) => {
    const next = checked
      ? [...new Set([...config.mixed_modes, stream])]
      : config.mixed_modes.filter((item) => item !== stream)
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

  const renderPalaceStream = (stream: 'memory_palace' | 'english') => {
    const value = config.streams[stream]
    const isEnglish = stream === 'english'
    return (
      <Section
        key={stream}
        title={STREAM_LABELS[stream]}
        description={isEnglish ? '只从英语学科宫殿生成结构复习卡。' : '只生成结构复习单元，不生成 Anki 正反面卡。'}
      >
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-background/80 px-3.5 py-3">
            <div className="min-w-0">
              <div className="text-sm font-medium">宫殿范围</div>
              <div className="mt-1 text-xs leading-5 text-muted-foreground">
                {isEnglish ? '英语全部' : value.subject_scope === 'non_english' ? '非英语全部' : '全部学科'}
                {' · '}
                {value.specific_palace_ids.length ? `额外选择 ${value.specific_palace_ids.length} 个` : `当前可用 ${availablePalaceCount} 个`}
              </div>
            </div>
            <Button type="button" size="sm" variant="outline" onClick={() => onOpenPalacePicker(stream)}>
              <ListChecks className="size-3.5" />选择宫殿
            </Button>
          </div>
          {!isEnglish ? (
            <Field label="学科范围">
              <select
                className={FIELD_CLASS}
                value={value.subject_scope}
                onChange={(event) => onChange(updateStream(config, stream, { subject_scope: event.target.value }))}
              >
                <option value="non_english">非英语全部</option>
                <option value="all">全部学科</option>
              </select>
            </Field>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="复习单元范围">
              <select className={FIELD_CLASS} value={value.due_policy} onChange={(event) => onChange(updateStream(config, stream, { due_policy: event.target.value }))}>
                <option value="due_first_then_expand">到期刷完后补充</option>
                <option value="due_only">只刷到期单元</option>
                <option value="all_content_due_weighted">到期与补充一起安排</option>
              </select>
            </Field>
            <Field label="多个宫殿时">
              <select className={FIELD_CLASS} value={value.palace_order} onChange={(event) => onChange(updateStream(config, stream, { palace_order: event.target.value }))}>
                <option value="finish_palace_then_next">一个刷完再换下一个</option>
                <option value="interleave_palaces">多个宫殿轮流穿插</option>
              </select>
            </Field>
          </div>
          <Field label="宫殿内单元顺序">
            <select className={FIELD_CLASS} value={value.unit_order} onChange={(event) => onChange(updateStream(config, stream, { unit_order: event.target.value }))}>
              <option value="structured">按知识结构顺序</option>
              <option value="random">随机单元顺序</option>
            </select>
          </Field>
        </div>
      </Section>
    )
  }

  const renderQuizStream = () => {
    const value = config.streams.quiz
    return (
      <Section key="quiz" title="刷题" description="本流只出现题目，不会出现宫殿评分卡。">
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-background/80 px-3.5 py-3">
            <div className="min-w-0">
              <div className="text-sm font-medium">题目范围</div>
              <div className="mt-1 text-xs text-muted-foreground">{value.subject_scope === 'english' ? '英语题目' : value.subject_scope === 'non_english' ? '非英语题目' : '全部题目'}</div>
            </div>
            <Button type="button" size="sm" variant="outline" onClick={() => onOpenPalacePicker('quiz')}>
              <ListChecks className="size-3.5" />选择宫殿
            </Button>
          </div>
          <Field label="题目学科范围">
            <select className={FIELD_CLASS} value={value.subject_scope} onChange={(event) => onChange(updateStream(config, 'quiz', { subject_scope: event.target.value }))}>
              <option value="all">全部学科</option>
              <option value="english">英语题目</option>
              <option value="non_english">非英语题目</option>
            </select>
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="题型">
              <select className={FIELD_CLASS} value={value.question_type} onChange={(event) => onChange(updateStream(config, 'quiz', { question_type: event.target.value }))}>
                <option value="all">全部题型</option>
                <option value="multiple_choice">选择题</option>
                <option value="true_false">判断题</option>
                <option value="fill_blank">填空题</option>
                <option value="matching">匹配题</option>
                <option value="ordering">排序题</option>
                <option value="categorization">分类题</option>
                <option value="short_answer">简答题</option>
              </select>
            </Field>
            <Field label="跨宫殿顺序">
              <select className={FIELD_CLASS} value={value.quiz_scope} onChange={(event) => onChange(updateStream(config, 'quiz', { quiz_scope: event.target.value }))}>
                <option value="cross_palace_random">跨宫殿随机</option>
                <option value="single_palace_random">一个宫殿刷完再换</option>
              </select>
            </Field>
          </div>
          <div className="space-y-2">
            <div className="text-sm font-medium">题目掌握度</div>
            {MASTERY_OPTIONS.map(([bucket, label, description]) => (
              <label key={bucket} className={cn('flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-3', value.mastery_buckets.includes(bucket), 'border-border/60 bg-background/80')}>
                <input type="checkbox" className="mt-0.5 size-4 accent-primary" checked={value.mastery_buckets.includes(bucket)} aria-label={label} onChange={(event) => onChange(toggleMastery(config, bucket, event.target.checked))} />
                <span className="min-w-0"><span className="block text-sm font-medium">{label}</span><span className="block text-xs leading-5 text-muted-foreground">{description}</span></span>
              </label>
            ))}
          </div>
          <ToggleRow label="薄弱题优先" description="在已选掌握度范围内，把薄弱题排在前面。" checked={value.weak_priority} onCheckedChange={(checked) => onChange(updateStream(config, 'quiz', { weak_priority: checked }))} />
        </div>
      </Section>
    )
  }

  return (
    <div className="space-y-4">
      <Section title="训练方向" description="先决定今天主要做什么，下面只显示相关配置。">
        <div role="radiogroup" aria-label="训练方向" className="grid gap-2 sm:grid-cols-2">
          {MODE_OPTIONS.map((option) => {
            const Icon = option.icon
            const selected = selectedMode === option.value
            return (
              <button key={option.value} type="button" role="radio" aria-checked={selected} className={cn('flex min-h-16 items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors', selected ? 'border-primary bg-primary/10' : 'border-border/60 bg-background/80 hover:bg-muted/60')} onClick={() => changeMode(option.value)}>
                <Icon className={cn('size-5 shrink-0', selected ? 'text-primary' : 'text-muted-foreground')} />
                <span className="min-w-0"><span className="block text-sm font-semibold">{option.label}</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">{option.description}</span></span>
              </button>
            )
          })}
        </div>
      </Section>

      {selectedMode === 'mixed' ? (
        <Section title="混合内容" description="至少选择两种内容，内容会按下面的策略穿插。">
          <div className="grid gap-2 sm:grid-cols-3">
            {FREESTYLE_TRAINING_STREAMS.map((stream) => (
              <label key={stream} className={cn('flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-3 text-sm', config.mixed_modes.includes(stream) ? 'border-primary/50 bg-primary/8' : 'border-border/60 bg-background/80')}>
                <input type="checkbox" className="size-4 accent-primary" checked={config.mixed_modes.includes(stream)} aria-label={STREAM_LABELS[stream]} onChange={(event) => toggleMixedStream(stream, event.target.checked)} />
                <span>{STREAM_LABELS[stream]}</span>
              </label>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="组合策略">
              <select className={FIELD_CLASS} value={config.mix.strategy} onChange={(event) => set({ mix: { ...config.mix, strategy: event.target.value as FreestyleFeedConfig['mix']['strategy'] } })}>
                <option value="ratio">按比例穿插</option>
                <option value="random">全局随机</option>
                <option value="sequential">分段完成</option>
              </select>
            </Field>
            {config.mixed_modes.map((stream) => (
              <Field key={stream} label={`${STREAM_LABELS[stream]}比例`}>
                <Input type="number" min={1} max={10} value={config.mix.ratios[stream]} disabled={config.mix.strategy !== 'ratio'} onChange={(event) => set({ mix: { ...config.mix, ratios: { ...config.mix.ratios, [stream]: Number(event.target.value) } } })} />
              </Field>
            ))}
          </div>
        </Section>
      ) : null}

      {activeStreams.includes('memory_palace') ? renderPalaceStream('memory_palace') : null}
      {activeStreams.includes('quiz') ? renderQuizStream() : null}
      {activeStreams.includes('english') ? renderPalaceStream('english') : null}

      <Section title="一轮刷多少">
        <Field label="本轮总数量" hint="候选不足时有多少刷多少，不会重复卡片。">
          <Input type="number" min={5} max={100} value={config.queue_length} onChange={(event) => set({ queue_length: Number(event.target.value) })} />
        </Field>
      </Section>

      <details className="rounded-xl border border-border/60 bg-card/40 p-4">
        <summary className="cursor-pointer text-sm font-semibold">高级设置</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="随机种子" hint="相同种子会得到相同的随机顺序。">
            <Input type="number" min={1} value={config.seed} onChange={(event) => set({ seed: Number(event.target.value) })} />
          </Field>
          {activeStreams.includes('quiz') && activeStreams.some((stream) => stream === 'memory_palace' || stream === 'english') ? (
            <Field label="绑定题目位置">
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
  )
}
