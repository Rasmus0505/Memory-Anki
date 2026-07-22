import type {
  FreestyleContentType,
  FreestyleQuestionTypeFilter,
} from '@/shared/api/contracts'
import type {
  FreestyleActionFrequency,
  FreestyleConfig,
  FreestyleOrderMode,
} from '@/modules/practice/ui/freestyle/model/freestyle'
import type { FreestyleMode } from '@/modules/practice/ui/freestyle/model/today-training'

export const CONTENT_TYPE_LABELS: Record<FreestyleContentType, string> = {
  quiz_question: '宫殿题卡',
  review: '正式复习',
  practice: '加强练习',
  english: '英语听力',
  english_reading: '英语阅读',
}

export const RANGE_LABELS: Record<FreestyleConfig['range'], string> = {
  all: '全部',
  due: '待复习',
  needs_practice: '需练习',
  specific_palaces: '指定宫殿',
  wrong: '错题重练',
}

export const ORDER_MODE_LABELS: Record<FreestyleOrderMode, string> = {
  palace_complete_then_random: '刷完整组再随机',
  random: '全随机',
  sequential: '原始顺序',
}

export const ACTION_FREQUENCY_LABELS: Record<FreestyleActionFrequency, string> = {
  none: '不混入',
  low: '低',
  medium: '中',
  high: '高',
}

export const MODE_LABELS: Record<FreestyleMode, string> = {
  today: '今日训练',
  free: '自由随心',
}

export const QUESTION_TYPE_DISPLAY: Partial<Record<string, string>> = {
  multiple_choice: '选择题',
  true_false: '判断题',
  fill_blank: '填空题',
  matching: '匹配题',
  ordering: '排序题',
  categorization: '归类题',
  short_answer: '简答题',
}

export const QUESTION_TYPE_ACCENT: Record<string, { hue: number; label: string }> = {
  multiple_choice: { hue: 210, label: '选择题' },
  true_false: { hue: 174, label: '判断题' },
  fill_blank: { hue: 270, label: '填空题' },
  matching: { hue: 38, label: '匹配题' },
  ordering: { hue: 24, label: '排序题' },
  categorization: { hue: 330, label: '归类题' },
  short_answer: { hue: 155, label: '简答题' },
}

export const QUESTION_TYPE_OPTIONS: Array<{ value: FreestyleQuestionTypeFilter; label: string }> = [
  { value: 'all', label: '全部题型' },
  { value: 'multiple_choice', label: '选择题' },
  { value: 'true_false', label: '判断题' },
  { value: 'fill_blank', label: '填空题' },
  { value: 'matching', label: '匹配题' },
  { value: 'ordering', label: '排序题' },
  { value: 'categorization', label: '归类题' },
  { value: 'short_answer', label: '简答题' },
]
