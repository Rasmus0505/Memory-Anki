import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  ReviewCalibrationDiagnose,
  ReviewCalibrationNodeProgress,
} from '@/shared/api/contracts'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Checkbox } from '@/shared/components/ui/checkbox'
import { Label } from '@/shared/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/shared/components/ui/radio-group'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/shared/components/ui/sheet'
import { toast } from '@/shared/feedback/toast'
import { cn } from '@/shared/lib/utils'
import {
  applyPalaceCalibrationApi,
  diagnosePalaceCalibrationApi,
  previewPalaceCalibrationApi,
  undoPalaceCalibrationApi,
  type ReviewCalibrationPayload,
  type ReviewCalibrationResult,
} from '@/modules/practice/ui/review/api'

type BaselineTier = 'new' | 'weak' | 'fair' | 'strong'
type ScopeKind = 'palace' | 'branch' | 'nodes'
type CalibrateMode = 'baseline' | 'match_node'

const BASELINE_OPTIONS: Array<{ value: BaselineTier; label: string; hint: string }> = [
  { value: 'new', label: '新卡', hint: '清空进度，视为未初始化' },
  { value: 'weak', label: '偏弱', hint: '约 1 天稳定度' },
  { value: 'fair', label: '一般', hint: '约 7 天稳定度' },
  { value: 'strong', label: '很熟', hint: '约 30 天稳定度' },
]

function makeOperationId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `calibrate_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) return error.message
  if (typeof error === 'string' && error.trim()) return error
  return fallback
}

function formatStability(days: number | null | undefined): string {
  if (days == null || Number.isNaN(Number(days))) return '—'
  const n = Number(days)
  if (n < 1) return `${Math.round(n * 24)}h`
  if (n < 10) return `${n.toFixed(1)}d`
  return `${Math.round(n)}d`
}

function formatDue(dueAt: string | null | undefined, due: boolean, reinforcement: boolean): string {
  if (reinforcement) return '同日复练'
  if (due) return '已到期'
  if (!dueAt) return '无排期'
  try {
    const d = new Date(dueAt)
    if (Number.isNaN(d.getTime())) return dueAt
    return d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
  } catch {
    return dueAt
  }
}

function progressTone(label: string): string {
  if (label === '未初始化' || label === '新学') return 'bg-muted text-muted-foreground'
  if (label === '偏弱' || label === '同日复练' || label === '内容变更') {
    return 'bg-amber-500/15 text-amber-900 dark:text-amber-100'
  }
  if (label === '很熟' || label === '较熟') return 'bg-emerald-500/15 text-emerald-900 dark:text-emerald-100'
  return 'bg-sky-500/15 text-sky-900 dark:text-sky-100'
}

export function PalaceCalibrationDrawer({
  open,
  onOpenChange,
  palaceId,
  selectedNodeUid = null,
  onApplied,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  palaceId: number
  selectedNodeUid?: string | null
  /** Called after successful apply/undo so hosts can refresh local projections. */
  onApplied?: () => void
}) {
  const [diagnose, setDiagnose] = useState<ReviewCalibrationDiagnose | null>(null)
  const [loadingDiagnose, setLoadingDiagnose] = useState(false)
  const [diagnoseError, setDiagnoseError] = useState<string | null>(null)
  const [calibrateMode, setCalibrateMode] = useState<CalibrateMode>('baseline')
  const [scopeKind, setScopeKind] = useState<ScopeKind>('palace')
  const [baselineTier, setBaselineTier] = useState<BaselineTier>('fair')
  const [sourceNodeUid, setSourceNodeUid] = useState<string | null>(null)
  const [checkedUids, setCheckedUids] = useState<Set<string>>(() => new Set())
  const [preview, setPreview] = useState<ReviewCalibrationResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [lastOperationId, setLastOperationId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const hasMapSelection = Boolean(selectedNodeUid)
  const nodes: ReviewCalibrationNodeProgress[] = diagnose?.nodes ?? []

  const openWaveWarning = useMemo(() => {
    const waves = diagnose?.waves ?? []
    return waves.some(
      (wave) =>
        wave.wave_type === 'formal_long_term' &&
        (wave.status === 'active' || wave.status === 'paused'),
    )
  }, [diagnose])

  const sourceNode = useMemo(
    () => nodes.find((n) => n.node_uid === sourceNodeUid) ?? null,
    [nodes, sourceNodeUid],
  )

  const loadDiagnose = useCallback(async () => {
    setLoadingDiagnose(true)
    setDiagnoseError(null)
    try {
      const response = await diagnosePalaceCalibrationApi(palaceId)
      setDiagnose(response.item)
    } catch (error) {
      setDiagnose(null)
      setDiagnoseError(errorMessage(error, '无法加载宫殿诊断'))
    } finally {
      setLoadingDiagnose(false)
    }
  }, [palaceId])

  useEffect(() => {
    if (!open) return
    setCalibrateMode('baseline')
    setScopeKind('palace')
    setBaselineTier('fair')
    setSourceNodeUid(selectedNodeUid ?? null)
    setCheckedUids(selectedNodeUid ? new Set([selectedNodeUid]) : new Set())
    setPreview(null)
    setActionError(null)
    // Keep lastOperationId across reopen so undo remains available in-session.
    void loadDiagnose()
    // Seed from map selection only when the drawer opens, not on every canvas click.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- selectedNodeUid read once per open
  }, [loadDiagnose, open])

  useEffect(() => {
    if (!hasMapSelection && scopeKind === 'branch') {
      setScopeKind('palace')
    }
  }, [hasMapSelection, scopeKind])

  useEffect(() => {
    // Changing scope/mode/tier/source invalidates a stale preview.
    setPreview(null)
    setActionError(null)
  }, [baselineTier, scopeKind, selectedNodeUid, calibrateMode, sourceNodeUid, checkedUids])

  const toggleChecked = useCallback((uid: string) => {
    setCheckedUids((prev) => {
      const next = new Set(prev)
      if (next.has(uid)) next.delete(uid)
      else next.add(uid)
      return next
    })
  }, [])

  const selectAllNodes = useCallback(() => {
    setCheckedUids(new Set(nodes.map((n) => n.node_uid)))
    setScopeKind('nodes')
  }, [nodes])

  const clearChecked = useCallback(() => {
    setCheckedUids(new Set())
  }, [])

  const buildPayload = useCallback(
    (operationId: string): ReviewCalibrationPayload => {
      if (calibrateMode === 'match_node') {
        const scope: Record<string, unknown> = { source_node_uid: sourceNodeUid }
        if (scopeKind === 'nodes') {
          scope.node_uids = [...checkedUids].filter((uid) => uid !== sourceNodeUid)
        } else if (scopeKind === 'branch') {
          scope.branch_uid = selectedNodeUid
        }
        return {
          operation_id: operationId,
          mode: 'match_node',
          scope_kind: scopeKind,
          scope,
          source_node_uid: sourceNodeUid ?? undefined,
          palace_revision: diagnose?.palace_revision,
        }
      }

      const scope =
        scopeKind === 'branch'
          ? { branch_uid: selectedNodeUid }
          : scopeKind === 'nodes'
            ? {
                node_uids:
                  checkedUids.size > 0
                    ? [...checkedUids]
                    : selectedNodeUid
                      ? [selectedNodeUid]
                      : [],
              }
            : {}
      return {
        operation_id: operationId,
        mode: 'baseline',
        scope_kind: scopeKind,
        scope,
        baseline_tier: baselineTier,
        palace_revision: diagnose?.palace_revision,
      }
    },
    [
      baselineTier,
      calibrateMode,
      checkedUids,
      diagnose?.palace_revision,
      scopeKind,
      selectedNodeUid,
      sourceNodeUid,
    ],
  )

  const validateBeforeAction = (): string | null => {
    if (calibrateMode === 'match_node') {
      if (!sourceNodeUid) return '请先在下方列表中指定一张模板卡片'
      if (scopeKind === 'branch' && !selectedNodeUid) return '请先在脑图中选中分支节点'
      if (scopeKind === 'nodes') {
        const targets = [...checkedUids].filter((uid) => uid !== sourceNodeUid)
        if (targets.length === 0) return '请勾选至少一张要校准的目标卡片（不含模板卡）'
      }
      return null
    }
    if (scopeKind === 'branch' && !selectedNodeUid) return '请先在脑图中选中一个节点'
    if (scopeKind === 'nodes') {
      const targets =
        checkedUids.size > 0 ? [...checkedUids] : selectedNodeUid ? [selectedNodeUid] : []
      if (targets.length === 0) return '请勾选目标卡片，或在脑图中选中节点'
    }
    return null
  }

  const handlePreview = async () => {
    const validationError = validateBeforeAction()
    if (validationError) {
      setActionError(validationError)
      return
    }
    setBusy(true)
    setActionError(null)
    try {
      const response = await previewPalaceCalibrationApi(palaceId, buildPayload(makeOperationId()))
      setPreview(response.item)
      if (response.item.palace_revision) {
        setDiagnose((prev) =>
          prev ? { ...prev, palace_revision: response.item.palace_revision! } : prev,
        )
      }
    } catch (error) {
      setPreview(null)
      setActionError(errorMessage(error, '预览失败'))
    } finally {
      setBusy(false)
    }
  }

  const handleApply = async () => {
    const validationError = validateBeforeAction()
    if (validationError) {
      setActionError(validationError)
      return
    }
    setBusy(true)
    setActionError(null)
    const operationId = makeOperationId()
    try {
      const response = await applyPalaceCalibrationApi(palaceId, buildPayload(operationId))
      setLastOperationId(response.item.operation_id || operationId)
      setPreview(null)
      const count = response.item.affected_node_count ?? 0
      toast.success(
        calibrateMode === 'match_node'
          ? `已将 ${count} 张卡片对齐到模板进度`
          : `已统一 ${count} 个节点的记忆基线`,
      )
      await loadDiagnose()
      onApplied?.()
    } catch (error) {
      setActionError(errorMessage(error, '应用校准失败'))
    } finally {
      setBusy(false)
    }
  }

  const handleUndo = async () => {
    if (!lastOperationId) return
    setBusy(true)
    setActionError(null)
    try {
      await undoPalaceCalibrationApi(palaceId, lastOperationId)
      setLastOperationId(null)
      setPreview(null)
      toast.success('已撤销上次校准')
      await loadDiagnose()
      onApplied?.()
    } catch (error) {
      setActionError(errorMessage(error, '撤销失败'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col overflow-hidden p-0 sm:max-w-lg">
        <SheetHeader className="shrink-0 border-b px-4 py-3">
          <SheetTitle>宫殿进度校准</SheetTitle>
          <SheetDescription>
            修正宫殿长期记忆进度与复习安排，不是本轮会话评分。可手动统一基线，或把多张卡对齐到某张模板卡的同一进度。
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
          <section className="space-y-2">
            <div className="text-sm font-medium">当前诊断</div>
            {loadingDiagnose ? (
              <p className="text-sm text-muted-foreground">加载中…</p>
            ) : diagnoseError ? (
              <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {diagnoseError}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="mt-2"
                  onClick={() => void loadDiagnose()}
                >
                  重试
                </Button>
              </div>
            ) : diagnose ? (
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-lg border p-2">
                  <div className="text-xs text-muted-foreground">到期</div>
                  <div className="font-medium">{diagnose.due_node_count}</div>
                </div>
                <div className="rounded-lg border p-2">
                  <div className="text-xs text-muted-foreground">逾期</div>
                  <div className="font-medium">{diagnose.overdue_node_count}</div>
                </div>
                <div className="rounded-lg border p-2">
                  <div className="text-xs text-muted-foreground">未初始化</div>
                  <div className="font-medium">{diagnose.uninitialized_node_count}</div>
                </div>
                <div className="rounded-lg border p-2">
                  <div className="text-xs text-muted-foreground">内容变更</div>
                  <div className="font-medium">{diagnose.content_changed_node_count}</div>
                </div>
                <div className="col-span-2 rounded-lg border p-2">
                  <div className="text-xs text-muted-foreground">正式波次</div>
                  <div className="font-medium">
                    {diagnose.wave_count} 个
                    {diagnose.date_spread_days > 0
                      ? ` · 日期跨度 ${diagnose.date_spread_days} 天`
                      : ''}
                    {diagnose.formal_wave_dates.length
                      ? ` · ${diagnose.formal_wave_dates.slice(0, 4).join('、')}${
                          diagnose.formal_wave_dates.length > 4 ? '…' : ''
                        }`
                      : ''}
                  </div>
                </div>
              </div>
            ) : null}
            {openWaveWarning ? (
              <div
                role="status"
                className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-100"
              >
                当前有进行中或已暂停的正式波次。校准可能把节点移出波次，进行中的会话状态可能变脏。
              </div>
            ) : null}
          </section>

          <section className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-medium">各卡片进度</div>
              <div className="flex gap-1">
                <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={selectAllNodes}>
                  全选
                </Button>
                <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={clearChecked}>
                  清空勾选
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              勾选目标卡；点「模板」指定对齐来源。稳定度与到期日帮助你判断要不要校准。
            </p>
            {loadingDiagnose ? null : nodes.length === 0 ? (
              <p className="text-sm text-muted-foreground">暂无节点进度数据</p>
            ) : (
              <ul className="max-h-[min(42vh,22rem)] space-y-1.5 overflow-y-auto rounded-lg border p-1.5">
                {nodes.map((node) => {
                  const checked = checkedUids.has(node.node_uid)
                  const isSource = sourceNodeUid === node.node_uid
                  const isMapSelected = selectedNodeUid === node.node_uid
                  return (
                    <li
                      key={node.node_uid}
                      className={cn(
                        'flex items-start gap-2 rounded-md border border-transparent px-2 py-1.5',
                        isSource && 'border-primary/40 bg-primary/5',
                        isMapSelected && !isSource && 'bg-muted/40',
                      )}
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => {
                          toggleChecked(node.node_uid)
                          if (scopeKind === 'palace') setScopeKind('nodes')
                        }}
                        aria-label={`选择 ${node.text}`}
                        className="mt-1"
                      />
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left"
                        onClick={() => {
                          toggleChecked(node.node_uid)
                          if (scopeKind === 'palace') setScopeKind('nodes')
                        }}
                      >
                        <div className="truncate text-sm font-medium leading-snug">{node.text}</div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                          <Badge
                            variant="secondary"
                            className={cn('h-5 px-1.5 text-[10px] font-medium', progressTone(node.progress_label))}
                          >
                            {node.progress_label}
                          </Badge>
                          <span>S {formatStability(node.stability_days)}</span>
                          <span>·</span>
                          <span>{formatDue(node.due_at, node.due, node.reinforcement_due)}</span>
                          {typeof node.retrievability === 'number' ? (
                            <>
                              <span>·</span>
                              <span>R {Math.round(node.retrievability * 100)}%</span>
                            </>
                          ) : null}
                        </div>
                      </button>
                      <Button
                        type="button"
                        size="sm"
                        variant={isSource ? 'default' : 'outline'}
                        className="h-7 shrink-0 px-2 text-[11px]"
                        onClick={() => {
                          setSourceNodeUid(node.node_uid)
                          setCalibrateMode('match_node')
                        }}
                      >
                        {isSource ? '模板' : '设模板'}
                      </Button>
                    </li>
                  )
                })}
              </ul>
            )}
            {sourceNode ? (
              <div className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs">
                模板卡：
                <span className="font-medium text-foreground"> {sourceNode.text} </span>
                <span className="text-muted-foreground">
                  · {sourceNode.progress_label} · S {formatStability(sourceNode.stability_days)}
                </span>
              </div>
            ) : null}
          </section>

          <section className="space-y-2">
            <div className="text-sm font-medium">校准方式</div>
            <RadioGroup
              value={calibrateMode}
              onValueChange={(value) => setCalibrateMode(value as CalibrateMode)}
              className="gap-2"
            >
              <label className="flex cursor-pointer items-center gap-2 rounded-lg border p-2">
                <RadioGroupItem value="baseline" id="cal-mode-baseline" />
                <div>
                  <Label htmlFor="cal-mode-baseline" className="cursor-pointer">
                    手动统一基线
                  </Label>
                  <div className="text-xs text-muted-foreground">按新卡/偏弱/一般/很熟写入标准进度</div>
                </div>
              </label>
              <label className="flex cursor-pointer items-center gap-2 rounded-lg border p-2">
                <RadioGroupItem value="match_node" id="cal-mode-match" />
                <div>
                  <Label htmlFor="cal-mode-match" className="cursor-pointer">
                    对齐到模板卡
                  </Label>
                  <div className="text-xs text-muted-foreground">
                    把目标卡写成与模板卡相同的记忆进度（稳定度 / 难度 / 到期节奏）
                  </div>
                </div>
              </label>
            </RadioGroup>
          </section>

          <section className="space-y-2">
            <div className="text-sm font-medium">范围</div>
            <RadioGroup
              value={scopeKind}
              onValueChange={(value) => setScopeKind(value as ScopeKind)}
              className="gap-2"
            >
              <label className="flex cursor-pointer items-center gap-2 rounded-lg border p-2">
                <RadioGroupItem value="palace" id="cal-scope-palace" />
                <div>
                  <Label htmlFor="cal-scope-palace" className="cursor-pointer">
                    整宫 / 全部
                  </Label>
                  <div className="text-xs text-muted-foreground">
                    {calibrateMode === 'match_node'
                      ? '所有可调度节点（自动排除模板卡）'
                      : '所有可调度节点'}
                  </div>
                </div>
              </label>
              <label
                className={`flex items-center gap-2 rounded-lg border p-2 ${
                  hasMapSelection ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'
                }`}
              >
                <RadioGroupItem value="branch" id="cal-scope-branch" disabled={!hasMapSelection} />
                <div>
                  <Label
                    htmlFor="cal-scope-branch"
                    className={hasMapSelection ? 'cursor-pointer' : 'cursor-not-allowed'}
                  >
                    当前分支
                  </Label>
                  <div className="text-xs text-muted-foreground">
                    {hasMapSelection ? `含 ${selectedNodeUid} 及其子节点` : '先在脑图选中节点'}
                  </div>
                </div>
              </label>
              <label className="flex cursor-pointer items-center gap-2 rounded-lg border p-2">
                <RadioGroupItem value="nodes" id="cal-scope-nodes" />
                <div>
                  <Label htmlFor="cal-scope-nodes" className="cursor-pointer">
                    勾选的卡片
                  </Label>
                  <div className="text-xs text-muted-foreground">
                    {checkedUids.size > 0
                      ? `已勾选 ${checkedUids.size} 张${
                          calibrateMode === 'match_node' && sourceNodeUid && checkedUids.has(sourceNodeUid)
                            ? '（应用时会排除模板卡）'
                            : ''
                        }`
                      : hasMapSelection
                        ? `未勾选时回退到脑图选中：${selectedNodeUid}`
                        : '在上方列表勾选目标卡'}
                  </div>
                </div>
              </label>
            </RadioGroup>
          </section>

          {calibrateMode === 'baseline' ? (
            <section className="space-y-2">
              <div className="text-sm font-medium">统一记忆基线</div>
              <RadioGroup
                value={baselineTier}
                onValueChange={(value) => setBaselineTier(value as BaselineTier)}
                className="gap-2"
              >
                {BASELINE_OPTIONS.map((option) => (
                  <label
                    key={option.value}
                    className="flex cursor-pointer items-center gap-2 rounded-lg border p-2"
                  >
                    <RadioGroupItem value={option.value} id={`cal-tier-${option.value}`} />
                    <div>
                      <Label htmlFor={`cal-tier-${option.value}`} className="cursor-pointer">
                        {option.label}
                      </Label>
                      <div className="text-xs text-muted-foreground">{option.hint}</div>
                    </div>
                  </label>
                ))}
              </RadioGroup>
            </section>
          ) : null}

          {preview ? (
            <div className="rounded-lg border bg-muted/30 px-3 py-2 text-sm">
              预览将影响 <b>{preview.affected_node_count}</b> 个节点
              {preview.mode === 'match_node' && sourceNode
                ? `（对齐到「${sourceNode.text}」）`
                : preview.baseline_tier
                  ? `（基线：${preview.baseline_tier}）`
                  : ''}
            </div>
          ) : null}

          {actionError ? (
            <div
              role="alert"
              className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {actionError}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2 pb-2">
            <Button type="button" variant="outline" disabled={busy} onClick={() => void handlePreview()}>
              预览
            </Button>
            <Button type="button" disabled={busy} onClick={() => void handleApply()}>
              {preview ? '确认应用' : '应用'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={busy || !lastOperationId}
              onClick={() => void handleUndo()}
            >
              撤销本次
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
