import * as React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ComboMilestoneBurst } from '@/shared/components/celebration/ComboMilestoneBurst'

describe('ComboMilestoneBurst', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('hides itself and calls onComplete after the configured duration', async () => {
    vi.useFakeTimers()
    const onComplete = vi.fn()

    render(
      <ComboMilestoneBurst
        milestoneStep={0}
        comboCount={3}
        copy="手感到了，继续揭晓。"
        durationMs={1300}
        onComplete={onComplete}
      />,
    )

    expect(screen.getByText('×3')).toBeTruthy()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1300)
    })

    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('×3')).toBeNull()
  })

  it('does not keep resetting the dismiss timer when parent rerenders with a new callback', async () => {
    vi.useFakeTimers()

    function Harness() {
      const [tick, setTick] = React.useState(0)
      return (
        <div>
          <button type="button" onClick={() => setTick((value) => value + 1)}>
            rerender {tick}
          </button>
          <ComboMilestoneBurst
            milestoneStep={0}
            comboCount={3}
            copy="手感到了，继续揭晓。"
            durationMs={1300}
            onComplete={() => undefined}
          />
        </div>
      )
    }

    render(<Harness />)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })

    const rerenderButton = screen.getByRole('button', { name: 'rerender 0' })
    await act(async () => {
      fireEvent.click(rerenderButton)
      fireEvent.click(rerenderButton)
      fireEvent.click(rerenderButton)
    })

    expect(screen.getByText('×3')).toBeTruthy()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(700)
    })

    expect(screen.queryByText('×3')).toBeNull()
  })
})
