export const SUPPORTED_LOCALES = ['zh-CN', 'en-US'] as const

export type AppLocale = (typeof SUPPORTED_LOCALES)[number]

export const DEFAULT_LOCALE: AppLocale = 'zh-CN'

export const APP_MESSAGES = {
  'command.searchPlaceholder': {
    'zh-CN': '搜索操作、宫殿、记忆桩、题目、章节...（Ctrl+K）',
    'en-US': 'Search actions, palaces, pegs, questions, chapters... (Ctrl+K)',
  },
  'command.noResults': {
    'zh-CN': '没有找到对应操作。',
    'en-US': 'No matching action found.',
  },
  'command.group.recent': {
    'zh-CN': '最近访问',
    'en-US': 'Recent',
  },
  'command.group.actions': {
    'zh-CN': '操作',
    'en-US': 'Actions',
  },
  'command.group.shortcuts': {
    'zh-CN': '快捷键',
    'en-US': 'Shortcuts',
  },
  'command.group.pages': {
    'zh-CN': '页面',
    'en-US': 'Pages',
  },
} as const

export type AppMessageKey = keyof typeof APP_MESSAGES

function normalizeLocale(locale: string | null | undefined): AppLocale {
  return SUPPORTED_LOCALES.includes(locale as AppLocale) ? (locale as AppLocale) : DEFAULT_LOCALE
}

export function getAppLocale(rawLocale?: string | null): AppLocale {
  if (rawLocale) return normalizeLocale(rawLocale)
  if (typeof navigator !== 'undefined') {
    return normalizeLocale(navigator.language)
  }
  return DEFAULT_LOCALE
}

export function translateAppMessage(
  key: AppMessageKey,
  params?: Record<string, string | number>,
  locale: AppLocale = DEFAULT_LOCALE,
) {
  const template = APP_MESSAGES[key][locale] ?? APP_MESSAGES[key][DEFAULT_LOCALE]
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`))
}
