import { useEffect, useState } from 'react'
import { getStudyGoalsApi } from '@/modules/dashboard/public'
import { getExamOverviewApi } from '@/modules/exam/public'
import { dailyReviewGoal, resolveAmbientTone, type AmbientTone } from '@/shared/ambient/ambientModel'

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
      const [goals, exam] = await Promise.allSettled([getStudyGoalsApi(), getExamOverviewApi()])
      if (current !== requestId) return
      if (exam.status === 'fulfilled') {
        const weekly = goals.status === 'fulfilled' ? goals.value?.weekly_review_count : null
        setProgress(exam.value.totals.reviewed_today / dailyReviewGoal(weekly))
        setExamDaysLeft(exam.value.days_left)
      }
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
