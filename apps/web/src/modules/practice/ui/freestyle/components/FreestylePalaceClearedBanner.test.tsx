import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FreestylePalaceClearedBanner } from './FreestylePalaceClearedBanner'

describe('FreestylePalaceClearedBanner', () => {
  it('renders clearance copy', () => {
    render(
      <FreestylePalaceClearedBanner
        clearance={{ palaceId: 1, palaceTitle: '卢梭', leftoverDue: 0 }}
        onDismiss={vi.fn()}
      />,
    )

    expect(screen.getByTestId('freestyle-palace-cleared').textContent).toContain(
      '《卢梭》今日到期已清',
    )
    expect(screen.getByTestId('freestyle-palace-cleared').textContent).toContain('点一下关闭')
  })

  it('calls onDismiss when the chip is clicked', () => {
    const onDismiss = vi.fn()
    render(
      <FreestylePalaceClearedBanner
        clearance={{ palaceId: 1, palaceTitle: '卢梭', leftoverDue: 0 }}
        onDismiss={onDismiss}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '关闭宫殿已清提示' }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})
