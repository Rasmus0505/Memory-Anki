import type { MindMapEditorState, MindMapImportPreviewResponse } from '@/shared/api/contracts'
import { vi } from 'vitest'
import {
  applyImportedEditorState,
  buildEditorDocFromSourceTree,
  countSourceTreeNodes,
  formatMindMapImportError,
  restoreImportedEditorState,
  saveImportHistory,
} from '@/modules/produce/ui/mindmap-import/model/mindmap-import'

function buildEditorState(): MindMapEditorState {
  return {
    editor_doc: {
      root: {
        data: { text: 'Root', uid: 'root-1' },
        children: [
          {
            data: { text: 'A', uid: 'a-1' },
            children: [],
          },
        ],
      },
    },
    editor_config: {},
    editor_local_config: {},
    lang: 'zh',
  }
}

describe('mindmap import helpers', () => {
  it('counts source tree nodes recursively', () => {
    expect(
      countSourceTreeNodes([
        {
          text: 'A',
          children: [
            { text: 'A1', children: [] },
            { text: 'A2', children: [{ text: 'A21', children: [] }] },
          ],
        },
      ]),
    ).toBe(4)
  })

  it('builds a fallback editor doc from source tree data', () => {
    const doc = buildEditorDocFromSourceTree({
      title: '导入标题',
      children: [
        {
          text: '第一节',
          rich_text_html: '<div>第一节</div>',
          children: [{ text: '知识点', children: [] }],
        },
      ],
    })

    expect(doc.root?.data).toMatchObject({
      text: '导入标题',
      uid: 'palace-root',
      memoryAnkiRootKind: 'palace',
    })
    expect(doc.root?.children?.[0]?.data).toMatchObject({
      text: '<div>第一节</div>',
      richText: true,
    })
    expect(
      typeof ((doc.root?.children?.[0]?.data as Record<string, unknown> | undefined)?.uid),
    ).toBe('string')
    expect(doc.root?.children?.[0]?.children?.[0]?.data?.text).toBe('知识点')
  })

  it('builds yellow highlight markup from emphasis_marks', () => {
    const doc = buildEditorDocFromSourceTree({
      title: '章节',
      children: [
        {
          text: '细胞膜由磷脂双分子层构成',
          emphasis_marks: [{ kind: 'highlight', text: '磷脂双分子层' }],
          children: [],
        },
      ],
    })
    const text = String(doc.root?.children?.[0]?.data?.text || '')
    expect(doc.root?.children?.[0]?.data?.richText).toBe(true)
    expect(text).toContain('data-emphasis="highlight"')
    expect(text).toContain('background-color:#fef08c')
    expect(text).toContain('磷脂双分子层')
  })

  it('applies replace and creates undo snapshot', () => {
    const editorState = buildEditorState()
    const result = applyImportedEditorState({
      editorState,
      importedDoc: {
        root: {
          data: { text: 'Imported', uid: 'root-2' },
          children: [],
        },
      },
      mode: 'replace',
      sourceTitle: '导入标题',
    })

    expect(result.applied).toBe(true)
    expect(result.nextEditorState?.editor_doc).toMatchObject({
      root: {
        data: { text: 'Imported' },
      },
    })
    expect(result.undoSnapshot?.editorDoc).toEqual(editorState.editor_doc)
    expect(result.undoSnapshot?.sourceTitle).toBe('导入标题')
  })

  it('appends the imported root as a child subtree instead of flattening its children', () => {
    const editorState = buildEditorState()
    const result = applyImportedEditorState({
      editorState,
      importedDoc: {
        root: {
          data: { text: 'Imported Root', uid: 'import-root', memoryAnkiRootKind: 'palace' },
          children: [
            { data: { text: 'B1', uid: 'b-1' }, children: [] },
            { data: { text: 'B2', uid: 'b-2' }, children: [] },
            { data: { text: 'B3', uid: 'b-3' }, children: [] },
            { data: { text: 'B4', uid: 'b-4' }, children: [] },
          ],
        },
      },
      mode: 'append',
      targetUid: 'a-1',
    })

    expect(result.applied).toBe(true)
    const targetChildren =
      (
        ((result.nextEditorState?.editor_doc as { root?: { children?: Array<{ data?: { uid?: string }; children?: unknown[] }> } })
          ?.root?.children || []) as Array<{ data?: { uid?: string }; children?: Array<{ data?: { text?: string } }> }>
      )[0]?.children || []
    const appendedRoot = targetChildren[0] as
      | {
          data?: Record<string, unknown>
          children?: Array<{ data?: { text?: string } }>
        }
      | undefined
    expect(targetChildren).toHaveLength(1)
    expect(appendedRoot?.data?.text).toBe('Imported Root')
    expect(appendedRoot?.data?.memoryAnkiRootKind).toBeUndefined()
    expect(typeof appendedRoot?.data?.uid).toBe('string')
    expect(appendedRoot?.data?.uid).not.toBe('import-root')
    expect(appendedRoot?.children?.map((child) => child.data?.text)).toEqual(['B1', 'B2', 'B3', 'B4'])
  })

  it('rekeys every appended descendant to avoid duplicate subtree identities', () => {
    const editorState: MindMapEditorState = {
      ...buildEditorState(),
      editor_doc: {
        root: {
          data: { text: 'Root', uid: 'root-1' },
          children: [
            {
              data: { text: 'A', uid: 'a-1', memoryAnkiId: 1, memoryAnkiNodeType: 'chapter' },
              children: [
                {
                  data: { text: 'Existing Child', uid: 'dup-child', memoryAnkiId: 2 },
                  children: [],
                },
              ],
            },
          ],
        },
      },
    }

    const result = applyImportedEditorState({
      editorState,
      importedDoc: {
        root: {
          data: {
            text: 'Imported Root',
            uid: 'a-1',
            memoryAnkiRootKind: 'palace',
            memoryAnkiId: 88,
            memoryAnkiNodeType: 'chapter',
          },
          children: [
            {
              data: { text: 'Imported Child', uid: 'dup-child', memoryAnkiId: 99, memoryAnkiNodeType: 'point' },
              children: [
                {
                  data: { text: 'Imported Grandchild', uid: 'root-1', memoryAnkiId: 100 },
                  children: [],
                },
              ],
            },
          ],
        },
      },
      mode: 'append',
      targetUid: 'a-1',
    })

    expect(result.applied).toBe(true)
    const appendedNode =
      (
        ((result.nextEditorState?.editor_doc as { root?: { children?: Array<{ children?: unknown[] }> } })?.root
          ?.children || []) as Array<{ children?: Array<{ data?: Record<string, unknown>; children?: unknown[] }> }>
      )[0]?.children?.[1]

    expect(appendedNode?.data?.text).toBe('Imported Root')
    expect(appendedNode?.data?.uid).not.toBe('a-1')
    expect(appendedNode?.data?.memoryAnkiRootKind).toBeUndefined()
    expect(appendedNode?.data?.memoryAnkiId).toBeUndefined()
    expect(appendedNode?.data?.memoryAnkiNodeType).toBeUndefined()

    const appendedChild = appendedNode?.children?.[0] as
      | { data?: Record<string, unknown>; children?: Array<{ data?: Record<string, unknown> }> }
      | undefined
    expect(appendedChild?.data?.text).toBe('Imported Child')
    expect(appendedChild?.data?.uid).not.toBe('dup-child')
    expect(appendedChild?.data?.memoryAnkiId).toBeUndefined()
    expect(appendedChild?.data?.memoryAnkiNodeType).toBeUndefined()

    const appendedGrandchild = appendedChild?.children?.[0]
    expect(appendedGrandchild?.data?.text).toBe('Imported Grandchild')
    expect(appendedGrandchild?.data?.uid).not.toBe('root-1')
    expect(appendedGrandchild?.data?.memoryAnkiId).toBeUndefined()
  })

  it('keeps existing target children and appends the imported subtree after them', () => {
    const editorState: MindMapEditorState = {
      ...buildEditorState(),
      editor_doc: {
        root: {
          data: { text: 'Root', uid: 'root-1' },
          children: [
            {
              data: { text: 'A', uid: 'a-1' },
              children: [{ data: { text: 'Existing', uid: 'existing-1' }, children: [] }],
            },
          ],
        },
      },
    }

    const result = applyImportedEditorState({
      editorState,
      importedDoc: {
        root: {
          data: { text: 'Imported Root', uid: 'import-root' },
          children: [{ data: { text: 'B', uid: 'b-1' }, children: [] }],
        },
      },
      mode: 'append',
      targetUid: 'a-1',
    })

    expect(result.applied).toBe(true)
    const targetChildren =
      (
        ((result.nextEditorState?.editor_doc as { root?: { children?: Array<{ children?: unknown[] }> } })?.root
          ?.children || []) as Array<{ children?: Array<{ data?: { text?: string } }> }>
      )[0]?.children || []
    expect(targetChildren.map((child) => child.data?.text)).toEqual(['Existing', 'Imported Root'])
  })

  it('appends a leaf node when the imported root has no children', () => {
    const editorState = buildEditorState()
    const result = applyImportedEditorState({
      editorState,
      importedDoc: {
        root: {
          data: { text: 'Imported Leaf', uid: 'import-root' },
          children: [],
        },
      },
      mode: 'append',
      targetUid: 'a-1',
    })

    expect(result.applied).toBe(true)
    const targetChildren =
      (
        ((result.nextEditorState?.editor_doc as { root?: { children?: Array<{ children?: unknown[] }> } })?.root
          ?.children || []) as Array<{ children?: Array<{ data?: { text?: string }; children?: unknown[] }> }>
      )[0]?.children || []
    expect(targetChildren).toHaveLength(1)
    expect(targetChildren[0]?.data?.text).toBe('Imported Leaf')
    expect(targetChildren[0]?.children).toEqual([])
  })

  it('returns append error when target uid is missing', () => {
    const editorState = buildEditorState()
    const result = applyImportedEditorState({
      editorState,
      importedDoc: {
        root: {
          data: { text: 'Imported', uid: 'root-2' },
          children: [{ data: { text: 'B', uid: 'b-1' }, children: [] }],
        },
      },
      mode: 'append',
      targetUid: null,
    })

    expect(result.applied).toBe(false)
    expect(result.error).toContain('请先在脑图中选中一个追加目标知识点')
  })

  it('returns append error when target uid does not exist', () => {
    const editorState = buildEditorState()
    const result = applyImportedEditorState({
      editorState,
      importedDoc: {
        root: {
          data: { text: 'Imported', uid: 'root-2' },
          children: [{ data: { text: 'B', uid: 'b-1' }, children: [] }],
        },
      },
      mode: 'append',
      targetUid: 'missing-node',
    })

    expect(result.applied).toBe(false)
    expect(result.error).toContain('未找到追加目标知识点')
  })

  it('restores editor state from undo snapshot', () => {
    const editorState = buildEditorState()
    const applied = applyImportedEditorState({
      editorState,
      importedDoc: {
        root: {
          data: { text: 'Imported', uid: 'root-2' },
          children: [],
        },
      },
      mode: 'replace',
    })
    const restored = restoreImportedEditorState(applied.nextEditorState ?? null, applied.undoSnapshot)
    expect(restored?.editor_doc).toEqual(editorState.editor_doc)
  })

  it('formats connection refused error with troubleshooting guidance', () => {
    const formatted = formatMindMapImportError(
      '百炼接口连接被拒绝：[WinError 10061] 由于目标计算机积极拒绝，无法连接。当前目标地址：https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    )
    expect(formatted).toContain('DASHSCOPE_BASE_URL')
    expect(formatted).toContain('目标主机和端口是否可达')
  })

  it('keeps enhanced invalid-json error details intact', () => {
    const formatted = formatMindMapImportError(
      '模型返回内容不是有效的脑图 JSON。 返回摘要：抱歉，我无法直接输出标准 JSON，但我看到图片里像是章节层级结构。',
    )
    expect(formatted).toContain('返回摘要')
    expect(formatted).toContain('抱歉，我无法直接输出标准 JSON')
  })

  it('keeps preview response compatible with typed contract', () => {
    const payload: MindMapImportPreviewResponse = {
      ok: true,
      source_tree: { title: 'x', children: [] },
      editor_doc: null,
    }
    expect(payload.ok).toBe(true)
  })

  it('keeps current-session history even when localStorage persistence fails', () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })

    const saved = saveImportHistory('palace_16', {
      title: '第一页',
      nodeCount: 1,
      sourceTree: { title: '第一页', children: [] },
      editorDoc: null,
      imagePreviewUrl: '',
      importMode: 'single',
    })

    expect(saved.history).toHaveLength(1)
    expect(saved.item.title).toBe('第一页')
    expect(saved.persisted).toBe(false)
    setItemSpy.mockRestore()
  })
})
