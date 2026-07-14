import { createRef } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MindMapEditorSurface, type MindMapEditorSurfaceHandle } from './MindMapEditorSurface'
import type { MindMapEditorState } from '@/shared/api/contracts'

const editorState: MindMapEditorState = {
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

describe('MindMapEditorSurface native host', () => {
  afterEach(() => {
    document.body.removeAttribute('style')
    document.documentElement.style.overflow = ''
    document.documentElement.classList.remove('memory-anki-mindmap-fullscreen-open')
    document.documentElement.style.removeProperty('--memory-anki-mindmap-fullscreen-top')
    document.documentElement.style.removeProperty('--memory-anki-mindmap-fullscreen-left')
    document.documentElement.style.removeProperty('--memory-anki-mindmap-fullscreen-width')
    document.documentElement.style.removeProperty('--memory-anki-mindmap-fullscreen-height')
    delete (window as Window & { visualViewport?: VisualViewport }).visualViewport
  })

  it('renders a native host instead of an iframe', () => {
    render(<MindMapEditorSurface editorState={editorState} onEditorStateChange={vi.fn()} />)

    expect(screen.getByTestId('mindmap-frame-native')).toBeTruthy()
    expect(document.querySelector('iframe')).toBeNull()
  })

  it('requests the browser Fullscreen API when the platform supports it', async () => {
    const ref = createRef<MindMapEditorSurfaceHandle>()
    const requestFullscreen = vi.fn(async () => {})
    Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', {
      configurable: true,
      value: requestFullscreen,
    })
    render(<MindMapEditorSurface ref={ref} editorState={editorState} onEditorStateChange={vi.fn()} />)

    await act(async () => {
      await ref.current?.enterNativeFullscreen()
    })

    expect(requestFullscreen).toHaveBeenCalledTimes(1)
    expect(requestFullscreen.mock.instances[0]).toBe(screen.getByTestId('mindmap-frame-native'))
    expect(screen.getByTestId('mindmap-frame-native').dataset.presentationMode).toBe('native')
  })

  it('reports viewport mode when the native fullscreen request is rejected', async () => {
    const ref = createRef<MindMapEditorSurfaceHandle>()
    Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', {
      configurable: true,
      value: vi.fn(async () => { throw new Error('not allowed') }),
    })
    render(<MindMapEditorSurface ref={ref} editorState={editorState} onEditorStateChange={vi.fn()} />)

    await act(async () => {
      await ref.current?.enterFullscreen()
    })

    expect(screen.getByTestId('mindmap-frame-native').dataset.presentationMode).toBe('viewport')
  })

  it('keeps the fullscreen handle contract', async () => {
    const ref = createRef<MindMapEditorSurfaceHandle>()
    render(<MindMapEditorSurface ref={ref} editorState={editorState} onEditorStateChange={vi.fn()} />)

    await act(async () => {
      await ref.current?.enterNativeFullscreen()
    })
    const frame = screen.getByTestId('mindmap-frame-native')
    const canvasRoot = frame.firstElementChild
    expect(frame.className).toContain('memory-anki-mindmap-native-fullscreen')
    expect(frame.dataset.fullscreen).toBe('true')

    await act(async () => {
      await ref.current?.exitNativeFullscreen()
    })
    expect(frame.className).not.toContain('memory-anki-mindmap-native-fullscreen')
    expect(frame.dataset.fullscreen).toBe('false')
    expect(frame.firstElementChild).toBe(canvasRoot)
  })

  it('uses the legacy WebKit exit API used by installed PWAs', async () => {
    const ref = createRef<MindMapEditorSurfaceHandle>()
    const webkitCancelFullScreen = vi.fn(async () => {})
    Object.defineProperty(document, 'webkitCurrentFullScreenElement', {
      configurable: true,
      value: document.documentElement,
    })
    Object.defineProperty(document, 'webkitCancelFullScreen', {
      configurable: true,
      value: webkitCancelFullScreen,
    })
    render(<MindMapEditorSurface ref={ref} editorState={editorState} onEditorStateChange={vi.fn()} />)

    await act(async () => {
      await ref.current?.enterNativeFullscreen()
      await ref.current?.exitNativeFullscreen()
    })

    expect(webkitCancelFullScreen).toHaveBeenCalledTimes(1)
  })
  it('toggles fullscreen from the canvas toolbar control', async () => {
    const onFullscreenChange = vi.fn()
    render(
      <MindMapEditorSurface
        editorState={editorState}
        onEditorStateChange={vi.fn()}
        onFullscreenChange={onFullscreenChange}
      />,
    )

    const frame = screen.getByTestId('mindmap-frame-native')
    const canvasRoot = frame.firstElementChild
    await act(async () => {
      fireEvent.click(screen.getByTitle('进入系统全屏'))
    })
    expect(frame.className).toContain('memory-anki-mindmap-native-fullscreen')
    expect(frame.firstElementChild).toBe(canvasRoot)
    expect(onFullscreenChange).toHaveBeenLastCalledWith(true)

    await act(async () => {
      fireEvent.click(screen.getByTitle('退出系统全屏'))
    })
    expect(frame.className).not.toContain('memory-anki-mindmap-native-fullscreen')
    expect(frame.firstElementChild).toBe(canvasRoot)
    expect(onFullscreenChange).toHaveBeenLastCalledWith(false)
  })

  it('delegates the primary fullscreen control to the web fullscreen host', async () => {
    const onFullscreenToggle = vi.fn()
    render(
      <MindMapEditorSurface
        editorState={editorState}
        onEditorStateChange={vi.fn()}
        onFullscreenToggle={onFullscreenToggle}
      />,
    )

    await act(async () => {
      fireEvent.click(screen.getByTitle('进入网页内全屏'))
    })

    expect(onFullscreenToggle).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('mindmap-frame-native').className).not.toContain(
      'memory-anki-mindmap-native-fullscreen',
    )
  })

  it('does not close a parent immersive flow when entering canvas fullscreen', async () => {
    const ref = createRef<MindMapEditorSurfaceHandle>()
    const onFullscreenToggle = vi.fn()
    render(
      <MindMapEditorSurface
        ref={ref}
        editorState={editorState}
        immersiveModeActive
        onEditorStateChange={vi.fn()}
        onFullscreenToggle={onFullscreenToggle}
      />,
    )

    await act(async () => {
      await ref.current?.enterNativeFullscreen()
    })

    expect(screen.getByTestId('mindmap-frame-native').className).toContain(
      'memory-anki-mindmap-native-fullscreen',
    )
    expect(onFullscreenToggle).not.toHaveBeenCalled()
  })

  it('uses viewport-only fullscreen without requesting the native API', async () => {
    const ref = createRef<MindMapEditorSurfaceHandle>()
    const requestFullscreen = vi.fn(async () => {})
    Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', {
      configurable: true,
      value: requestFullscreen,
    })
    render(
      <MindMapEditorSurface
        ref={ref}
        editorState={editorState}
        presentationStrategy={'viewport-only'}
        onEditorStateChange={vi.fn()}
      />,
    )

    await act(async () => {
      await ref.current?.enterNativeFullscreen()
    })

    expect(requestFullscreen).not.toHaveBeenCalled()
    expect(screen.getByTestId('mindmap-frame-native').className).toContain(
      'memory-anki-mindmap-native-fullscreen',
    )
    expect(screen.getByTestId('mindmap-frame-native').dataset.presentationMode).toBe('viewport')
  })

  it('uses the canvas fullscreen control for viewport-only PWA presentation', async () => {
    const onFullscreenToggle = vi.fn()
    const requestFullscreen = vi.fn(async () => {})
    Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', {
      configurable: true,
      value: requestFullscreen,
    })
    render(
      <MindMapEditorSurface
        editorState={editorState}
        presentationStrategy={'viewport-only'}
        onEditorStateChange={vi.fn()}
        onFullscreenToggle={onFullscreenToggle}
      />,
    )

    await act(async () => {
      fireEvent.click(screen.getByTitle('进入全屏'))
    })

    expect(onFullscreenToggle).not.toHaveBeenCalled()
    expect(requestFullscreen).not.toHaveBeenCalled()
    expect(screen.getByTestId('mindmap-frame-native').dataset.presentationMode).toBe('viewport')
    expect(screen.getByTitle('退出全屏')).toBeTruthy()
  })

  it('locks page scrolling while fullscreen is active', async () => {
    const ref = createRef<MindMapEditorSurfaceHandle>()
    document.body.style.overflow = 'auto'
    document.documentElement.style.overflow = 'auto'

    render(<MindMapEditorSurface ref={ref} editorState={editorState} onEditorStateChange={vi.fn()} />)

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

  it('locks the page and follows the visual viewport in PWA fullscreen', async () => {
    const ref = createRef<MindMapEditorSurfaceHandle>()
    const viewport = new EventTarget() as VisualViewport
    Object.defineProperties(viewport, {
      offsetTop: { configurable: true, value: 18 },
      offsetLeft: { configurable: true, value: 6 },
      width: { configurable: true, value: 390 },
      height: { configurable: true, value: 720 },
    })
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: viewport,
    })

    render(
      <MindMapEditorSurface
        ref={ref}
        editorState={editorState}
        presentationStrategy={'viewport-only'}
        onEditorStateChange={vi.fn()}
      />,
    )

    await act(async () => {
      await ref.current?.enterFullscreen()
    })

    expect(document.body.style.position).toBe('fixed')
    expect(document.documentElement.classList.contains('memory-anki-mindmap-fullscreen-open')).toBe(true)
    expect(document.documentElement.style.getPropertyValue('--memory-anki-mindmap-fullscreen-top')).toBe('18px')
    expect(document.documentElement.style.getPropertyValue('--memory-anki-mindmap-fullscreen-left')).toBe('6px')
    expect(document.documentElement.style.getPropertyValue('--memory-anki-mindmap-fullscreen-width')).toBe('390px')
    expect(document.documentElement.style.getPropertyValue('--memory-anki-mindmap-fullscreen-height')).toBe('720px')

    Object.defineProperties(viewport, {
      offsetTop: { configurable: true, value: 0 },
      offsetLeft: { configurable: true, value: 0 },
      width: { configurable: true, value: 844 },
      height: { configurable: true, value: 390 },
    })
    act(() => viewport.dispatchEvent(new Event('resize')))
    expect(document.documentElement.style.getPropertyValue('--memory-anki-mindmap-fullscreen-width')).toBe('844px')
    expect(document.documentElement.style.getPropertyValue('--memory-anki-mindmap-fullscreen-height')).toBe('390px')

    await act(async () => {
      await ref.current?.exitFullscreen()
    })

    expect(document.body.style.position).toBe('')
    expect(document.documentElement.classList.contains('memory-anki-mindmap-fullscreen-open')).toBe(false)
  })

  it('exits fullscreen when Escape is pressed', async () => {
    const ref = createRef<MindMapEditorSurfaceHandle>()
    const onFullscreenChange = vi.fn()
    render(
      <MindMapEditorSurface
        ref={ref}
        editorState={editorState}
        onEditorStateChange={vi.fn()}
        onFullscreenChange={onFullscreenChange}
      />,
    )

    await act(async () => {
      await ref.current?.enterNativeFullscreen()
    })
    const frame = screen.getByTestId('mindmap-frame-native')
    expect(frame.className).toContain('memory-anki-mindmap-native-fullscreen')

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(frame.className).not.toContain('memory-anki-mindmap-native-fullscreen')
    expect(onFullscreenChange).toHaveBeenLastCalledWith(false)
  })
})
