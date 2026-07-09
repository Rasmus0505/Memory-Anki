import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import KnowledgePage from '@/features/knowledge/KnowledgePage'
import * as knowledgeApi from '@/entities/knowledge/api'

const knowledgeReloadMock = vi.hoisted(() => vi.fn())
const knowledgeReplaceEditorStateMock = vi.hoisted(() => vi.fn())
const knowledgeMindMapMockState = vi.hoisted(() => ({
  nextMountId: 1,
}))
const knowledgeImportMockState = vi.hoisted(() => ({
  importAppliedSyncVersion: 0,
}))
const knowledgeUseMindMapImportMock = vi.hoisted(() => vi.fn())

vi.mock('@/shared/hooks/usePersistedMindMapEditor', () => ({
  usePersistedMindMapEditor: () => ({
    meta: { id: 7, name: '历史', color: '#334155', sort_order: 1 },
    setMeta: vi.fn(),
    editorState: {
      editor_doc: {
        root: {
          data: { text: '历史', uid: 'subject-root-1' },
          children: [],
        },
      },
      editor_config: {},
      editor_local_config: {},
      lang: 'zh',
    },
    setEditorState: vi.fn(),
    replaceEditorState: knowledgeReplaceEditorStateMock,
    adoptExternalState: vi.fn(),
    isLoading: false,
    isSaving: false,
    error: null,
    reload: knowledgeReloadMock,
    flushSave: vi.fn(),
  }),
}))

vi.mock('@/shared/components/mindmap-host', () => ({
  MindMapFrame: React.forwardRef(({
    syncIntent = 'soft',
    forceSyncKey = null,
    initialViewPolicy = 'preserve',
    viewMemoryScope = null,
    onNodeActive,
  }: {
    syncIntent?: 'soft' | 'replace'
    forceSyncKey?: string | number | null
    initialViewPolicy?: 'preserve' | 'reset'
    viewMemoryScope?: string | null
    onNodeActive?: (nodes: Array<{
      uid: string | null
      text: string
      note: string
      memoryAnkiId: number | null
      memoryAnkiNodeType: string | null
      rawData: Record<string, unknown>
    }>) => void
  }, ref) => {
    React.useImperativeHandle(ref, () => ({
      setUiCleared: vi.fn(),
      toggleUiCleared: vi.fn(),
      enterNativeFullscreen: vi.fn(async () => {}),
      exitNativeFullscreen: vi.fn(async () => {}),
    }))
    const mountIdRef = React.useRef<number | null>(null)
    if (mountIdRef.current == null) {
      mountIdRef.current = knowledgeMindMapMockState.nextMountId++
    }
    return (
      <div data-testid="knowledge-mindmap-frame">
        <div>{`knowledge-mount-${mountIdRef.current}`}</div>
        <div>{`knowledge-sync-${syncIntent}`}</div>
        <div>{`knowledge-force-${String(forceSyncKey ?? '')}`}</div>
        <div>{`knowledge-view-policy-${initialViewPolicy}`}</div>
        <div>{`knowledge-view-scope-${String(viewMemoryScope ?? '')}`}</div>
        <button
          type="button"
          onClick={() =>
            onNodeActive?.([
              {
                uid: 'chapter-42',
                text: '第二章',
                note: '',
                memoryAnkiId: 42,
                memoryAnkiNodeType: 'chapter',
                rawData: {},
              },
            ])
          }
        >
          选中测试章节
        </button>
      </div>
    )
  }),
  MindMapPageToolbar: ({
    importMindMapAction,
    importTextAction,
    immersiveAction,
    nativeFullscreenAction,
    clearUiAction,
  }: Record<string, any>) => (
    <div data-testid="knowledge-mindmap-toolbar">
      {importMindMapAction ? <button type="button" onClick={importMindMapAction.onClick}>{importMindMapAction.label}</button> : null}
      {importTextAction ? <button type="button" onClick={importTextAction.onClick}>{importTextAction.label}</button> : null}
      {immersiveAction ? <button type="button" onClick={immersiveAction.onClick}>{immersiveAction.label}</button> : null}
      {nativeFullscreenAction ? <button type="button" onClick={nativeFullscreenAction.onClick}>{nativeFullscreenAction.label}</button> : null}
      {clearUiAction ? <button type="button" onClick={clearUiAction.onClick}>{clearUiAction.label}</button> : null}
    </div>
  ),
}))

vi.mock('@/features/mindmap-import', () => ({
  useMindMapImport: knowledgeUseMindMapImportMock,
  MindMapImportDrawer: () => null,
}))

describe('KnowledgePage mind map host refresh behavior', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    knowledgeReloadMock.mockReset()
    knowledgeReplaceEditorStateMock.mockReset()
    knowledgeMindMapMockState.nextMountId = 1
    knowledgeImportMockState.importAppliedSyncVersion = 0
    knowledgeUseMindMapImportMock.mockImplementation(() => ({
      importExternalSyncKey: null,
      importAppliedSyncVersion: knowledgeImportMockState.importAppliedSyncVersion,
      importOpen: false,
      setImportOpen: vi.fn(),
      importMode: 'mindmap',
      setImportMode: vi.fn(),
      importSourceKind: 'file',
      setImportSourceKind: vi.fn(),
      setMindMapImportWorkflow: vi.fn(),
      importLoading: false,
      importApplying: false,
      importUndoing: false,
      importError: '',
      importSourceTree: null,
      importPreviewEditorDoc: null,
      importExtractedText: '',
      importImagePreviewUrl: '',
      importBatchImages: [],
      importStructureImageId: null,
      importBatchStatus: 'idle',
      importBatchMeta: null,
      importWarnings: [],
      importCanAppend: false,
      importCanUndoLastImport: false,
      handleImportPaste: vi.fn(),
      handleImportFileChange: vi.fn(),
      handleBatchImportStart: vi.fn(),
      handleDeleteBatchImage: vi.fn(),
      handleMoveBatchImage: vi.fn(),
      handleSetStructureImage: vi.fn(),
      handleImportApplyReplace: vi.fn(),
      handleImportApplyAppend: vi.fn(),
      handleUndoLastImport: vi.fn(),
      importHistory: [],
      handleImportSelectHistory: vi.fn(),
      handleImportDeleteHistory: vi.fn(),
    }))
    vi.spyOn(knowledgeApi, 'getSubjectsApi').mockResolvedValue([
      { id: 7, name: '历史', color: '#334155', sort_order: 1 },
    ] as never)
    vi.spyOn(knowledgeApi, 'updateSubjectApi').mockResolvedValue({ ok: true } as never)
    vi.spyOn(knowledgeApi, 'getChapterApi').mockResolvedValue({
      chapter: null,
      palaces: [],
    } as never)
    vi.spyOn(knowledgeApi, 'deleteChapterApi').mockResolvedValue({ ok: true })
  })

  it('keeps the same host instance when saving subject info and stays on soft sync', async () => {
    render(<KnowledgePage />)

    await waitFor(() => {
      expect(screen.getByText('knowledge-mount-1')).toBeTruthy()
    })
    await waitFor(() => {
      expect((screen.getByLabelText('名称') as HTMLInputElement).value).toBe('历史')
    })
    expect(screen.getByText('knowledge-sync-soft')).toBeTruthy()
    expect(screen.getByText('knowledge-force-subject:7:0')).toBeTruthy()
    expect(screen.getByText('knowledge-view-policy-reset')).toBeTruthy()
    expect(screen.getByText('knowledge-view-scope-knowledge-subject:7')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '保存学科信息' }))

    await waitFor(() => {
      expect(knowledgeApi.updateSubjectApi).toHaveBeenCalledWith(7, {
        name: '历史',
        color: '#334155',
      })
    })
    await waitFor(() => {
      expect(knowledgeReloadMock).toHaveBeenCalled()
    })
    expect(screen.getByText('knowledge-mount-1')).toBeTruthy()
    expect(screen.getByText('knowledge-sync-soft')).toBeTruthy()
    expect(screen.getByText('knowledge-view-policy-reset')).toBeTruthy()
    expect(screen.getByText('knowledge-view-scope-knowledge-subject:7')).toBeTruthy()
  })

  it('passes import applied sync version into forceSyncKey for replace sync after import', async () => {
    knowledgeImportMockState.importAppliedSyncVersion = 2

    render(<KnowledgePage />)

    await waitFor(() => {
      expect(screen.getByText('knowledge-force-subject:7:2')).toBeTruthy()
    })
    expect(screen.getByText('knowledge-view-policy-reset')).toBeTruthy()
    expect(screen.getByText('knowledge-view-scope-knowledge-subject:7')).toBeTruthy()
  })

  it('passes an explicit applyEditorState callback into useMindMapImport', async () => {
    render(<KnowledgePage />)

    await waitFor(() => {
      expect(knowledgeUseMindMapImportMock).toHaveBeenCalled()
      expect(screen.getByText('knowledge-force-subject:7:0')).toBeTruthy()
    })

    const lastCall =
      knowledgeUseMindMapImportMock.mock.calls[
        knowledgeUseMindMapImportMock.mock.calls.length - 1
      ]?.[0] as {
      applyEditorState?: (nextState: unknown) => Promise<void>
    }
    expect(typeof lastCall?.applyEditorState).toBe('function')

    const nextState = {
      editor_doc: {
        root: {
          data: { text: '导入结果', uid: 'subject-root-1' },
          children: [{ data: { text: '第一部分', uid: 'chapter-1' }, children: [] }],
        },
      },
      editor_config: {},
      editor_local_config: {},
      lang: 'zh',
    }
    vi.spyOn(knowledgeApi, 'saveSubjectEditorApi').mockResolvedValue({
      subject: { id: 7, name: '历史', color: '#334155', sort_order: 1 },
      ...nextState,
    } as never)

    await lastCall.applyEditorState?.(nextState)

    expect(knowledgeReplaceEditorStateMock).toHaveBeenCalledWith(nextState)
    expect(knowledgeApi.saveSubjectEditorApi).toHaveBeenCalledWith(7, nextState)
    expect(knowledgeReloadMock).toHaveBeenCalled()
  })

  it('confirms chapter delete impact before force deleting', async () => {
    vi.spyOn(knowledgeApi, 'getChapterApi').mockResolvedValue({
      chapter: {
        id: 42,
        name: '第二章',
        notes: '',
        children: [],
        breadcrumbs: [],
      },
      palaces: [
        {
          id: 9,
          title: '教育史宫殿',
          mastered: false,
          archived: false,
          review_stage_completed: 2,
          review_stage_total: 5,
          next_due_date: '2026-07-10',
        },
      ],
    })
    const impact = {
      ok: false,
      requires_force: true,
      chapter_count: 2,
      linked_palace_count: 1,
      question_count: 3,
    } as const
    vi.spyOn(knowledgeApi, 'deleteChapterApi')
      .mockRejectedValueOnce(new knowledgeApi.DeleteChapterImpactError(impact))
      .mockResolvedValueOnce({ ok: true })
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(
      <MemoryRouter>
        <KnowledgePage />
      </MemoryRouter>,
    )

    fireEvent.click(await screen.findByRole('button', { name: '选中测试章节' }))
    await screen.findByText('教育史宫殿')
    expect(screen.getByText('复习 2/5')).toBeTruthy()
    expect(screen.getByText('下次 2026-07-10')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '删除章节' }))

    await waitFor(() => {
      expect(confirmSpy).toHaveBeenCalledWith(
        '该章节及其子章节共 2 个，关联了 1 个宫殿、3 道题目。删除后题目将一并删除且不可恢复，确定删除吗？',
      )
    })
    expect(knowledgeApi.deleteChapterApi).toHaveBeenNthCalledWith(1, 42)
    expect(knowledgeApi.deleteChapterApi).toHaveBeenNthCalledWith(2, 42, { force: true })
    expect(knowledgeReloadMock).toHaveBeenCalled()
  })
})
