import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MindMapCanvasToolbar } from './MindMapCanvasToolbar'

describe('MindMapCanvasToolbar', () => {
  it('renders page and canvas actions in one scrolling row without retired controls', () => {
    const onRefreshHost = vi.fn()
    render(
      <MindMapCanvasToolbar
        focusMode={false}
        canUndo
        canRedo={false}
        showHistoryControls
        leadingContent={<button type="button">学习组</button>}
        onRefreshHost={onRefreshHost}
        onToggleFocusMode={vi.fn()}
        onUndo={vi.fn()}
        onRedo={vi.fn()}
      />,
    )

    const toolbar = screen.getByRole('button', { name: '学习组' }).parentElement
    expect(toolbar?.className).toContain('flex-nowrap')
    expect(toolbar?.className).toContain('overflow-x-auto')
    expect(screen.getByTitle('刷新脑图')).toBeTruthy()
    expect(screen.getByTitle('进入网页内全屏')).toBeTruthy()
    expect(screen.getByTitle('撤销')).toBeTruthy()
    expect(screen.queryByTitle('手动整理画布')).toBeNull()
    expect(screen.queryByRole('button', { name: '整理画布' })).toBeNull()
    expect(screen.queryByTitle('放大')).toBeNull()
    expect(screen.queryByTitle('缩小')).toBeNull()
    expect(screen.queryByText(/拖拽时会即时预演落点/)).toBeNull()

    fireEvent.click(screen.getByTitle('刷新脑图'))
    expect(onRefreshHost).toHaveBeenCalledTimes(1)
  })
})
