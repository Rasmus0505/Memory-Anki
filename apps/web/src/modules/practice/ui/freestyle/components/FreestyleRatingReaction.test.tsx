import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  publishFreestyleRatingPulse,
  recordFreestyleComboRating,
  resetFreestyleCombo,
} from '@/modules/practice/ui/freestyle/model/freestyleComboStore'
import { FreestyleRatingReaction } from './FreestyleRatingReaction'

const particles = vi.hoisted(() => ({
  emitRatingBurst: vi.fn(),
  emitKeycapShockwave: vi.fn(),
  emitCollectors: vi.fn(),
  emitComboMilestone: vi.fn(),
  stampOn: vi.fn(),
  milestoneOn: true,
}))

vi.mock('@/shared/feedback/particles', () => ({
  emitRatingBurst: particles.emitRatingBurst,
  emitKeycapShockwave: particles.emitKeycapShockwave,
  emitCollectors: particles.emitCollectors,
  emitComboMilestone: particles.emitComboMilestone,
  rectCenter: (rect: DOMRect) => ({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }),
}))

vi.mock('./freestyleParticleScenes', () => ({
  freestyleMotionOn: () => true,
  milestoneEffectsOn: () => particles.milestoneOn,
  progressTargetPoint: () => null,
  viewingSegment: () => null,
  chargeSegment: vi.fn(),
  playLandingChime: vi.fn(),
  stampOn: particles.stampOn,
  flashVignette: vi.fn(),
}))

function renderCard() {
  const view = render(
    <FreestyleRatingReaction active>
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

describe('FreestyleRatingReaction particles', () => {
  beforeEach(() => {
    resetFreestyleCombo()
    particles.milestoneOn = true
  })
  afterEach(() => vi.clearAllMocks())

  it('bursts from the pressed keycap and sends collectors to the progress rail', () => {
    renderCard()
    rate()
    expect(particles.emitRatingBurst).toHaveBeenCalledWith({ x: 130, y: 404 }, 3, 1)
    expect(particles.emitKeycapShockwave).toHaveBeenCalledWith({ x: 130, y: 404 }, 3)
    expect(particles.emitCollectors).toHaveBeenCalledWith(expect.objectContaining({ origin: { x: 130, y: 404 }, rating: 3, combo: 1 }))
    expect(particles.emitComboMilestone).not.toHaveBeenCalled()
  })

  it('celebrates a combo milestone only when the milestone scene is enabled', () => {
    renderCard()
    rate([1])
    expect(particles.emitComboMilestone).toHaveBeenCalledTimes(1)
    expect(particles.stampOn).toHaveBeenCalledWith(expect.any(HTMLElement), '连击 ×1')

    act(() => resetFreestyleCombo())
    particles.milestoneOn = false
    rate([1])
    expect(particles.emitComboMilestone).toHaveBeenCalledTimes(1)
  })
})
