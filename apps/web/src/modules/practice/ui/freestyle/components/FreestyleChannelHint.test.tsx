import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FreestyleChannelHint } from './FreestyleChannelHint'

function renderHint(overrides: Partial<Parameters<typeof FreestyleChannelHint>[0]> = {}) {
  const onApply = vi.fn()
  const onDismiss = vi.fn()
  render(
    <FreestyleChannelHint
      state="anxious"
      hint="最近 8 张偏难"
      actionLabel="只留到期的"
      onApply={onApply}
      onDismiss={onDismiss}
      {...overrides}
    />,
  )
  return { onApply, onDismiss }
}

describe('FreestyleChannelHint', () => {
  it('states the reading and offers the correction in one tap', () => {
    const { onApply } = renderHint()

    expect(screen.getByTestId('freestyle-channel-hint').textContent).toContain('最近 8 张偏难')
    fireEvent.click(screen.getByTestId('freestyle-channel-hint-apply'))
    expect(onApply).toHaveBeenCalledTimes(1)
  })

  it('can be declined, so a suggestion never becomes a nag', () => {
    const { onDismiss, onApply } = renderHint()

    fireEvent.click(screen.getByTestId('freestyle-channel-hint-dismiss'))
    expect(onDismiss).toHaveBeenCalledTimes(1)
    expect(onApply).not.toHaveBeenCalled()
  })

  it('distinguishes the two exits from the channel', () => {
    const { unmount } = render(
      <FreestyleChannelHint
        state="anxious"
        hint="偏难"
        actionLabel="只留到期的"
        onApply={vi.fn()}
        onDismiss={vi.fn()}
      />,
    )
    expect(screen.getByTestId('freestyle-channel-hint').getAttribute('data-state')).toBe('anxious')
    unmount()

    renderHint({ state: 'bored', hint: '偏轻', actionLabel: '加点新的' })
    expect(screen.getByTestId('freestyle-channel-hint').getAttribute('data-state')).toBe('bored')
  })

  it('blocks a second apply while the rebuild is in flight', () => {
    const { onApply } = renderHint({ busy: true })

    const apply = screen.getByTestId('freestyle-channel-hint-apply')
    expect(apply.hasAttribute('disabled')).toBe(true)
    fireEvent.click(apply)
    expect(onApply).not.toHaveBeenCalled()
  })

  /** It sits above the rating bar: the bottom edge belongs to rating, the top to the rail. */
  it('stays out of the rating bar and the rail', () => {
    renderHint()
    const className = screen.getByTestId('freestyle-channel-hint').className
    expect(className).toContain('bottom-[5.25rem]')
    expect(className).toContain('pointer-events-none')
  })
})
