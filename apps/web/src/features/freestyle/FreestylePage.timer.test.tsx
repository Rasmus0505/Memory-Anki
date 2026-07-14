import { fireEvent, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  freestyleTimer,
  quizCard,
  renderPage,
  setupFreestylePageTest,
} from './FreestylePage.test-support'

describe('FreestylePage timer', () => {
  beforeEach(setupFreestylePageTest)

  it('keeps the timer active while swiping through cards', async () => {
    renderPage([quizCard(1), quizCard(2)])

    await screen.findByText('选择题 1')
    const scroller = document.querySelector('[data-page-history-scroll-key="freestyle-cards"]')
    expect(scroller).toBeTruthy()
    Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 600 })
    Object.defineProperty(scroller, 'scrollTop', { configurable: true, value: 600 })
    fireEvent.scroll(scroller as Element)

    expect(freestyleTimer.registerActivity).toHaveBeenCalledWith(
      'practice_interaction',
      { source: 'freestyle_scroll' },
    )
  })
})