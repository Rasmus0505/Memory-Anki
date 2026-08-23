import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_REVIEW_FEEDBACK_SETTINGS,
  applyFeedbackPreset,
  type ReviewFeedbackSettings,
} from '@/shared/feedback/reviewFeedbackSettings'
import { useFreestyleFlowFeedback } from './useFreestyleFlowFeedback'

const played: Array<{ event: string; volume?: number }> = []
let settings: ReviewFeedbackSettings = DEFAULT_REVIEW_FEEDBACK_SETTINGS

vi.mock('@/shared/feedback/mindmap-audio/useMindMapFeedback', () => ({
  useMindMapFeedbackSettings: () => settings,
  useMindMapFeedbackAudio: (enabled: boolean) => ({
    playEvent: (event: string, options?: { volume?: number }) => {
      if (!enabled) return
      played.push({ event, volume: options?.volume })
    },
    playComboMilestone: () => undefined,
  }),
}))

vi.mock('@/modules/practice/ui/freestyle/hooks/usePrefersReducedMotion', () => ({
  usePrefersReducedMotion: () => false,
}))

type Harness = ReturnType<typeof useFreestyleFlowFeedback>

function mount() {
  const captured: { current: Harness | null } = { current: null }
  function Probe() {
    captured.current = useFreestyleFlowFeedback()
    return null
  }
  const result = render(<Probe />)
  return { captured, ...result }
}

describe('useFreestyleFlowFeedback', () => {
  beforeEach(() => {
    played.length = 0
    settings = DEFAULT_REVIEW_FEEDBACK_SETTINGS
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('answers a reveal, which used to be entirely silent in freestyle', () => {
    const { captured } = mount()
    act(() => captured.current!.signalReveal())
    expect(played.map((item) => item.event)).toEqual(['card_reveal'])
  })

  it('rate-limits reveal audio so fast flipping stays information, not texture', () => {
    const { captured } = mount()
    act(() => {
      captured.current!.signalReveal()
      captured.current!.signalReveal()
      captured.current!.signalReveal()
    })
    expect(played).toHaveLength(1)
  })

  it('lets a deliberate second flip through once the gap has passed', () => {
    const { captured } = mount()
    act(() => captured.current!.signalReveal())
    act(() => {
      vi.advanceTimersByTime(120)
      captured.current!.signalReveal()
    })
    expect(played).toHaveLength(2)
  })

  it('confirms a passing rate with a commit tone and an affirm breath', () => {
    const { captured } = mount()
    act(() => captured.current!.signalRating(3, true))
    expect(played.map((item) => item.event)).toEqual(['field_commit'])
    expect(captured.current!.breath?.kind).toBe('affirm')
  })

  it('marks a palace chapter with all_clear_ready, not a rate tone', () => {
    const { captured } = mount()
    act(() => captured.current!.signalPalaceCleared())
    expect(played.map((item) => item.event)).toEqual(['all_clear_ready'])
    expect(captured.current!.breath?.kind).toBe('affirm')
  })

  it('never answers a weak rate with a miss sound', () => {
    const { captured } = mount()
    act(() => captured.current!.signalRating(1, false))
    expect(played.map((item) => item.event)).toEqual(['node_select'])
    expect(played.map((item) => item.event)).not.toContain('quiz_result_incorrect')
    expect(captured.current!.breath?.kind).toBe('note')
  })

  it('restarts the breath when a second rate lands inside the first window', () => {
    const { captured } = mount()
    act(() => captured.current!.signalRating(1, false))
    const first = captured.current!.breath?.nonce
    act(() => captured.current!.signalRating(3, true))
    expect(captured.current!.breath?.nonce).not.toBe(first)
    expect(captured.current!.breath?.kind).toBe('affirm')
  })

  it('clears the breath on its own so it cannot outlive the card', () => {
    const { captured } = mount()
    act(() => captured.current!.signalRating(3, true))
    expect(captured.current!.breath).not.toBeNull()
    act(() => {
      vi.advanceTimersByTime(600)
    })
    expect(captured.current!.breath).toBeNull()
  })

  /**
   * The 专注 preset exists so learning itself is silent. A rate confirmation that
   * ignored it would defeat the only setting the learner has for that.
   */
  it('stays silent under the 专注 preset', () => {
    settings = applyFeedbackPreset(DEFAULT_REVIEW_FEEDBACK_SETTINGS, 'focus')
    const { captured } = mount()
    act(() => {
      captured.current!.signalReveal()
      captured.current!.signalRating(3, true)
    })
    expect(played).toEqual([])
  })

  it('stays silent when sound is off entirely', () => {
    settings = { ...DEFAULT_REVIEW_FEEDBACK_SETTINGS, soundEnabled: false }
    const { captured } = mount()
    act(() => {
      captured.current!.signalReveal()
      captured.current!.signalRating(3, true)
    })
    expect(played).toEqual([])
  })

  it('skips the breath when animation is off but still confirms audibly', () => {
    settings = { ...DEFAULT_REVIEW_FEEDBACK_SETTINGS, animationEnabled: false }
    const { captured } = mount()
    act(() => captured.current!.signalRating(3, true))
    expect(played.map((item) => item.event)).toEqual(['field_commit'])
    expect(captured.current!.breath).toBeNull()
  })
})
