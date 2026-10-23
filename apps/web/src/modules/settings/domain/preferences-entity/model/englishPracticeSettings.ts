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
  | 'reveal_letter'
  | 'reveal_word'
  | 'toggle_translation'
  | 'toggle_mask'
  | 'cycle_layout'
  | 'toggle_sound'
  | 'speed_up'
  | 'speed_down'
  | 'reset_sentence'
  | 'pause_session'
  | 'toggle_playback_mode'
  | 'open_shortcuts'

export type ShortcutActionId = EnglishShortcutActionId
export type EnglishPracticeShortcutMap = Record<EnglishShortcutActionId, ShortcutBinding | null>
export type EnglishDictationLayout = 'theater' | 'classic' | 'immersive'
export type EnglishPlaybackMode = 'single' | 'continuous'

export interface EnglishMaskSettings {
  enabled: boolean
  blur: number
  opacity: number
}

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
  playback: {
    mode: EnglishPlaybackMode
  }
  stage: {
    layout: EnglishDictationLayout
    playbackSpeed: number
    showFilmstrip: boolean
    mask: EnglishMaskSettings
  }
}

export interface EnglishShortcutActionDefinition {
  id: EnglishShortcutActionId
  label: string
  group: 'playback' | 'typing' | 'view' | 'system'
}

export const ENGLISH_PRACTICE_SETTINGS_STORAGE_KEY = 'memory-anki-english-practice-settings-v3'
export const ENGLISH_PRACTICE_SETTINGS_UPDATED_EVENT = 'memory-anki-english-practice-settings-change'

export const ENGLISH_SHORTCUT_ACTIONS: EnglishShortcutActionDefinition[] = [
  { id: 'replay_sentence', label: '重播本句', group: 'playback' },
  { id: 'previous_sentence', label: '上一句', group: 'playback' },
  { id: 'next_sentence', label: '下一句', group: 'playback' },
  { id: 'pause_session', label: '暂停 / 继续', group: 'playback' },
  { id: 'toggle_playback_mode', label: '单句 / 连播', group: 'playback' },
  { id: 'reveal_letter', label: '揭示一个字母', group: 'typing' },
  { id: 'reveal_word', label: '揭示当前单词', group: 'typing' },
  { id: 'reset_sentence', label: '清空重输本句', group: 'typing' },
  { id: 'toggle_translation', label: '显示 / 隐藏译文', group: 'view' },
  { id: 'toggle_mask', label: '遮挡板开关', group: 'view' },
  { id: 'cycle_layout', label: '切换布局', group: 'view' },
  { id: 'speed_up', label: '加快播放', group: 'view' },
  { id: 'speed_down', label: '减慢播放', group: 'view' },
  { id: 'toggle_sound', label: '声音开关', group: 'system' },
  { id: 'open_shortcuts', label: '快捷键面板', group: 'system' },
]

function binding(code: string, key: string): ShortcutBinding {
  return { code, key, shift: false, ctrl: false, alt: false, meta: false }
}

export const DEFAULT_ENGLISH_SHORTCUTS: EnglishPracticeShortcutMap = {
  replay_sentence: binding('Space', 'space'),
  previous_sentence: binding('ArrowLeft', 'arrowleft'),
  next_sentence: binding('ArrowRight', 'arrowright'),
  pause_session: binding('Escape', 'escape'),
  toggle_playback_mode: binding('F3', 'f3'),
  reveal_letter: binding('ArrowUp', 'arrowup'),
  reveal_word: binding('ArrowDown', 'arrowdown'),
  reset_sentence: binding('Home', 'home'),
  toggle_translation: binding('Enter', 'enter'),
  toggle_mask: binding('Backquote', '`'),
  cycle_layout: binding('F2', 'f2'),
  speed_up: binding('PageUp', 'pageup'),
  speed_down: binding('PageDown', 'pagedown'),
  toggle_sound: binding('F8', 'f8'),
  open_shortcuts: binding('F1', 'f1'),
}

export const DEFAULT_SHORTCUTS = DEFAULT_ENGLISH_SHORTCUTS

export const ENGLISH_DICTATION_SHORTCUT_OPTIONS = {
  allowBareLetters: false,
  allowBareDigits: false,
  allowBareDeleteKeys: true,
  allowEscape: true,
  allowedBarePrintableKeys: ['`', '\\', '-', '='],
} as const

export const DEFAULT_ENGLISH_PRACTICE_SETTINGS: EnglishPracticeSettings = {
  shortcuts: DEFAULT_ENGLISH_SHORTCUTS,
  sound: {
    enabled: true,
    masterVolume: 0.5,
  },
  flow: {
    autoAdvanceOnPass: false,
  },
  replay: {
    autoReplayOnPass: false,
    singleSentenceLoopEnabled: false,
  },
  playback: {
    mode: 'single',
  },
  stage: {
    layout: 'theater',
    playbackSpeed: 1,
    showFilmstrip: true,
    mask: {
      enabled: false,
      blur: 18,
      opacity: 72,
    },
  },
}

export function captureShortcutFromKeyboardEvent(event: KeyboardEvent) {
  return captureKeyboardShortcut(
    event,
    {
      reservedKey: (label) => `${label} 会影响输入或删除，不建议设置为学习快捷键。`,
      barePrintable: (key) => `「${key.toUpperCase()}」是答题输入键，容易误触。请改用方向键、功能键或组合键。`,
    },
    ENGLISH_DICTATION_SHORTCUT_OPTIONS,
  )
}

function isLegacyResetBinding(value: unknown) {
  const binding = normalizeShortcutBindingValue(value)
  return Boolean(
    binding
      && binding.key === 'delete'
      && !binding.shift
      && !binding.ctrl
      && !binding.alt
      && !binding.meta,
  )
}

export function sanitizeEnglishShortcutMap(rawShortcutMap: unknown): EnglishPracticeShortcutMap {
  const raw =
    rawShortcutMap && typeof rawShortcutMap === 'object'
      ? (rawShortcutMap as Partial<Record<EnglishShortcutActionId, unknown>>)
      : {}
  // v2 settings only knew modifier-based actions. Treat them as absent so the
  // new no-modifier defaults apply instead of half-migrating into a hybrid map.
  const hasNewScheme = 'toggle_mask' in raw || 'cycle_layout' in raw || 'open_shortcuts' in raw
  const source = hasNewScheme ? raw : {}
  const occupied = new Set<string>()
  const nextShortcutMap = {} as EnglishPracticeShortcutMap

  for (const action of ENGLISH_SHORTCUT_ACTIONS) {
    const rawRequested = source[action.id] ?? DEFAULT_ENGLISH_SHORTCUTS[action.id]
    const requested = normalizeShortcutBindingValue(
      action.id === 'reset_sentence' && isLegacyResetBinding(rawRequested)
        ? DEFAULT_ENGLISH_SHORTCUTS.reset_sentence
        : rawRequested,
    )
    if (!requested || !isShortcutBindingAllowed(requested, ENGLISH_DICTATION_SHORTCUT_OPTIONS)) {
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

function sanitizeLayout(value: unknown): EnglishDictationLayout {
  return value === 'classic' || value === 'immersive' || value === 'theater'
    ? value
    : DEFAULT_ENGLISH_PRACTICE_SETTINGS.stage.layout
}

function sanitizePlaybackMode(value: unknown): EnglishPlaybackMode {
  return value === 'continuous' || value === 'single'
    ? value
    : DEFAULT_ENGLISH_PRACTICE_SETTINGS.playback.mode
}

export function sanitizeEnglishPracticeSettings(value: unknown): EnglishPracticeSettings {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const rawSound = raw.sound && typeof raw.sound === 'object' ? (raw.sound as Record<string, unknown>) : {}
  const rawFlow = raw.flow && typeof raw.flow === 'object' ? (raw.flow as Record<string, unknown>) : {}
  const rawReplay = raw.replay && typeof raw.replay === 'object' ? (raw.replay as Record<string, unknown>) : {}
  const rawPlayback = raw.playback && typeof raw.playback === 'object' ? (raw.playback as Record<string, unknown>) : {}
  const rawStage = raw.stage && typeof raw.stage === 'object' ? (raw.stage as Record<string, unknown>) : {}
  const rawMask = rawStage.mask && typeof rawStage.mask === 'object' ? (rawStage.mask as Record<string, unknown>) : {}
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
    playback: {
      mode: sanitizePlaybackMode(rawPlayback.mode),
    },
    stage: {
      layout: sanitizeLayout(rawStage.layout),
      playbackSpeed: sanitizeNumber(
        rawStage.playbackSpeed,
        DEFAULT_ENGLISH_PRACTICE_SETTINGS.stage.playbackSpeed,
        0.5,
        2,
      ),
      showFilmstrip: sanitizeBoolean(
        rawStage.showFilmstrip,
        DEFAULT_ENGLISH_PRACTICE_SETTINGS.stage.showFilmstrip,
      ),
      mask: {
        enabled: sanitizeBoolean(
          rawMask.enabled,
          DEFAULT_ENGLISH_PRACTICE_SETTINGS.stage.mask.enabled,
        ),
        blur: sanitizeNumber(
          rawMask.blur,
          DEFAULT_ENGLISH_PRACTICE_SETTINGS.stage.mask.blur,
          0,
          40,
        ),
        opacity: sanitizeNumber(
          rawMask.opacity,
          DEFAULT_ENGLISH_PRACTICE_SETTINGS.stage.mask.opacity,
          20,
          100,
        ),
      },
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
