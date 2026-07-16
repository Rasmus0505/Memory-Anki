import { describe, expect, it } from 'vitest'
import type { MindMapDoc } from '@/shared/api/contracts'
import {
  addPreviewChild,
  appendSiblingsAfterUid,
  applyReplacementAtUid,
  deletePreviewNode,
  editorNodesToPreviewTree,
  previewTreeToEditorNodes,
  updatePreviewNodeText,
} from './aiSplitPreview'

function sampleDoc(): MindMapDoc {
  return {
    root: {
      data: { text: '根', uid: 'root' },
      children: [
        { data: { text: '前置', uid: 'before' }, children: [] },
        {
          data: { text: '长内容原文', note: '备注', uid: 'target' },
          children: [],
        },
        { data: { text: '后置', uid: 'after' }, children: [] },
      ],
    },
  }
}

describe('aiSplitPreview', () => {
  it('converts API nodes to editable preview tree and back', () => {
    const preview = editorNodesToPreviewTree([
      {
        data: { text: 'A', uid: 'ai-split-a' },
        children: [{ data: { text: 'A1', uid: 'ai-split-a1' }, children: [] }],
      },
      { text: 'B', children: [] },
    ])
    expect(preview).toHaveLength(2)
    expect(preview[0].text).toBe('A')
    expect(preview[0].children[0].text).toBe('A1')
    expect(preview[1].text).toBe('B')

    const editorNodes = previewTreeToEditorNodes(preview)
    expect(editorNodes[0].data?.text).toBe('A')
    expect(editorNodes[0].children?.[0].data?.text).toBe('A1')
    expect(editorNodes[1].data?.text).toBe('B')
  })

  it('replaces target while preserving sibling order', () => {
    const next = applyReplacementAtUid(sampleDoc(), 'target', [
      { data: { text: '定义', uid: 'n1' }, children: [] },
      { data: { text: '例子', uid: 'n2' }, children: [] },
    ])
    const texts = (next.root?.children ?? []).map((item) => item.data?.text)
    expect(texts).toEqual(['前置', '定义', '例子', '后置'])
  })

  it('appends siblings after selected node without deleting source', () => {
    const next = appendSiblingsAfterUid(sampleDoc(), 'before', [
      { data: { text: '插入1', uid: 'i1' }, children: [] },
    ])
    const texts = (next.root?.children ?? []).map((item) => item.data?.text)
    expect(texts).toEqual(['前置', '插入1', '长内容原文', '后置'])
  })

  it('appends as same-level siblings of a nested selection, not as its children', () => {
    const nested: MindMapDoc = {
      root: {
        data: { text: '根', uid: 'root' },
        children: [
          {
            data: { text: '父卡', uid: 'parent' },
            children: [
              { data: { text: '选中卡', uid: 'selected' }, children: [] },
              { data: { text: '原同级', uid: 'old-sib' }, children: [] },
            ],
          },
        ],
      },
    }
    const next = appendSiblingsAfterUid(nested, 'selected', [
      { data: { text: '新卡A', uid: 'na' }, children: [] },
      { data: { text: '新卡B', uid: 'nb' }, children: [{ data: { text: '新卡B子', uid: 'nb1' }, children: [] }] },
    ])
    const parent = next.root?.children?.[0]
    expect(parent?.data?.uid).toBe('parent')
    expect((parent?.children ?? []).map((item) => item.data?.uid)).toEqual([
      'selected',
      'na',
      'nb',
      'old-sib',
    ])
    // Selected must stay a leaf regarding the append payload (no new nodes under it).
    expect(parent?.children?.[0]?.children ?? []).toEqual([])
    // Nested structure of the payload is preserved under the new sibling, not under selected.
    expect(parent?.children?.[2]?.children?.[0]?.data?.text).toBe('新卡B子')
  })

  it('resolves selection by memoryAnkiId when uid is missing on disk', () => {
    const doc = {
      root: {
        data: { text: '根', uid: 'root' },
        children: [
          { data: { text: 'A', memoryAnkiId: 42 }, children: [] },
          { data: { text: 'B', uid: 'b' }, children: [] },
        ],
      },
    } as MindMapDoc
    const next = appendSiblingsAfterUid(doc, '42', [
      { data: { text: '插入', uid: 'ins' }, children: [] },
    ])
    expect((next.root?.children ?? []).map((item) => item.data?.text)).toEqual(['A', '插入', 'B'])
  })

  it('supports preview tree edit helpers', () => {
    let tree = editorNodesToPreviewTree([
      { data: { text: 'A', uid: 'a' }, children: [] },
    ])
    tree = updatePreviewNodeText(tree, 'a', 'A改')
    tree = addPreviewChild(tree, 'a', '子')
    expect(tree[0].text).toBe('A改')
    expect(tree[0].children).toHaveLength(1)
    tree = deletePreviewNode(tree, tree[0].children[0].id)
    expect(tree[0].children).toHaveLength(0)
  })
})
