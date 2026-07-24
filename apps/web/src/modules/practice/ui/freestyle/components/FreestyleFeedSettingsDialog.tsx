import { useEffect, useState, type ReactNode } from 'react'
import { getPalacesGroupedApi } from '@/modules/content/public'
import { sanitizeFreestyleFeedConfig } from '@/modules/practice/domain/feedConfig'
import { flattenPalaceOptions } from '@/modules/practice/ui/freestyle/model/freestyle-cards'
import type {
  FreestyleFeedConfig,
  FreestylePalaceContext,
  FreestyleProgressScope,
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

const PROGRESS_SCOPE_OPTIONS: Array<{
  value: FreestyleProgressScope
  label: string
  description: string
}> = [
  {
    value: 'overdue',
    label: '逾期',
    description: '该复习日已经过去，优先清掉积压。',
  },
  {
    value: 'due',
    label: '已到期',
    description: '今天该复习，并且时间已经到了。',
  },
  {
    value: 'calendar_today',
    label: '今日将到期',
    description: '今天排了复习，但还没到点；提前练可选。',
  },
  {
    value: 'reinforcement',
    label: '同日补刷',
    description: '刚才忘记/困难后，20/60 分钟再练的节点。',
  },
  {
    value: 'new',
    label: '新学',
    description: '还没评过分的节点（新建宫殿也能进队列）。',
  },
]

function Section({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <section className="space-y-3 rounded-xl border border-border/60 bg-card/40 p-4">
      <div className="space-y-0.5">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {description ? <p className="text-xs leading-5 text-muted-foreground">{description}</p> : null}
      </div>
      {children}
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
  const [draft, setDraft] = useState(config)
  const [palaces, setPalaces] = useState<FreestylePalaceContext[]>([])
  const allPalacesSelected =
    palaces.length > 0 && palaces.every((palace) => draft.specific_palace_ids.includes(palace.id))

  useEffect(() => {
    if (open) setDraft(config)
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
              选要刷什么、怎么排序、一轮刷多少。保存后会按新规则重排还没刷完的卡。
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
              <ToggleRow
                label="优先出容易错的题"
                description="错题和薄弱题会排在前面。"
                checked={draft.weak_quiz_priority}
                onCheckedChange={(checked) =>
                  setDraft((current) => ({ ...current, weak_quiz_priority: checked }))
                }
              />
            </div>
          </Section>

          <Section title="筛选">
            <div className="grid gap-4">
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
            </div>

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
                      // 同一按钮：未全选 → 全选；已全选 → 清空（恢复不限制）
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

          <Section title="出现顺序与多少" description="数字越大，这一类在混排里越容易先出现。">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="宫殿卡多一点 / 少一点" hint="0 = 尽量不出（若开关仍开则权重为 0）">
                <Input
                  type="number"
                  min={0}
                  max={20}
                  className="h-10"
                  value={draft.weights.mindmap_branch}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      weights: {
                        ...current.weights,
                        mindmap_branch: Number(event.target.value),
                      },
                    }))
                  }
                />
              </Field>
              <Field label="正反面卡多一点 / 少一点">
                <Input
                  type="number"
                  min={0}
                  max={20}
                  className="h-10"
                  value={draft.weights.anki_card}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      weights: {
                        ...current.weights,
                        anki_card: Number(event.target.value),
                      },
                    }))
                  }
                />
              </Field>
              <Field label="练习题多一点 / 少一点" className="sm:col-span-2">
                <Input
                  type="number"
                  min={0}
                  max={20}
                  className="h-10"
                  value={draft.weights.quiz_question}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      weights: {
                        ...current.weights,
                        quiz_question: Number(event.target.value),
                      },
                    }))
                  }
                />
              </Field>

              <Field label="多个宫殿时怎么排" className="sm:col-span-2">
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

              <Field label="同一宫殿内怎么排" className="sm:col-span-2">
                <select
                  className={FIELD_CLASS}
                  value={draft.within_palace_order}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      within_palace_order: event.target
                        .value as FreestyleFeedConfig['within_palace_order'],
                    }))
                  }
                >
                  <option value="tree_order">按导图结构顺序</option>
                  <option value="deterministic_shuffle">打乱顺序（结果可复现）</option>
                </select>
              </Field>

              <div className="space-y-2 sm:col-span-2">
                <div className="space-y-0.5">
                  <div className="text-sm font-medium">今天练哪些进度</div>
                  <p className="text-xs leading-5 text-muted-foreground">
                    可多选组合；至少保留一项。关掉的类型不会进宫殿翻卡队列。
                  </p>
                </div>
                <div className="space-y-2">
                  {PROGRESS_SCOPE_OPTIONS.map((option) => {
                    const checked = draft.progress_scopes.includes(option.value)
                    return (
                      <ToggleRow
                        key={option.value}
                        label={option.label}
                        description={option.description}
                        checked={checked}
                        onCheckedChange={(nextChecked) =>
                          setDraft((current) => {
                            const set = new Set(current.progress_scopes)
                            if (nextChecked) {
                              set.add(option.value)
                            } else if (set.size > 1) {
                              set.delete(option.value)
                            }
                            // Refuse to clear the last scope (avoids empty mind-map queue).
                            const progress_scopes = PROGRESS_SCOPE_OPTIONS.map((item) => item.value).filter(
                              (scope) => set.has(scope),
                            )
                            return {
                              ...current,
                              progress_scopes,
                              include_calendar_today_due: progress_scopes.includes('calendar_today'),
                            }
                          })
                        }
                      />
                    )
                  })}
                </div>
              </div>

              <Field
                label="到期刷完后怎么补"
                hint="只影响是否混入练习题；宫殿翻卡仍只出上面勾选的进度。"
                className="sm:col-span-2"
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
                  <option value="due_only">只练勾选进度，不够也不补题</option>
                  <option value="due_first_then_expand">先练勾选进度，不够再补题</option>
                  <option value="all_content_due_weighted">题目和勾选进度混在一起刷</option>
                </select>
              </Field>
            </div>
          </Section>

          <Section title="一轮刷多少">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="每张宫殿卡大概含多少知识点"
                hint="按完整小分支切分，可能会略多一点。"
              >
                <Input
                  type="number"
                  min={3}
                  max={50}
                  className="h-10"
                  value={draft.node_limit}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      node_limit: Number(event.target.value),
                    }))
                  }
                />
              </Field>
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
