import * as React from 'react'
import type { ReviewStageSummary } from '@/shared/api/contracts'
import {
  formatApiDateTime,
  formatDateTimeLocalValue,
  formatLocalDateTimeInputValue,
  parseApiDateTime,
} from '@/shared/lib/dateTime'
import { cn } from '@/shared/lib/utils'

const SEGMENT_UNITS = 12
const PROGRESS_TICK_MS = 5 * 1000
const palaceStageClockSubscribers = new Set<() => void>()
let palaceStageClockTimer: number | null = null
let palaceStageClockNowMs = Date.now()

function subscribePalaceStageClock(onTick: () => void) {
  palaceStageClockSubscribers.add(onTick)
  palaceStageClockNowMs = Date.now()
  if (palaceStageClockTimer == null) {
    palaceStageClockTimer = window.setInterval(() => {
      palaceStageClockNowMs = Date.now()
      palaceStageClockSubscribers.forEach((subscriber) => subscriber())
    }, PROGRESS_TICK_MS)
  }
  return () => {
    palaceStageClockSubscribers.delete(onTick)
    if (palaceStageClockSubscribers.size === 0 && palaceStageClockTimer != null) {
      window.clearInterval(palaceStageClockTimer)
      palaceStageClockTimer = null
    }
  }
}

function getPalaceStageClockSnapshot() {
  return palaceStageClockNowMs
}

function usePalaceStageClock(enabled: boolean) {
  return React.useSyncExternalStore(
    enabled ? subscribePalaceStageClock : () => () => {},
    getPalaceStageClockSnapshot,
    getPalaceStageClockSnapshot,
  )
}

function getSegmentProgress(
  previousStage: ReviewStageSummary,
  nextStage: ReviewStageSummary,
  nowMs: number,
  nextReviewAt?: string | null,
): number {
  const startValue = previousStage.completed_at ?? previousStage.scheduled_at
  const endValue = nextStage.scheduled_at ?? nextStage.completed_at ?? nextReviewAt
  const startMs = parseApiDateTime(startValue).getTime()
  const endMs = parseApiDateTime(endValue).getTime()
  if (Number.isNaN(endMs)) {
    return 0
  }
  if (Number.isNaN(startMs) || endMs <= startMs) {
    return nowMs >= endMs ? 1 : 0
  }
  const ratio = (nowMs - startMs) / (endMs - startMs)
  const clampedRatio = Math.max(0, Math.min(ratio, 1))
  const segmentUnits = Math.floor(clampedRatio * SEGMENT_UNITS)
  return Math.max(0, Math.min(segmentUnits / SEGMENT_UNITS, 1))
}

export function formatStageDateTime(value: string | null): string {
  return value ? formatApiDateTime(value) : '未记录具体时间'
}

export function toDateTimeLocalValue(value?: string | null): string {
  return value ? formatLocalDateTimeInputValue(value) : formatDateTimeLocalValue(new Date()).slice(0, 16)
}

function getStageTooltip(stage: ReviewStageSummary): string {
  if (stage.completed) {
    return `${stage.label} · 完成于 ${formatStageDateTime(stage.completed_at)}`
  }
  return `${stage.label} · 预计 ${formatStageDateTime(stage.scheduled_at)}`
}

export function PalaceStageProgress({
  stageLabels,
  completed,
  stages,
  nextReviewAt,
  onStageClick,
}: {
  stageLabels: string[]
  completed: number
  stages?: ReviewStageSummary[]
  nextReviewAt?: string | null
  onStageClick?: (stage: ReviewStageSummary) => void
}) {
  const hasCompleteBackendStages = Boolean(stages?.length) && stages!.length === stageLabels.length
  const normalizedStages = hasCompleteBackendStages
    ? stages!
    : stageLabels.map((label, index) => ({
        review_number: index,
        label,
        completed: index < completed,
        completed_at: null,
        scheduled_at: null,
      }))
  const total = normalizedStages.length
  const lastCompletedIndex = normalizedStages.reduce(
    (lastIndex, stage, index) => (stage.completed ? index : lastIndex),
    -1,
  )
  const shouldAnimateProgress = lastCompletedIndex >= 0 && lastCompletedIndex < total - 1
  const nowMs = usePalaceStageClock(shouldAnimateProgress)

  const stageMetrics = React.useMemo(() => {
    if (total === 1) {
      const onlyStage = normalizedStages[0]
      return {
        fillPercent: onlyStage?.completed ? 100 : 0,
      }
    }
    if (lastCompletedIndex < 0) {
      return {
        fillPercent: 0,
      }
    }

    if (lastCompletedIndex >= total - 1) {
      return {
        fillPercent: 100,
      }
    }

    const previousStage = normalizedStages[lastCompletedIndex]
    const nextStage = normalizedStages[lastCompletedIndex + 1]
    const segmentStart = (lastCompletedIndex / (total - 1)) * 100
    const segmentEnd = ((lastCompletedIndex + 1) / (total - 1)) * 100
    const segmentProgress = getSegmentProgress(previousStage, nextStage, nowMs, nextReviewAt)
    const fillPercent = Math.min(
      segmentStart + (segmentEnd - segmentStart) * segmentProgress,
      segmentEnd,
    )

    return {
      fillPercent,
    }
  }, [lastCompletedIndex, nextReviewAt, normalizedStages, nowMs, total])

  if (total <= 0) {
    return null
  }

  return (
    <div className="mt-3">
      <div className="relative h-4">
	        <div className="absolute left-0 right-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-border" data-testid="stage-track" />
	        <div
	          className="absolute left-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-info transition-[width]"
          data-testid="stage-track-fill"
          style={{ width: `${stageMetrics.fillPercent}%` }}
        />
        <div className="absolute inset-0 flex items-center justify-between">
          {normalizedStages.map((stage, index) => {
            const active = stage.completed
            return (
              <button
                key={stage.review_number}
                type="button"
                title={getStageTooltip(stage)}
                aria-label={`${stage.label}，${stage.completed ? '已完成' : '未完成'}，点击调整宫殿复习进度`}
                onClick={() => onStageClick?.(stage)}
                disabled={!onStageClick}
                data-testid={`stage-node-${index}`}
                className={cn(
                  'group -mx-[9px] flex h-8 w-8 items-center justify-center rounded-full',
                  onStageClick && 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  active ? '[&>span]:bg-info' : '[&>span]:bg-muted-foreground/30',
                )}
              >
                <span
                  className={cn(
                    'h-3.5 w-3.5 rounded-full border-2 border-background shadow-sm transition-transform',
                    onStageClick && 'group-hover:scale-110',
                    active ? 'bg-info' : 'bg-muted-foreground/30',
                  )}
                />
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
