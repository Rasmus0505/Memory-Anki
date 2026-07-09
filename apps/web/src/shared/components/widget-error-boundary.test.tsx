import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WidgetErrorBoundary } from './widget-error-boundary'

let shouldThrow = false

function FlakyWidget() {
  if (shouldThrow) throw new Error('widget boom')
  return <div>widget content</div>
}

describe('WidgetErrorBoundary', () => {
  beforeEach(() => {
    shouldThrow = false
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('keeps widget failures local and can retry rendering', () => {
    shouldThrow = true
    render(
      <div>
        <h1>page header</h1>
        <WidgetErrorBoundary label="图表">
          <FlakyWidget />
        </WidgetErrorBoundary>
      </div>,
    )

    expect(screen.getByText('page header')).toBeTruthy()
    expect(screen.getByText('图表渲染失败，页面其他部分不受影响。')).toBeTruthy()

    shouldThrow = false
    fireEvent.click(screen.getByRole('button', { name: '重试渲染' }))

    expect(screen.getByText('widget content')).toBeTruthy()
    expect(screen.getByText('page header')).toBeTruthy()
  })
})
