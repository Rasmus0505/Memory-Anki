import type { FreestyleMode } from '@/modules/practice/ui/freestyle/model/today-training'

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
