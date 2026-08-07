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
import { getPalacesGroupedApi, getSubjectTreeApi } from '@/modules/content/public'
import {
  applyFreestyleQuickPreset,
  FREESTYLE_QUICK_PRESETS,
  sanitizeFreestyleFeedConfig,
  type FreestyleQuickPresetId,
} from '@/modules/practice/domain/feedConfig'
import {
  planCardStatus,
  type FreestyleRoundPlanCard,
  type FreestyleRoundPlanCardStatus,
  type FreestyleRoundPlanState,
} from '@/modules/practice/public'
import { flattenPalaceOptions } from '@/modules/practice/ui/freestyle/model/freestyle-cards'
import {
  buildFreestylePalaceScopeSubjects,
  type FreestylePalaceScopeSubject,
} from '@/modules/practice/ui/freestyle/model/freestyle-palace-scope'
import { FreestylePalacePickerDialog } from './FreestylePalacePickerDialog'
import { FreestyleTrainingConfigForm } from './FreestyleTrainingConfigForm'
import type {
  FreestyleCard,
  FreestyleFeedConfig,
  FreestylePalaceContext,
  FreestyleTrainingStream,
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
import type { FreestyleSkipState } from '@/modules/practice/domain/queueState'
import { cn } from '@/shared/lib/utils'

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
  loading = false,
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
  loading?: boolean
}) {
  const [draft, setDraft] = useState(() => sanitizeFreestyleFeedConfig(config))
  const [palaces, setPalaces] = useState<FreestylePalaceContext[]>([])
  const [scopeSubjects, setScopeSubjects] = useState<FreestylePalaceScopeSubject[]>([])
  const [pickerStream, setPickerStream] = useState<FreestyleTrainingStream | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const [collapsedPalaces, setCollapsedPalaces] = useState<Set<number>>(new Set())
  const planDialogOpen = open

  useEffect(() => {
    if (!open) setPickerStream(null)
  }, [open])

  useEffect(() => {
    if (open) {
      setDraft(sanitizeFreestyleFeedConfig(config))
      setSelectedIds([])
    }
  }, [config, open])

  useEffect(() => {
    if (!open) return
    let active = true
    void getPalacesGroupedApi().then(async (value) => {
      const subjectIds = (value.subjects ?? []).map((item) => item.subject?.id).filter((id): id is number => Boolean(id))
      if (active) {
        setPalaces(flattenPalaceOptions(value))
        setScopeSubjects(buildFreestylePalaceScopeSubjects(value))
      }
      const trees = typeof getSubjectTreeApi === 'function'
        ? await Promise.all(
            subjectIds.map(async (id) => {
              try {
                return await getSubjectTreeApi(id)
              } catch {
                return null
              }
            }),
          )
        : []
      const resolvedTrees = trees.filter((tree): tree is NonNullable<typeof tree> => Boolean(tree))
      if (active && resolvedTrees.length > 0) {
        setScopeSubjects(buildFreestylePalaceScopeSubjects(value, resolvedTrees))
      }
    }).catch(() => {
      if (active) { setPalaces([]); setScopeSubjects([]) }
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

  const applyQuickPreset = (presetId: FreestyleQuickPresetId) => {
    setDraft((current) => applyFreestyleQuickPreset(current, presetId, palaces))
  }

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
    <>
    <Dialog open={planDialogOpen} onOpenChange={onOpenChange}>
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
                <Button type="button" size="sm" variant="ghost" disabled={loading} aria-busy={loading} onClick={onResetRound}>
                  <RotateCcw className={cn('size-3.5', loading && 'animate-spin')} />
                  {loading ? '正在安排...' : '再来一轮'}
                </Button>
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
                      const canDrag = status !== 'completed' && status !== 'excluded'
                      const isActive = status === 'active'
                      return <div key={entry.cardId}>
                        {dragOverId === entry.cardId && draggingId !== entry.cardId ? (
                          <div data-testid="round-plan-drop-placeholder" className="mx-1 my-1 flex h-14 items-center justify-center rounded-lg border-2 border-dashed border-emerald-500/60 bg-emerald-500/8 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                            放到这里
                          </div>
                        ) : null}
                        <div
                          data-testid={`round-plan-card-${entry.cardId}`}
                          draggable={canDrag}
                          onDragStart={(event) => {
                            if (!canDrag) return
                            event.dataTransfer.effectAllowed = 'move'
                            event.dataTransfer.setData('text/plain', entry.cardId)
                            setDraggingId(entry.cardId)
                          }}
                          onDragEnter={() => canDrag && setDragOverId(entry.cardId)}
                          onDragOver={(event) => {
                            if (!canDrag) return
                            event.preventDefault()
                            event.dataTransfer.dropEffect = 'move'
                            setDragOverId(entry.cardId)
                          }}
                          onDrop={(event) => {
                            event.preventDefault()
                            const sourceId = draggingId || event.dataTransfer.getData('text/plain')
                            if (sourceId) moveRow(sourceId, entry.cardId)
                            setDraggingId(null)
                            setDragOverId(null)
                          }}
                          onDragEnd={() => {
                            setDraggingId(null)
                            setDragOverId(null)
                          }}
                          className={cn(
                            'mx-1 my-1 flex min-h-14 items-center gap-2 rounded-lg border px-2 py-2 text-sm transition-colors',
                            isActive
                              ? 'border-emerald-500/60 bg-emerald-500/12 shadow-sm ring-1 ring-emerald-500/20'
                              : 'border-transparent hover:border-border/70 hover:bg-background/70',
                            isSelected && !isActive && 'bg-primary/5',
                            draggingId === entry.cardId && 'opacity-45',
                            status === 'excluded' && 'opacity-65',
                          )}
                        >
                          <button type="button" draggable={false} disabled={!canDrag} className="inline-flex size-8 shrink-0 cursor-grab items-center justify-center rounded-md text-muted-foreground hover:bg-muted active:cursor-grabbing disabled:cursor-not-allowed" aria-label={`拖动${rowLabel(entry)}`} title="拖动调整顺序">
                            <GripVertical className="size-4" />
                          </button>
                          <input type="checkbox" checked={isSelected} onChange={() => toggleSelected(entry.cardId)} aria-label={`选择${rowLabel(entry)}`} />
                          <button type="button" className="min-w-0 flex-1 truncate text-left hover:text-primary disabled:cursor-not-allowed" disabled={!liveCard} onClick={() => liveCard && onJump(entry.cardId)} title={rowLabel(entry)}>{rowLabel(entry)}</button>
                          <span className={cn('shrink-0 rounded-full border px-2 py-0.5 text-[11px]', STATUS_CLASSES[status])}>{isActive ? '当前复习' : STATUS_LABELS[status]}</span>
                          {entry.occurrenceKind === 'retry' ? <span className="shrink-0 text-[11px] text-amber-700 dark:text-amber-300">来源 {entry.sourceCardId} · {entry.retryAfterCards}张后</span> : null}
                          {status === 'completed' ? <Check className="size-4 shrink-0 text-emerald-500" /> : null}
                        </div>
                      </div>
                    })}
                  </div> : null}
                </section>
              })}
            </div>
          </section>

          <section className="min-h-0 overflow-y-auto p-4 lg:p-5">
            <div className="mb-3 flex items-center justify-between gap-2"><div><div className="text-sm font-semibold">随心配置</div><div className="text-xs text-muted-foreground">保存后保留本轮已完成和已排除状态。</div></div><ListChecks className="size-4 text-muted-foreground" /></div>
            <section className="mb-3 space-y-2 rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-3">
              <div>
                <div className="text-sm font-semibold">快捷预设</div>
                <div className="text-xs leading-5 text-muted-foreground">一键切换本轮要刷的内容范围。</div>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                {FREESTYLE_QUICK_PRESETS.map((preset) => (
                  <Button key={preset.id} type="button" variant="outline" className="h-auto min-h-14 justify-start px-3 py-2 text-left" onClick={() => applyQuickPreset(preset.id)}>
                    <span className="min-w-0"><span className="block text-sm font-semibold">{preset.label}</span><span className="block truncate text-[11px] font-normal text-muted-foreground">{preset.description}</span></span>
                  </Button>
                ))}
              </div>
            </section>
            <FreestyleTrainingConfigForm
              config={draft}
              scopeSubjects={scopeSubjects}
              onOpenPalacePicker={setPickerStream}
              onChange={setDraft}
            />
          </section>
        </div>

        <DialogFooter className="shrink-0 flex-col-reverse gap-2 sm:flex-row">
          <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => onOpenChange(false)}>关闭</Button>
          <Button type="button" className="w-full sm:w-auto" onClick={() => { onSaveConfig(sanitizeFreestyleFeedConfig(draft)); onOpenChange(false) }}><Save className="size-4" />保存配置并重排</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <FreestylePalacePickerDialog
      open={pickerStream != null}
      subjects={scopeSubjects}
      value={pickerStream ? draft.streams[pickerStream].specific_palace_ids : []}
      onOpenChange={(next) => { if (!next) setPickerStream(null) }}
      onConfirm={(ids) => {
        if (!pickerStream) return
        const next = sanitizeFreestyleFeedConfig({
          ...draft,
          streams: {
            ...draft.streams,
            [pickerStream]: {
              ...draft.streams[pickerStream],
              specific_palace_ids: ids,
            },
          },
        })
        setDraft(next)
        setPickerStream(null)
        onSaveConfig(next)
      }}
    />
  </>
  )
}
