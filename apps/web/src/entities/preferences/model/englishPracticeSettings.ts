import {
  captureShortcutFromKeyboardEvent as captureKeyboardShortcut,
  cloneShortcutBinding,
  getShortcutLabel,
  getShortcutSignature,
  isShortcutBindingAllowed,
  isShortcutPressed,
  normalizeShortcutBindingValue,
  type ShortcutBinding,
} from '@/shared/keyboard/shortcutBindings'
import { createPersistentPreferenceStore } from '@/shared/preferences/persistentPreferenceStore'

export type { ShortcutBinding }
export { getShortcutLabel, getShortcutSignature, isShortcutPressed, normalizeShortcutBindingValue }

export type EnglishShortcutActionId =
  | 'replay_sentence'
  | 'previous_sentence'
  | 'next_sentence'
  | 'reveal_word'
  | 'reveal_letter'
  | 'toggle_single_loop'
  | 'toggle_auto_replay'
  | 'toggle_sound'

export type ShortcutActionId = EnglishShortcutActionId
export type EnglishPracticeShortcutMap = Record<EnglishShortcutActionId, ShortcutBinding | null>

export interface EnglishPracticeSettings {
  shortcuts: EnglishPracticeShortcutMap
  sound: {
    enabled: boolean
    masterVolume: number
  }
  flow: {
    autoAdvanceOnPass: boolean
  }
  replay: {
    autoReplayOnPass: boolean
    singleSentenceLoopEnabled: boolean
  }
}

export interface EnglishShortcutActionDefinition {
  id: EnglishShortcutActionId
  label: string
}

export const ENGLISH_PRACTICE_SETTINGS_STORAGE_KEY = 'memory-anki-english-practice-settings-v2'
export const ENGLISH_PRACTICE_SETTINGS_UPDATED_EVENT = 'memory-anki-english-practice-settings-change'

export const ENGLISH_SHORTCUT_ACTIONS: EnglishShortcutActionDefinition[] = [
  { id: 'replay_sentence', label: '重播当前句' },
  { id: 'previous_sentence', label: '上一句' },
  { id: 'next_sentence', label: '下一句' },
  { id: 'reveal_word', label: '揭示当前词' },
  { id: 'reveal_letter', label: '揭示一个字母' },
  { id: 'toggle_single_loop', label: '开关单句循环' },
  { id: 'toggle_auto_replay', label: '开关答后重播' },
  { id: 'toggle_sound', label: '开关声音' },
]

export const DEFAULT_ENGLISH_SHORTCUTS: EnglishPracticeShortcutMap = {
  replay_sentence: { code: 'Space', key: 'space', shift: true, ctrl: false, alt: false, meta: false },
  previous_sentence: { code: 'ArrowLeft', key: 'arrowleft', shift: true, ctrl: false, alt: false, meta: false },
  next_sentence: { code: 'ArrowRight', key: 'arrowright', shift: true, ctrl: false, alt: false, meta: false },
  reveal_word: { code: 'Enter', key: 'enter', shift: true, ctrl: false, alt: false, meta: false },
  reveal_letter: { code: 'ArrowUp', key: 'arrowup', shift: true, ctrl: false, alt: false, meta: false },
  toggle_single_loop: { code: 'KeyL', key: 'l', shift: true, ctrl: false, alt: false, meta: false },
  toggle_auto_replay: { code: 'KeyR', key: 'r', shift: true, ctrl: false, alt: false, meta: false },
  toggle_sound: { code: 'KeyM', key: 'm', shift: true, ctrl: false, alt: false, meta: false },
}

export const DEFAULT_SHORTCUTS = DEFAULT_ENGLISH_SHORTCUTS

export const DEFAULT_ENGLISH_PRACTICE_SETTINGS: EnglishPracticeSettings = {
  shortcuts: DEFAULT_ENGLISH_SHORTCUTS,
  sound: {
    enabled: true,
    masterVolume: 0.5,
  },
  flow: {
    autoAdvanceOnPass: true,
  },
  replay: {
    autoReplayOnPass: true,
    singleSentenceLoopEnabled: false,
  },
}

export function captureShortcutFromKeyboardEvent(event: KeyboardEvent) {
  return captureKeyboardShortcut(event, {
    reservedKey: (label) => `${label} 会影响输入，不建议设置为学习快捷键。`,
    barePrintable: (key) => `「${key.toUpperCase()}」是答题输入键，容易误触。请改用 Shift、Ctrl、Alt 或 Meta 组合。`,
  })
}

export function sanitizeEnglishShortcutMap(rawShortcutMap: unknown): EnglishPracticeShortcutMap {
  const raw =
    rawShortcutMap && typeof rawShortcutMap === 'object'
      ? (rawShortcutMap as Partial<Record<EnglishShortcutActionId, unknown>>)
      : {}
  const occupied = new Set<string>()
  const nextShortcutMap = {} as EnglishPracticeShortcutMap

  for (const action of ENGLISH_SHORTCUT_ACTIONS) {
    const requested = normalizeShortcutBindingValue(raw[action.id] ?? DEFAULT_ENGLISH_SHORTCUTS[action.id])
    if (!requested || !isShortcutBindingAllowed(requested)) {
      nextShortcutMap[action.id] = null
      continue
    }
    const signature = getShortcutSignature(requested)
    if (!signature || occupied.has(signature)) {
      nextShortcutMap[action.id] = null
      continue
    }
    occupied.add(signature)
    nextShortcutMap[action.id] = cloneShortcutBinding(requested)
  }

  return nextShortcutMap
}

function sanitizeBoolean(value: unknown, fallback: boolean) {
  if (typeof value === 'boolean') return value
  return fallback
}

function sanitizeNumber(value: unknown, fallback: number, min: number, max: number) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.min(max, Math.max(min, value))
  }
  return fallback
}

export function sanitizeEnglishPracticeSettings(value: unknown): EnglishPracticeSettings {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const rawSound = raw.sound && typeof raw.sound === 'object' ? (raw.sound as Record<string, unknown>) : {}
  const rawFlow = raw.flow && typeof raw.flow === 'object' ? (raw.flow as Record<string, unknown>) : {}
  const rawReplay = raw.replay && typeof raw.replay === 'object' ? (raw.replay as Record<string, unknown>) : {}
  return {
    shortcuts: sanitizeEnglishShortcutMap(raw.shortcuts),
    sound: {
      enabled: sanitizeBoolean(rawSound.enabled, DEFAULT_ENGLISH_PRACTICE_SETTINGS.sound.enabled),
      masterVolume: sanitizeNumber(
        rawSound.masterVolume,
        DEFAULT_ENGLISH_PRACTICE_SETTINGS.sound.masterVolume,
        0,
        1,
      ),
    },
    flow: {
      autoAdvanceOnPass: sanitizeBoolean(
        rawFlow.autoAdvanceOnPass,
        DEFAULT_ENGLISH_PRACTICE_SETTINGS.flow.autoAdvanceOnPass,
      ),
    },
    replay: {
      autoReplayOnPass: sanitizeBoolean(
        rawReplay.autoReplayOnPass,
        DEFAULT_ENGLISH_PRACTICE_SETTINGS.replay.autoReplayOnPass,
      ),
      singleSentenceLoopEnabled: sanitizeBoolean(
        rawReplay.singleSentenceLoopEnabled,
        DEFAULT_ENGLISH_PRACTICE_SETTINGS.replay.singleSentenceLoopEnabled,
      ),
    },
  }
}

const store = createPersistentPreferenceStore<EnglishPracticeSettings>({
  cacheKey: 'english_practice_settings',
  defaultValue: DEFAULT_ENGLISH_PRACTICE_SETTINGS,
  localStorageKey: ENGLISH_PRACTICE_SETTINGS_STORAGE_KEY,
  sanitize: sanitizeEnglishPracticeSettings,
  updatedEvent: ENGLISH_PRACTICE_SETTINGS_UPDATED_EVENT,
  isValidCache: (value): value is EnglishPracticeSettings => Boolean(value && typeof value === 'object'),
})

export const readEnglishPracticeSettings = store.read
export const writeEnglishPracticeSettings = store.write
export const resetEnglishPracticeSettings = store.reset
