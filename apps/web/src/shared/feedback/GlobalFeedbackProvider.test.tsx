import * as React from 'react'
import { act, fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { GlobalFeedbackProvider } from '@/shared/feedback/GlobalFeedbackProvider'
import { dispatchGlobalFeedback } from '@/shared/feedback/globalFeedbackModel'

const playEvent = vi.fn()

vi.mock('@/shared/components/mindmap-host/useMindMapFeedback', () => ({
  useMindMapFeedbackSettings: () => ({
    animationEnabled: true,
    mode: 'immersive',
    soundEnabled: true,
    volume: 1,
    baseVolumeMultiplier: 1,
  }),
  useMindMapFeedbackAudio: () => ({ playEvent }),
}))

describe('GlobalFeedbackProvider', () => {
  it('does not turn ordinary DOM interactions into global feedback', () => {
    const view = render(
      <GlobalFeedbackProvider>
        <button type="button">普通按钮</button>
        <input aria-label="普通输入" />
      </GlobalFeedbackProvider>,
    )

    fireEvent.pointerDown(view.getByRole('button'))
    fireEvent.click(view.getByRole('button'))
    fireEvent.focus(view.getByRole('textbox'))
    fireEvent.keyDown(view.getByRole('textbox'), { key: 'a' })

    expect(playEvent).not.toHaveBeenCalled()
  })

  it('still renders explicitly dispatched learning feedback', () => {
    render(
      <GlobalFeedbackProvider>
        <div>content</div>
      </GlobalFeedbackProvider>,
    )

    act(() => dispatchGlobalFeedback('quiz_result_correct'))
    expect(playEvent).toHaveBeenCalledWith('quiz_result_correct', {
      origin: 'review',
      audioScope: 'local',
    })
  })
})
