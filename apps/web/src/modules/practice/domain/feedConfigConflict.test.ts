import { describe, expect, it } from 'vitest'
import { sanitizeFreestyleFeedConfig } from './feedConfig'

describe('freestyle config conflict repair', () => {
  it('repairs explicit quiz_only content toggles', () => {
    const config = sanitizeFreestyleFeedConfig({
      content: { mindmap_branch: true, anki_card: false, quiz_question: false },
      mix_mode: 'quiz_only',
    })
    expect(config.content).toEqual({ mindmap_branch: false, anki_card: false, quiz_question: true })
  })

  it('repairs explicit mindmap_only content toggles', () => {
    const config = sanitizeFreestyleFeedConfig({
      content: { mindmap_branch: false, anki_card: false, quiz_question: true },
      mix_mode: 'mindmap_only',
    })
    expect(config.content.mindmap_branch).toBe(true)
    expect(config.content.quiz_question).toBe(false)
  })
})
