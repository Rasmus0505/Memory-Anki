import type { DashboardResponse } from '@/shared/api/contracts'
import { formatDuration } from '@/modules/session/public'
import { getTimeRecordChartColor } from '@/modules/session/public'

export function formatLearningTooltip(item: DashboardResponse['today_learning_palaces'][number]) {
  const lines = [
    `${item.palace_title || '未命名宫殿'}`,
    `总时长：${formatDuration(item.total_seconds)}`,
    `宫殿编辑：${formatDuration(item.palace_edit_seconds)}`,
    `练习：${formatDuration(item.practice_seconds)}`,
    `复习：${formatDuration(item.review_seconds)}`,
  ]
  if (item.quiz_seconds > 0) {
    lines.splice(4, 0, `做题：${formatDuration(item.quiz_seconds)}`)
  }
  return lines.join('\n')
}

export const dashboardLearningLegend = [
  { key: 'palace_edit', label: '宫殿编辑', color: getTimeRecordChartColor('palace_edit') },
  { key: 'practice', label: '练习', color: getTimeRecordChartColor('practice') },
  { key: 'quiz', label: '做题', color: getTimeRecordChartColor('quiz') },
  { key: 'review', label: '复习', color: getTimeRecordChartColor('review') },
] as const

export function buildLearningSegments(item: DashboardResponse['today_learning_palaces'][number]) {
  const rawSegments = [
    { key: 'palace_edit', seconds: item.palace_edit_seconds, color: getTimeRecordChartColor('palace_edit') },
    { key: 'practice', seconds: item.practice_seconds, color: getTimeRecordChartColor('practice') },
    { key: 'quiz', seconds: item.quiz_seconds, color: getTimeRecordChartColor('quiz') },
    { key: 'review', seconds: item.review_seconds, color: getTimeRecordChartColor('review') },
  ].filter((segment) => segment.seconds > 0)

  const total = Math.max(1, item.total_seconds)
  const minimalUnits = rawSegments.length
  const minPercent = rawSegments.length > 1 ? 6 : 100
  const baseWidths = rawSegments.map((segment) => (segment.seconds / total) * 100)
  const promotedFlags = baseWidths.map((width) => width > 0 && width < minPercent)
  const promotedTotal = promotedFlags.reduce((sum, flag) => sum + (flag ? minPercent : 0), 0)
  const untouchedTotal = baseWidths.reduce((sum, width, index) => sum + (promotedFlags[index] ? 0 : width), 0)
  const remainingPercent = Math.max(0, 100 - promotedTotal)

  return rawSegments.map((segment, index) => {
    const width = promotedFlags[index]
      ? minPercent
      : untouchedTotal > 0
        ? (baseWidths[index] / untouchedTotal) * remainingPercent
        : (100 - minimalUnits * minPercent) / Math.max(1, rawSegments.length)
    return {
      ...segment,
      width,
    }
  })
}
