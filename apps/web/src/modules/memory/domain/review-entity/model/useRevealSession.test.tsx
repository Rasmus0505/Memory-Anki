import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MindMapEditorState } from '@/shared/api/contracts'
import type { MindMapSelection } from '@/modules/content/public'
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

  it('auto-reveals question-card children when the session starts with a revealed root', () => {
    const withQuestionCards: MindMapEditorState = {
      ...editorState,
      editor_doc: {
        root: {
          data: { text: '宫殿', uid: 'root' },
          children: [
            { data: { text: '知识点 A', uid: 'a' }, children: [] },
            {
              data: { text: '题目 B', uid: 'b', memoryAnkiQuestionCard: true },
              children: [],
            },
          ],
        },
      },
    }
    const { result } = renderHook(() =>
      useRevealSession({ title: '宫殿', editorState: withQuestionCards }),
    )

    expect(result.current.revealMap.a).toBe('hidden')
    expect(result.current.revealMap.b).toBe('revealed')
  })

  it('auto-reveals non-due cards when focusNodeIds are provided for formal review', () => {
    const { result } = renderHook(() =>
      useRevealSession({
        title: '宫殿',
        editorState,
        focusNodeIds: ['b'],
      }),
    )

    expect(result.current.revealMap.root).toBe('revealed')
    expect(result.current.revealMap.a).toBe('revealed')
    expect(result.current.revealMap.b).toBe('placeholder')
  })

  it('blocks hide only on non-due cards; due hide sticks and expand stays stepwise', () => {
    const nested: MindMapEditorState = {
      ...editorState,
      editor_doc: {
        root: {
          data: { text: '宫殿', uid: 'root' },
          children: [
            { data: { text: 'Fresh', uid: 'fresh' }, children: [] },
            {
              data: { text: 'Due', uid: 'due' },
              children: [
                { data: { text: 'Nested fresh', uid: 'nested-fresh' }, children: [] },
                { data: { text: 'Nested due', uid: 'nested-due' }, children: [] },
              ],
            },
          ],
        },
      },
    }
    const { result } = renderHook(() =>
      useRevealSession({
        title: '宫殿',
        editorState: nested,
        focusNodeIds: ['due', 'nested-due'],
      }),
    )

    expect(result.current.revealMap.fresh).toBe('revealed')
    expect(result.current.revealMap.due).toBe('placeholder')
    expect(result.current.revealMap['nested-fresh']).toBe('hidden')

    act(() => {
      result.current.handleNodeContextMenu([selection('fresh', 'Fresh')])
    })
    flushRevealFrame()
    // Non-due cards cannot be hidden in formal due-scope review.
    expect(result.current.revealMap.fresh).toBe('revealed')

    act(() => {
      result.current.handleNodeClick([selection('due', 'Due')])
    })
    flushRevealFrame()
    // Flip due content only — do not dump all children.
    expect(result.current.revealMap.due).toBe('revealed')
    expect(result.current.revealMap['nested-fresh']).toBe('hidden')
    expect(result.current.revealMap['nested-due']).toBe('hidden')

    act(() => {
      result.current.handleNodeClick([selection('due', 'Due')])
    })
    flushRevealFrame()
    // Free child skips placeholder; due sibling stays hidden until next expand.
    expect(result.current.revealMap['nested-fresh']).toBe('revealed')
    expect(result.current.revealMap['nested-due']).toBe('hidden')

    act(() => {
      result.current.handleNodeClick([selection('due', 'Due')])
    })
    flushRevealFrame()
    expect(result.current.revealMap['nested-due']).toBe('placeholder')

    act(() => {
      result.current.handleNodeContextMenu([selection('due', 'Due')])
    })
    flushRevealFrame()
    // Due card hide must actually hide descendants.
    expect(result.current.revealMap['nested-fresh']).toBe('hidden')
    expect(result.current.revealMap['nested-due']).toBe('hidden')
  })

  it('bulk-reveals descendants from hover with selection fallback', () => {
    const nested: MindMapEditorState = {
      ...editorState,
      editor_doc: {
        root: {
          data: { text: '宫殿', uid: 'root' },
          children: [
            {
              data: { text: '知识点 A', uid: 'a' },
              children: [
                { data: { text: 'A1', uid: 'a1' }, children: [] },
                { data: { text: 'A2', uid: 'a2' }, children: [] },
              ],
            },
          ],
        },
      },
    }
    const { result } = renderHook(() =>
      useRevealSession({ title: '宫殿', editorState: nested }),
    )

    act(() => {
      result.current.handleNodeClick([selection('root', '宫殿')])
    })
    flushRevealFrame()
    expect(result.current.revealMap.a).toBe('placeholder')

    act(() => {
      result.current.handleNodeClick([selection('a', '知识点 A')])
    })
    flushRevealFrame()
    expect(result.current.revealMap.a).toBe('revealed')

    act(() => {
      result.current.handleNodeHover([selection('a', '知识点 A')])
      result.current.handleBulkRevealSubtree()
    })
    flushRevealFrame()
    expect(result.current.revealMap.a1).toBe('placeholder')
    expect(result.current.revealMap.a2).toBe('placeholder')

    act(() => {
      result.current.handleBulkRevealSubtree()
    })
    flushRevealFrame()
    expect(result.current.revealMap.a1).toBe('revealed')
    expect(result.current.revealMap.a2).toBe('revealed')

    // Selection fallback when hover cleared.
    act(() => {
      result.current.handleNodeHover([])
      result.current.handleBulkRevealDirectChildren('a')
    })
    // Both children already revealed — no-op.
    flushRevealFrame()
    expect(result.current.revealMap.a1).toBe('revealed')
  })

  it('keeps locked bulk target when phase-1 re-hover lands on a child', () => {
    const nested: MindMapEditorState = {
      ...editorState,
      editor_doc: {
        root: {
          data: { text: '宫殿', uid: 'root' },
          children: [
            {
              data: { text: '知识点 A', uid: 'a' },
              children: [
                { data: { text: 'A1', uid: 'a1' }, children: [] },
                { data: { text: 'A2', uid: 'a2' }, children: [] },
              ],
            },
          ],
        },
      },
    }
    const { result } = renderHook(() =>
      useRevealSession({ title: '宫殿', editorState: nested }),
    )

    act(() => {
      result.current.handleNodeClick([selection('root', '宫殿')])
    })
    flushRevealFrame()
    act(() => {
      result.current.handleNodeClick([selection('a', '知识点 A')])
    })
    flushRevealFrame()

    act(() => {
      result.current.handleNodeHover([selection('a', '知识点 A')])
      expect(result.current.handleBulkRevealSubtree()).toBe(true)
    })
    flushRevealFrame()
    expect(result.current.revealMap.a1).toBe('placeholder')
    expect(result.current.revealMap.a2).toBe('placeholder')

    // Layout shift: pointer now over a newly revealed child (would steal live hover).
    act(() => {
      result.current.handleNodeHover([selection('a1', 'A1')])
    })
    expect(result.current.hoveredNodeId).toBe('a1')

    act(() => {
      expect(result.current.handleBulkRevealSubtree()).toBe(true)
    })
    flushRevealFrame()
    // Phase-2 must still flip parent A's children, not no-op on leaf a1.
    expect(result.current.revealMap.a1).toBe('revealed')
    expect(result.current.revealMap.a2).toBe('revealed')
  })

  it('releases bulk lock after both phases so a new hover can retarget', () => {
    const nested: MindMapEditorState = {
      ...editorState,
      editor_doc: {
        root: {
          data: { text: '宫殿', uid: 'root' },
          children: [
            {
              data: { text: '知识点 A', uid: 'a' },
              children: [{ data: { text: 'A1', uid: 'a1' }, children: [] }],
            },
            {
              data: { text: '知识点 B', uid: 'b' },
              children: [{ data: { text: 'B1', uid: 'b1' }, children: [] }],
            },
          ],
        },
      },
    }
    const { result } = renderHook(() =>
      useRevealSession({ title: '宫殿', editorState: nested }),
    )

    act(() => {
      result.current.handleNodeClick([selection('root', '宫殿')])
    })
    flushRevealFrame()
    act(() => {
      result.current.handleNodeClick([selection('a', '知识点 A')])
      result.current.handleNodeClick([selection('b', '知识点 B')])
    })
    flushRevealFrame()

    act(() => {
      result.current.handleNodeHover([selection('a', '知识点 A')])
      result.current.handleBulkRevealSubtree()
    })
    flushRevealFrame()
    act(() => {
      result.current.handleBulkRevealSubtree()
    })
    flushRevealFrame()
    expect(result.current.revealMap.a1).toBe('revealed')

    // After complete bulk, hover B and flip B — lock must not stick on A.
    act(() => {
      result.current.handleNodeHover([selection('b', '知识点 B')])
      expect(result.current.handleBulkRevealDirectChildren()).toBe(true)
    })
    flushRevealFrame()
    expect(result.current.revealMap.b1).toBe('placeholder')
  })

  it('keeps sticky bulk target after mouseleave so phase-2 A/S still flips', () => {
    const nested: MindMapEditorState = {
      ...editorState,
      editor_doc: {
        root: {
          data: { text: '宫殿', uid: 'root' },
          children: [
            {
              data: { text: '知识点 A', uid: 'a' },
              children: [
                { data: { text: 'A1', uid: 'a1' }, children: [] },
                { data: { text: 'A2', uid: 'a2' }, children: [] },
              ],
            },
          ],
        },
      },
    }
    const { result } = renderHook(() =>
      useRevealSession({ title: '宫殿', editorState: nested }),
    )

    act(() => {
      result.current.handleNodeClick([selection('root', '宫殿')])
    })
    flushRevealFrame()
    act(() => {
      result.current.handleNodeClick([selection('a', '知识点 A')])
    })
    flushRevealFrame()

    act(() => {
      result.current.handleNodeHover([selection('a', '知识点 A')])
      result.current.handleBulkRevealSubtree()
    })
    flushRevealFrame()
    expect(result.current.revealMap.a1).toBe('placeholder')
    expect(result.current.revealMap.a2).toBe('placeholder')

    // Simulate reveal re-render mouseleave (live hover cleared, no selection passed).
    act(() => {
      result.current.handleNodeHover([])
    })
    expect(result.current.hoveredNodeId).toBeNull()

    act(() => {
      result.current.handleBulkRevealSubtree()
    })
    flushRevealFrame()
    expect(result.current.revealMap.a1).toBe('revealed')
    expect(result.current.revealMap.a2).toBe('revealed')
  })

  it('prefers selection fallback over sticky last-hover when both exist', () => {
    const nested: MindMapEditorState = {
      ...editorState,
      editor_doc: {
        root: {
          data: { text: '宫殿', uid: 'root' },
          children: [
            {
              data: { text: '知识点 A', uid: 'a' },
              children: [{ data: { text: 'A1', uid: 'a1' }, children: [] }],
            },
            {
              data: { text: '知识点 B', uid: 'b' },
              children: [{ data: { text: 'B1', uid: 'b1' }, children: [] }],
            },
          ],
        },
      },
    }
    const { result } = renderHook(() =>
      useRevealSession({ title: '宫殿', editorState: nested }),
    )

    act(() => {
      result.current.handleNodeClick([selection('root', '宫殿')])
    })
    flushRevealFrame()
    act(() => {
      result.current.handleNodeClick([selection('a', '知识点 A')])
      result.current.handleNodeClick([selection('b', '知识点 B')])
    })
    flushRevealFrame()

    // Hover A then leave — sticky becomes A.
    act(() => {
      result.current.handleNodeHover([selection('a', '知识点 A')])
      result.current.handleNodeHover([])
    })

    // Selection fallback B must win over sticky A.
    act(() => {
      result.current.handleBulkRevealDirectChildren('b')
    })
    flushRevealFrame()
    expect(result.current.revealMap.b1).toBe('placeholder')
    expect(result.current.revealMap.a1).not.toBe('placeholder')
    expect(result.current.revealMap.a1).not.toBe('revealed')
  })
})
