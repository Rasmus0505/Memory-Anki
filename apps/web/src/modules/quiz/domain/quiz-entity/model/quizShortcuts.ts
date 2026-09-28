import {
  captureShortcutFromKeyboardEvent as captureKeyboardShortcut,
  cloneShortcutBinding,
  getShortcutLabel,
  getShortcutSignature,
  isShortcutBindingAllowed,
  isShortcutPressed,
  normalizeShortcutBindingValue,
  type ShortcutAllowOptions,
  type ShortcutBinding,
} from '@/shared/keyboard/shortcutBindings'

export type { ShortcutBinding }
export { getShortcutLabel, getShortcutSignature, isShortcutPressed }

export type QuizShortcutActionId =
  | 'previous_question'
  | 'next_question'
  | 'previous_option'
  | 'next_option'
  | 'submit_choice'
  | 'toggle_mark'
  | 'select_option_1'
  | 'select_option_2'
  | 'select_option_3'
  | 'select_option_4'
  | 'select_option_a'
  | 'select_option_b'
  | 'select_option_c'
  | 'select_option_d'

export type QuizShortcutGroupId = 'navigate' | 'option' | 'mark'

export interface QuizShortcutActionDefinition {
  id: QuizShortcutActionId
  group: QuizShortcutGroupId
  label: string
  description: string
  defaultBinding: ShortcutBinding | null
  /** Direct option select. Absent for navigation, submit, and mark. */
  optionIndex?: number
}

export type QuizShortcutMap = Record<QuizShortcutActionId, ShortcutBinding | null>

export const QUIZ_SHORTCUT_GROUPS: Array<{ id: QuizShortcutGroupId; label: string }> = [
  { id: 'navigate', label: '切题' },
  { id: 'option', label: '选项' },
  { id: 'mark', label: '标记' },
]

const QUIZ_SHORTCUT_ALLOW: ShortcutAllowOptions = {
  allowBareLetters: true,
  allowBareDigits: true,
}

function bare(code: string, key: string): ShortcutBinding {
  return { code, key, shift: false, ctrl: false, alt: false, meta: false }
}

export const QUIZ_SHORTCUT_ACTIONS: QuizShortcutActionDefinition[] = [
  {
    id: 'previous_question',
    group: 'navigate',
    label: '上一题',
    description: '切到当前列表的上一题。',
    defaultBinding: bare('ArrowLeft', 'arrowleft'),
  },
  {
    id: 'next_question',
    group: 'navigate',
    label: '下一题',
    description: '切到当前列表的下一题。',
    defaultBinding: bare('ArrowRight', 'arrowright'),
  },
  {
    id: 'toggle_mark',
    group: 'mark',
    label: '标记 / 取消标记',
    description: '方向上键按一次切换标记，再按一次取消。按住不连切。',
    defaultBinding: bare('ArrowUp', 'arrowup'),
  },
  {
    id: 'previous_option',
    group: 'option',
    label: '上一选项',
    description: '默认未设置。方向上键用来切换标记，需要时再录一个键。',
    defaultBinding: null,
  },
  {
    id: 'next_option',
    group: 'option',
    label: '下一选项',
    description: '高亮下一个选项，到末尾后回到第一项。',
    defaultBinding: bare('ArrowDown', 'arrowdown'),
  },
  {
    id: 'submit_choice',
    group: 'option',
    label: '提交当前选项',
    description: '提交当前高亮的选项。焦点在其他按钮上时不触发。',
    defaultBinding: bare('Enter', 'enter'),
  },
  {
    id: 'select_option_1',
    group: 'option',
    label: '选第 1 项',
    description: '直接提交第 1 个选项。',
    defaultBinding: bare('Digit1', '1'),
    optionIndex: 0,
  },
  {
    id: 'select_option_2',
    group: 'option',
    label: '选第 2 项',
    description: '直接提交第 2 个选项。',
    defaultBinding: bare('Digit2', '2'),
    optionIndex: 1,
  },
  {
    id: 'select_option_3',
    group: 'option',
    label: '选第 3 项',
    description: '直接提交第 3 个选项。',
    defaultBinding: bare('Digit3', '3'),
    optionIndex: 2,
  },
  {
    id: 'select_option_4',
    group: 'option',
    label: '选第 4 项',
    description: '直接提交第 4 个选项。',
    defaultBinding: bare('Digit4', '4'),
    optionIndex: 3,
  },
  {
    id: 'select_option_a',
    group: 'option',
    label: '选 A',
    description: '直接提交第 1 个选项。',
    defaultBinding: bare('KeyA', 'a'),
    optionIndex: 0,
  },
  {
    id: 'select_option_b',
    group: 'option',
    label: '选 B',
    description: '直接提交第 2 个选项。',
    defaultBinding: bare('KeyB', 'b'),
    optionIndex: 1,
  },
  {
    id: 'select_option_c',
    group: 'option',
    label: '选 C',
    description: '直接提交第 3 个选项。',
    defaultBinding: bare('KeyC', 'c'),
    optionIndex: 2,
  },
  {
    id: 'select_option_d',
    group: 'option',
    label: '选 D',
    description: '直接提交第 4 个选项。',
    defaultBinding: bare('KeyD', 'd'),
    optionIndex: 3,
  },
]

export const DEFAULT_QUIZ_SHORTCUTS: QuizShortcutMap = QUIZ_SHORTCUT_ACTIONS.reduce(
  (acc, action) => {
    acc[action.id] = action.defaultBinding ? cloneShortcutBinding(action.defaultBinding) : null
    return acc
  },
  {} as QuizShortcutMap,
)

const FRIENDLY_LABELS: Record<string, string> = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
}

export function formatQuizShortcutLabel(bindingValue: unknown) {
  const label = getShortcutLabel(bindingValue)
  if (label === '未设置') return label
  return FRIENDLY_LABELS[label] ?? label
}

export function captureQuizShortcutFromKeyboardEvent(event: KeyboardEvent) {
  return captureKeyboardShortcut(
    event,
    {
      escapeReserved: 'Esc 需要保留给关闭弹窗。',
      tabReserved: 'Tab 需要保留给焦点切换。',
      reservedKey: () => '该按键会影响输入或删除操作，不建议设置为做题快捷键。',
      barePrintable: (key) => `「${key.toUpperCase()}」容易和输入冲突，请改用方向键、数字、字母或组合键。`,
    },
    QUIZ_SHORTCUT_ALLOW,
  )
}

export function sanitizeQuizShortcutMap(rawShortcutMap: unknown): QuizShortcutMap {
  const raw =
    rawShortcutMap && typeof rawShortcutMap === 'object'
      ? (rawShortcutMap as Partial<Record<QuizShortcutActionId, unknown>>)
      : {}
  const occupied = new Set<string>()
  const next = {} as QuizShortcutMap

  for (const action of QUIZ_SHORTCUT_ACTIONS) {
    const hasOwn = Object.prototype.hasOwnProperty.call(raw, action.id)
    if (hasOwn && raw[action.id] == null) {
      next[action.id] = null
      continue
    }
    const requested = normalizeShortcutBindingValue(
      hasOwn ? raw[action.id] : DEFAULT_QUIZ_SHORTCUTS[action.id],
    )
    if (!requested || !isShortcutBindingAllowed(requested, QUIZ_SHORTCUT_ALLOW)) {
      next[action.id] = null
      continue
    }
    const signature = getShortcutSignature(requested)
    if (!signature || occupied.has(signature)) {
      next[action.id] = null
      continue
    }
    occupied.add(signature)
    next[action.id] = cloneShortcutBinding(requested)
  }

  return next
}

export function isQuizShortcutMap(value: unknown): value is QuizShortcutMap {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

let recordingDepth = 0

export function beginQuizShortcutRecording() {
  recordingDepth += 1
  return () => {
    recordingDepth = Math.max(0, recordingDepth - 1)
  }
}

export function isQuizShortcutRecording() {
  return recordingDepth > 0
}

export interface QuizShortcutContext {
  questionCount: number
  optionCount: number
  choiceShortcutsActive: boolean
  attemptClosed: boolean
  repeat: boolean
  editable: boolean
  recording: boolean
  enterOnUnrelatedControl: boolean
}

export interface QuizShortcutMatch {
  id: QuizShortcutActionId
  /** False when a held mark key must be swallowed without toggling again. */
  run: boolean
  optionIndex?: number
}

export function resolveQuizShortcutAction(
  event: KeyboardEvent,
  shortcuts: QuizShortcutMap,
  context: QuizShortcutContext,
): QuizShortcutMatch | null {
  if (context.editable || context.recording || event.isComposing || event.key === 'Process') return null
  const matched = QUIZ_SHORTCUT_ACTIONS.find((action) => isShortcutPressed(event, shortcuts[action.id]))
  if (!matched) return null

  if (matched.id === 'toggle_mark') {
    return { id: matched.id, run: !context.repeat }
  }

  if (matched.id === 'previous_question' || matched.id === 'next_question') {
    if (context.questionCount <= 1) return null
    return { id: matched.id, run: true }
  }

  if (!context.choiceShortcutsActive || context.attemptClosed || context.optionCount <= 0) return null
  if (matched.id === 'submit_choice' && context.enterOnUnrelatedControl) return null
  if (matched.optionIndex != null && matched.optionIndex >= context.optionCount) return null
  return {
    id: matched.id,
    run: matched.id === 'previous_option' || matched.id === 'next_option' || !context.repeat,
    optionIndex: matched.optionIndex,
  }
}
