import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FreestyleFeedErrorState, FreestyleLoadingState } from './FreestyleFeedStates'

describe('FreestyleFeedStates', () => {
  it('marks the loading state busy while the queue is being prepared', () => {
    const { container } = render(<FreestyleLoadingState />)
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy()
    expect(screen.getByText('正在准备今天的内容…')).toBeTruthy()
  })

  it('offers a retry that reloads the feed with the same config', () => {
    const onLoadFeed = vi.fn().mockResolvedValue(undefined)
    const config = { seed: 1 } as never
    render(
      <FreestyleFeedErrorState
        feedError="network down"
        mode="free"
        config={config}
        onLoadFeed={onLoadFeed}
        onCopyDiagnostics={vi.fn().mockResolvedValue(undefined)}
      />,
    )
    expect(screen.getByText('队列加载失败')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /重试/ }))
    expect(onLoadFeed).toHaveBeenCalledWith(config)
  })
})
