import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_ENGLISH_PRACTICE_SETTINGS,
  type EnglishPracticeSettings,
} from '@/modules/settings/public'
import { DEFAULT_MASK_RECT } from '../dictationLayout'
import { DictationShortcutPanel } from './DictationShortcutPanel'

function renderPanel(settings: EnglishPracticeSettings = DEFAULT_ENGLISH_PRACTICE_SETTINGS) {
  const onSave = vi.fn()
  const onClose = vi.fn()
  render(
    <DictationShortcutPanel
      open
      settings={settings}
      onClose={onClose}
      onSave={onSave}
      onResetMask={vi.fn()}
      onFullWidthMask={vi.fn()}
      maskRect={DEFAULT_MASK_RECT}
    />,
  )
  return { onSave, onClose }
}

function rowFor(label: string) {
  const labelNode = screen.getByText(label)
  const row = labelNode.closest('.ed-shortcut-row')
  expect(row).toBeTruthy()
  return row as HTMLElement
}

describe('DictationShortcutPanel', () => {
  it('records a bare function key and applies it', async () => {
    const { onSave } = renderPanel()
    const row = rowFor('揭示一个字母')

    fireEvent.click(within(row).getByRole('button', { name: '录制' }))
    expect(within(row).getByRole('button', { name: '取消' })).toBeTruthy()

    fireEvent.keyDown(window, { key: 'F4', code: 'F4' })

    await waitFor(() => {
      expect(within(row).getByText('F4')).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: /应用设置/ }))

    expect(onSave).toHaveBeenCalledTimes(1)
    const saved = onSave.mock.calls[0][0] as EnglishPracticeSettings
    expect(saved.shortcuts.reveal_letter).toEqual({
      code: 'F4',
      key: 'f4',
      shift: false,
      ctrl: false,
      alt: false,
      meta: false,
    })
  })

  it('rejects a bare typing letter while recording', async () => {
    renderPanel()
    const row = rowFor('揭示当前单词')
    fireEvent.click(within(row).getByRole('button', { name: '录制' }))

    fireEvent.keyDown(window, { key: 'x', code: 'KeyX' })

    expect(await screen.findByText(/答题输入键/)).toBeTruthy()
    expect(within(row).getByRole('button', { name: '取消' })).toBeTruthy()
  })

  it('reports a conflict with another action instead of overwriting it', async () => {
    renderPanel()
    const row = rowFor('揭示一个字母')
    fireEvent.click(within(row).getByRole('button', { name: '录制' }))

    fireEvent.keyDown(window, { key: 'ArrowDown', code: 'ArrowDown' })

    expect(await screen.findByText(/与「揭示当前单词」冲突/)).toBeTruthy()
    fireEvent.click(within(row).getByRole('button', { name: '取消' }))
    expect(within(row).getByText('ArrowUp')).toBeTruthy()
  })

  it('switches the default playback mode to continuous', async () => {
    const { onSave } = renderPanel()
    expect(screen.getByRole('radio', { name: '单句播放' }).getAttribute('aria-checked')).toBe('true')

    fireEvent.click(screen.getByRole('radio', { name: '连播整段' }))
    fireEvent.click(screen.getByRole('button', { name: /应用设置/ }))

    const saved = onSave.mock.calls[0][0] as EnglishPracticeSettings
    expect(saved.playback.mode).toBe('continuous')
  })

  it('cancels recording with Shift+Escape and closes the panel with Escape', async () => {
    const { onClose } = renderPanel()
    const row = rowFor('揭示一个字母')
    fireEvent.click(within(row).getByRole('button', { name: '录制' }))
    fireEvent.keyDown(window, { key: 'Escape', code: 'Escape', shiftKey: true })

    await waitFor(() => {
      expect(within(row).getByRole('button', { name: '录制' })).toBeTruthy()
    })
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('restores the default shortcut map', async () => {
    const custom: EnglishPracticeSettings = {
      ...DEFAULT_ENGLISH_PRACTICE_SETTINGS,
      shortcuts: {
        ...DEFAULT_ENGLISH_PRACTICE_SETTINGS.shortcuts,
        replay_sentence: { code: 'F4', key: 'f4', shift: false, ctrl: false, alt: false, meta: false },
      },
    }
    const { onSave } = renderPanel(custom)
    expect(within(rowFor('重播本句')).getByText('F4')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /恢复默认快捷键/ }))
    expect(within(rowFor('重播本句')).getByText('Space')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /应用设置/ }))

    const saved = onSave.mock.calls[0][0] as EnglishPracticeSettings
    expect(saved.shortcuts.replay_sentence?.key).toBe('space')
  })
})
