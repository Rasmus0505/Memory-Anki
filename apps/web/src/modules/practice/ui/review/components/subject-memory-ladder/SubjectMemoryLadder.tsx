import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  getSubjectMemoryLadderApi,
  SUBJECT_MEMORY_LADDER_QUERY_KEY,
} from './api'
import {
  MEMORY_LADDER_STAGE_COUNT,
  defaultStageIndex,
  findSubjectLadder,
  formatReviewDate,
  nodeScale,
  stageLabel,
  type SubjectMemoryLadderKey,
  type SubjectMemoryLadderStage,
} from './model'
import './subject-memory-ladder.css'

function reviewPalacePath(palaceId: number, subjectKey: SubjectMemoryLadderKey): string {
  if (typeof subjectKey !== 'number') return `/palaces/${palaceId}/review`
  return `/palaces/${palaceId}/review?subjectId=${subjectKey}`
}

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

export function SubjectMemoryLadder({
  subjectKey,
  variant,
}: {
  subjectKey: SubjectMemoryLadderKey
  variant: 'thumb' | 'full'
}) {
  const navigate = useNavigate()
  const result = useQuery({
    queryKey: SUBJECT_MEMORY_LADDER_QUERY_KEY,
    queryFn: getSubjectMemoryLadderApi,
    staleTime: 30_000,
  })
  const subject = findSubjectLadder(result.data, subjectKey)
  const stages = subject?.stages ?? []
  const opening = defaultStageIndex(stages)
  const [picked, setPicked] = useState<number | null>(null)
  const stageIndex = stages.some((stage) => stage.stage_index === picked) ? picked ?? opening : opening
  const stage = stages[stageIndex]
  const max = Math.max(1, ...stages.map((item) => item.palace_count))
  const summary = useMemo(() => {
    if (!subject) return '这一科还没有进入记忆档位的宫殿'
    const overdue = subject.stages.reduce((sum, item) => sum + item.overdue_palace_count, 0)
    if (subject.palace_count === 0) return '这一科还没有进入记忆档位的宫殿'
    return overdue > 0 ? `${subject.palace_count} 座宫殿在档，${overdue} 座有逾期` : `${subject.palace_count} 座宫殿在档`
  }, [subject])

  if (variant === 'thumb') {
    return <Thumb stages={stages} label={result.isError ? '记忆档位暂时读不到' : summary} />
  }

  const selected = stage ?? {
    stage_index: 0,
    interval_days: 0,
    palace_count: 0,
    unit_count: 0,
    overdue_palace_count: 0,
    palaces: [],
  }
  const earliest = selected.palaces[0]

  return (
    <section className="sml sml-full" aria-label="记忆档位">
      <div className="sml-full-head">
        <span className="sml-kicker">记忆档位</span>
        <span className="sml-stage-name">{stageLabel(selected.interval_days)}</span>
      </div>
      {result.isError ? (
        <p className="sml-status" role="status">
          记忆档位暂时读不到。
          <button type="button" className="underline underline-offset-4" onClick={() => void result.refetch()}>重新加载</button>
        </p>
      ) : result.isPending ? (
        <p className="sml-status" role="status">正在读取记忆档位…</p>
      ) : (
        <>
          <div className="sml-track" aria-hidden="true">
            {Array.from({ length: MEMORY_LADDER_STAGE_COUNT }, (_, index) => {
              const item = stages[index]
              const count = item?.palace_count ?? 0
              return (
                <button
                  key={index}
                  type="button"
                  className="sml-node"
                  onClick={() => setPicked(index)}
                  aria-label={stageLabel(item?.interval_days ?? 0)}
                >
                  <span
                    className="sml-dot"
                    data-empty={count === 0}
                    data-overdue={Boolean(item && item.overdue_palace_count > 0)}
                    data-selected={index === stageIndex}
                    style={{ height: 16, transform: `scaleY(${nodeScale(count, max)})` }}
                  />
                </button>
              )
            })}
          </div>
          <input
            className="sml-range"
            type="range"
            min={0}
            max={MEMORY_LADDER_STAGE_COUNT - 1}
            step={1}
            value={stageIndex}
            aria-label="拨动记忆档位"
            aria-valuetext={`${stageLabel(selected.interval_days)}，${selected.palace_count} 座宫殿`}
            onChange={(event) => setPicked(Number(event.target.value))}
          />
          <div className="sml-labels" aria-hidden="true">
            {(result.data?.ladder ?? [0, 1, 3, 7, 14, 30, 60, 120, 240, 365]).map((days, index) => (
              <span key={days} data-selected={index === stageIndex}>{stageLabel(days)}</span>
            ))}
          </div>
          <p className="sml-summary">
            {selected.palace_count === 0
              ? '这一档还没有宫殿。'
              : <><strong>{selected.palace_count} 座宫殿</strong> · {selected.unit_count} 个记忆单元 · 最早 {earliest ? formatReviewDate(earliest.due_date, earliest.overdue, earliest.due_today) : '—'}</>}
          </p>
          {selected.palace_count > 0 && (
            <div className="sml-list">
              {selected.palaces.map((palace) => (
                <button
                  key={palace.palace_id}
                  type="button"
                  className="sml-palace"
                  data-overdue={palace.overdue}
                  onClick={() => navigate(reviewPalacePath(palace.palace_id, subjectKey))}
                >
                  <span>{palace.title}</span>
                  <small>{formatReviewDate(palace.due_date, palace.overdue, palace.due_today)} · {palace.unit_count} 个单元</small>
                </button>
              ))}
            </div>
          )}
          <div className="sml-actions">
            <span className="sml-empty">{selected.palace_count === 0 ? '拨到有圆点的档位，就能看到宫殿。' : '点宫殿进入它自己的复习。'}</span>
            <button
              type="button"
              className="sml-review"
              disabled={selected.palace_count === 0}
              onClick={() => navigate(reviewStagePath(selected.palaces.map((palace) => palace.palace_id)))}
            >
              复习这一档
            </button>
          </div>
        </>
      )}
    </section>
  )
}
