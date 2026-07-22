import type { PalaceSegmentSummary } from '@/shared/api/contracts'
import { formatApiDateTime } from '@/shared/lib/dateTime'

export function formatSegmentDateTime(value: string | null) {
  return value ? formatApiDateTime(value).slice(0, 16) : '未设置'
}

export function getSegmentDisplayName(
  segment: PalaceSegmentSummary,
  index: number,
): string {
  if (segment.display_name) return segment.display_name
  if (segment.is_virtual_default) return '第 1 学习组'
  if (/^第\s*1\s*学习组$/.test(segment.name)) {
    return `第 ${index + 1} 学习组`
  }
  return segment.name
}
