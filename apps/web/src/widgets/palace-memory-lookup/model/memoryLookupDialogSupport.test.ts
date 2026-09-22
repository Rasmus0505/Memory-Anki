import { describe, expect, it } from 'vitest'
import type { MindMapEditorState } from '@/shared/api/contracts'
import {
  collectMemoryLookupFocusNodeUids,
  describeMemoryLookupPreview,
  pickMemoryLookupBinding,
  resolveMemoryLookupFocusNodeUid,
  resolveMemoryLookupPalaceId,
  shouldBlockMemoryLookupClose,
} from './memoryLookupDialogSupport'

function editorStateWithTree(
  rootUid: string,
  childUid?: string,
  grandchildUid?: string,
): MindMapEditorState {
  return {
    editor_doc: {
      root: {
        data: { uid: rootUid, text: 'root' },
        children: childUid
          ? [{
              data: { uid: childUid, text: 'child' },
              children: grandchildUid
                ? [{ data: { uid: grandchildUid, text: 'leaf' }, children: [] }]
                : [],
            }]
          : [],
      },
    },
    editor_config: {},
    editor_local_config: {},
    lang: 'zh',
    editor_fingerprint: 'test',
  } as MindMapEditorState
}

describe('memory lookup preview caption', () => {
  it('describes view, flip, and edit without clipping the palace', () => {
    expect(describeMemoryLookupPreview({
      mode: 'view',
      centeredOnBinding: true,
    })).toBe('只读脑图预览 · 绑定节点已置于中央')
    expect(describeMemoryLookupPreview({
      mode: 'flip',
      centeredOnBinding: false,
      compact: true,
    })).toBe('翻卡模式')
    expect(describeMemoryLookupPreview({
      mode: 'edit',
      centeredOnBinding: false,
      saveStatus: 'saving',
    })).toBe('编辑模式：正在保存修改。')
    expect(describeMemoryLookupPreview({
      mode: 'edit',
      centeredOnBinding: false,
      saveStatus: 'error',
      saveError: '版本冲突',
    })).toBe('编辑模式：保存失败。版本冲突')
  })
})

describe('memory lookup dialog lifecycle', () => {
  it('blocks dialog close while the embedded mind map is fullscreen', () => {
    expect(shouldBlockMemoryLookupClose({
      nextOpen: false,
      pinned: false,
      mindMapFullscreenActive: true,
    })).toBe(true)
  })

  it('allows normal close after fullscreen exits', () => {
    expect(shouldBlockMemoryLookupClose({
      nextOpen: false,
      pinned: false,
      mindMapFullscreenActive: false,
    })).toBe(false)
  })

  it('never blocks an open request', () => {
    expect(shouldBlockMemoryLookupClose({
      nextOpen: true,
      pinned: true,
      mindMapFullscreenActive: true,
    })).toBe(false)
  })
})

describe('memory lookup focus node', () => {
  it('centers on the requested node when it exists in the loaded tree', () => {
    expect(
      resolveMemoryLookupFocusNodeUid(editorStateWithTree('root-1', 'bound-9'), 'bound-9'),
    ).toBe('bound-9')
  })

  it('falls back to the palace root when the requested node is missing', () => {
    expect(
      resolveMemoryLookupFocusNodeUid(editorStateWithTree('root-1', 'child-2'), 'missing'),
    ).toBe('root-1')
  })

  it('falls back to the palace root when no node was requested', () => {
    expect(resolveMemoryLookupFocusNodeUid(editorStateWithTree('root-1'), null)).toBe('root-1')
  })

  it('centers on the deepest bound node when a question is also bound to the root', () => {
    expect(
      resolveMemoryLookupFocusNodeUid(
        editorStateWithTree('root-1', 'child-2', 'leaf-9'),
        ['root-1', 'leaf-9', 'child-2'],
      ),
    ).toBe('leaf-9')
  })

  it('prefers the deepest bound node under the opened card', () => {
    expect(
      resolveMemoryLookupFocusNodeUid(
        editorStateWithTree('root-1', 'child-2', 'leaf-9'),
        ['root-1', 'child-2', 'leaf-9'],
        'child-2',
      ),
    ).toBe('leaf-9')
  })

  it('resolves memoryAnkiId when data.uid is missing', () => {
    const state = {
      editor_doc: {
        root: {
          data: { uid: 'root-1', text: 'root' },
          children: [{ data: { memoryAnkiId: 'bound-legacy', text: 'child' }, children: [] }],
        },
      },
      editor_config: {},
      editor_local_config: {},
      lang: 'zh',
      editor_fingerprint: 'test',
    } as MindMapEditorState
    expect(resolveMemoryLookupFocusNodeUid(state, 'bound-legacy')).toBe('bound-legacy')
  })
})

describe('memory lookup bound-node center', () => {
  it('keeps the full palace tree when resolving a bound node', () => {
    const source = editorStateWithTree('root-1', 'bound-9')
    expect(resolveMemoryLookupFocusNodeUid(source, 'bound-9')).toBe('bound-9')
    expect(
      (source.editor_doc as { root?: { data?: { uid?: string }; children?: unknown[] } }).root
        ?.data?.uid,
    ).toBe('root-1')
    expect(
      (source.editor_doc as { root?: { children?: Array<{ data?: { uid?: string } }> } }).root
        ?.children?.[0]?.data?.uid,
    ).toBe('bound-9')
  })
})

describe('memory lookup binding pick', () => {
  it('prefers a binding that lives on the current question palace', () => {
    const picked = pickMemoryLookupBinding(
      [
        { node_uid: 'other', palace_id: 8, target_palace_id: 8 },
        { node_uid: 'bound', palace_id: 3, target_palace_id: 3 },
      ],
      3,
    )
    expect(picked?.node_uid).toBe('bound')
  })

  it('uses the first usable binding when no palace matches', () => {
    const picked = pickMemoryLookupBinding(
      [
        { node_uid: 'first', palace_id: 8 },
        { node_uid: 'second', palace_id: 9 },
      ],
      3,
    )
    expect(picked?.node_uid).toBe('first')
  })

  it('resolves the target palace from the binding before the question palace', () => {
    expect(
      resolveMemoryLookupPalaceId(
        { node_uid: 'bound', palace_id: 8, target_palace_id: 12 },
        3,
      ),
    ).toBe(12)
    expect(resolveMemoryLookupPalaceId(null, 3)).toBe(3)
  })

  it('collects every bound node on the current palace, not only the first edge', () => {
    expect(
      collectMemoryLookupFocusNodeUids(
        [
          { node_uid: 'root-1', palace_id: 3, target_palace_id: 3 },
          { node_uid: 'leaf-9', palace_id: 3, target_palace_id: 3 },
          { node_uid: 'other', palace_id: 8, target_palace_id: 8 },
        ],
        3,
      ),
    ).toEqual(['root-1', 'leaf-9'])
  })
})
