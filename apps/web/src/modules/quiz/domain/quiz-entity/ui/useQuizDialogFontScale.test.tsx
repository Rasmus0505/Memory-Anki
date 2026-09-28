import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetClientPreferenceCacheForTest } from '@/shared/preferences/clientPreferences'
import { QuizFontScaleBody } from './QuizFontScaleBody'
import { QuizFontScaleHint } from './QuizFontScaleHint'
import { useQuizDialogFontScale } from './useQuizDialogFontScale'
import { readQuizFontScale } from '@/modules/quiz/domain/quiz-entity/model/quizFontScaleSettings'

function Harness({ active = true }: { active?: boolean }) {
  const fontScale = useQuizDialogFontScale(active)
  return (
    <div ref={fontScale.contentRef} data-testid="quiz-dialog">
      <QuizFontScaleHint percent={fontScale.percent} visible={fontScale.hintVisible} />
      <QuizFontScaleBody percent={fontScale.percent}>
        <p>题干</p>
      </QuizFontScaleBody>
      <span>题号</span>
    </div>
  )
}

function wheel(deltaY: number, ctrlKey: boolean) {
  const event = new WheelEvent('wheel', {
    deltaY,
    ctrlKey,
    bubbles: true,
    cancelable: true,
  })
  act(() => {
    screen.getByText('题干').dispatchEvent(event)
  })
  return event
}

describe('useQuizDialogFontScale', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    window.localStorage.clear()
    resetClientPreferenceCacheForTest()
  })

  afterEach(() => {
    vi.useRealTimers()
    resetClientPreferenceCacheForTest()
  })

  it('enlarges only the question body on ctrl+wheel and remembers the percent', () => {
    render(<Harness />)
    const body = screen.getByTestId('quiz-font-scale-body')
    expect(body.style.zoom).toBe('100%')
    expect(body.contains(screen.getByText('题干'))).toBe(true)
    expect(body.contains(screen.getByText('题号'))).toBe(false)

    const zoomIn = wheel(-100, true)
    expect(zoomIn.defaultPrevented).toBe(true)
    expect(body.style.zoom).toBe('110%')
    expect(screen.getByTestId('quiz-font-scale-hint').textContent).toBe('110%')

    const scrolled = wheel(100, false)
    expect(scrolled.defaultPrevented).toBe(false)
    expect(body.style.zoom).toBe('110%')

    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(readQuizFontScale()).toBe(110)

    act(() => {
      screen.getByText('题干').dispatchEvent(
        new KeyboardEvent('keydown', { key: '0', ctrlKey: true, bubbles: true, cancelable: true }),
      )
    })
    expect(body.style.zoom).toBe('100%')
    expect(screen.getByTestId('quiz-font-scale-hint').textContent).toBe('100%')
  })

  it('stops at 180% and hides the percent after a moment', () => {
    render(<Harness />)
    for (let index = 0; index < 12; index += 1) wheel(-100, true)
    expect(screen.getByTestId('quiz-font-scale-body').style.zoom).toBe('180%')
    act(() => {
      vi.advanceTimersByTime(900)
    })
    expect(screen.queryByTestId('quiz-font-scale-hint')).toBeNull()
  })

  it('ignores ctrl+wheel outside the dialog', () => {
    render(
      <div>
        <Harness />
        <p>外面</p>
      </div>,
    )
    const outside = new WheelEvent('wheel', {
      deltaY: -100,
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })
    act(() => {
      screen.getByText('外面').dispatchEvent(outside)
    })
    expect(outside.defaultPrevented).toBe(false)
    expect(screen.getByTestId('quiz-font-scale-body').style.zoom).toBe('100%')
  })
})
