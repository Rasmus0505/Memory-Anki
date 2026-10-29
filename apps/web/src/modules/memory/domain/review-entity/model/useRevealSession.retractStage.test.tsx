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

/** 收卡 must follow 揭示方式; this file owns that contract so the main hook spec stays small. */
describe('useRevealSession 收卡 × 揭示方式', () => {
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

  it('keeps 直接显示 free of placeholders across flip → 收卡 → flip', () => {
    const { result } = renderHook(() =>
      useRevealSession({
        title: '宫殿',
        editorState,
        revealConfig: { granularity: 'single', stage: 'direct' },
        pendingAdvancePolicy: 'latest-only',
      }),
    )

    act(() => {
      result.current.applyTargetRevealFrom(result.current.revealMap, [selection('a', '知识点 A')])
    })
    flushRevealFrame()
    expect(result.current.revealMap.a).toBe('revealed')

    act(() => {
      expect(result.current.retractTarget([selection('a', '知识点 A')])).toBe(true)
    })
    expect(result.current.revealMap.a).toBe('hidden')

    // The next flip re-opens the content directly — no prompt in between.
    act(() => {
      result.current.applyTargetRevealFrom(result.current.revealMap, [selection('a', '知识点 A')])
    })
    flushRevealFrame()
    expect(result.current.revealMap.a).toBe('revealed')
  })

  it('keeps the 两阶段 prompt on 收卡', () => {
    const { result } = renderHook(() =>
      useRevealSession({
        title: '宫殿',
        editorState,
        revealConfig: { granularity: 'single', stage: 'two-step' },
      }),
    )

    act(() => {
      result.current.handleNodeClick([selection('root', '宫殿')])
    })
    flushRevealFrame()
    act(() => {
      result.current.handleNodeClick([selection('root', '宫殿')])
    })
    flushRevealFrame()
    expect(result.current.revealMap.a).toBe('revealed')

    act(() => {
      result.current.retractTarget([selection('a', '知识点 A')])
    })
    expect(result.current.revealMap.a).toBe('placeholder')
  })
})
