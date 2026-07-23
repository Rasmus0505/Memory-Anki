import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReviewCalibrationDiagnose } from '@/shared/api/contracts'
import { Button } from '@/shared/components/ui/button'
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
import {
  applyPalaceCalibrationApi,
  diagnosePalaceCalibrationApi,
  previewPalaceCalibrationApi,
  undoPalaceCalibrationApi,
  type ReviewCalibrationResult,
} from '@/modules/practice/ui/review/api'

type BaselineTier = 'new' | 'weak' | 'fair' | 'strong'
type ScopeKind = 'palace' | 'branch' | 'nodes'

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
  const [scopeKind, setScopeKind] = useState<ScopeKind>('palace')
  const [baselineTier, setBaselineTier] = useState<BaselineTier>('fair')
  const [preview, setPreview] = useState<ReviewCalibrationResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [lastOperationId, setLastOperationId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const hasSelection = Boolean(selectedNodeUid)

  const openWaveWarning = useMemo(() => {
    const waves = diagnose?.waves ?? []
    return waves.some(
      (wave) =>
        wave.wave_type === 'formal_long_term' &&
        (wave.status === 'active' || wave.status === 'paused'),
    )
  }, [diagnose])

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
    setScopeKind('palace')
    setBaselineTier('fair')
    setPreview(null)
    setActionError(null)
    // Keep lastOperationId across reopen so undo remains available in-session.
    void loadDiagnose()
  }, [loadDiagnose, open])

  useEffect(() => {
    if (!hasSelection && scopeKind !== 'palace') {
      setScopeKind('palace')
    }
  }, [hasSelection, scopeKind])

  useEffect(() => {
    // Changing scope/tier invalidates a stale preview.
    setPreview(null)
    setActionError(null)
  }, [baselineTier, scopeKind, selectedNodeUid])

  const buildPayload = useCallback(
    (operationId: string) => {
      const scope =
        scopeKind === 'branch'
          ? { branch_uid: selectedNodeUid }
          : scopeKind === 'nodes'
            ? { node_uids: selectedNodeUid ? [selectedNodeUid] : [] }
            : {}
      return {
        operation_id: operationId,
        mode: 'baseline' as const,
        scope_kind: scopeKind,
        scope,
        baseline_tier: baselineTier,
        palace_revision: diagnose?.palace_revision,
      }
    },
    [baselineTier, diagnose?.palace_revision, scopeKind, selectedNodeUid],
  )

  const handlePreview = async () => {
    if (scopeKind !== 'palace' && !selectedNodeUid) {
      setActionError('请先在脑图中选中一个节点')
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
    if (scopeKind !== 'palace' && !selectedNodeUid) {
      setActionError('请先在脑图中选中一个节点')
      return
    }
    setBusy(true)
    setActionError(null)
    const operationId = makeOperationId()
    try {
      const response = await applyPalaceCalibrationApi(palaceId, buildPayload(operationId))
      setLastOperationId(response.item.operation_id || operationId)
      setPreview(null)
      toast.success(`已统一 ${response.item.affected_node_count ?? 0} 个节点的记忆基线`)
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
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>宫殿进度校准</SheetTitle>
          <SheetDescription>
            修正宫殿长期记忆进度与复习安排，不是本轮会话评分。改错后可用「撤销本次」。
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-5 p-4">

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
                    整宫
                  </Label>
                  <div className="text-xs text-muted-foreground">所有可调度节点</div>
                </div>
              </label>
              <label
                className={`flex items-center gap-2 rounded-lg border p-2 ${
                  hasSelection ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'
                }`}
              >
                <RadioGroupItem value="branch" id="cal-scope-branch" disabled={!hasSelection} />
                <div>
                  <Label
                    htmlFor="cal-scope-branch"
                    className={hasSelection ? 'cursor-pointer' : 'cursor-not-allowed'}
                  >
                    当前分支
                  </Label>
                  <div className="text-xs text-muted-foreground">
                    {hasSelection ? `含 ${selectedNodeUid} 及其子节点` : '先在脑图选中节点'}
                  </div>
                </div>
              </label>
              <label
                className={`flex items-center gap-2 rounded-lg border p-2 ${
                  hasSelection ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'
                }`}
              >
                <RadioGroupItem value="nodes" id="cal-scope-nodes" disabled={!hasSelection} />
                <div>
                  <Label
                    htmlFor="cal-scope-nodes"
                    className={hasSelection ? 'cursor-pointer' : 'cursor-not-allowed'}
                  >
                    选中节点
                  </Label>
                  <div className="text-xs text-muted-foreground">
                    {hasSelection ? `仅 ${selectedNodeUid}` : '先在脑图选中节点'}
                  </div>
                </div>
              </label>
            </RadioGroup>
          </section>

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

          {preview ? (
            <div className="rounded-lg border bg-muted/30 px-3 py-2 text-sm">
              预览将影响 <b>{preview.affected_node_count}</b> 个节点
              {preview.baseline_tier ? `（基线：${preview.baseline_tier}）` : ''}
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

          <div className="flex flex-wrap gap-2">
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
