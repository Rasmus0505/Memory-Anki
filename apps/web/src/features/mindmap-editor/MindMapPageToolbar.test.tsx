import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MindMapPageToolbar } from './MindMapPageToolbar'

describe('MindMapPageToolbar', () => {
  it('renders only the actions provided for the current scene', () => {
    render(
      <MindMapPageToolbar
        importMindMapAction={{ label: '转脑图', onClick: vi.fn() }}
        quizAction={{ label: '做题', onClick: vi.fn() }}
        nativeFullscreenAction={{ label: '全屏编辑', onClick: vi.fn() }}
        clearUiAction={{ label: '清屏', onClick: vi.fn() }}
      />,
    )

    expect(screen.getByRole('button', { name: '转脑图' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '做题' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '全屏编辑' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '清屏' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '回忆模式' })).toBeNull()
    expect(screen.queryByRole('button', { name: '学习组' })).toBeNull()
  })

  it('renders scene toggle labels exactly as provided', () => {
    const { rerender } = render(
      <MindMapPageToolbar modeToggle={{ label: '复习', onClick: vi.fn() }} />,
    )

    expect(screen.getByRole('button', { name: '复习' })).toBeTruthy()

    rerender(<MindMapPageToolbar modeToggle={{ label: '编辑', onClick: vi.fn() }} />)

    expect(screen.getByRole('button', { name: '编辑' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '复习' })).toBeNull()
  })

  it('keeps dedicated scene actions accessible in the modern overflow menu', async () => {
    const onImport = vi.fn()
    const onMiniPalace = vi.fn()

    render(
      <MindMapPageToolbar
        taskControl={{ value: 'build', onChange: vi.fn() }}
        importMindMapAction={{ label: '转脑图', onClick: onImport }}
        miniPalaceAction={{ label: '迷你宫殿训练', onClick: onMiniPalace }}
      />,
    )

    fireEvent.keyDown(screen.getByRole('button', { name: '更多脑图操作' }), { key: 'Enter' })
    fireEvent.click(await screen.findByRole('menuitem', { name: '转脑图' }))

    expect(onImport).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(screen.getByRole('button', { name: '更多脑图操作' }), { key: 'Enter' })
    fireEvent.click(await screen.findByRole('menuitem', { name: '迷你宫殿训练' }))

    expect(onMiniPalace).toHaveBeenCalledTimes(1)
  })

  it('supports segment target selection, confirm, and cancel', () => {
    const onToggle = vi.fn()
    const onTargetChange = vi.fn()
    const onConfirm = vi.fn()
    const onCancel = vi.fn()

    render(
      <MindMapPageToolbar
        segmentControl={{
          active: true,
          targetSegmentId: 'new',
          options: [
            { id: 1, name: '第一学习组' },
            { id: 2, name: '第二学习组' },
          ],
          onToggle,
          onTargetChange,
          onConfirm,
          onCancel,
        }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /学习组中/ }))
    fireEvent.change(screen.getByLabelText('学习组目标'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: '确认' }))
    fireEvent.click(screen.getByRole('button', { name: '取消' }))

    expect(onToggle).toHaveBeenCalledTimes(1)
    expect(onTargetChange).toHaveBeenCalledWith(2)
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('invokes clear, immersive, and native fullscreen callbacks', () => {
    const onToggleImmersive = vi.fn()
    const onToggleNativeFullscreen = vi.fn()
    const onToggleUiCleared = vi.fn()
    const onQuiz = vi.fn()

    render(
      <MindMapPageToolbar
        quizAction={{ label: '做题', onClick: onQuiz }}
        immersiveAction={{ label: '半屏编辑', onClick: onToggleImmersive, active: true }}
        nativeFullscreenAction={{ label: '全屏编辑', onClick: onToggleNativeFullscreen }}
        clearUiAction={{ label: '清屏', onClick: onToggleUiCleared, active: true }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '做题' }))
    fireEvent.click(screen.getByRole('button', { name: '半屏编辑' }))
    fireEvent.click(screen.getByRole('button', { name: '全屏编辑' }))
    fireEvent.click(screen.getByRole('button', { name: '清屏' }))

    expect(onQuiz).toHaveBeenCalledTimes(1)
    expect(onToggleImmersive).toHaveBeenCalledTimes(1)
    expect(onToggleNativeFullscreen).toHaveBeenCalledTimes(1)
    expect(onToggleUiCleared).toHaveBeenCalledTimes(1)
  })
})
