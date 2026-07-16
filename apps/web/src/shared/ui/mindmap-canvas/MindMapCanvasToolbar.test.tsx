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
    expect(screen.getByTitle('进入全屏')).toBeTruthy()
    expect(screen.queryByTitle('进入系统全屏')).toBeNull()
    expect(screen.getByTitle('撤销')).toBeTruthy()
    expect(screen.queryByTitle('手动整理画布')).toBeNull()
    expect(screen.queryByRole('button', { name: '整理画布' })).toBeNull()
    expect(screen.queryByTitle('放大')).toBeNull()
    expect(screen.queryByTitle('缩小')).toBeNull()
    expect(screen.queryByText(/拖拽时会即时预演落点/)).toBeNull()

    fireEvent.click(screen.getByTitle('刷新脑图'))
    expect(onRefreshHost).toHaveBeenCalledTimes(1)
  })

  it('places webpage fullscreen to the right of system fullscreen with distinct icons', () => {
    const onToggleSystem = vi.fn()
    const onToggleWebpage = vi.fn()
    render(
      <MindMapCanvasToolbar
        focusMode={false}
        presentationMode="embedded"
        showSystemFullscreenControl
        canUndo={false}
        canRedo={false}
        showHistoryControls={false}
        onRefreshHost={vi.fn()}
        onToggleSystemFullscreen={onToggleSystem}
        onToggleWebpageFullscreen={onToggleWebpage}
      />,
    )

    const systemButton = screen.getByTitle('进入系统全屏')
    const webpageButton = screen.getByTitle('进入网页全屏')
    expect(systemButton.compareDocumentPosition(webpageButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    fireEvent.click(systemButton)
    fireEvent.click(webpageButton)
    expect(onToggleSystem).toHaveBeenCalledTimes(1)
    expect(onToggleWebpage).toHaveBeenCalledTimes(1)
  })
})
