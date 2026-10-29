import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FlipCardRevealSettingsDialog } from './FlipCardRevealSettingsDialog'
import { DEFAULT_FLIP_CARD_REVEAL_CONFIG } from '@/shared/preferences/flipCardRevealConfig'
import {
  readMemoryAnkiShortcuts,
  resetMemoryAnkiShortcuts,
} from '@/modules/settings/domain/preferences-entity/model/memoryAnkiShortcuts'

describe('FlipCardRevealSettingsDialog', () => {
  afterEach(() => resetMemoryAnkiShortcuts())

  it('lets the learner choose unit vs palace edit scope', () => {
    const onChange = vi.fn()
    render(
      <FlipCardRevealSettingsDialog
        open
        onOpenChange={vi.fn()}
        value={DEFAULT_FLIP_CARD_REVEAL_CONFIG}
        onChange={onChange}
        freestyleFlipMode={{ value: 'free', onChange: vi.fn() }}
      />,
    )

    expect(screen.getByTestId('flip-card-reveal-settings-dialog')).toBeTruthy()
    expect(screen.getByText('当前专线')).toBeTruthy()
    expect(screen.getByText('整座宫殿')).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: '整座宫殿' }))
    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_FLIP_CARD_REVEAL_CONFIG,
      editScope: 'palace',
    })
  })

  it('lets the learner turn Enter flip camera tracking off', () => {
    const onChange = vi.fn()
    render(
      <FlipCardRevealSettingsDialog
        open
        onOpenChange={vi.fn()}
        value={DEFAULT_FLIP_CARD_REVEAL_CONFIG}
        onChange={onChange}
        freestyleFlipMode={{ value: 'free', onChange: vi.fn() }}
      />,
    )

    fireEvent.click(screen.getByRole('switch', { name: 'Enter 翻卡镜头追踪' }))
    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_FLIP_CARD_REVEAL_CONFIG,
      enterRevealFollow: false,
    })
  })

  it('lets the learner turn on paging to the next unit after a rating', () => {
    const onChange = vi.fn()
    render(
      <FlipCardRevealSettingsDialog
        open
        onOpenChange={vi.fn()}
        value={DEFAULT_FLIP_CARD_REVEAL_CONFIG}
        onChange={onChange}
        freestyleFlipMode={{ value: 'free', onChange: vi.fn() }}
      />,
    )

    fireEvent.click(screen.getByRole('switch', { name: '评分后自动翻页' }))
    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_FLIP_CARD_REVEAL_CONFIG,
      autoAdvanceOnRate: true,
    })
  })

  it('opens the independent shortcut page from the flip settings', () => {
    render(
      <FlipCardRevealSettingsDialog
        open
        onOpenChange={vi.fn()}
        value={DEFAULT_FLIP_CARD_REVEAL_CONFIG}
        onChange={vi.fn()}
        freestyleFlipMode={{ value: 'free', onChange: vi.fn() }}
      />,
    )

    fireEvent.click(screen.getByRole('tab', { name: '快捷键' }))

    expect(screen.getByText('收卡')).toBeTruthy()
    expect(screen.getByText('上一张')).toBeTruthy()
    // 批量翻卡 lost its keyboard entry to the W/A/S/D view pan.
    expect(screen.queryByText('翻开下方全部子卡')).toBeNull()
    expect(screen.getAllByRole('button', { name: '录制' })).toHaveLength(5)
  })

  it('records a new 收卡 key and writes it immediately', () => {
    render(
      <FlipCardRevealSettingsDialog
        open
        onOpenChange={vi.fn()}
        value={DEFAULT_FLIP_CARD_REVEAL_CONFIG}
        onChange={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('tab', { name: '快捷键' }))

    const retractRow = screen.getByText('收卡').closest('.grid') as HTMLElement
    fireEvent.click(within(retractRow).getByRole('button', { name: '录制' }))
    act(() => {
      fireEvent.keyDown(window, { key: 'k', code: 'KeyK' })
    })

    expect(within(retractRow).getByText('K')).toBeTruthy()
    expect(readMemoryAnkiShortcuts().retract_current_card).toEqual({
      code: 'KeyK',
      key: 'k',
      shift: false,
      ctrl: false,
      alt: false,
      meta: false,
    })
  })

  it('accepts a bare Backspace for 收卡 and rejects the fixed page keys', () => {
    render(
      <FlipCardRevealSettingsDialog
        open
        onOpenChange={vi.fn()}
        value={DEFAULT_FLIP_CARD_REVEAL_CONFIG}
        onChange={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('tab', { name: '快捷键' }))

    const retractRow = screen.getByText('收卡').closest('.grid') as HTMLElement
    fireEvent.click(within(retractRow).getByRole('button', { name: '清除收卡快捷键' }))
    expect(within(retractRow).getByText('未设置')).toBeTruthy()

    fireEvent.click(within(retractRow).getByRole('button', { name: '录制' }))
    act(() => {
      fireEvent.keyDown(window, { key: 'Backspace', code: 'Backspace' })
    })
    expect(within(retractRow).getByText('Backspace')).toBeTruthy()
    expect(readMemoryAnkiShortcuts().retract_current_card?.code).toBe('Backspace')

    // Space / PageUp / PageDown / ← / → are the feed's fixed page keys.
    fireEvent.click(within(retractRow).getByRole('button', { name: '录制' }))
    act(() => {
      fireEvent.keyDown(window, { key: 'PageDown', code: 'PageDown' })
    })
    expect(screen.getByText(/保留给随心页翻页/)).toBeTruthy()
    expect(readMemoryAnkiShortcuts().retract_current_card?.code).toBe('Backspace')
  })

  it('keeps the rating auto-paging switch out of formal palace review', () => {
    render(
      <FlipCardRevealSettingsDialog
        open
        onOpenChange={vi.fn()}
        value={DEFAULT_FLIP_CARD_REVEAL_CONFIG}
        onChange={vi.fn()}
      />,
    )

    expect(screen.queryByRole('switch', { name: '评分后自动翻页' })).toBeNull()
  })
})
