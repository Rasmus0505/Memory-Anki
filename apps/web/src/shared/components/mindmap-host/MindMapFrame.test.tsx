import { createRef } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MindMapFrame, type MindMapFrameHandle } from './MindMapFrame'

const editorState = {
  editor_doc: {
    root: {
      data: { text: '宫殿', uid: 'root' },
      children: [{ data: { text: '知识点', uid: 'child' }, children: [] }],
    },
  },
  editor_config: {},
  editor_local_config: {},
  lang: 'zh',
}

describe('MindMapFrame native host', () => {
  afterEach(() => {
    document.body.style.overflow = ''
    document.documentElement.style.overflow = ''
    document.documentElement.style.removeProperty('--memory-anki-mindmap-fullscreen-height')
  })

  it('renders a native host instead of an iframe', () => {
    render(<MindMapFrame editorState={editorState} onEditorStateChange={vi.fn()} />)

    expect(screen.getByTestId('mindmap-frame-native')).toBeTruthy()
    expect(document.querySelector('iframe')).toBeNull()
  })

  it('keeps the fullscreen handle contract', async () => {
    const ref = createRef<MindMapFrameHandle>()
    render(<MindMapFrame ref={ref} editorState={editorState} onEditorStateChange={vi.fn()} />)

    await act(async () => {
      await ref.current?.enterNativeFullscreen()
    })
    expect(screen.getByTestId('mindmap-frame-fullscreen-layer')).toBeTruthy()
    expect(screen.getByTestId('mindmap-frame-native').className).not.toContain(
      'memory-anki-mindmap-native-fullscreen',
    )

    await act(async () => {
      await ref.current?.exitNativeFullscreen()
    })
    expect(screen.queryByTestId('mindmap-frame-fullscreen-layer')).toBeNull()
  })

  it('toggles fullscreen from the canvas toolbar control', () => {
    const onFullscreenChange = vi.fn()
    render(
      <MindMapFrame
        editorState={editorState}
        onEditorStateChange={vi.fn()}
        onFullscreenChange={onFullscreenChange}
      />,
    )

    fireEvent.click(screen.getByTitle('进入画布专注模式'))
    expect(screen.getByTestId('mindmap-frame-fullscreen-layer')).toBeTruthy()
    expect(onFullscreenChange).toHaveBeenLastCalledWith(true)

    fireEvent.click(screen.getByTitle('退出画布专注模式'))
    expect(screen.queryByTestId('mindmap-frame-fullscreen-layer')).toBeNull()
    expect(onFullscreenChange).toHaveBeenLastCalledWith(false)
  })

  it('locks page scrolling while fullscreen is active', async () => {
    const ref = createRef<MindMapFrameHandle>()
    document.body.style.overflow = 'auto'
    document.documentElement.style.overflow = 'auto'

    render(<MindMapFrame ref={ref} editorState={editorState} onEditorStateChange={vi.fn()} />)

    await act(async () => {
      await ref.current?.enterNativeFullscreen()
    })
    expect(document.body.style.overflow).toBe('hidden')
    expect(document.documentElement.style.overflow).toBe('hidden')

    await act(async () => {
      await ref.current?.exitNativeFullscreen()
    })
    expect(document.body.style.overflow).toBe('auto')
    expect(document.documentElement.style.overflow).toBe('auto')
  })

  it('exits fullscreen when Escape is pressed', async () => {
    const ref = createRef<MindMapFrameHandle>()
    const onFullscreenChange = vi.fn()
    render(
      <MindMapFrame
        ref={ref}
        editorState={editorState}
        onEditorStateChange={vi.fn()}
        onFullscreenChange={onFullscreenChange}
      />,
    )

    await act(async () => {
      await ref.current?.enterNativeFullscreen()
    })
    expect(screen.getByTestId('mindmap-frame-fullscreen-layer')).toBeTruthy()

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(screen.queryByTestId('mindmap-frame-fullscreen-layer')).toBeNull()
    expect(onFullscreenChange).toHaveBeenLastCalledWith(false)
  })
})
