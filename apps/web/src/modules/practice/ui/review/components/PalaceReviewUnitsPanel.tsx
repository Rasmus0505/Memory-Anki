import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarClock, ChevronDown, ChevronUp, LoaderCircle, RefreshCw, Undo2, X } from 'lucide-react'
import { appConfirm } from '@/shared/components/ui/native-dialog'
import { Button } from '@/shared/components/ui/button'
import { toast } from '@/shared/feedback/toast'
import { stripMindMapHtml } from '@/shared/lib/mindmapRichText'
import { cn } from '@/shared/lib/utils'
import {
  adjustUnitScheduleApi,
  getPalaceReviewUnitsApi,
  reconcilePalaceUnitsApi,
  undoContentScheduleBatchApi,
  type PalaceUnitProjectionDto,
  type ReconcilePalaceUnitsResultDto,
  type UnitScheduleSnapshotDto,
} from '../api'

/** Ebbinghaus-style interval ladder used by unit review stages. */
export const UNIT_INTERVAL_LADDER_DAYS = [0, 1, 3, 7, 14, 30, 60, 120, 240, 365] as const

function intervalStageLabel(days: number) {
  return days === 0 ? '首学' : `${days}天级`
}

export type PalaceReviewUnitChangeHighlight = {
  unit_id: string
  action: string
  before?: UnitScheduleSnapshotDto | null
  after?: UnitScheduleSnapshotDto | null
}

export type PalaceReviewUnitsPanelProps = {
  open: boolean
  palaceId: number
  onClose: () => void
  /** Last reconcile undo token if parent just reconciled (batch id). */
  undoToken?: string | null
  /** Optional recent changes to highlight in the list. */
  recentChanges?: PalaceReviewUnitChangeHighlight[]
  /** Parent may rebuild freestyle queue after schedule edits. */
  onScheduleChanged?: () => void
}

type UnitRow = PalaceUnitProjectionDto['units'][number]

function operationId() {
  return crypto.randomUUID?.() ?? `unit-schedule-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function formatDueLabel(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return value
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function actionLabel(action: string) {
  const map: Record<string, string> = {
    demote: '降阶',
    create: '新建',
    remove: '移除',
    update: '更新',
    keep: '保持',
    promote: '升阶',
  }
  return map[action] || action
}

export function PalaceReviewUnitsPanel({
  open,
  palaceId,
  onClose,
  undoToken: undoTokenProp,
  recentChanges: recentChangesProp,
  onScheduleChanged,
}: PalaceReviewUnitsPanelProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [projection, setProjection] = useState<PalaceUnitProjectionDto | null>(null)
  const [expandedUnitId, setExpandedUnitId] = useState<string | null>(null)
  const [draftStage, setDraftStage] = useState<number>(0)
  const [draftDue, setDraftDue] = useState('')
  const [draftPassed, setDraftPassed] = useState(false)
  const [savingUnitId, setSavingUnitId] = useState<string | null>(null)
  const [reconciling, setReconciling] = useState(false)
  const [undoing, setUndoing] = useState(false)
  const [localUndoToken, setLocalUndoToken] = useState<string | null>(null)
  const [localChanges, setLocalChanges] = useState<PalaceReviewUnitChangeHighlight[]>([])
  const [changeSummary, setChangeSummary] = useState<string | null>(null)

  const effectiveUndoToken = localUndoToken ?? undoTokenProp ?? null
  const highlightByUnitId = useMemo(() => {
    const map = new Map<string, PalaceReviewUnitChangeHighlight>()
    for (const item of recentChangesProp ?? []) {
      if (item.unit_id) map.set(item.unit_id, item)
    }
    for (const item of localChanges) {
      if (item.unit_id) map.set(item.unit_id, item)
    }
    return map
  }, [localChanges, recentChangesProp])

  const loadUnits = useCallback(async () => {
    if (!palaceId) return
    setLoading(true)
    setError(null)
    try {
      const item = await getPalaceReviewUnitsApi(palaceId)
      setProjection(item)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载复习单元失败')
      setProjection(null)
    } finally {
      setLoading(false)
    }
  }, [palaceId])

  useEffect(() => {
    if (!open) {
      setExpandedUnitId(null)
      setError(null)
      setChangeSummary(null)
      setSavingUnitId(null)
      setReconciling(false)
      setUndoing(false)
      return
    }
    void loadUnits()
  }, [loadUnits, open])

  // Parent may pass a fresh undo token after content demote; keep local in sync when panel opens.
  useEffect(() => {
    if (!open) return
    if (undoTokenProp) setLocalUndoToken(undoTokenProp)
  }, [open, undoTokenProp])

  const openEditor = useCallback((unit: UnitRow) => {
    setExpandedUnitId((current) => {
      if (current === unit.id) return null
      setDraftStage(unit.stage_index)
      setDraftDue(unit.due_date)
      setDraftPassed(unit.has_passed)
      return unit.id
    })
  }, [])

  const handleSaveUnit = useCallback(async (unit: UnitRow) => {
    const stageChanged = draftStage !== unit.stage_index
    const dueChanged = draftDue !== unit.due_date
    const passedChanged = draftPassed !== unit.has_passed
    if (!stageChanged && !dueChanged && !passedChanged) {
      toast.message('没有需要保存的修改')
      return
    }
    setSavingUnitId(unit.id)
    try {
      const result = await adjustUnitScheduleApi(unit.id, {
        operation_id: operationId(),
        ...(stageChanged ? { stage_index: draftStage } : {}),
        ...(dueChanged ? { due_date: draftDue } : {}),
        ...(passedChanged ? { has_passed: draftPassed } : {}),
        reason: 'manual_adjust',
      })
      setProjection((current) => {
        if (!current) return current
        return {
          ...current,
          units: current.units.map((item) => (item.id === result.unit.id ? { ...item, ...result.unit } : item)),
          due_unit_count: result.palace.due_unit_count,
          next_review_date: result.palace.next_review_date,
          review_status: result.palace.review_status,
          unit_count: result.palace.unit_count,
        }
      })
      setDraftStage(result.unit.stage_index)
      setDraftDue(result.unit.due_date)
      setDraftPassed(result.unit.has_passed)
      toast.success('已更新单元进度')
      onScheduleChanged?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '更新单元进度失败')
    } finally {
      setSavingUnitId(null)
    }
  }, [draftDue, draftPassed, draftStage, onScheduleChanged])

  const handleReconcile = useCallback(async () => {
    if (!palaceId || reconciling) return
    setReconciling(true)
    try {
      const result: ReconcilePalaceUnitsResultDto = await reconcilePalaceUnitsApi(palaceId)
      const changes = (result.changes ?? []).map((item) => ({
        unit_id: item.unit_id,
        action: item.action,
        before: item.before,
        after: item.after,
      }))
      setLocalChanges(changes)
      setLocalUndoToken(result.undo_token ?? result.schedule_batch_id ?? null)
      if (result.changed && changes.length > 0) {
        const parts = changes.slice(0, 4).map((item) => {
          const title = stripMindMapHtml(
            result.changes.find((row) => row.unit_id === item.unit_id)?.title || item.unit_id,
          )
          return `${title || '单元'} · ${actionLabel(item.action)}`
        })
        const extra = changes.length > 4 ? ` 等 ${changes.length} 项` : ''
        setChangeSummary(`已调和：${parts.join('；')}${extra}`)
        toast.success(`进度已调和（${changes.length} 项变更）`)
      } else {
        setChangeSummary('调和完成：无进度变更')
        toast.message('调和完成：无进度变更')
      }
      await loadUnits()
      if (result.changed) onScheduleChanged?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '调和进度失败')
    } finally {
      setReconciling(false)
    }
  }, [loadUnits, onScheduleChanged, palaceId, reconciling])

  const handleUndoBatch = useCallback(async () => {
    if (!palaceId || !effectiveUndoToken || undoing) return
    const confirmed = await appConfirm(
      '将撤销最近一次内容变更对复习进度的影响（阶梯/到期等会回滚）。确定继续？',
      {
        title: '撤销内容对进度的影响',
        confirmText: '撤销',
        cancelText: '取消',
        tone: 'danger',
      },
    )
    if (!confirmed) return
    setUndoing(true)
    try {
      const result = await undoContentScheduleBatchApi(palaceId, effectiveUndoToken, operationId())
      setLocalUndoToken(null)
      setLocalChanges([])
      setChangeSummary(
        result.restored_count > 0
          ? `已撤销：恢复 ${result.restored_count} 个单元进度`
          : '已撤销：没有可恢复的进度变更',
      )
      toast.success(
        result.restored_count > 0
          ? `已撤销内容对进度的影响（恢复 ${result.restored_count} 个单元）`
          : '已撤销',
      )
      await loadUnits()
      onScheduleChanged?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '撤销失败')
    } finally {
      setUndoing(false)
    }
  }, [effectiveUndoToken, loadUnits, onScheduleChanged, palaceId, undoing])

  if (!open) return null

  const units = projection?.units ?? []
  const title = projection?.title ? stripMindMapHtml(projection.title) : `宫殿 ${palaceId}`

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" data-testid="palace-review-units-panel">
      <button
        type="button"
        className="absolute inset-0 cursor-default bg-black/50 backdrop-blur-sm"
        aria-label="关闭本宫殿复习单元"
        onClick={onClose}
      />
      <div
        className={cn(
          'relative z-10 flex max-h-[82dvh] flex-col rounded-t-2xl border-t shadow-2xl',
          'border-border bg-background text-foreground',
        )}
        role="dialog"
        aria-modal="true"
        aria-label="本宫殿复习单元"
      >
        <div className="mx-auto mt-3 h-1 w-10 rounded-full bg-muted-foreground/30" />
        <div className="flex items-center justify-between gap-2 px-5 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <CalendarClock className="size-4 shrink-0 text-amber-500" />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">本宫殿复习单元</div>
              <div className="truncate text-xs text-muted-foreground">
                {title}
                {projection
                  ? ` · ${projection.unit_count} 单元 · 到期 ${projection.due_unit_count}`
                  : null}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="关闭"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="flex flex-wrap gap-2 border-t border-border px-4 py-2.5">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={loading || reconciling}
            onClick={() => void handleReconcile()}
            className="gap-1.5"
          >
            {reconciling ? (
              <LoaderCircle className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            立即调和进度
          </Button>
          {effectiveUndoToken ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={undoing}
              onClick={() => void handleUndoBatch()}
              className="gap-1.5 border-amber-500/40 text-amber-700 dark:text-amber-300"
            >
              {undoing ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : (
                <Undo2 className="size-3.5" />
              )}
              撤销这次内容对进度的影响
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={loading}
            onClick={() => void loadUnits()}
            className="ml-auto text-muted-foreground"
          >
            刷新
          </Button>
        </div>

        {changeSummary ? (
          <div className="border-t border-border bg-muted/40 px-5 py-2 text-xs text-muted-foreground">
            {changeSummary}
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto border-t border-border px-4 py-3">
          {loading && !projection ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin" />
              正在加载复习单元…
            </div>
          ) : null}
          {error ? (
            <div className="space-y-3 py-6 text-center">
              <p className="text-sm text-destructive">{error}</p>
              <Button type="button" size="sm" variant="outline" onClick={() => void loadUnits()}>
                重试
              </Button>
            </div>
          ) : null}
          {!loading && !error && units.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              当前宫殿没有永久标记复习单元。
            </p>
          ) : null}
          <ul className="space-y-2">
            {units.map((unit) => {
              const titleText = stripMindMapHtml(unit.title) || '未命名单元'
              const expanded = expandedUnitId === unit.id
              const highlight = highlightByUnitId.get(unit.id)
              const nodeCount = unit.node_uids?.length ?? 0
              const saving = savingUnitId === unit.id
              return (
                <li
                  key={unit.id}
                  className={cn(
                    'rounded-xl border border-border bg-card/80 p-3',
                    highlight ? 'ring-1 ring-amber-400/50' : null,
                    unit.due ? 'border-amber-500/35' : null,
                  )}
                  data-testid={`palace-review-unit-row-${unit.id}`}
                >
                  <button
                    type="button"
                    className="flex w-full items-start gap-2 text-left"
                    onClick={() => openEditor(unit)}
                    aria-expanded={expanded}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{titleText}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                        <span className="rounded-full bg-muted px-2 py-0.5 font-medium text-foreground/80">
                          {intervalStageLabel(unit.interval_days)}
                        </span>
                        <span>到期 {formatDueLabel(unit.due_date)}</span>
                        {unit.due ? (
                          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 font-medium text-amber-700 dark:text-amber-300">
                            到期
                          </span>
                        ) : null}
                        {unit.has_passed ? (
                          <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-emerald-700 dark:text-emerald-300">
                            已通过
                          </span>
                        ) : null}
                        <span>{nodeCount} 节点</span>
                        {highlight ? (
                          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-amber-700 dark:text-amber-300">
                            最近：{actionLabel(highlight.action)}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    {expanded ? (
                      <ChevronUp className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    )}
                  </button>

                  {expanded ? (
                    <div className="mt-3 space-y-3 border-t border-border pt-3">
                      <div className="grid gap-2 sm:grid-cols-2">
                        <label className="block text-xs text-muted-foreground">
                          阶梯级别
                          <select
                            className="mt-1 w-full rounded-lg border border-border bg-background px-2.5 py-2 text-sm text-foreground"
                            value={draftStage}
                            onChange={(event) => setDraftStage(Number(event.target.value))}
                            disabled={saving}
                          >
                            {UNIT_INTERVAL_LADDER_DAYS.map((days, index) => (
                              <option key={days} value={index}>
                                {index} · {intervalStageLabel(days)}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="block text-xs text-muted-foreground">
                          到期日
                          <input
                            type="date"
                            className="mt-1 w-full rounded-lg border border-border bg-background px-2.5 py-2 text-sm text-foreground"
                            value={draftDue}
                            onChange={(event) => setDraftDue(event.target.value)}
                            disabled={saving}
                          />
                        </label>
                      </div>
                      <label className="flex items-center gap-2 text-xs text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={draftPassed}
                          onChange={(event) => setDraftPassed(event.target.checked)}
                          disabled={saving}
                          className="size-3.5 rounded border-border"
                        />
                        已通过本阶（has_passed）
                      </label>
                      <div className="flex justify-end gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={saving}
                          onClick={() => setExpandedUnitId(null)}
                        >
                          收起
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          disabled={saving}
                          onClick={() => void handleSaveUnit(unit)}
                          className="gap-1.5"
                        >
                          {saving ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
                          保存进度
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
        </div>
        <div className="h-[env(safe-area-inset-bottom,0px)] shrink-0" />
      </div>
    </div>
  )
}
