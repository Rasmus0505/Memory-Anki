import { useEffect, useState, type ReactNode } from 'react'
import { getPalacesGroupedApi } from '@/modules/content/public'
import {
  DEFAULT_QUIZ_MASTERY_BUCKETS,
  sanitizeFreestyleFeedConfig,
} from '@/modules/practice/domain/feedConfig'
import { flattenPalaceOptions } from '@/modules/practice/ui/freestyle/model/freestyle-cards'
import type {
  FreestyleBoundQuizPlacement,
  FreestyleFeedConfig,
  FreestyleMixMode,
  FreestylePalaceContext,
  FreestyleQuizMasteryBucket,
  FreestyleQuizScope,
} from '@/shared/api/contracts'
import { Button } from '@/shared/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { Input } from '@/shared/components/ui/input'
import { Switch } from '@/shared/components/ui/switch'
import { cn } from '@/shared/lib/utils'

const FIELD_CLASS =
  'h-10 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'

const MIX_MODE_OPTIONS: Array<{
  value: FreestyleMixMode
  label: string
  description: string
}> = [
  {
    value: 'ratio',
    label: '按比例穿插',
    description: '每刷 N 张宫殿类卡，穿插 M 道题。',
  },
  {
    value: 'random',
    label: '随机混刷',
    description: '宫殿与题打乱混排；同一轮顺序固定，可点换一批。',
  },
  {
    value: 'sequential_map_quiz',
    label: '先宫殿后题',
    description: '先刷完宫殿类卡，再刷练习题。',
  },
  {
    value: 'sequential_quiz_map',
    label: '先题后宫殿',
    description: '先刷练习题，再刷宫殿类卡。',
  },
  {
    value: 'mindmap_only',
    label: '只刷宫殿',
    description: '本轮不出练习题。',
  },
  {
    value: 'quiz_only',
    label: '只刷练习题',
    description: '本轮不出宫殿/正反面卡。',
  },
]

const BOUND_PLACEMENT_OPTIONS: Array<{
  value: FreestyleBoundQuizPlacement
  label: string
  description: string
}> = [
  {
    value: 'into_mix',
    label: '绑定题参与混排（推荐）',
    description: '相关题计入「宫殿:题」比例，比例才能稳定生效。',
  },
  {
    value: 'quiz_stream',
    label: '绑定题全部进题目流',
    description: '与无绑定题一样，按混合模式统一排。',
  },
  {
    value: 'follow_unit',
    label: '绑定题紧跟对应分支',
    description: '学完这一支立刻做相关题；会削弱比例的可预期性。',
  },
]

const QUIZ_MASTERY_BUCKET_OPTIONS: Array<{
  value: FreestyleQuizMasteryBucket
  label: string
  description: string
}> = [
  { value: 'unseen', label: '没做过', description: '从未作答的题' },
  { value: 'weak', label: '错的 / 薄弱', description: '正确率低或近期容易错' },
  { value: 'reinforce', label: '需巩固', description: '半熟、还要再练' },
  { value: 'stable', label: '已掌握', description: '已经比较稳的题（默认不刷）' },
]

const QUIZ_SCOPE_OPTIONS: Array<{
  value: FreestyleQuizScope
  label: string
  description: string
}> = [
  {
    value: 'cross_palace_random',
    label: '跨宫殿随机',
    description: '题目可在不同宫殿之间跳着出。',
  },
  {
    value: 'single_palace_random',
    label: '单宫殿随机',
    description: '先在一个宫殿内随机刷题，再换下一个宫殿。',
  },
]

function Section({
  title,
  description,
  children,
  disabled,
}: {
  title: string
  description?: string
  children: ReactNode
  disabled?: boolean
}) {
  return (
    <section
      className={cn(
        'space-y-3 rounded-xl border border-border/60 bg-card/40 p-4',
        disabled && 'opacity-55',
      )}
    >
      <div className="space-y-0.5">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {description ? <p className="text-xs leading-5 text-muted-foreground">{description}</p> : null}
      </div>
      <fieldset disabled={disabled} className="min-w-0 space-y-3 border-0 p-0">
        {children}
      </fieldset>
    </section>
  )
}

function ToggleRow({
  label,
  description,
  checked,
  onCheckedChange,
}: {
  label: string
  description?: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <label className="flex min-h-12 cursor-pointer items-center justify-between gap-4 rounded-xl border border-border/60 bg-background/80 px-3.5 py-3 shadow-sm">
      <div className="min-w-0 space-y-1">
        <div className="text-sm font-medium leading-none">{label}</div>
        {description ? <div className="text-xs leading-5 text-muted-foreground">{description}</div> : null}
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        className="shrink-0"
        aria-label={label}
      />
    </label>
  )
}

function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string
  hint?: string
  children: ReactNode
  className?: string
}) {
  return (
    <label className={cn('grid gap-1.5 text-sm', className)}>
      <span className="font-medium leading-none">{label}</span>
      {children}
      {hint ? <span className="text-xs leading-5 text-muted-foreground">{hint}</span> : null}
    </label>
  )
}

function toggleBucket(
  current: FreestyleQuizMasteryBucket[],
  bucket: FreestyleQuizMasteryBucket,
  enabled: boolean,
): FreestyleQuizMasteryBucket[] {
  if (enabled) {
    if (current.includes(bucket)) return current
    return [...current, bucket]
  }
  const next = current.filter((item) => item !== bucket)
  // Keep at least one bucket so the queue does not silently drop all quizzes.
  return next.length > 0 ? next : [...DEFAULT_QUIZ_MASTERY_BUCKETS]
}

export function FreestyleFeedSettingsDialog({
  open,
  config,
  onOpenChange,
  onSave,
}: {
  open: boolean
  config: FreestyleFeedConfig
  onOpenChange: (open: boolean) => void
  onSave: (config: FreestyleFeedConfig) => void
}) {
  const [draft, setDraft] = useState(() => sanitizeFreestyleFeedConfig(config))
  const [palaces, setPalaces] = useState<FreestylePalaceContext[]>([])
  const allPalacesSelected =
    palaces.length > 0 && palaces.every((palace) => draft.specific_palace_ids.includes(palace.id))
  const quizEnabled = draft.content.quiz_question && draft.mix_mode !== 'mindmap_only'
  const showRatioControls = draft.mix_mode === 'ratio' && quizEnabled
  const showBoundPlacement =
    quizEnabled && draft.mix_mode !== 'mindmap_only' && draft.mix_mode !== 'quiz_only'

  useEffect(() => {
    if (open) setDraft(sanitizeFreestyleFeedConfig(config))
  }, [config, open])

  useEffect(() => {
    if (!open) return
    let active = true
    void getPalacesGroupedApi()
      .then((data) => {
        if (active) setPalaces(flattenPalaceOptions(data))
      })
      .catch(() => {
        if (active) setPalaces([])
      })
    return () => {
      active = false
    }
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        floatingId="freestyle-feed-settings"
        className="flex max-h-[min(86vh,100dvh-1.5rem)] w-[min(34rem,calc(100vw-1.5rem))] min-w-0 flex-col overflow-hidden rounded-2xl border-border/70 bg-background p-0 shadow-2xl"
      >
        <DialogHeader>
          <div className="min-w-0">
            <DialogTitle>随心队列设置</DialogTitle>
            <DialogDescription className="mt-1">
              选要刷什么、题目怎么抽、宫殿和题怎么混。保存后会按新规则重排还没刷完的卡。
            </DialogDescription>
          </div>
          <DialogClose onClick={() => onOpenChange(false)} />
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">
          <Section title="要刷哪些内容" description="关掉的类型不会进这一轮队列。">
            <div className="space-y-2">
              <ToggleRow
                label="记忆宫殿（翻节点回忆）"
                description="像在宫殿里翻知识点，适合结构和关系。"
                checked={draft.content.mindmap_branch}
                onCheckedChange={(checked) =>
                  setDraft((current) => ({
                    ...current,
                    content: { ...current.content, mindmap_branch: checked },
                  }))
                }
              />
              <ToggleRow
                label="正反面卡片（Anki 样式）"
                description="先看正面，点一下再看反面；适合单词、短语。"
                checked={draft.content.anki_card}
                onCheckedChange={(checked) =>
                  setDraft((current) => ({
                    ...current,
                    content: { ...current.content, anki_card: checked },
                  }))
                }
              />
              <ToggleRow
                label="练习题"
                description="选择题、填空等题库题目。"
                checked={draft.content.quiz_question}
                onCheckedChange={(checked) =>
                  setDraft((current) => ({
                    ...current,
                    content: { ...current.content, quiz_question: checked },
                  }))
                }
              />
            </div>
          </Section>

          <Section
            title="题目刷题"
            description={
              quizEnabled
                ? '单独控制刷什么题、怎么抽、宫殿与题的比例。'
                : '请先开启「练习题」，或把混合模式从「只刷宫殿」改开。'
            }
            disabled={!quizEnabled}
          >
            <div className="space-y-2">
              <div className="text-sm font-medium">刷什么题</div>
              <p className="text-xs leading-5 text-muted-foreground">可多选。至少保留一类，否则无法出题。</p>
              {QUIZ_MASTERY_BUCKET_OPTIONS.map((option) => {
                const checked = draft.quiz_mastery_buckets.includes(option.value)
                return (
                  <label
                    key={option.value}
                    className={cn(
                      'flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-3 text-sm',
                      checked
                        ? 'border-primary/50 bg-primary/8'
                        : 'border-border/60 bg-background/80',
                    )}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 size-4 shrink-0 accent-primary"
                      checked={checked}
                      aria-label={option.label}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          quiz_mastery_buckets: toggleBucket(
                            current.quiz_mastery_buckets,
                            option.value,
                            event.target.checked,
                          ),
                        }))
                      }
                    />
                    <span className="min-w-0 space-y-0.5">
                      <span className="block font-medium leading-none">{option.label}</span>
                      <span className="block text-xs leading-5 text-muted-foreground">
                        {option.description}
                      </span>
                    </span>
                  </label>
                )
              })}
            </div>

            <Field label="题目范围" hint="只影响练习题怎么抽，不影响宫殿卡片顺序。">
              <select
                className={FIELD_CLASS}
                value={draft.quiz_scope}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    quiz_scope: event.target.value as FreestyleQuizScope,
                  }))
                }
              >
                {QUIZ_SCOPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <span className="text-xs leading-5 text-muted-foreground">
                {QUIZ_SCOPE_OPTIONS.find((item) => item.value === draft.quiz_scope)?.description}
              </span>
            </Field>

            {showRatioControls ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="宫殿类卡（每轮）" hint="记忆宫殿 + 正反面卡合计。">
                  <Input
                    type="number"
                    min={1}
                    max={10}
                    className="h-10"
                    value={draft.mix_ratio.mindmap}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        mix_ratio: {
                          ...current.mix_ratio,
                          mindmap: Number(event.target.value),
                        },
                      }))
                    }
                  />
                </Field>
                <Field label="练习题（每轮）" hint="穿插的题目张数。">
                  <Input
                    type="number"
                    min={1}
                    max={10}
                    className="h-10"
                    value={draft.mix_ratio.quiz}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        mix_ratio: {
                          ...current.mix_ratio,
                          quiz: Number(event.target.value),
                        },
                      }))
                    }
                  />
                </Field>
                <p className="text-xs leading-5 text-muted-foreground sm:col-span-2">
                  例如 2 : 1 = 两张宫殿类卡后穿插一道题。某一侧刷完后只出另一侧。绑定题默认计入题侧，比例才会真正生效。
                </p>
              </div>
            ) : null}

            <Field label="只要某种题型" hint="只影响练习题。">
              <select
                className={FIELD_CLASS}
                value={draft.question_type}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    question_type: event.target.value as FreestyleFeedConfig['question_type'],
                  }))
                }
              >
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

            <ToggleRow
              label="优先出容易错的题"
              description="在已选进度桶内，薄弱题排在前面（不改变进池范围）。"
              checked={draft.weak_quiz_priority}
              onCheckedChange={(checked) =>
                setDraft((current) => ({ ...current, weak_quiz_priority: checked }))
              }
            />

            {showBoundPlacement ? (
              <Field
                label="绑定到知识点的题放哪"
                hint="有节点绑定的练习题如何相对宫殿出现。"
              >
                <select
                  className={FIELD_CLASS}
                  value={draft.bound_quiz_placement}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      bound_quiz_placement: event.target.value as FreestyleBoundQuizPlacement,
                    }))
                  }
                >
                  {BOUND_PLACEMENT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <span className="text-xs leading-5 text-muted-foreground">
                  {
                    BOUND_PLACEMENT_OPTIONS.find(
                      (item) => item.value === draft.bound_quiz_placement,
                    )?.description
                  }
                </span>
              </Field>
            ) : null}
          </Section>

          <Section
            title="宫殿和题怎么混"
            description="决定宫殿类卡与练习题的大顺序。正反面卡算宫殿侧。"
          >
            <div className="space-y-3">
              <Field label="混合模式">
                <select
                  className={FIELD_CLASS}
                  value={draft.mix_mode}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      mix_mode: event.target.value as FreestyleMixMode,
                    }))
                  }
                >
                  {MIX_MODE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <span className="text-xs leading-5 text-muted-foreground">
                  {MIX_MODE_OPTIONS.find((item) => item.value === draft.mix_mode)?.description}
                </span>
              </Field>

              {draft.mix_mode === 'random' ? (
                <p className="text-xs leading-5 text-muted-foreground">
                  同一配置与同一「换一批」种子下顺序固定；点页面上的换一批会重排。
                </p>
              ) : null}

              <Field label="多个宫殿时宫殿卡怎么排">
                <select
                  className={FIELD_CLASS}
                  value={draft.palace_order}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      palace_order: event.target.value as FreestyleFeedConfig['palace_order'],
                    }))
                  }
                >
                  <option value="finish_palace_then_next">一个宫殿刷完，再换下一个</option>
                  <option value="interleave_palaces">多个宫殿轮流穿插</option>
                </select>
              </Field>

              <Field
                label="宫殿复习单元从哪来"
                hint="只影响记忆宫殿卡片是否扩展到非到期单元；题目进池由上方「刷什么题」决定。"
              >
                <select
                  className={FIELD_CLASS}
                  value={draft.due_policy}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      due_policy: event.target.value as FreestyleFeedConfig['due_policy'],
                    }))
                  }
                >
                  <option value="due_only">只出到期宫殿单元</option>
                  <option value="due_first_then_expand">到期刷完再补其它单元</option>
                  <option value="all_content_due_weighted">到期与补充单元一起进池</option>
                </select>
              </Field>
            </div>
          </Section>

          <Section title="筛选">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 space-y-0.5">
                  <div className="text-sm font-medium">只练这些宫殿</div>
                  <p className="text-xs text-muted-foreground">
                    {draft.specific_palace_ids.length
                      ? `已选 ${draft.specific_palace_ids.length} 个宫殿`
                      : '不勾选 = 全部宫殿都可以出现'}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  disabled={!palaces.length}
                  aria-pressed={allPalacesSelected}
                  onClick={() =>
                    setDraft((current) => ({
                      ...current,
                      specific_palace_ids: allPalacesSelected
                        ? []
                        : palaces.map((palace) => palace.id),
                    }))
                  }
                >
                  全选
                </Button>
              </div>
              <div className="max-h-40 space-y-1 overflow-y-auto rounded-xl border border-border/60 bg-background/70 p-2 sm:max-h-44">
                {palaces.length ? (
                  palaces.map((palace) => {
                    const checked = draft.specific_palace_ids.includes(palace.id)
                    return (
                      <label
                        key={palace.id}
                        className={cn(
                          'flex min-h-10 min-w-0 cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm transition-colors',
                          checked
                            ? 'border-primary/50 bg-primary/8'
                            : 'border-transparent hover:bg-muted/50',
                        )}
                      >
                        <input
                          type="checkbox"
                          className="size-4 shrink-0 accent-primary"
                          checked={checked}
                          onChange={() =>
                            setDraft((current) => ({
                              ...current,
                              specific_palace_ids: checked
                                ? current.specific_palace_ids.filter((id) => id !== palace.id)
                                : [...current.specific_palace_ids, palace.id],
                            }))
                          }
                        />
                        <span className="min-w-0 truncate">
                          {palace.resolved_title || palace.title}
                        </span>
                      </label>
                    )
                  })
                ) : (
                  <div className="px-2 py-4 text-center text-xs text-muted-foreground">暂无宫殿</div>
                )}
              </div>
            </div>
          </Section>

          <Section title="一轮刷多少">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="这一轮大概刷多少张">
                <Input
                  type="number"
                  min={5}
                  max={100}
                  className="h-10"
                  value={draft.queue_length}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      queue_length: Number(event.target.value),
                    }))
                  }
                />
              </Field>
              <Field
                label="打乱用的固定号码"
                hint="一般不用改；相同号码下次打乱结果一样。"
                className="sm:col-span-2"
              >
                <Input
                  type="number"
                  min={1}
                  className="h-10"
                  value={draft.seed}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      seed: Number(event.target.value),
                    }))
                  }
                />
              </Field>
            </div>
          </Section>
        </div>

        <DialogFooter className="shrink-0 flex-col-reverse gap-2 sm:flex-row">
          <Button
            type="button"
            variant="outline"
            className="min-h-11 w-full sm:min-h-9 sm:w-auto"
            onClick={() => onOpenChange(false)}
          >
            取消
          </Button>
          <Button
            type="button"
            className="min-h-11 w-full sm:min-h-9 sm:w-auto"
            onClick={() => {
              onSave(sanitizeFreestyleFeedConfig(draft))
              onOpenChange(false)
            }}
          >
            保存并重排剩余队列
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
