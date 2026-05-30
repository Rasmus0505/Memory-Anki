import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import KnowledgePage from '@/features/knowledge/KnowledgePage'
import * as knowledgeApi from '@/shared/api/modules/knowledge'

const knowledgeReloadMock = vi.hoisted(() => vi.fn())
const knowledgeMindMapMockState = vi.hoisted(() => ({
  nextMountId: 1,
}))

vi.mock('@/shared/hooks/usePersistedMindMapEditor', () => ({
  usePersistedMindMapEditor: () => ({
    meta: { id: 7, name: '历史', color: '#334155', sort_order: 1 },
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
    isSaving: false,
    error: null,
    reload: knowledgeReloadMock,
  }),
}))

vi.mock('@/shared/components/mindmap-host', () => ({
  MindMapFrame: ({
    syncIntent = 'soft',
  }: {
    syncIntent?: 'soft' | 'replace'
  }) => {
    const mountIdRef = React.useRef<number | null>(null)
    if (mountIdRef.current == null) {
      mountIdRef.current = knowledgeMindMapMockState.nextMountId++
    }
    return (
      <div data-testid="knowledge-mindmap-frame">
        <div>{`knowledge-mount-${mountIdRef.current}`}</div>
        <div>{`knowledge-sync-${syncIntent}`}</div>
      </div>
    )
  },
}))

vi.mock('@/features/palace-edit/hooks/useMindMapImport', () => ({
  useMindMapImport: () => ({
    importExternalSyncKey: null,
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
    importSubjectOptions: [],
    importSelectedSubjectId: null,
    setImportSelectedSubjectId: vi.fn(),
    importSubjectDocuments: [],
    importSubjectDocumentsLoading: false,
    importSelectedSubjectDocumentId: null,
    setImportSelectedSubjectDocumentId: vi.fn(),
    importPdfPageMeta: [],
    importPdfPagesLoading: false,
    importPdfPages: [],
    importPdfPageInput: '',
    setImportPdfPageInput: vi.fn(),
    importPdfSelectionError: '',
    importStructurePage: 1,
    setImportStructurePage: vi.fn(),
    importPdfPreviewPage: 1,
    setImportPdfPreviewPage: vi.fn(),
    importAnalyzedPdfPages: [],
    importRangePrompt: '',
    setImportRangePrompt: vi.fn(),
    importPdfOptions: {},
    setImportPdfOption: vi.fn(),
    importWarnings: [],
    importCanApply: false,
    importMatchMode: 'strict_match',
    toggleImportPdfPage: vi.fn(),
    handlePdfImportStart: vi.fn(),
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
    handleSubjectDocumentUpload: vi.fn(),
  }),
}))

vi.mock('@/features/palace-edit/components/PalaceMindMapImportDrawer', () => ({
  PalaceMindMapImportDrawer: () => null,
}))

describe('KnowledgePage mind map host refresh behavior', () => {
  beforeEach(() => {
    knowledgeReloadMock.mockReset()
    knowledgeMindMapMockState.nextMountId = 1
    vi.restoreAllMocks()
    vi.spyOn(knowledgeApi, 'getSubjectsApi').mockResolvedValue([
      { id: 7, name: '历史', color: '#334155', sort_order: 1 },
    ] as never)
    vi.spyOn(knowledgeApi, 'updateSubjectApi').mockResolvedValue({ ok: true } as never)
    vi.spyOn(knowledgeApi, 'getChapterApi').mockResolvedValue({
      chapter: null,
      palaces: [],
    } as never)
  })

  it('keeps the same host instance when saving subject info and stays on soft sync', async () => {
    render(<KnowledgePage />)

    await waitFor(() => {
      expect(screen.getByText('knowledge-mount-1')).toBeTruthy()
    })
    expect(screen.getByText('knowledge-sync-soft')).toBeTruthy()

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
  })
})
