import type { ChartConfig } from '@/shared/components/ui/chart'

export const timeRecordChartConfig: ChartConfig = {
  seconds: { label: '有效时长', color: '#2563eb' },
  review: { label: '正式复习', color: '#0f172a' },
  practice: { label: '练习', color: '#0f766e' },
  quiz: { label: '做题', color: '#7c3aed' },
  palace_edit: { label: '宫殿编辑', color: '#c2410c' },
  custom: { label: '其他', color: '#64748b' },
}

const CUSTOM_TAG_COLORS = [
  '#0369a1',
  '#0f766e',
  '#a16207',
  '#be123c',
  '#6d28d9',
  '#15803d',
  '#c2410c',
  '#1d4ed8',
]

export function getTimeRecordChartColor(kind: string) {
  const colorByKind: Record<string, string> = {
    review: '#0f172a',
    practice: '#0f766e',
    quiz: '#7c3aed',
    palace_edit: '#c2410c',
    custom: '#64748b',
  }
  if (colorByKind[kind]) return colorByKind[kind]

  let hash = 0
  for (let index = 0; index < kind.length; index += 1) {
    hash = (hash * 31 + kind.charCodeAt(index)) >>> 0
  }
  return CUSTOM_TAG_COLORS[hash % CUSTOM_TAG_COLORS.length]
}
