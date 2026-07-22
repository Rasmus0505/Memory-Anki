import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Pencil } from 'lucide-react'
import {
  DEFAULT_STUDY_GOALS,
  getStudyGoalsApi,
  getWeeklyReportApi,
  saveStudyGoalsApi,
  type StudyGoals,
} from '@/modules/dashboard/ui/dashboard/api'
import type { WeeklyReport } from '@/shared/api/contracts'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { Progress } from '@/shared/components/ui/progress'

const EMPTY_WEEKLY_REPORT: WeeklyReport = {
  week_start: '',
  week_end: '',
  study_seconds: 0,
  review_count: 0,
  average_score: 0,
  new_palace_count: 0,
}

function normalizeGoals(value: StudyGoals): StudyGoals {
  return {
    weekly_study_minutes: Math.max(1, Math.round(Number(value.weekly_study_minutes) || DEFAULT_STUDY_GOALS.weekly_study_minutes)),
    weekly_review_count: Math.max(1, Math.round(Number(value.weekly_review_count) || DEFAULT_STUDY_GOALS.weekly_review_count)),
  }
}

function progressPercent(current: number, target: number) {
  if (target <= 0) return 0
  return Math.min(100, Math.round((current / target) * 100))
}

export function WeeklyGoalsCard() {
  const [goals, setGoals] = useState<StudyGoals>(DEFAULT_STUDY_GOALS)
  const [draft, setDraft] = useState<StudyGoals>(DEFAULT_STUDY_GOALS)
  const [report, setReport] = useState<WeeklyReport>(EMPTY_WEEKLY_REPORT)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    void Promise.all([getStudyGoalsApi(), getWeeklyReportApi(0)])
      .then(([savedGoals, weeklyReport]) => {
        if (!active) return
        const nextGoals = normalizeGoals(savedGoals ?? DEFAULT_STUDY_GOALS)
        setGoals(nextGoals)
        setDraft(nextGoals)
        setReport(weeklyReport)
      })
      .catch((requestError) => {
        if (!active) return
        setError(requestError instanceof Error ? requestError.message : '学习目标加载失败。')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  const studyMinutes = Math.floor(report.study_seconds / 60)
  const studyProgress = progressPercent(studyMinutes, goals.weekly_study_minutes)
  const reviewProgress = progressPercent(report.review_count, goals.weekly_review_count)
  const allReached = studyProgress >= 100 && reviewProgress >= 100
  const goalRows = useMemo(
    () => [
      {
        label: '学习时长',
        current: studyMinutes,
        target: goals.weekly_study_minutes,
        unit: '分钟',
        progress: studyProgress,
      },
      {
        label: '复习次数',
        current: report.review_count,
        target: goals.weekly_review_count,
        unit: '次',
        progress: reviewProgress,
      },
    ],
    [goals.weekly_review_count, goals.weekly_study_minutes, report.review_count, reviewProgress, studyMinutes, studyProgress],
  )

  const handleOpenEditor = () => {
    setDraft(goals)
    setOpen(true)
  }

  const handleSave = async () => {
    const nextGoals = normalizeGoals(draft)
    setSaving(true)
    setError(null)
    try {
      await saveStudyGoalsApi(nextGoals)
      setGoals(nextGoals)
      setDraft(nextGoals)
      setOpen(false)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '学习目标保存失败。')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="text-base">本周目标</CardTitle>
            {loading ? <p className="mt-1 text-xs text-muted-foreground">正在读取目标进度...</p> : null}
          </div>
          <div className="flex items-center gap-2">
            {allReached ? (
              <Badge variant="success">
                <CheckCircle2 className="size-3" />
                已达成
              </Badge>
            ) : null}
            <Button type="button" size="icon" variant="outline" onClick={handleOpenEditor} aria-label="编辑学习目标">
              <Pencil className="size-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {goalRows.map((row) => (
            <div key={row.label} className="space-y-2">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="font-medium">{row.label}</span>
                <span className="text-muted-foreground">
                  本周 {row.current} / 目标 {row.target} {row.unit}
                </span>
              </div>
              <Progress value={row.progress} aria-label={`${row.label}目标进度 ${row.progress}%`} />
            </div>
          ))}
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent floatingId="dashboard-weekly-goals" capsuleLabel="编辑学习目标">
          <DialogHeader>
            <DialogTitle>编辑学习目标</DialogTitle>
            <DialogDescription>目标会同步到客户端偏好，刷新或换设备后继续生效。</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 px-6 py-5">
            <div className="grid gap-2">
              <Label htmlFor="weekly-study-minutes">每周学习时长目标</Label>
              <Input
                id="weekly-study-minutes"
                min={1}
                type="number"
                value={draft.weekly_study_minutes}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    weekly_study_minutes: Number(event.target.value),
                  }))
                }
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="weekly-review-count">每周复习次数目标</Label>
              <Input
                id="weekly-review-count"
                min={1}
                type="number"
                value={draft.weekly_review_count}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    weekly_review_count: Number(event.target.value),
                  }))
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button type="button" onClick={() => void handleSave()} disabled={saving}>
              {saving ? '保存中...' : '保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
