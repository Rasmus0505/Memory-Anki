import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { MindMapDoc } from '@/shared/api/contracts'
import {
  pushMindMapHistory,
  redoMindMapHistory,
  undoMindMapHistory,
  useMindMapEditHistory,
  type MindMapEditHistoryState,
} from './useMindMapEditHistory'

function makeDoc(text: string): MindMapDoc {
  return {
    root: { data: { uid: 'root', text }, children: [] },
  }
}

describe('mind map edit history', () => {
  it('limits past snapshots and supports undo/redo transitions', () => {
    let history: MindMapEditHistoryState = { past: [], future: [] }
    history = pushMindMapHistory(history, makeDoc('A'), 2)
    history = pushMindMapHistory(history, makeDoc('B'), 2)
    history = pushMindMapHistory(history, makeDoc('C'), 2)

    expect(history.past.map((doc) => (doc as MindMapDoc).root?.data?.text)).toEqual(['B', 'C'])
    const undone = undoMindMapHistory(history, makeDoc('D'))
    expect((undone?.editorDoc as MindMapDoc).root?.data?.text).toBe('C')
    const redone = redoMindMapHistory(undone!.history, undone!.editorDoc)
    expect((redone?.editorDoc as MindMapDoc).root?.data?.text).toBe('D')
  })

  it('records local commits and applies undo/redo', () => {
    const onApply = vi.fn()
    const { result } = renderHook(
      ({ doc }) => useMindMapEditHistory(doc, onApply),
      { initialProps: { doc: makeDoc('A') } },
    )

    act(() => {
      result.current.commit(makeDoc('B'))
    })
    expect(result.current.canUndo).toBe(true)
    expect(onApply).toHaveBeenLastCalledWith(makeDoc('B'))

    act(() => {
      result.current.undo()
    })
    expect(onApply).toHaveBeenLastCalledWith(makeDoc('A'))
    expect(result.current.canRedo).toBe(true)

    act(() => {
      result.current.redo()
    })
    expect(onApply).toHaveBeenLastCalledWith(makeDoc('B'))
  })

  it('records external session writes into undo stack so AI apply / import can be undone', () => {
    const onApply = vi.fn()
    const { result, rerender } = renderHook(
      ({ doc }) => useMindMapEditHistory(doc, onApply),
      { initialProps: { doc: makeDoc('A') } },
    )

    act(() => {
      result.current.commit(makeDoc('B'))
    })
    expect(result.current.canUndo).toBe(true)

    // Parent applied a doc outside commit() (e.g. AI 分卡「替换原卡片」).
    rerender({ doc: makeDoc('EXTERNAL') })
    expect(result.current.canUndo).toBe(true)
    // New branch: previous future from any redo path is cleared by pushMindMapHistory.
    expect(result.current.canRedo).toBe(false)

    act(() => {
      result.current.undo()
    })
    // Undoes external write back to last local state.
    expect(onApply).toHaveBeenLastCalledWith(makeDoc('B'))
    expect(result.current.canRedo).toBe(true)

    act(() => {
      result.current.undo()
    })
    expect(onApply).toHaveBeenLastCalledWith(makeDoc('A'))

    act(() => {
      result.current.redo()
    })
    expect(onApply).toHaveBeenLastCalledWith(makeDoc('B'))
    act(() => {
      result.current.redo()
    })
    expect(onApply).toHaveBeenLastCalledWith(makeDoc('EXTERNAL'))
  })
})
