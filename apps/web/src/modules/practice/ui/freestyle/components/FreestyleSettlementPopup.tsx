import { useEffect, useState } from 'react'
import type { FreestyleOverviewResponse, FreestyleOverviewRound } from '@/shared/api/contracts'
import type { FreestyleRoundSubjectStat } from '../model/roundCompletion'
import {
  progressPercent,
  remainingDelta,
  type FreestyleSaveOutcome,
} from '../model/freestyleSettlementModel'
import { FreestyleSaveStatus } from './FreestyleSaveStatus'

const FOLD_AFTER = 3
const NEXT_REVIEW_PREVIEW = 5

interface FreestyleSettlementPopupProps {
  saveOutcome: FreestyleSaveOutcome
  ratedCount: number
  passedCount: number
  remainingBefore: number
  remainingAfter: number
  subjects: FreestyleOverviewRound['by_subject']
  palacesBySubject: FreestyleRoundSubjectStat[]
  nextReviews: FreestyleOverviewResponse['next_reviews']
  onRetrySave?: () => void
  onContinue: () => void
  onClose: () => void
}

export function FreestyleSettlementPopup({
  saveOutcome,
  ratedCount,
  passedCount,
  remainingBefore,
  remainingAfter,
  subjects,
  palacesBySubject,
  nextReviews,
  onRetrySave,
  onContinue,
  onClose,
}: FreestyleSettlementPopupProps) {
  const [showAllSubjects, setShowAllSubjects] = useState(false)
  const [openSubjectKey, setOpenSubjectKey] = useState<string | null>(null)
  const delta = remainingDelta(remainingBefore, remainingAfter)
  const passRate = progressPercent(passedCount, ratedCount)
  const visibleSubjects = showAllSubjects ? subjects : subjects.slice(0, FOLD_AFTER)
  const palacesFor = (subjectId: number | null) =>
    palacesBySubject.find((item) => item.subjectId === subjectId)?.palaces ?? []

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="本轮总结"
        className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-stage-line bg-stage-raised p-6 text-stage-ink"
      >
        <header className="flex flex-col gap-3">
          <FreestyleSaveStatus outcome={saveOutcome} onRetry={onRetrySave} />
          <div className="grid grid-cols-3 gap-3">
            <div>
              <div className="text-2xl font-semibold tabular-nums">{ratedCount}</div>
              <div className="text-xs text-stage-muted">本次完成</div>
            </div>
            <div>
              <div className="text-2xl font-semibold tabular-nums">{passRate}%</div>
              <div className="text-xs text-stage-muted">通过率</div>
            </div>
            <div>
              <div className="text-2xl font-semibold tabular-nums">
                {delta.before} → {delta.after}
              </div>
              <div className="text-xs text-stage-muted">今日还剩</div>
            </div>
          </div>
        </header>

        <section className="mt-6 flex flex-col gap-2">
          <h3 className="text-xs text-stage-muted">学科进度</h3>
          {visibleSubjects.map((subject) => {
            const pct = progressPercent(subject.done, subject.total)
            const key = String(subject.subject_id ?? 'none')
            const open = openSubjectKey === key
            return (
              <div key={key} className="rounded-lg border border-stage-line p-3">
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => setOpenSubjectKey(open ? null : key)}
                  className="flex w-full items-center justify-between text-sm"
                >
                  <span>{subject.name}</span>
                  <span className="tabular-nums">
                    {subject.done}/{subject.total} · {pct}%
                  </span>
                </button>
                <div className="mt-2 h-1.5 overflow-hidden rounded bg-stage-line">
                  <div className="h-full bg-stage-glow" style={{ width: `${pct}%` }} />
                </div>
                {open ? (
                  <ul className="mt-2 flex flex-col gap-1 text-xs text-stage-muted">
                    {palacesFor(subject.subject_id).map((palace) => (
                      <li key={palace.palaceId} className="flex justify-between">
                        <span>{palace.palaceTitle}</span>
                        <span className="tabular-nums">{palace.cardCount} 项</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            )
          })}
          {subjects.length > FOLD_AFTER ? (
            <button
              type="button"
              onClick={() => setShowAllSubjects((value) => !value)}
              className="text-xs text-stage-glow"
            >
              {showAllSubjects ? '收起' : `展开其余 ${subjects.length - FOLD_AFTER} 个学科`}
            </button>
          ) : null}
        </section>

        <section className="mt-6 flex flex-col gap-2">
          <h3 className="text-xs text-stage-muted">下次复习</h3>
          {nextReviews.length === 0 ? (
            <p className="text-sm text-stage-muted">暂无已安排的复习</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {nextReviews.slice(0, NEXT_REVIEW_PREVIEW).map((item) => (
                <li key={item.unit_id} className="flex justify-between gap-3">
                  <span className="truncate">{item.name || item.palace_name}</span>
                  <span className="shrink-0 tabular-nums text-stage-muted">{item.due_date}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <footer className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={onClose} className="rounded-xl px-4 py-2 text-sm text-stage-muted">
            关闭
          </button>
          <button
            type="button"
            onClick={onContinue}
            className="rounded-xl bg-stage-glow px-4 py-2 text-sm font-medium text-stage"
          >
            继续下一轮
          </button>
        </footer>
      </div>
    </div>
  )
}
