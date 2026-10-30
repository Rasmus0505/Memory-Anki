import { useCallback, useEffect, useRef, useState } from 'react'
import { Brain } from 'lucide-react'
import {
  getPalaceReviewUnitsApi,
  type PalaceUnitProjectionDto,
} from '@/modules/practice/ui/review/api'
import { intervalBadgeLabel, intervalOutlookLabel } from '@/modules/practice/ui/review/model/intervalBands'
import { Button } from '@/shared/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { APP_EVENT_NAMES, onAppEvent } from '@/shared/events/appEvents'

export type PalaceUnitRow = PalaceUnitProjectionDto['units'][number]

/**
 * The editor's 单元评分 entry and the mark-chip summary both read one unit
 * projection. It is loaded on first need (hover/focus or a chip click) instead
 * of on every editor mount: most editing sessions never look at it, and an
 * eager fetch only adds a request and a late state update to every page.
 */
export function usePalaceReviewUnits(palaceId?: number | null) {
  const [units, setUnits] = useState<PalaceUnitRow[]>([])
  const [loading, setLoading] = useState(false)
  const [requested, setRequested] = useState(false)
  const aliveRef = useRef(true)
  const requestedRef = useRef(false)

  useEffect(
    () => () => {
      aliveRef.current = false
    },
    [],
  )

  const load = useCallback(
    async (options?: { force?: boolean }) => {
      if (!palaceId) return
      if (requestedRef.current && !options?.force) return
      requestedRef.current = true
      if (aliveRef.current) {
        setRequested(true)
        setLoading(true)
      }
      try {
        const projection = await getPalaceReviewUnitsApi(palaceId)
        if (aliveRef.current) setUnits(projection.units)
      } catch {
        if (aliveRef.current) setUnits([])
      } finally {
        if (aliveRef.current) setLoading(false)
      }
    },
    [palaceId],
  )

  useEffect(
    () =>
      onAppEvent(APP_EVENT_NAMES.reviewStateChanged, () => {
        if (requestedRef.current) void load({ force: true })
      }),
    [load],
  )

  return { units, loading, requested, load, dueCount: units.filter((unit) => unit.due).length }
}


/**
 * The permanent-mark chip opens one unit's summary. Question-card chips pass
 * through untouched: only a uid the editor actually marked is a unit.
 */
export function usePalaceUnitSummary(
  reviewUnits: ReturnType<typeof usePalaceReviewUnits>,
  permanentMarkUids: readonly string[],
) {
  const [uid, setUid] = useState<string | null>(null)
  const clear = useCallback(() => setUid(null), [])
  const onChipClick = useCallback(
    (next: string) => {
      if (!permanentMarkUids.includes(next)) return
      void reviewUnits.load()
      setUid(next)
    },
    [permanentMarkUids, reviewUnits],
  )
  const unit = uid
    ? (reviewUnits.units.find((item) => item.node_uids.includes(uid)) ?? null)
    : null
  return { uid, unit, onChipClick, clear }
}

export function PalaceUnitRatingEntry({
  units,
  loading,
  requested,
  onLoad,
  onOpen,
}: {
  units: PalaceUnitRow[]
  loading: boolean
  requested: boolean
  onLoad: () => void
  onOpen: () => void
}) {
  const dueCount = units.filter((unit) => unit.due).length
  return (
    <button
      type="button"
      data-testid="open-unit-rating"
      onPointerEnter={onLoad}
      onFocus={onLoad}
      onClick={onOpen}
      className="flex w-full items-center gap-2 rounded-lg border border-border/70 bg-background px-3 py-2 text-left transition-colors hover:border-primary/50 hover:bg-primary/5"
    >
      <Brain className="size-4 shrink-0 text-primary" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">单元评分</span>
        <span className="block text-[11px] text-muted-foreground">
          {!requested
            ? '按单元评分与调整进度'
            : loading
              ? '正在读取复习单元…'
              : dueCount > 0
                ? `${dueCount} 个今天到期`
                : `${units.length} 个复习单元`}
        </span>
      </span>
    </button>
  )
}

/**
 * What a permanent-mark chip opens: the unit's scope, its booked gap and the
 * next due date, plus the way to the rating page. Rating itself stays on that
 * page, where the four previews and the map are both visible.
 */
export function UnitSummaryDialog({
  open,
  unit,
  loading,
  onClose,
  onRate,
}: {
  open: boolean
  unit: PalaceUnitRow | null
  loading: boolean
  onClose: () => void
  onRate: (unitId: string) => void
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogTitle>{unit?.title ?? '复习单元'}</DialogTitle>
        <DialogDescription>
          {unit
            ? '这段内容会作为一个复习单元独立排期。'
            : loading
              ? '正在读取复习单元…'
              : '这个标记还没成为复习单元；退出标记模式后生效。'}
        </DialogDescription>
        {unit ? (
          <div className="space-y-3 text-sm">
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
              <dt className="text-muted-foreground">范围</dt>
              <dd>{unit.node_uids.length} 个节点</dd>
              <dt className="text-muted-foreground">记忆等级</dt>
              <dd>{intervalOutlookLabel(unit.interval_days)}</dd>
              <dt className="text-muted-foreground">下次到期</dt>
              <dd>
                {unit.due ? '今天到期' : intervalBadgeLabel(unit.interval_days)}
                {unit.due_date ? ` · ${unit.due_date}` : ''}
              </dd>
            </dl>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={onClose}>
                关闭
              </Button>
              <Button type="button" size="sm" onClick={() => onRate(unit.id)}>
                去评分
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
