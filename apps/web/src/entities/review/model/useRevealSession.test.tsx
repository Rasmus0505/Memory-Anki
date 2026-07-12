import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MindMapEditorState } from '@/shared/api/contracts'
import type { MindMapSelection } from '@/entities/mindmap-document'
import { useRevealSession } from './useRevealSession'

const editorState: MindMapEditorState = {
  editor_doc: {
    root: {
      data: { text: '宫殿', uid: 'root' },
      children: [
        { data: { text: '知识点 A', uid: 'a' }, children: [] },
        { data: { text: '知识点 B', uid: 'b' }, children: [] },
      ],
    },
  },
  editor_config: {},
  editor_local_config: {},
  lang: 'zh',
}

describe('useRevealSession', () => {
  let rafCallbacks: FrameRequestCallback[] = []
  let originalRequestAnimationFrame: typeof window.requestAnimationFrame
  let originalCancelAnimationFrame: typeof window.cancelAnimationFrame

  beforeEach(() => {
    rafCallbacks = []
    originalRequestAnimationFrame = window.requestAnimationFrame
    originalCancelAnimationFrame = window.cancelAnimationFrame
    window.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      rafCallbacks.push(callback)
      return rafCallbacks.length
    })
    window.cancelAnimationFrame = vi.fn()
  })

  afterEach(() => {
    window.requestAnimationFrame = originalRequestAnimationFrame
    window.cancelAnimationFrame = originalCancelAnimationFrame
  })

  function flushRevealFrame() {
    const callbacks = rafCallbacks
    rafCallbacks = []
    act(() => {
      callbacks.forEach((callback) => callback(16))
    })
  }

  function selection(uid: string, text: string): MindMapSelection {
    return {
      uid,
      text,
      note: '',
      memoryAnkiId: null,
      memoryAnkiNodeType: null,
      rawData: {},
    }
  }

  it('batches rapid reveal clicks into the next animation frame in order', () => {
    const { result } = renderHook(() =>
      useRevealSession({ title: '宫殿', editorState }),
    )
    const initialSyncKey = result.current.visibleEditorSyncKey

    act(() => {
      result.current.handleNodeClick([selection('root', '宫殿')])
      result.current.handleNodeClick([selection('root', '宫殿')])
    })

    expect(result.current.visibleEditorSyncKey).toBe(initialSyncKey)
    expect(result.current.revealMap.a).toBe('hidden')
    expect(result.current.revealMap.b).toBe('hidden')

    flushRevealFrame()

    expect(result.current.revealMap.a).toBe('placeholder')
    expect(result.current.revealMap.b).toBe('placeholder')
    expect(result.current.visibleEditorSyncKey).not.toBe(initialSyncKey)
  })

  it('batches reveal and hide actions without revealing hidden cards during recovery-style input', () => {
    const { result } = renderHook(() =>
      useRevealSession({ title: '宫殿', editorState }),
    )

    act(() => {
      result.current.handleNodeClick([selection('root', '宫殿')])
      result.current.handleNodeContextMenu([selection('root', '宫殿')])
    })
    flushRevealFrame()

    expect(result.current.revealMap.a).toBe('hidden')
    expect(result.current.revealMap.b).toBe('hidden')
  })
})
