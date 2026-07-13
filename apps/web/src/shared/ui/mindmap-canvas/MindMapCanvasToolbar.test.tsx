import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MindMapCanvasToolbar } from './MindMapCanvasToolbar'

describe('MindMapCanvasToolbar', () => {
  it('renders page and canvas actions in one scrolling row without retired controls', () => {
    const onReflow = vi.fn()
    render(
      <MindMapCanvasToolbar
        focusMode={false}
        canUndo
        canRedo={false}
        showHistoryControls
        leadingContent={<button type="button">学习组</button>}
        onReflow={onReflow}
        onToggleFocusMode={vi.fn()}
        onUndo={vi.fn()}
        onRedo={vi.fn()}
      />,
    )

    const toolbar = screen.getByRole('button', { name: '学习组' }).parentElement
    expect(toolbar?.className).toContain('flex-nowrap')
    expect(toolbar?.className).toContain('overflow-x-auto')
    expect(screen.queryByTitle('刷新脑图')).toBeNull()
    expect(screen.queryByTitle('放大')).toBeNull()
    expect(screen.queryByTitle('缩小')).toBeNull()
    expect(screen.queryByText(/拖拽时会即时预演落点/)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '整理画布' }))
    expect(onReflow).toHaveBeenCalledTimes(1)
  })
})
