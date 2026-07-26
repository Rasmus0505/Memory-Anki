import { useCallback, useEffect, useState } from 'react'
import type { PalaceAggregationMove, PalaceReviewScheduleSettings } from '@/shared/api/contracts'
import {
  applyPalaceAggregationApi,
  clearPalaceAggregationApi,
  getPalaceReviewScheduleSettingsApi,
  previewPalaceAggregationApi,
  updatePalaceReviewScheduleSettingsApi,
} from '@/modules/practice/ui/review/api/scheduleInsightApi'
import { Button } from '@/shared/components/ui/button'
import { Switch } from '@/shared/components/ui/switch'
import { toast } from '@/shared/feedback/toast'

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) return error.message
  return fallback
}

function formatLocalDate(value: string): string {
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}

/**
 * 宫殿"聚合复习日"设置区块：开关（PUT settings）+ 预览/应用/清除。
 * 关闭聚合时后端自动清除已聚合日期。
 */
export function PalaceAggregationSettingsSection({
  palaceId,
  onChanged,
}: {
  palaceId: number
  /** Called after apply/clear/disable so hosts can refresh schedule views. */
  onChanged?: () => void
}) {
  const [settings, setSettings] = useState<PalaceReviewScheduleSettings | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [moves, setMoves] = useState<PalaceAggregationMove[] | null>(null)

  useEffect(() => {
    let active = true
    setSettings(null)
    setMoves(null)
    setLoadError(null)
    getPalaceReviewScheduleSettingsApi(palaceId)
      .then((response) => {
        if (active) setSettings(response.item)
      })
      .catch((error) => {
        if (active) setLoadError(errorMessage(error, '无法加载聚合设置'))
      })
    return () => {
      active = false
    }
  }, [palaceId])

  const handleToggle = useCallback(
    async (enabled: boolean) => {
      setBusy(true)
      try {
        const response = await updatePalaceReviewScheduleSettingsApi(palaceId, {
          aggregation_enabled: enabled,
        })
        setSettings(response.item)
        setMoves(null)
        if (!enabled) {
          toast.success('已关闭聚合复习日，已聚合日期已恢复原定到期')
          onChanged?.()
        } else {
          toast.success('已开启聚合复习日')
        }
      } catch (error) {
        toast.error(errorMessage(error, '保存聚合设置失败'))
      } finally {
        setBusy(false)
      }
    },
    [onChanged, palaceId],
  )

  const handlePreview = useCallback(async () => {
    setBusy(true)
    try {
      const response = await previewPalaceAggregationApi(palaceId)
      setMoves(response.item.moves)
      if (response.item.moves.length === 0) {
        toast.message('近期没有可聚合的到期卡片')
      }
    } catch (error) {
      toast.error(errorMessage(error, '预览聚合失败'))
    } finally {
      setBusy(false)
    }
  }, [palaceId])

  const handleApply = useCallback(async () => {
    setBusy(true)
    try {
      const response = await applyPalaceAggregationApi(palaceId)
      toast.success(`已聚合 ${response.item.applied_count ?? response.item.moves.length} 张卡片的复习日`)
      setMoves(null)
      onChanged?.()
    } catch (error) {
      toast.error(errorMessage(error, '应用聚合失败'))
    } finally {
      setBusy(false)
    }
  }, [onChanged, palaceId])

  const handleClear = useCallback(async () => {
    setBusy(true)
    try {
      const response = await clearPalaceAggregationApi(palaceId)
      toast.success(`已清除 ${response.item.cleared_count} 张卡片的聚合日期`)
      setMoves(null)
      onChanged?.()
    } catch (error) {
      toast.error(errorMessage(error, '清除聚合失败'))
    } finally {
      setBusy(false)
    }
  }, [onChanged, palaceId])

  return (
    <section className="space-y-2" data-testid="palace-aggregation-settings">
      <div className="text-sm font-medium">聚合复习日</div>
      {loadError ? (
        <p className="text-sm text-destructive">{loadError}</p>
      ) : !settings ? (
        <p className="text-sm text-muted-foreground">正在加载聚合设置…</p>
      ) : (
        <>
          <label className="flex items-center justify-between gap-3 rounded-lg border p-3">
            <div>
              <div className="text-sm font-medium">把零散到期日聚合到同一天</div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                同一宫殿的卡片尽量集中在一天复习，减少天天开宫殿的碎片感；轻微牺牲部分卡的保持率。
              </div>
            </div>
            <Switch
              checked={settings.aggregation_enabled}
              disabled={busy}
              onCheckedChange={(checked) => void handleToggle(checked)}
              aria-label="聚合复习日开关"
            />
          </label>
          {settings.aggregation_enabled ? (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void handlePreview()}>
                  预览聚合
                </Button>
                <Button type="button" size="sm" disabled={busy || !moves?.length} onClick={() => void handleApply()}>
                  应用
                </Button>
                <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => void handleClear()}>
                  清除聚合
                </Button>
              </div>
              {moves && moves.length > 0 ? (
                <ul className="max-h-44 space-y-1 overflow-y-auto rounded-lg border p-1.5 text-xs">
                  {moves.map((move) => (
                    <li
                      key={move.node_uid}
                      className="flex items-center justify-between gap-2 rounded px-2 py-1 odd:bg-muted/30"
                    >
                      <span className="truncate text-muted-foreground">{move.node_uid}</span>
                      <span className="shrink-0 tabular-nums">
                        原定 {formatLocalDate(move.raw_due_local)} → 聚合到 {formatLocalDate(move.target_local)}
                        <span className="ml-1 text-muted-foreground">
                          保持率损失 {move.retention_drop_pp.toFixed(1)} pp
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </section>
  )
}
