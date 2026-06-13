import type { ChartConfig } from '@/shared/components/ui/chart'

export const timeRecordChartConfig: ChartConfig = {
  seconds: { label: '有效时长', color: '#2563eb' },
  review: { label: '正式复习', color: '#0f172a' },
  practice: { label: '练习', color: '#0f766e' },
  quiz: { label: '做题', color: '#7c3aed' },
  palace_edit: { label: '宫殿编辑', color: '#c2410c' },
}

export function getTimeRecordChartColor(
  kind: 'review' | 'practice' | 'quiz' | 'palace_edit',
) {
  const colorByKind = {
    review: '#0f172a',
    practice: '#0f766e',
    quiz: '#7c3aed',
    palace_edit: '#c2410c',
  }

  return colorByKind[kind]
}
