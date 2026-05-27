import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useMindMapImport } from '@/features/palace-edit/hooks/useMindMapImport'
import * as knowledgeApi from '@/shared/api/modules/knowledge'
import * as palaceApi from '@/shared/api/modules/palaces'
import * as profileApi from '@/shared/api/modules/profile'
import type { MindMapEditorState } from '@/shared/api/contracts'

function buildEditorState(): MindMapEditorState {
  return {
    editor_doc: {
      root: {
        data: { text: 'Root', uid: 'root-1' },
        children: [{ data: { text: 'A', uid: 'a-1' }, children: [] }],
      },
    },
    editor_config: {},
    editor_local_config: {},
    lang: 'zh',
  }
}

function Harness() {
  const [editorState, setEditorState] = React.useState<MindMapEditorState | null>(buildEditorState())
  const model = useMindMapImport({
    entityKey: 'palace_1',
    editorState,
    setEditorState: (nextState) => setEditorState(nextState),
    selectedNodeUid: 'a-1',
    subjectOptions: [{ id: 4, name: '外国教育史' }],
    defaultSubjectId: 4,
  })

  const handleLoadPreview = async () => {
    const file = new File(['x'], 'test.png', { type: 'image/png' })
    const event = {
      target: { files: [file], value: '' },
    } as unknown as React.ChangeEvent<HTMLInputElement>
    await model.handleImportFileChange(event)
  }

  return (
      <div>
        <div data-testid="sync-version">{model.importAppliedSyncVersion}</div>
        <div data-testid="batch-count">{model.importBatchImages.length}</div>
        <div data-testid="batch-status">{model.importBatchStatus}</div>
        <div data-testid="pdf-pages">{model.importPdfPages.join(',')}</div>
        <div data-testid="pdf-doc-id">{model.importSelectedSubjectDocumentId ?? ''}</div>
        <button type="button" onClick={() => void handleLoadPreview()}>
          load
        </button>
        <button
          type="button"
          onClick={() => {
            model.setMindMapImportWorkflow('batch')
          }}
        >
          enable-batch
        </button>
        <button
          type="button"
          onClick={() => {
            const fileOne = new File(['a'], 'one.png', { type: 'image/png' })
            const fileTwo = new File(['b'], 'two.png', { type: 'image/png' })
            const event = {
              target: { files: [fileOne, fileTwo], value: '' },
            } as unknown as React.ChangeEvent<HTMLInputElement>
            void model.handleImportFileChange(event)
          }}
        >
          queue-batch
        </button>
        <button type="button" onClick={() => void model.handleBatchImportStart()}>
          start-batch
        </button>
        <button
          type="button"
          onClick={() => {
            model.setImportSourceKind('subject-pdf')
          }}
        >
          enable-pdf
        </button>
        <button
          type="button"
          onClick={() => {
            model.setImportPdfPageInput('1,3')
          }}
        >
          set-pdf-pages
        </button>
        <button
          type="button"
          onClick={() => {
            model.setImportStructurePage(3)
          }}
        >
          set-structure-page
        </button>
        <button
          type="button"
          onClick={() => {
            model.setImportRangePrompt('第一节 东方文明古国的教育')
          }}
        >
          set-range-prompt
        </button>
        <button type="button" onClick={() => void model.handlePdfImportStart()}>
          start-pdf
        </button>
      <button type="button" onClick={model.handleImportApplyReplace}>
        replace
      </button>
      <button type="button" onClick={model.handleUndoLastImport}>
        undo
      </button>
    </div>
  )
}

describe('useMindMapImport', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:preview'),
      revokeObjectURL: vi.fn(),
    })
    vi.spyOn(palaceApi, 'previewMindMapImportApi').mockResolvedValue({
      ok: true,
      source_tree: {
        title: '导入脑图',
        children: [{ text: '新增节点', children: [] }],
      },
      editor_doc: {
        root: {
          data: { text: 'Imported', uid: 'import-root' },
          children: [{ data: { text: 'B', uid: 'b-1' }, children: [] }],
        },
      },
    } as never)
    vi.spyOn(palaceApi, 'previewMindMapBatchImportApi').mockResolvedValue({
      ok: true,
      source_tree: {
        title: '批量导入脑图',
        children: [{ text: '章节一', children: [{ text: '补充点', children: [] }] }],
      },
      editor_doc: {
        root: {
          data: { text: 'Batch Imported', uid: 'batch-root' },
          children: [{ data: { text: '章节一', uid: 'chapter-1' }, children: [] }],
        },
      },
      structure_image_index: 0,
      image_count: 2,
    } as never)
    vi.spyOn(knowledgeApi, 'getSubjectDocumentsApi').mockResolvedValue({
      items: [
        {
          id: 11,
          subject_id: 4,
          filename: 'subjects/4/test.pdf',
          original_name: 'test.pdf',
          mime_type: 'application/pdf',
          file_size: 128,
          page_count: 3,
          created_at: '2026-05-26T10:00:00',
        },
      ],
    } as never)
    vi.spyOn(knowledgeApi, 'getSubjectDocumentPagesApi').mockResolvedValue({
      page_count: 3,
      pages: [
        { page_number: 1, thumbnail_url: '/thumb-1', preview_url: '/preview-1' },
        { page_number: 2, thumbnail_url: '/thumb-2', preview_url: '/preview-2' },
        { page_number: 3, thumbnail_url: '/thumb-3', preview_url: '/preview-3' },
      ],
    } as never)
    vi.spyOn(profileApi, 'getReviewSettingsApi').mockResolvedValue({
      default_algorithm: 'ebbinghaus',
      default_review_mode: 'flashcard',
      custom_intervals: '1,2,4,7,15,30,60',
      algorithm_change_scope: 'future_only',
      sleep_review_time: '22:00',
      early_review_anchor: 'true',
      ebbinghaus_intervals: '1h,sleep,1,2,4,7,15,30,60',
      daily_max_reviews: '0',
      mastered_interval: '180',
      auto_smooth_overdue: 'true',
      overdue_smoothing_days: '7',
      overdue_smoothing_threshold: '5',
      time_recording_threshold_seconds: '0',
      import_pdf_strict_restore_default: 'true',
      import_pdf_quote_original_default: 'true',
      import_pdf_mount_leaf_only_default: 'true',
      import_pdf_preserve_emphasis_default: 'true',
    } as never)
    vi.spyOn(profileApi, 'updateReviewSettingsApi').mockResolvedValue({
      default_algorithm: 'ebbinghaus',
      default_review_mode: 'flashcard',
      custom_intervals: '1,2,4,7,15,30,60',
      algorithm_change_scope: 'future_only',
      sleep_review_time: '22:00',
      early_review_anchor: 'true',
      ebbinghaus_intervals: '1h,sleep,1,2,4,7,15,30,60',
      daily_max_reviews: '0',
      mastered_interval: '180',
      auto_smooth_overdue: 'true',
      overdue_smoothing_days: '7',
      overdue_smoothing_threshold: '5',
      time_recording_threshold_seconds: '0',
      import_pdf_strict_restore_default: 'true',
      import_pdf_quote_original_default: 'true',
      import_pdf_mount_leaf_only_default: 'true',
      import_pdf_preserve_emphasis_default: 'true',
    } as never)
    vi.spyOn(palaceApi, 'previewMindMapPdfImportApi').mockResolvedValue({
      ok: true,
      source_tree: {
        title: 'PDF 脑图',
        children: [{ text: '第一节', children: [] }],
      },
      editor_doc: {
        root: {
          data: { text: 'PDF Imported', uid: 'pdf-root' },
          children: [{ data: { text: '第一节', uid: 'pdf-1' }, children: [] }],
        },
      },
      selected_pages: [1, 3],
      structure_page: 3,
      match_mode: 'strict_match',
      can_apply: true,
      warnings: [],
    } as never)
  })

  it('increments applied sync version on apply and undo', async () => {
    render(<Harness />)

    fireEvent.click(screen.getByRole('button', { name: 'load' }))
    await waitFor(() => {
      expect(palaceApi.previewMindMapImportApi).toHaveBeenCalled()
    })

    fireEvent.click(screen.getByRole('button', { name: 'replace' }))
    await waitFor(() => {
      expect(screen.getByTestId('sync-version').textContent).toBe('1')
    })

    fireEvent.click(screen.getByRole('button', { name: 'undo' }))
    await waitFor(() => {
      expect(screen.getByTestId('sync-version').textContent).toBe('2')
    })
  })

  it('queues batch images without auto-starting recognition', async () => {
    render(<Harness />)

    fireEvent.click(screen.getByRole('button', { name: 'enable-batch' }))
    fireEvent.click(screen.getByRole('button', { name: 'queue-batch' }))

    await waitFor(() => {
      expect(screen.getByTestId('batch-count').textContent).toBe('2')
      expect(screen.getByTestId('batch-status').textContent).toBe('ready')
    })
    expect(palaceApi.previewMindMapBatchImportApi).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'start-batch' }))
    await waitFor(() => {
      expect(palaceApi.previewMindMapBatchImportApi).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({ structureImageIndex: 0 }),
      )
    })
  })

  it('builds subject-pdf requests from selected pages and prompt', async () => {
    render(<Harness />)

    await waitFor(() => {
      expect(screen.getByTestId('pdf-doc-id').textContent).toBe('11')
    })

    fireEvent.click(screen.getByRole('button', { name: 'enable-pdf' }))
    fireEvent.click(screen.getByRole('button', { name: 'set-pdf-pages' }))
    fireEvent.click(screen.getByRole('button', { name: 'set-structure-page' }))
    fireEvent.click(screen.getByRole('button', { name: 'set-range-prompt' }))

    await waitFor(() => {
      expect(screen.getByTestId('pdf-pages').textContent).toBe('1,3')
    })

    fireEvent.click(screen.getByRole('button', { name: 'start-pdf' }))
    await waitFor(() => {
      expect(palaceApi.previewMindMapPdfImportApi).toHaveBeenCalledWith({
        subject_document_id: 11,
        page_selection: [1, 3],
        structure_page: 3,
        range_prompt: '第一节 东方文明古国的教育',
        fallback_title: 'test.pdf',
        import_options: {
          strict_restore: true,
          quote_original_text_only: true,
          mount_on_original_leaf_only: true,
          preserve_emphasis_marks: true,
        },
      })
    })
  })
})
