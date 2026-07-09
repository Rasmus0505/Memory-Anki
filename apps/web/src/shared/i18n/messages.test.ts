import { describe, expect, it } from 'vitest'
import { getAppLocale, translateAppMessage } from './messages'

describe('app i18n messages', () => {
  it('falls back to Chinese for unsupported browser locales', () => {
    expect(getAppLocale('fr-FR')).toBe('zh-CN')
  })

  it('translates known keys and falls back per message', () => {
    expect(translateAppMessage('command.group.actions', undefined, 'en-US')).toBe('Actions')
    expect(translateAppMessage('command.group.actions', undefined, 'zh-CN')).toBe('操作')
  })

  it('keeps unresolved interpolation placeholders visible', () => {
    expect(translateAppMessage('command.group.actions', { count: 3 }, 'en-US')).toBe('Actions')
  })
})
