import { describe, expect, it } from 'vitest'
import { resolveFeedbackPolicy } from '@/shared/feedback/feedbackPolicy'

describe('feedback policy', () => {
  it('keeps ordinary success and validation feedback local', () => {
    expect(resolveFeedbackPolicy({ kind: 'operation_success' })).toMatchObject({
      surface: 'inline',
      audio: 'none',
    })
    expect(resolveFeedbackPolicy({ kind: 'operation_error' })).toMatchObject({
      surface: 'inline',
      audio: 'none',
    })
  })

  it('uses toast only when a result is outside its visible owning surface', () => {
    expect(resolveFeedbackPolicy({ kind: 'task_complete', visibility: 'background' }).surface).toBe('toast')
    expect(resolveFeedbackPolicy({ kind: 'task_complete', visibility: 'local' }).surface).toBe('task')
  })

  it('never celebrates an ordinary correct answer', () => {
    expect(resolveFeedbackPolicy({ kind: 'quiz_correct' })).toMatchObject({
      surface: 'learning',
      celebration: 'none',
    })
    expect(resolveFeedbackPolicy({ kind: 'milestone' }).celebration).toBe('milestone')
    expect(resolveFeedbackPolicy({ kind: 'completion' }).celebration).toBe('completion')
  })
})
