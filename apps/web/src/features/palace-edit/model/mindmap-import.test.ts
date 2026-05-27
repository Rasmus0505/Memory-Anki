import type { MindMapEditorState, MindMapImportPreviewResponse } from '@/shared/api/contracts'
import { vi } from 'vitest'
import {
  applyImportedEditorState,
  countSourceTreeNodes,
  formatMindMapImportError,
  restoreImportedEditorState,
  saveImportHistory,
} from '@/features/palace-edit/model/mindmap-import'

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
      targetUid: 'missing-node',
    })

    expect(result.applied).toBe(false)
    expect(result.error).toContain('未找到追加目标节点')
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
      importMode: 'pdf',
      imageCount: 6,
    })

    expect(saved.history).toHaveLength(1)
    expect(saved.item.title).toBe('第一页')
    expect(saved.persisted).toBe(false)
    setItemSpy.mockRestore()
  })
})
