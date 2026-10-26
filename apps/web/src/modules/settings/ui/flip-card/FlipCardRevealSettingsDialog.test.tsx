import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FlipCardRevealSettingsDialog } from './FlipCardRevealSettingsDialog'
import { DEFAULT_FLIP_CARD_REVEAL_CONFIG } from '@/shared/preferences/flipCardRevealConfig'

describe('FlipCardRevealSettingsDialog', () => {
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
