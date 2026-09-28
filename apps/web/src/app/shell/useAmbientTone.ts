import { useEffect, useState } from 'react'
import { getDashboardApi, getStudyGoalsApi } from '@/modules/dashboard/public'
import { getExamOverviewApi } from '@/modules/exam/public'
import { dailyGoalSeconds, resolveAmbientTone, type AmbientTone } from '@/shared/ambient/ambientModel'

const REFRESH_MS = 10 * 60 * 1000
const CLOCK_MS = 5 * 60 * 1000
const STARTUP_DELAY_MS = 4000

function currentHour(date = new Date()) {
  return date.getHours() + date.getMinutes() / 60
}

export function useAmbientTone(enabled: boolean): AmbientTone {
  const [hour, setHour] = useState(currentHour)
  const [progress, setProgress] = useState(0)
  const [examDaysLeft, setExamDaysLeft] = useState<number | null>(null)

  useEffect(() => {
    const id = window.setInterval(() => setHour(currentHour()), CLOCK_MS)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    if (!enabled) return
    let requestId = 0
    const load = async () => {
      const current = ++requestId
      const [dashboard, goals, exam] = await Promise.allSettled([
        getDashboardApi(),
        getStudyGoalsApi(),
        getExamOverviewApi(),
      ])
      if (current !== requestId) return
      if (dashboard.status === 'fulfilled') {
        const weekly = goals.status === 'fulfilled' ? goals.value?.weekly_study_minutes : null
        setProgress(dashboard.value.today_total_review_duration_seconds / dailyGoalSeconds(weekly))
      }
      if (exam.status === 'fulfilled') setExamDaysLeft(exam.value.days_left)
      setHour(currentHour())
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load()
    }
    const startup = window.setTimeout(() => void load(), STARTUP_DELAY_MS)
    const interval = window.setInterval(() => void load(), REFRESH_MS)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      requestId += 1
      window.clearTimeout(startup)
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [enabled])

  return resolveAmbientTone({ hour, progress, examDaysLeft })
}
