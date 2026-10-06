import { describe, expect, it } from 'vitest'
import {
  consumeFreestyleWheel,
  idleFreestyleWheelPaging,
  FREESTYLE_WHEEL_NOTCH_LOCK_MS,
  FREESTYLE_WHEEL_TRACKPAD_LOCK_MS,
} from './freestyleWheelPaging'

describe('freestyle wheel paging', () => {
  it('turns one mouse notch into one page and swallows the rest of that notch', () => {
    const first = consumeFreestyleWheel(idleFreestyleWheelPaging(), { deltaX: 0, deltaY: 100 }, 1_000)
    expect(first).toMatchObject({ decision: 'page', direction: 1 })

    const burst = consumeFreestyleWheel(first.next, { deltaX: 0, deltaY: 100 }, 1_040)
    expect(burst.decision).toBe('hold')
    expect(burst.direction).toBe(0)

    const nextNotch = consumeFreestyleWheel(
      first.next,
      { deltaX: 0, deltaY: -120 },
      1_000 + FREESTYLE_WHEEL_NOTCH_LOCK_MS,
    )
    expect(nextNotch).toMatchObject({ decision: 'page', direction: -1 })
  })

  it('coalesces trackpad ticks so inertia does not skip the feed', () => {
    let state = idleFreestyleWheelPaging()
    let decision = 'hold'
    for (let step = 0; step < 4; step += 1) {
      const consumed = consumeFreestyleWheel(state, { deltaX: 0, deltaY: 12 }, 2_000 + step)
      state = consumed.next
      decision = consumed.decision
    }
    expect(decision).toBe('hold')

    const page = consumeFreestyleWheel(state, { deltaX: 0, deltaY: 12 }, 2_010)
    expect(page).toMatchObject({ decision: 'page', direction: 1 })

    const inertia = consumeFreestyleWheel(page.next, { deltaX: 0, deltaY: 16 }, 2_200)
    expect(inertia.decision).toBe('hold')
    expect(page.next.lockedUntil - 2_010).toBe(FREESTYLE_WHEEL_TRACKPAD_LOCK_MS)
  })

  it('leaves ctrl-wheel and horizontal gestures to zoom and nested scroll', () => {
    const idle = idleFreestyleWheelPaging()
    expect(consumeFreestyleWheel(idle, { deltaX: 0, deltaY: -100, ctrlKey: true }, 0).decision).toBe('ignore')
    expect(consumeFreestyleWheel(idle, { deltaX: 80, deltaY: 20 }, 0).decision).toBe('ignore')
    expect(consumeFreestyleWheel(idle, { deltaX: 0, deltaY: -1, deltaMode: 1 }, 0)).toMatchObject({
      decision: 'page',
      direction: -1,
    })
  })
})
