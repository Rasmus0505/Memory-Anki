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
})
