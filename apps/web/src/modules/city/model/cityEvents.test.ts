import { describe, expect, it } from 'vitest'
import { cityCommandForFeedback } from './cityEvents'

describe('cityCommandForFeedback', () => {
  it('maps the four grades to city rating levels', () => {
    expect(cityCommandForFeedback('grade_forget')).toEqual({ type: 'rating', level: 1 })
    expect(cityCommandForFeedback('grade_hard')).toEqual({ type: 'rating', level: 2 })
    expect(cityCommandForFeedback('grade_good')).toEqual({ type: 'rating', level: 3 })
    expect(cityCommandForFeedback('grade_easy')).toEqual({ type: 'rating', level: 4 })
  })

  it('maps quiz results without inventing growth for wrong answers', () => {
    expect(cityCommandForFeedback('quiz_result_correct')).toEqual({ type: 'quiz', correct: true })
    expect(cityCommandForFeedback('quiz_result_incorrect')).toEqual({ type: 'quiz', correct: false })
  })

  it('maps meaningful mind-map edits and ignores micro interactions', () => {
    expect(cityCommandForFeedback('node_create')).toEqual({ type: 'pin' })
    expect(cityCommandForFeedback('node_move')).toEqual({ type: 'structure' })
    expect(cityCommandForFeedback('text_commit')).toEqual({ type: 'detail' })
    expect(cityCommandForFeedback('node_select')).toBeNull()
    expect(cityCommandForFeedback('pointer_click')).toBeNull()
  })
})
