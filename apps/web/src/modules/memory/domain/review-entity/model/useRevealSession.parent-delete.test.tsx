import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { MindMapEditorState } from '@/shared/api/contracts'
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

describe('useRevealSession parent delete', () => {
  it('keeps promoted children revealed after a parent is deleted', () => {
    const withParent: MindMapEditorState = {
      ...editorState,
      editor_doc: {
        root: {
          data: { text: '四阶段', uid: 'root' },
          children: [
            {
              data: { text: '婴幼青', uid: 'group' },
              children: [
                { data: { text: '婴儿期', uid: 'baby' }, children: [] },
                { data: { text: '幼儿期', uid: 'child' }, children: [] },
              ],
            },
          ],
        },
      },
    }
    const { result, rerender } = renderHook(
      ({ state }: { state: MindMapEditorState }) =>
        useRevealSession({ title: '宫殿', editorState: state }),
      { initialProps: { state: withParent } },
    )

    act(() => {
      result.current.setRevealMap({
        root: 'revealed',
        group: 'revealed',
        baby: 'revealed',
        child: 'revealed',
      })
    })
    expect(result.current.revealMap.baby).toBe('revealed')
    expect(result.current.revealMap.child).toBe('revealed')

    rerender({
      state: {
        ...withParent,
        editor_doc: {
          root: {
            data: { text: '四阶段', uid: 'root' },
            children: [
              { data: { text: '婴儿期', uid: 'baby' }, children: [] },
              { data: { text: '幼儿期', uid: 'child' }, children: [] },
            ],
          },
        },
      },
    })
    expect(result.current.revealMap.group).toBeUndefined()
    expect(result.current.revealMap.baby).toBe('revealed')
    expect(result.current.revealMap.child).toBe('revealed')
  })
})
