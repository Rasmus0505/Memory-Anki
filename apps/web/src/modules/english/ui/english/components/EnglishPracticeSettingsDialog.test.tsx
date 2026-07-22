import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { EnglishPracticeSettingsDialog } from '@/modules/english/ui/english/components/EnglishPracticeSettingsDialog'
import { DEFAULT_ENGLISH_PRACTICE_SETTINGS } from '@/modules/settings/public'

describe('EnglishPracticeSettingsDialog', () => {
  it('captures and saves a valid Shift+K shortcut binding', () => {
    const onSave = vi.fn()

    render(
      <EnglishPracticeSettingsDialog
        open
        settings={DEFAULT_ENGLISH_PRACTICE_SETTINGS}
        onOpenChange={vi.fn()}
        onSave={onSave}
      />,
    )

    fireEvent.click(screen.getAllByRole('button', { name: '录制' })[0])
    fireEvent.keyDown(window, { key: 'K', code: 'KeyK', shiftKey: true })
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }))

    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave.mock.calls[0][0].shortcuts.replay_sentence).toEqual({
      code: 'KeyK',
      key: 'k',
      shift: true,
      ctrl: false,
      alt: false,
      meta: false,
    })
  })

  it('saves the auto advance toggle in the persisted settings payload', () => {
    const onSave = vi.fn()

    render(
      <EnglishPracticeSettingsDialog
        open
        settings={DEFAULT_ENGLISH_PRACTICE_SETTINGS}
        onOpenChange={vi.fn()}
        onSave={onSave}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '自动下一句开启' }))
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }))

    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave.mock.calls[0][0].flow.autoAdvanceOnPass).toBe(false)
  })

  it('keeps the row in recording mode and shows an inline error for bare typing keys', () => {
    render(
      <EnglishPracticeSettingsDialog
        open
        settings={DEFAULT_ENGLISH_PRACTICE_SETTINGS}
        onOpenChange={vi.fn()}
        onSave={vi.fn()}
      />,
    )

    fireEvent.click(screen.getAllByRole('button', { name: '录制' })[0])
    fireEvent.keyDown(window, { key: 'k', code: 'KeyK' })

    expect(screen.getByText('「K」是答题输入键，容易误触。请改用 Shift、Ctrl、Alt 或 Meta 组合。')).toBeTruthy()
    expect(screen.getByRole('button', { name: '取消录制' })).toBeTruthy()
    expect(screen.getByText('按键录制中…')).toBeTruthy()
  })

  it('persists masterVolume changes through save', () => {
    const onSave = vi.fn()

    render(
      <EnglishPracticeSettingsDialog
        open
        settings={DEFAULT_ENGLISH_PRACTICE_SETTINGS}
        onOpenChange={vi.fn()}
        onSave={onSave}
      />,
    )

    const slider = screen.getByLabelText('总音量') as HTMLInputElement
    expect(slider).toBeTruthy()
    expect(slider.value).toBe('0.5')

    fireEvent.change(slider, { target: { value: '0.75' } })
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }))

    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave.mock.calls[0][0].sound.masterVolume).toBe(0.75)
    expect(onSave.mock.calls[0][0].sound.enabled).toBe(true)
  })
})
