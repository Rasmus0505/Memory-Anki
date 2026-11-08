import { useEffect, useMemo, useState } from 'react'
import {
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  Check,
  GripVertical,
  Search,
  X,
} from 'lucide-react'
import type { FreestyleCard } from '@/shared/api/contracts'
import type { FreestyleRoundPlanState } from '@/modules/practice/domain/roundPlan'
import type { FreestyleUnitEncounterState } from '@/modules/practice/domain/queueState'
import type { UnitRating } from '@/modules/practice/ui/review/api/unitReviewApi'
import { isOccurrenceScored } from '@/modules/practice/domain/unitProgressState'
import { isMindMapBranchCard } from '@/modules/practice/ui/freestyle/model/freestyle-cards'
import type { RatingSaveEntry } from '@/modules/practice/ui/freestyle/model/ratingSaveStore'
import { Checkbox } from '@/shared/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { Button } from '@/shared/components/ui/button'
import { toast } from '@/shared/feedback/toast'
import { cn } from '@/shared/lib/utils'

const RATING_OPTIONS: Array<{ value: UnitRating; label: string }> = [
  { value: 1, label: '忘记' },
  { value: 2, label: '困难' },
  { value: 3, label: '记得' },
  { value: 4, label: '轻松' },
]

type QueueRow = {
  id: string
  label: string
  palaceTitle: string
  palaceId: number | null
  status: 'pending' | 'rated' | 'removed' | 'waiting' | 'stale'
  rating: UnitRating | null
  retry: boolean
  current: boolean
  selectable: boolean
  excludable: boolean
  rateable: boolean
  movable: boolean
  busy: boolean
  card: FreestyleCard | null
}

function cardLabel(card: FreestyleCard | undefined, fallback: string) {
  if (!card) return fallback || '记忆点'
  if (card.type === 'mindmap_branch') {
    return String(card.context_path.at(-1)?.text || card.anchor_uid || fallback || '记忆点').trim()
  }
  if (card.type === 'action') return card.title || card.subtitle || fallback || '复习任务'
  if (card.type === 'quiz_question') return `题目：${String(card.question.stem || fallback || '题目').replace(/\s+/g, ' ').trim()}`
  return '提示'
}

function rowStatusLabel(row: QueueRow) {
  if (row.status === 'removed') return '已移出'
  if (row.status === 'rated') return row.rating == null ? '已评分' : `${RATING_OPTIONS.find((item) => item.value === row.rating)?.label ?? '已评分'}`
  if (row.status === 'waiting') return '待重练'
  if (row.status === 'stale') return '待更新'
  return '待评分'
}

function buildRows(input: {
  cards: FreestyleCard[]
  roundPlan: FreestyleRoundPlanState | null
  completedIds: readonly string[]
  hiddenIds: readonly string[]
  encounters: Record<string, FreestyleUnitEncounterState>
  currentCardId: string | null
  ratingSaveEntries: Record<string, RatingSaveEntry>
}): QueueRow[] {
  const cardsById = new Map(input.cards.map((card) => [String(card.id), card]))
  const plan = input.roundPlan
  const orderedIds = [...(plan?.orderIds ?? [])]
  for (const card of input.cards) {
    if (!orderedIds.includes(card.id)) orderedIds.push(card.id)
  }
  const completedIds = new Set(input.completedIds.map(String))
  const hiddenIds = new Set(input.hiddenIds.map(String))
  const compressedIds = new Set(plan?.compressedIds ?? [])

  return orderedIds.flatMap((id): QueueRow[] => {
    const entry = plan?.cardsById[id]
    const card = cardsById.get(id) ?? null
    if (card?.type === 'review_hint' || entry?.kind === 'review_hint') return []
    if (!entry && !card) return []
    if (compressedIds.has(id) || (entry?.sourceCardId && compressedIds.has(entry.sourceCardId))) return []
    const rawRating = input.encounters[id]?.selectedRating ?? entry?.lastRating ?? null
    const rating: UnitRating | null = rawRating === 1 || rawRating === 2 || rawRating === 3 || rawRating === 4
      ? rawRating
      : null
    const scored = rating != null || completedIds.has(id) || entry?.status === 'completed'
      || isOccurrenceScored(id, {
        completedIds: input.completedIds,
        encounters: input.encounters,
        roundPlan: plan,
      })
    const removed = entry?.status === 'excluded' || hiddenIds.has(id)
    const retry = entry?.occurrenceKind === 'retry'
      || (card != null && 'occurrence_kind' in card && card.occurrence_kind === 'retry')
    const waiting = !scored && entry?.status === 'retry'
    const status: QueueRow['status'] = removed
      ? 'removed'
      : scored
        ? 'rated'
        : waiting
          ? 'waiting'
          : entry?.status === 'stale'
            ? 'stale'
            : 'pending'
    const save = input.ratingSaveEntries[id]
    const busy = save?.status === 'saving'
    const specialReview = card != null && isMindMapBranchCard(card) && (card.bedtime || card.palace_pass)
    const movable = status === 'pending' && !retry && !busy && !specialReview && entry?.lastRating == null
    const excludable = status === 'pending' && card != null && !busy
    const rateable = excludable
      && card != null
      && isMindMapBranchCard(card)
      && !card.bedtime
      && !card.palace_pass
      && Boolean(card.unit_id)
      && card.unit_revision != null
    const selectable = status === 'removed' || excludable

    return [{
      id,
      label: cardLabel(card ?? undefined, entry?.label ?? ''),
      palaceTitle: entry?.palaceTitle || (card && 'palace_title' in card ? card.palace_title : '') || '',
      palaceId: entry?.palaceId ?? (card && card.type === 'mindmap_branch' ? card.palace_id : null),
      status,
      rating,
      retry,
      current: id === input.currentCardId,
      selectable,
      excludable,
      rateable,
      movable,
      busy,
      card,
    }]
  })
}

export interface FreestyleQueuePanelProps {
  cards: FreestyleCard[]
  roundPlan: FreestyleRoundPlanState | null
  completedIds: readonly string[]
  hiddenIds: readonly string[]
  encounters: Record<string, FreestyleUnitEncounterState>
  currentCardId: string | null
  ratingSaveEntries: Record<string, RatingSaveEntry>
  active?: boolean
  onExclude: (cardIds: string[]) => void
  onRestore: (cardIds: string[]) => void
  onReorder: (orderIds: string[]) => void
  onRateCards: (cardIds: readonly string[], rating: UnitRating) => {
    queued: number
    unchanged: number
    skipped: number
  }
}

/** 本轮队列 editor. Selecting or editing a row never navigates the review feed. */
export function FreestyleQueuePanel({
  cards,
  roundPlan,
  completedIds,
  hiddenIds,
  encounters,
  currentCardId,
  ratingSaveEntries,
  active = true,
  onExclude,
  onRestore,
  onReorder,
  onRateCards,
}: FreestyleQueuePanelProps) {
  const [query, setQuery] = useState('')
  const [palaceFilter, setPalaceFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState<'pending' | 'removed' | 'rated' | 'all'>('pending')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [ratingIntent, setRatingIntent] = useState<UnitRating | null>(null)
  const [draggedId, setDraggedId] = useState<string | null>(null)

  const rows = useMemo(() => buildRows({
    cards,
    roundPlan,
    completedIds,
    hiddenIds,
    encounters,
    currentCardId,
    ratingSaveEntries,
  }), [cards, completedIds, currentCardId, encounters, hiddenIds, ratingSaveEntries, roundPlan])
  const eligibleKey = useMemo(
    () => rows.filter((row) => row.selectable).map((row) => row.id).join('\u0000'),
    [rows],
  )

  useEffect(() => {
    const eligible = new Set(eligibleKey ? eligibleKey.split('\u0000') : [])
    setSelectedIds((current) => {
      const next = current.filter((id) => eligible.has(id))
      return next.length === current.length ? current : next
    })
  }, [eligibleKey])

  const palaceOptions = useMemo(() => {
    const titles = new Map<string, string>()
    rows.forEach((row) => {
      if (row.palaceId != null) titles.set(String(row.palaceId), row.palaceTitle || `宫殿 ${row.palaceId}`)
    })
    return [...titles.entries()].sort((left, right) => left[1].localeCompare(right[1], 'zh-CN'))
  }, [rows])

  const filteredRows = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    return rows.filter((row) => {
      if (statusFilter !== 'all' && row.status !== statusFilter) return false
      if (palaceFilter !== 'all' && String(row.palaceId ?? '') !== palaceFilter) return false
      if (!needle) return true
      return `${row.label} ${row.palaceTitle}`.toLocaleLowerCase().includes(needle)
    })
  }, [palaceFilter, query, rows, statusFilter])

  const pendingCount = rows.filter((row) => row.status === 'pending').length
  const removedCount = rows.filter((row) => row.status === 'removed').length
  const ratedCount = rows.filter((row) => row.status === 'rated').length
  const selectableFilteredIds = filteredRows.filter((row) => row.selectable).map((row) => row.id)
  const selectedRows = rows.filter((row) => selectedIds.includes(row.id))
  const selectedRemovedIds = selectedRows.filter((row) => row.status === 'removed').map((row) => row.id)
  const selectedQueuedIds = selectedRows.filter((row) => row.excludable).map((row) => row.id)
  const selectedPendingIds = selectedRows.filter((row) => row.rateable).map((row) => row.id)
  const selectedAllFiltered = selectableFilteredIds.length > 0
    && selectableFilteredIds.every((id) => selectedIds.includes(id))

  const toggleSelected = (id: string, checked: boolean) => {
    setSelectedIds((current) => checked
      ? current.includes(id) ? current : [...current, id]
      : current.filter((item) => item !== id))
  }

  const reorderRows = (fromId: string, toId: string) => {
    if (fromId === toId || !roundPlan) return
    const visibleMovable = filteredRows.filter((row) => row.movable).map((row) => row.id)
    const from = visibleMovable.indexOf(fromId)
    const to = visibleMovable.indexOf(toId)
    if (from < 0 || to < 0) return
    const moved = [...visibleMovable]
    moved.splice(to, 0, moved.splice(from, 1)[0])
    const movableIds = new Set(rows.filter((row) => row.movable).map((row) => row.id))
    const fullMovable = roundPlan.orderIds.filter((id) => movableIds.has(id))
    const visibleSet = new Set(visibleMovable)
    let cursor = 0
    const nextMovable = fullMovable.map((id) => visibleSet.has(id) ? moved[cursor++] ?? id : id)
    const nextFull = [...roundPlan.orderIds]
    let fullCursor = 0
    nextFull.forEach((id, index) => {
      if (fullMovable.includes(id)) nextFull[index] = nextMovable[fullCursor++] ?? id
    })
    onReorder(nextFull)
  }

  const moveRow = (rowId: string, direction: -1 | 1) => {
    const movable = filteredRows.filter((row) => row.movable)
    const index = movable.findIndex((row) => row.id === rowId)
    const target = movable[index + direction]
    if (index < 0 || !target) return
    reorderRows(rowId, target.id)
  }

  const confirmRating = () => {
    if (ratingIntent == null || selectedPendingIds.length === 0) return
    const result = onRateCards(selectedPendingIds, ratingIntent)
    setRatingIntent(null)
    setSelectedIds([])
    if (result.queued > 0) toast.success(`已提交 ${result.queued} 张，正在按「${RATING_OPTIONS.find((item) => item.value === ratingIntent)?.label}」保存`)
    else toast.info('所选卡片没有可提交的评分')
  }

  const ratingLabel = ratingIntent == null ? '' : RATING_OPTIONS.find((item) => item.value === ratingIntent)?.label ?? ''

  return (
    <section className="flex h-full min-h-0 flex-1 flex-col" aria-label="随心列表" data-testid="freestyle-queue-panel" data-keyboard-shortcuts-suspended={active ? 'true' : undefined}>
      <div className="shrink-0 border-b border-border/70 px-3 pb-2 pt-3">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            type="search"
            aria-label="筛选本轮队列"
            placeholder="搜记忆点或宫殿"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            className="h-9 w-full rounded-lg border border-input bg-card pl-8 pr-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/40"
          />
        </label>
        <div className="mt-2 flex gap-1 overflow-x-auto" role="tablist" aria-label="队列状态">
          {([
            ['pending', `待评分 ${pendingCount}`],
            ['removed', `已移出 ${removedCount}`],
            ['rated', `已评分 ${ratedCount}`],
            ['all', '全部'],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={statusFilter === value}
              onClick={() => setStatusFilter(value)}
              className={cn(
                'shrink-0 rounded-md px-2 py-1 text-xs transition-colors',
                statusFilter === value ? 'bg-primary/12 font-medium text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <select
          aria-label="按宫殿筛选"
          value={palaceFilter}
          onChange={(event) => setPalaceFilter(event.currentTarget.value)}
          className="mt-2 h-8 w-full rounded-md border border-border bg-card px-2 text-xs text-foreground"
        >
          <option value="all">所有宫殿</option>
          {palaceOptions.map(([id, title]) => <option key={id} value={id}>{title}</option>)}
        </select>
      </div>

      {(selectedIds.length > 0 || statusFilter === 'pending' || statusFilter === 'removed') ? (
        <div className="flex min-h-9 items-center justify-between gap-2 border-b border-border/60 px-3 py-1.5">
          {statusFilter === 'pending' || statusFilter === 'removed' ? (
            <label className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
              <Checkbox
                aria-label={selectedAllFiltered ? '取消全选筛选结果' : '全选筛选结果'}
                checked={selectedAllFiltered}
                disabled={selectableFilteredIds.length === 0}
                onCheckedChange={(checked) => setSelectedIds((current) => {
                  const rest = current.filter((id) => !selectableFilteredIds.includes(id))
                  return checked === true ? [...rest, ...selectableFilteredIds] : rest
                })}
              />
              <span>全选{selectedIds.length > 0 ? ` · 已选 ${selectedIds.length}` : ''}</span>
            </label>
          ) : <span className="text-xs text-muted-foreground">已选 {selectedIds.length}</span>}
          {selectedIds.length > 0 ? (
            <button type="button" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" onClick={() => setSelectedIds([])}>
              <X className="size-3.5" aria-hidden />清空
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-1.5" data-testid="freestyle-queue-list">
        {filteredRows.length === 0 ? (
          <div className="px-2 py-8 text-center text-sm text-muted-foreground">
            {query || palaceFilter !== 'all' ? '没有符合条件的项目' : statusFilter === 'removed' ? '没有移出本轮的项目' : statusFilter === 'rated' ? '还没有已评分的项目' : '本轮没有待评分项目'}
          </div>
        ) : filteredRows.map((row, index) => (
          <div
            key={row.id}
            data-testid="freestyle-queue-row"
            data-card-id={row.id}
            draggable={row.movable}
            onDragStart={(event) => {
              if (!row.movable) return
              setDraggedId(row.id)
              event.dataTransfer.effectAllowed = 'move'
              event.dataTransfer.setData('text/plain', row.id)
            }}
            onDragEnd={() => setDraggedId(null)}
            onDragOver={(event) => {
              if (!draggedId || !row.movable) return
              event.preventDefault()
              event.dataTransfer.dropEffect = 'move'
            }}
            onDrop={(event) => {
              event.preventDefault()
              const source = draggedId || event.dataTransfer.getData('text/plain')
              reorderRows(source, row.id)
              setDraggedId(null)
            }}
            className={cn(
              'group flex min-w-0 items-center gap-1.5 border-b border-border/50 py-2 pl-1 pr-0.5',
              draggedId === row.id && 'opacity-40',
            )}
          >
            <span className="w-5 shrink-0 text-center text-[10px] tabular-nums text-muted-foreground/80">
              {row.status === 'pending' ? `${rows.filter((item) => item.status === 'pending').findIndex((item) => item.id === row.id) + 1}` : ''}
            </span>
            {row.selectable ? (
              <Checkbox
                aria-label={`选择：${row.label}`}
                checked={selectedIds.includes(row.id)}
                onCheckedChange={(checked) => toggleSelected(row.id, checked === true)}
              />
            ) : row.status === 'rated' ? (
              <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-rate-good/15 text-rate-good" aria-label="已评分">
                <Check className="size-3" aria-hidden />
              </span>
            ) : row.status === 'removed' ? (
              <ArchiveRestore className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            ) : <span className="size-4 shrink-0" />}
            <div className="min-w-0 flex-1">
              <div className={cn('line-clamp-2 break-words text-[13px] leading-5', row.status === 'removed' && 'text-muted-foreground line-through')} title={row.label}>
                {row.label}
              </div>
              <div className="flex min-w-0 items-center gap-1.5 text-[10px] leading-4 text-muted-foreground">
                <span className="truncate">{row.palaceTitle || '未分类'}</span>
                <span aria-hidden>·</span>
                <span className="shrink-0">{rowStatusLabel(row)}</span>
                {row.current ? <span className="shrink-0 text-primary">当前</span> : null}
                {row.retry ? <span className="shrink-0">重练</span> : null}
                {row.busy ? <span className="shrink-0">保存中</span> : null}
                {ratingSaveEntries[row.id]?.status === 'failed' ? <span className="shrink-0">未保存</span> : null}
              </div>
            </div>
            {row.status === 'removed' ? (
              <button
                type="button"
                aria-label={`恢复：${row.label}`}
                title="恢复到本轮"
                className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                onClick={() => onRestore([row.id])}
              >
                <ArchiveRestore className="size-4" aria-hidden />
              </button>
            ) : row.movable ? (
              <div className="flex shrink-0 items-center">
                <button
                  type="button"
                  aria-label={`上移：${row.label}`}
                  disabled={index === 0 || !filteredRows.slice(0, index).some((item) => item.movable)}
                  className="inline-flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:invisible focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                  onClick={() => moveRow(row.id, -1)}
                ><ArrowUp className="size-3.5" aria-hidden /></button>
                <button
                  type="button"
                  aria-label={`下移：${row.label}`}
                  disabled={!filteredRows.slice(index + 1).some((item) => item.movable)}
                  className="inline-flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:invisible focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                  onClick={() => moveRow(row.id, 1)}
                ><ArrowDown className="size-3.5" aria-hidden /></button>
                <GripVertical className="mr-0.5 size-3.5 cursor-grab text-muted-foreground/50 group-hover:text-muted-foreground" aria-hidden />
              </div>
            ) : null}
          </div>
        ))}
      </div>

      {selectedIds.length > 0 ? (
        <div className="border-t border-border bg-card px-3 py-2.5">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-foreground">已选 {selectedIds.length} 项</span>
            <div className="flex gap-1">
              {selectedQueuedIds.length > 0 ? (
                <button
                  type="button"
                  className="h-7 rounded-md border border-border px-2 text-xs text-foreground hover:bg-accent disabled:opacity-50"
                  onClick={() => {
                    onExclude(selectedQueuedIds)
                    setSelectedIds((current) => current.filter((id) => !selectedQueuedIds.includes(id)))
                  }}
                >移出本轮</button>
              ) : null}
              {selectedRemovedIds.length > 0 ? (
                <button
                  type="button"
                  className="h-7 rounded-md border border-border px-2 text-xs text-foreground hover:bg-accent"
                  aria-label={`恢复 ${selectedRemovedIds.length} 张`}
                  onClick={() => {
                    onRestore(selectedRemovedIds)
                    setSelectedIds((current) => current.filter((id) => !selectedRemovedIds.includes(id)))
                  }}
                >恢复</button>
              ) : null}
            </div>
          </div>
          {selectedPendingIds.length > 0 ? (
            <div className="grid grid-cols-4 gap-1">
              {RATING_OPTIONS.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  className="min-h-9 rounded-lg border border-border px-1 text-xs font-medium text-foreground transition-colors hover:border-primary/50 hover:bg-primary/8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                  onClick={() => setRatingIntent(item.value)}
                >{item.label}</button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <Dialog open={ratingIntent != null} onOpenChange={(open) => { if (!open) setRatingIntent(null) }}>
        <DialogContent className="max-w-md" data-keyboard-shortcuts-suspended="true">
          <DialogHeader>
            <DialogTitle>确认批量评分为「{ratingLabel}」？</DialogTitle>
            <DialogDescription>
              将对选中的 {selectedPendingIds.length} 张记忆点逐张保存「{ratingLabel}」，并按各自的评分规则更新复习安排。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRatingIntent(null)}>取消</Button>
            <Button disabled={selectedPendingIds.length === 0} onClick={confirmRating}>
              确认评分 {selectedPendingIds.length} 张
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
