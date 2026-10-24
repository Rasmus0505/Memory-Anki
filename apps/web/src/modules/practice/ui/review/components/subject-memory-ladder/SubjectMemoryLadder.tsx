import { useMemo, useState, type KeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  MEMORY_LADDER_STAGE_COUNT,
  formatReviewDate,
  nodeScale,
  stageLabel,
  type SubjectMemoryLadderKey,
  type SubjectMemoryLadderStage,
} from './model'
import { useSubjectMemoryLadder } from './useSubjectMemoryLadder'
import './subject-memory-ladder.css'

const FALLBACK_LADDER = [0, 1, 3, 7, 14, 30, 60, 120, 240, 365] as const
const BAR_MAX_HEIGHT = 34

function reviewStagePath(palaceIds: readonly number[]): string {
  return `/freestyle?palaceIds=${palaceIds.join(',')}`
}

function Thumb({
  stages,
  label,
}: {
  stages: SubjectMemoryLadderStage[]
  label: string
}) {
  const max = Math.max(1, ...stages.map((stage) => stage.palace_count))
  return (
    <div className="sml sml-thumb" role="img" aria-label={label}>
      {Array.from({ length: MEMORY_LADDER_STAGE_COUNT }, (_, index) => {
        const stage = stages[index]
        const count = stage?.palace_count ?? 0
        return (
          <span
            key={index}
            className="sml-dot"
            data-empty={count === 0}
            data-overdue={Boolean(stage && stage.overdue_palace_count > 0)}
            style={{ transform: `scaleY(${nodeScale(count, max)})` }}
          />
        )
      })}
    </div>
  )
}

export interface SubjectMemoryLadderProps {
  subjectKey: SubjectMemoryLadderKey
  variant: 'thumb' | 'full'
  /**
   * 受控的当前间隔段；`null` 表示“全部宫殿”。
   * 传了 `onStageSelect` 即进入受控模式，由外层决定筛选后的内容。
   */
  selectedStageIndex?: number | null
  /** 点间隔段（含再点一次取消）时回调；返回 `null` 表示取消筛选。 */
  onStageSelect?: (stageIndex: number | null) => void
}

export function SubjectMemoryLadder({
  subjectKey,
  variant,
  selectedStageIndex,
  onStageSelect,
}: SubjectMemoryLadderProps) {
  const navigate = useNavigate()
  const { subject, stages, data, isError, isPending, refetch } = useSubjectMemoryLadder(subjectKey)
  const [picked, setPicked] = useState<number | null>(null)
  const controlled = onStageSelect != null
  const activeIndex = controlled ? selectedStageIndex ?? null : picked
  const stage = activeIndex == null ? null : stages[activeIndex] ?? null
  const max = Math.max(1, ...stages.map((item) => item.palace_count))
  const rack = data?.ladder ?? FALLBACK_LADDER
  const summary = useMemo(() => {
    if (!subject) return '这一科还没有进入记忆复习的宫殿'
    if (subject.palace_count === 0) return '这一科还没有进入记忆复习的宫殿'
    const overdue = subject.stages.reduce((sum, item) => sum + item.overdue_palace_count, 0)
    return overdue > 0
      ? `${subject.palace_count} 座宫殿在档，${overdue} 座有逾期`
      : `${subject.palace_count} 座宫殿在档`
  }, [subject])

  if (variant === 'thumb') {
    return <Thumb stages={stages} label={isError ? '记忆间隔暂时读不到' : summary} />
  }

  const commit = (next: number | null) => {
    if (onStageSelect) onStageSelect(next)
    else setPicked(next)
  }
  const selectStep = (index: number) => {
    commit(index === activeIndex ? null : index)
  }
  const onStepKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next: number | null | undefined
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      next = Math.min(MEMORY_LADDER_STAGE_COUNT - 1, index + 1)
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      next = Math.max(0, index - 1)
    } else if (event.key === 'Home') {
      next = 0
    } else if (event.key === 'End') {
      next = MEMORY_LADDER_STAGE_COUNT - 1
    } else if (event.key === 'Escape') {
      next = null
    }
    if (next === undefined) return
    event.preventDefault()
    commit(next)
    if (next != null) {
      const steps = event.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[role="radio"]')
      steps?.[next]?.focus()
    }
  }

  const totalUnits = subject?.stages.reduce((sum, item) => sum + item.unit_count, 0) ?? 0
  const earliest = stage?.palaces[0]

  return (
    <section className="sml sml-full" aria-label="记忆间隔">
      <div className="sml-full-head">
        <span className="sml-kicker">记忆间隔</span>
        <div className="sml-head-right">
          <span className="sml-stage-name" data-active={stage != null}>
            {stage ? stageLabel(stage.interval_days) : '全部宫殿'}
          </span>
          {stage ? (
            <button
              type="button"
              className="sml-clear"
              aria-label="取消间隔段选中，显示全部"
              onClick={() => commit(null)}
            >
              全部
            </button>
          ) : null}
        </div>
      </div>

      {isError ? (
        <p className="sml-status" role="status">
          记忆间隔暂时读不到。
          <button type="button" className="sml-link" onClick={() => void refetch()}>重新加载</button>
        </p>
      ) : isPending ? (
        <p className="sml-status" role="status">正在读取记忆间隔…</p>
      ) : (
        <>
          <div
            className="sml-scale"
            role="radiogroup"
            aria-label="记忆间隔"
            data-filtering={controlled}
          >
            <span
              className="sml-glow"
              aria-hidden="true"
              data-visible={activeIndex != null}
              style={{ transform: `translateX(${(activeIndex ?? 0) * 100}%)` }}
            />
            {Array.from({ length: MEMORY_LADDER_STAGE_COUNT }, (_, index) => {
              const item = stages[index]
              const count = item?.palace_count ?? 0
              const overdue = Boolean(item && item.overdue_palace_count > 0)
              const intervalDays = item?.interval_days ?? rack[index] ?? 0
              const selected = index === activeIndex
              return (
                <button
                  key={index}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={`${stageLabel(intervalDays)}，${count} 座宫殿${overdue ? '，有逾期' : ''}`}
                  tabIndex={index === (activeIndex ?? 0) ? 0 : -1}
                  className="sml-step"
                  data-empty={count === 0}
                  data-overdue={overdue}
                  data-selected={selected}
                  onClick={() => selectStep(index)}
                  onKeyDown={(event) => onStepKeyDown(event, index)}
                >
                  <span className="sml-step-rail" aria-hidden="true">
                    <span
                      className="sml-bar"
                      style={{ height: Math.round(nodeScale(count, max) * BAR_MAX_HEIGHT) }}
                    />
                  </span>
                  <span className="sml-step-label">{stageLabel(intervalDays)}</span>
                </button>
              )
            })}
          </div>

          <div className="sml-summary-row">
            <p className="sml-summary" aria-live="polite">
              {stage ? (
                <>
                  <strong>{stage.palace_count} 座宫殿</strong>
                  <span> · {stage.unit_count} 个记忆单元</span>
                  <span> · 最早 {earliest ? formatReviewDate(earliest.due_date, earliest.overdue, earliest.due_today) : '—'}</span>
                </>
              ) : (
                <>
                  <strong>{subject?.palace_count ?? 0} 座宫殿</strong>
                  <span> · {totalUnits} 个记忆单元</span>
                </>
              )}
            </p>
            {stage && stage.palaces.length > 0 ? (
              <button
                type="button"
                className="sml-review"
                onClick={() => navigate(reviewStagePath(stage.palaces.map((palace) => palace.palace_id)))}
              >
                复习这一段
              </button>
            ) : null}
          </div>
          <p className="sml-hint">
            {controlled
              ? stage
                ? '筛选只影响下方显示；章节题目占比仍按整本书计算。'
                : '点任意间隔段，下方章节只保留这一段的宫殿。'
              : stage
                ? '再点一次同一个间隔段可以取消选中。'
                : '点间隔段，查看这一段的宫殿数量和最近复习日期。'}
          </p>
        </>
      )}
    </section>
  )
}
