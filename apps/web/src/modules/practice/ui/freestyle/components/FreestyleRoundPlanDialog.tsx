import { useEffect, useMemo, useState } from 'react'
import {
  Check,
  ChevronDown,
  ChevronRight,
  GripVertical,
  ListChecks,
  RotateCcw,
  Save,
  Undo2,
  X,
} from 'lucide-react'
import { getPalacesGroupedApi } from '@/modules/content/public'
import { DEFAULT_QUIZ_MASTERY_BUCKETS, sanitizeFreestyleFeedConfig } from '@/modules/practice/domain/feedConfig'
import {
  planCardStatus,
  type FreestyleRoundPlanCard,
  type FreestyleRoundPlanCardStatus,
  type FreestyleRoundPlanState,
} from '@/modules/practice/public'
import { flattenPalaceOptions } from '@/modules/practice/ui/freestyle/model/freestyle-cards'
import type { FreestyleCard, FreestyleFeedConfig, FreestylePalaceContext } from '@/shared/api/contracts'
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
import type { FreestyleSkipState } from '@/modules/practice/domain/queueState'
import { cn } from '@/shared/lib/utils'

const FIELD_CLASS = 'h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm'

const STATUS_LABELS: Record<FreestyleRoundPlanCardStatus, string> = {
  pending: '待复习',
  active: '当前',
  completed: '已通过',
  retry: '待重练',
  excluded: '已排除',
  stale: '需重建',
}

const STATUS_CLASSES: Record<FreestyleRoundPlanCardStatus, string> = {
  pending: 'border-border/60 text-muted-foreground',
  active: 'border-primary/60 bg-primary/10 text-primary',
  completed: 'border-emerald-500/30 bg-emerald-500/8 text-emerald-700 dark:text-emerald-300',
  retry: 'border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-200',
  excluded: 'border-border/50 bg-muted/50 text-muted-foreground line-through',
  stale: 'border-rose-500/35 bg-rose-500/10 text-rose-700 dark:text-rose-200',
}

function palaceIdFromEntry(entry: FreestyleRoundPlanCard) {
  return entry.palaceId ?? 0
}

function rowLabel(entry: FreestyleRoundPlanCard) {
  return entry.occurrenceKind === 'retry'
    ? `重练第 ${Math.max(1, entry.retryAttempt)} 次 · ${entry.label || entry.cardId}`
    : entry.label || entry.cardId
}

function configWith(next: FreestyleFeedConfig, patch: Partial<FreestyleFeedConfig>) {
  return sanitizeFreestyleFeedConfig({ ...next, ...patch })
}

function ConfigPanel({
  config,
  palaces,
  onChange,
}: {
  config: FreestyleFeedConfig
  palaces: FreestylePalaceContext[]
  onChange: (next: FreestyleFeedConfig) => void
}) {
  const set = (patch: Partial<FreestyleFeedConfig>) => onChange(configWith(config, patch))
  const setContent = (key: keyof FreestyleFeedConfig['content'], value: boolean) =>
    set({ content: { ...config.content, [key]: value } })
  const setRatio = (key: 'mindmap' | 'quiz', value: number) =>
    set({ mix_ratio: { ...config.mix_ratio, [key]: value } })
  const selected = new Set(config.specific_palace_ids)

  return (
    <div className="space-y-3 pb-2">
      <section className="space-y-2 rounded-xl border border-border/60 bg-card/40 p-3">
        <div className="text-sm font-semibold">本轮刷什么</div>
        {([
          ['mindmap_branch', '记忆宫殿（翻节点回忆）'],
          ['anki_card', '正反面卡片（Anki 样式）'],
          ['quiz_question', '练习题'],
        ] as const).map(([key, label]) => (
          <label key={key} className="flex min-h-10 items-center justify-between gap-3 rounded-lg border border-border/60 bg-background/70 px-3 py-2 text-sm">
            <span>{label}</span>
            <Switch checked={config.content[key]} onCheckedChange={(value) => setContent(key, Boolean(value))} aria-label={label} />
          </label>
        ))}
      </section>

      <section className="space-y-2 rounded-xl border border-border/60 bg-card/40 p-3">
        <div className="text-sm font-semibold">宫殿与题目</div>
        <label className="grid gap-1 text-sm">
          <span>混合模式</span>
          <select className={FIELD_CLASS} value={config.mix_mode} onChange={(event) => set({ mix_mode: event.target.value as FreestyleFeedConfig['mix_mode'] })}>
            <option value="ratio">按比例穿插</option>
            <option value="random">随机混刷</option>
            <option value="sequential_map_quiz">先宫殿后题</option>
            <option value="sequential_quiz_map">先题后宫殿</option>
            <option value="mindmap_only">只刷宫殿</option>
            <option value="quiz_only">只刷练习题</option>
          </select>
        </label>
        {config.mix_mode === 'ratio' ? (
          <div className="grid grid-cols-2 gap-2">
            <label className="grid gap-1 text-sm"><span>宫殿类卡</span><Input type="number" min={1} max={10} value={config.mix_ratio.mindmap} onChange={(event) => setRatio('mindmap', Number(event.target.value))} /></label>
            <label className="grid gap-1 text-sm"><span>练习题</span><Input type="number" min={1} max={10} value={config.mix_ratio.quiz} onChange={(event) => setRatio('quiz', Number(event.target.value))} /></label>
          </div>
        ) : null}
        <label className="grid gap-1 text-sm"><span>绑定题目位置</span><select className={FIELD_CLASS} value={config.bound_quiz_placement} onChange={(event) => set({ bound_quiz_placement: event.target.value as FreestyleFeedConfig['bound_quiz_placement'] })}><option value="into_mix">计入混合比例</option><option value="follow_unit">跟随所属单元</option><option value="quiz_stream">进入题目流</option></select></label>
        <label className="flex min-h-10 items-center justify-between gap-3 rounded-lg border border-border/60 bg-background/70 px-3 py-2 text-sm"><span>薄弱题目优先</span><Switch checked={config.weak_quiz_priority} onCheckedChange={(value) => set({ weak_quiz_priority: Boolean(value) })} aria-label="薄弱题目优先" /></label>
        <label className="grid gap-1 text-sm"><span>多个宫殿时</span><select className={FIELD_CLASS} value={config.palace_order} onChange={(event) => set({ palace_order: event.target.value as FreestyleFeedConfig['palace_order'] })}><option value="finish_palace_then_next">完成一个宫殿再换下一个</option><option value="interleave_palaces">多个宫殿轮流穿插</option></select></label>
        <label className="grid gap-1 text-sm"><span>复习单元范围</span><select className={FIELD_CLASS} value={config.due_policy} onChange={(event) => set({ due_policy: event.target.value as FreestyleFeedConfig['due_policy'] })}><option value="due_only">只出到期单元</option><option value="due_first_then_expand">到期优先，不足时补未到期</option><option value="all_content_due_weighted">到期和补充单元一起进池</option></select></label>
        <label className="grid gap-1 text-sm"><span>题目范围</span><select className={FIELD_CLASS} value={config.quiz_scope} onChange={(event) => set({ quiz_scope: event.target.value as FreestyleFeedConfig['quiz_scope'] })}><option value="cross_palace_random">跨宫殿随机</option><option value="single_palace_random">单宫殿随机</option></select></label>
      </section>

      <section className="space-y-2 rounded-xl border border-border/60 bg-card/40 p-3">
        <div className="text-sm font-semibold">题目筛选</div>
        <label className="grid gap-1 text-sm"><span>题型</span><select className={FIELD_CLASS} value={config.question_type} onChange={(event) => set({ question_type: event.target.value as FreestyleFeedConfig['question_type'] })}><option value="all">全部题型</option><option value="multiple_choice">选择题</option><option value="true_false">判断题</option><option value="fill_blank">填空题</option><option value="matching">匹配题</option><option value="ordering">排序题</option><option value="categorization">分类题</option><option value="short_answer">简答题</option></select></label>
        <div className="space-y-1.5 text-sm">
          <div>题目掌握度</div>
          {(['unseen', 'weak', 'reinforce', 'stable'] as const).map((bucket) => {
            const checked = config.quiz_mastery_buckets.includes(bucket)
            return <label key={bucket} className="flex items-center gap-2"><input type="checkbox" checked={checked} onChange={(event) => { const next = event.target.checked ? [...config.quiz_mastery_buckets, bucket] : config.quiz_mastery_buckets.filter((item) => item !== bucket); set({ quiz_mastery_buckets: next.length ? next : [...DEFAULT_QUIZ_MASTERY_BUCKETS] }) }} /><span>{bucket === 'unseen' ? '没做过' : bucket === 'weak' ? '错的 / 薄弱' : bucket === 'reinforce' ? '需巩固' : '已掌握'}</span></label>
          })}
        </div>
      </section>

      <section className="space-y-2 rounded-xl border border-border/60 bg-card/40 p-3">
        <div className="flex items-center justify-between gap-2"><div className="text-sm font-semibold">宫殿筛选</div><span className="text-xs text-muted-foreground">{selected.size ? `已选 ${selected.size} 个` : '全部宫殿'}</span></div>
        <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-border/60 p-1.5">
          {palaces.map((palace) => <label key={palace.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/60"><input type="checkbox" checked={selected.has(palace.id)} onChange={(event) => { const ids = new Set(config.specific_palace_ids); if (event.target.checked) ids.add(palace.id); else ids.delete(palace.id); set({ specific_palace_ids: [...ids] }) }} /><span className="truncate">{palace.resolved_title || palace.title || `宫殿 ${palace.id}`}</span></label>)}
          {!palaces.length ? <div className="px-2 py-3 text-center text-xs text-muted-foreground">暂无宫殿</div> : null}
        </div>
      </section>

      <section className="grid grid-cols-2 gap-2 rounded-xl border border-border/60 bg-card/40 p-3">
        <label className="grid gap-1 text-sm"><span>本轮上限</span><Input type="number" min={5} max={100} value={config.queue_length} onChange={(event) => set({ queue_length: Number(event.target.value) })} /></label>
        <label className="grid gap-1 text-sm"><span>随机种子</span><Input type="number" min={1} value={config.seed} onChange={(event) => set({ seed: Number(event.target.value) })} /></label>
      </section>
    </div>
  )
}

export function FreestyleRoundPlanDialog({
  open,
  config,
  cards,
  currentIndex,
  queueState,
  roundPlan,
  onOpenChange,
  onJump,
  onExclude,
  onRestore,
  onReorder,
  onSaveConfig,
  onResetRound,
}: {
  open: boolean
  config: FreestyleFeedConfig
  cards: FreestyleCard[]
  currentIndex: number
  queueState: FreestyleSkipState
  roundPlan: FreestyleRoundPlanState | null
  onOpenChange: (open: boolean) => void
  onJump: (cardId: string) => void
  onExclude: (cardIds: string[]) => void
  onRestore: (cardIds: string[]) => void
  onReorder: (orderIds: string[]) => void
  onSaveConfig: (config: FreestyleFeedConfig) => void
  onResetRound: () => void
}) {
  const [draft, setDraft] = useState(() => sanitizeFreestyleFeedConfig(config))
  const [palaces, setPalaces] = useState<FreestylePalaceContext[]>([])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [collapsedPalaces, setCollapsedPalaces] = useState<Set<number>>(new Set())

  useEffect(() => {
    if (open) {
      setDraft(sanitizeFreestyleFeedConfig(config))
      setSelectedIds([])
    }
  }, [config, open])

  useEffect(() => {
    if (!open) return
    let active = true
    void getPalacesGroupedApi().then((value) => {
      if (active) setPalaces(flattenPalaceOptions(value))
    }).catch(() => {
      if (active) setPalaces([])
    })
    return () => { active = false }
  }, [open])

  const liveById = useMemo(() => new Map(cards.map((card) => [card.id, card])), [cards])
  const rows = useMemo(() => {
    if (!roundPlan) return []
    return roundPlan.orderIds.map((id) => roundPlan.cardsById[id]).filter(Boolean)
  }, [roundPlan])
  const groups = useMemo(() => {
    const result = new Map<number, FreestyleRoundPlanCard[]>()
    rows.forEach((entry) => {
      const id = palaceIdFromEntry(entry)
      const bucket = result.get(id) ?? []
      bucket.push(entry)
      result.set(id, bucket)
    })
    return [...result.entries()]
  }, [rows])
  const currentCardId = cards[currentIndex]?.id ?? queueState.currentCardId
  const selectedSet = new Set(selectedIds)

  const moveRow = (sourceId: string, targetId: string) => {
    if (sourceId === targetId || !roundPlan) return
    const next = [...roundPlan.orderIds]
    const sourceIndex = next.indexOf(sourceId)
    const targetIndex = next.indexOf(targetId)
    if (sourceIndex < 0 || targetIndex < 0) return
    next.splice(sourceIndex, 1)
    next.splice(next.indexOf(targetId), 0, sourceId)
    onReorder(next)
  }

  const toggleSelected = (id: string) => setSelectedIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id])
  const toggleGroup = (entries: FreestyleRoundPlanCard[]) => {
    const ids = entries.map((entry) => entry.cardId)
    const allSelected = ids.every((id) => selectedSet.has(id))
    setSelectedIds((current) => allSelected ? current.filter((id) => !ids.includes(id)) : [...new Set([...current, ...ids])])
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent floatingId="freestyle-round-plan" className="flex max-h-[min(92vh,100dvh-1rem)] w-[min(76rem,calc(100vw-1rem))] min-w-0 flex-col overflow-hidden rounded-2xl border-border/70 bg-background p-0 shadow-2xl">
        <DialogHeader>
          <div className="min-w-0">
            <DialogTitle className="flex items-center gap-2"><ListChecks className="size-5 text-primary" />本轮安排</DialogTitle>
            <DialogDescription>查看进度、调整本轮顺序，右侧配置只会重排尚未开始的卡片。</DialogDescription>
          </div>
          <DialogClose onClick={() => onOpenChange(false)} />
        </DialogHeader>

        <div className="grid min-h-0 flex-1 gap-0 lg:grid-cols-[minmax(0,1.1fr)_minmax(22rem,0.9fr)]">
          <section className="min-h-0 overflow-y-auto border-b border-border/70 p-4 lg:border-b-0 lg:border-r lg:p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm text-muted-foreground">已安排 {roundPlan?.scheduledCount ?? rows.length} 张 · 候选 {roundPlan?.candidateCount ?? rows.length} · 上限 {roundPlan?.queueLimit ?? config.queue_length}</div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="outline" disabled={!selectedIds.length} onClick={() => onExclude(selectedIds)}><X className="size-3.5" />排除选中</Button>
                <Button type="button" size="sm" variant="outline" disabled={!selectedIds.length} onClick={() => onRestore(selectedIds)}><Undo2 className="size-3.5" />恢复选中</Button>
                <Button type="button" size="sm" variant="ghost" onClick={onResetRound}><RotateCcw className="size-3.5" />再来一轮</Button>
              </div>
            </div>
            {roundPlan?.limitReached ? <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/8 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">候选内容超过本轮上限，只安排了前 {roundPlan.queueLimit} 张。</div> : null}
            {!roundPlan || !rows.length ? <div className="flex min-h-56 items-center justify-center text-sm text-muted-foreground">当前还没有本轮安排。</div> : null}
            <div className="space-y-3">
              {groups.map(([palaceId, entries]) => {
                const collapsed = collapsedPalaces.has(palaceId)
                const title = entries.find((entry) => entry.palaceTitle)?.palaceTitle || (palaceId ? `宫殿 ${palaceId}` : '未归属宫殿')
                return <section key={palaceId} className="rounded-xl border border-border/70 bg-card/30">
                  <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
                    <button type="button" className="inline-flex size-7 items-center justify-center rounded-md hover:bg-muted" onClick={() => setCollapsedPalaces((current) => { const next = new Set(current); if (next.has(palaceId)) next.delete(palaceId); else next.add(palaceId); return next })} aria-label={collapsed ? `展开${title}` : `折叠${title}`}>{collapsed ? <ChevronRight className="size-4" /> : <ChevronDown className="size-4" />}</button>
                    <input type="checkbox" checked={entries.every((entry) => selectedSet.has(entry.cardId))} onChange={() => toggleGroup(entries)} aria-label={`选择${title}全部安排`} />
                    <div className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</div>
                    <span className="text-xs text-muted-foreground">{entries.filter((entry) => entry.status === 'completed').length}/{entries.length}</span>
                  </div>
                  {!collapsed ? <div className="divide-y divide-border/50">
                    {entries.map((entry) => {
                      const liveCard = liveById.get(entry.cardId)
                      const status = liveCard ? planCardStatus(liveCard, roundPlan, queueState.completedIds, queueState.hiddenIds, currentCardId) : entry.status
                      const isSelected = selectedSet.has(entry.cardId)
                      return <div key={entry.cardId} draggable={status !== 'completed' && status !== 'excluded'} onDragStart={() => setDraggingId(entry.cardId)} onDragOver={(event) => event.preventDefault()} onDrop={() => { if (draggingId) moveRow(draggingId, entry.cardId); setDraggingId(null) }} className={cn('flex items-center gap-2 px-3 py-2.5 text-sm', isSelected && 'bg-primary/5', status === 'excluded' && 'opacity-65')}>
                        <GripVertical className="size-4 shrink-0 cursor-grab text-muted-foreground" aria-label="拖动调整顺序" />
                        <input type="checkbox" checked={isSelected} onChange={() => toggleSelected(entry.cardId)} aria-label={`选择${rowLabel(entry)}`} />
                        <button type="button" className="min-w-0 flex-1 truncate text-left hover:text-primary disabled:cursor-not-allowed" disabled={!liveCard} onClick={() => liveCard && onJump(entry.cardId)} title={rowLabel(entry)}>{rowLabel(entry)}</button>
                        <span className={cn('shrink-0 rounded-full border px-2 py-0.5 text-[11px]', STATUS_CLASSES[status])}>{STATUS_LABELS[status]}</span>
                        {entry.occurrenceKind === 'retry' ? <span className="shrink-0 text-[11px] text-amber-700 dark:text-amber-300">来源 {entry.sourceCardId} · {entry.retryAfterCards}张后</span> : null}
                        {status === 'completed' ? <Check className="size-4 shrink-0 text-emerald-500" /> : null}
                      </div>
                    })}
                  </div> : null}
                </section>
              })}
            </div>
          </section>

          <section className="min-h-0 overflow-y-auto p-4 lg:p-5">
            <div className="mb-3 flex items-center justify-between gap-2"><div><div className="text-sm font-semibold">随心配置</div><div className="text-xs text-muted-foreground">保存后保留本轮已完成和已排除状态。</div></div><ListChecks className="size-4 text-muted-foreground" /></div>
            <ConfigPanel config={draft} palaces={palaces} onChange={setDraft} />
          </section>
        </div>

        <DialogFooter className="shrink-0 flex-col-reverse gap-2 sm:flex-row">
          <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => onOpenChange(false)}>关闭</Button>
          <Button type="button" className="w-full sm:w-auto" onClick={() => { onSaveConfig(sanitizeFreestyleFeedConfig(draft)); onOpenChange(false) }}><Save className="size-4" />保存配置并重排</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
