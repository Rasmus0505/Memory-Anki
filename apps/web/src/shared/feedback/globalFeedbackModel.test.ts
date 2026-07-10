import { describe, expect, it, vi } from 'vitest'
import {
  GLOBAL_FEEDBACK_REQUEST_EVENT,
  createMindMapFeedbackDescriptor,
  dispatchGlobalFeedback,
  getMindMapFeedbackProfile,
} from '@/shared/feedback/globalFeedbackModel'

describe('globalFeedbackModel', () => {
  it('maps explicit semantic events to layered profiles', () => {
    expect(createMindMapFeedbackDescriptor('session_complete')).toMatchObject({
      level: 'milestone',
      visualKind: 'reward',
      screenPulse: 'celebration',
    })
    expect(getMindMapFeedbackProfile('quiz_generate_save')).toMatchObject({
      level: 'milestone',
      origin: 'system',
      audioScope: 'global',
    })
  })

  it('dispatches only intentional semantic requests', () => {
    const listener = vi.fn()
    window.addEventListener(GLOBAL_FEEDBACK_REQUEST_EVENT, listener)
    dispatchGlobalFeedback('quiz_result_correct', { audioScope: 'local' })
    window.removeEventListener(GLOBAL_FEEDBACK_REQUEST_EVENT, listener)

    expect(listener).toHaveBeenCalledTimes(1)
    expect((listener.mock.calls[0][0] as CustomEvent).detail).toEqual({
      event: 'quiz_result_correct',
      audioScope: 'local',
    })
  })
})
