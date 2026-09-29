import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  publishFreestyleRatingPulse,
  recordFreestyleComboRating,
  resetFreestyleCombo,
} from '@/modules/practice/ui/freestyle/model/freestyleComboStore'
import { FreestyleRatingReaction } from './FreestyleRatingReaction'

const fx = vi.hoisted(() => ({ cue: vi.fn() }))

vi.mock('@/shared/fx', () => ({
  cue: fx.cue,
  useFxOwner: (owner: string) => owner,
}))

function renderCard(active = true) {
  const view = render(
    <FreestyleRatingReaction active={active}>
      <button type="button" data-testid="freestyle-rating-button-3">记得</button>
    </FreestyleRatingReaction>,
  )
  const button = view.getByTestId('freestyle-rating-button-3')
  button.getBoundingClientRect = () => ({ left: 100, top: 400, width: 60, height: 40, right: 160, bottom: 440, x: 100, y: 400, toJSON: () => ({}) })
  return view
}

function rate(steps: readonly number[] = []) {
  act(() => {
    recordFreestyleComboRating(true, steps)
    publishFreestyleRatingPulse(3, 'lift')
  })
}

describe('FreestyleRatingReaction cue', () => {
  beforeEach(() => resetFreestyleCombo())
  afterEach(() => vi.clearAllMocks())

  it('cues grade.commit from the pressed keycap top with combo and an owner', () => {
    renderCard()
    rate()
    expect(fx.cue).toHaveBeenCalledTimes(1)
    const [name, payload, options] = fx.cue.mock.calls[0]
    expect(name).toBe('grade.commit')
    expect(payload).toMatchObject({ origin: { x: 130, y: 404 }, grade: 3, combo: 1, milestone: false, allowRare: true })
    expect(options.owner).toMatch(/^grade:.*:on$/)
  })

  it('flags a crossed combo milestone', () => {
    renderCard()
    rate([1])
    expect(fx.cue.mock.calls[0][1]).toMatchObject({ milestone: true, combo: 1 })
  })

  it('stays silent on a card that is not being read', () => {
    renderCard(false)
    rate()
    expect(fx.cue).not.toHaveBeenCalled()
  })
})
