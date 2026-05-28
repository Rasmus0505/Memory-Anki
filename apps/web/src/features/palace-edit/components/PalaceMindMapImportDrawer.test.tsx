import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PalaceMindMapImportDrawer } from '@/features/palace-edit/components/PalaceMindMapImportDrawer'

vi.mock('@/shared/components/mindmap-host', () => ({
  MindMapFrame: ({ forceSyncKey }: { forceSyncKey?: string | number | null }) => (
    <div data-testid="mindmap-frame">{String(forceSyncKey ?? '')}</div>
  ),
}))

function buildProps(
  overrides: Partial<React.ComponentProps<typeof PalaceMindMapImportDrawer>> = {},
): React.ComponentProps<typeof PalaceMindMapImportDrawer> {
  return {
    open: true,
    onOpenChange: vi.fn(),
    mode: 'mindmap',
    onModeChange: vi.fn(),
    sourceKind: 'subject-pdf',
    onSourceKindChange: vi.fn(),
    onWorkflowChange: vi.fn(),
    loading: false,
    applying: false,
    undoing: false,
    error: '',
    sourceTree: null,
    previewEditorDoc: null,
    extractedText: '',
    imagePreviewUrl: '',
    batchImages: [],
    structureImageId: null,
    batchStatus: 'idle',
    batchMeta: null,
    subjectOptions: [{ id: 4, name: '外国教育史' }],
    selectedSubjectId: 4,
    onSelectedSubjectIdChange: vi.fn(),
    subjectDocuments: [
      {
        id: 11,
        subject_id: 4,
        filename: 'subjects/4/test.pdf',
        original_name: 'test.pdf',
        mime_type: 'application/pdf',
        file_size: 128,
        page_count: 3,
        created_at: '2026-05-27T10:00:00',
      },
    ],
    subjectDocumentsLoading: false,
    selectedSubjectDocumentId: 11,
    onSelectedSubjectDocumentIdChange: vi.fn(),
    pdfPageMeta: [{ page_number: 1, thumbnail_url: '/thumb-1', preview_url: '/preview-1' }],
    pdfPagesLoading: false,
    selectedPdfPages: [1],
    pdfPageInput: '1',
    onPdfPageInputChange: vi.fn(),
    pdfSelectionError: '',
    structurePage: 1,
    onStructurePageChange: vi.fn(),
    pdfPreviewPage: 1,
    onPdfPreviewPageChange: vi.fn(),
    analyzedPdfPages: [],
    rangePrompt: '古希腊',
    onRangePromptChange: vi.fn(),
    pdfImportOptions: {
      strict_restore: true,
      quote_original_text_only: true,
      mount_on_original_leaf_only: true,
      preserve_emphasis_marks: true,
      semantic_split_long_paragraphs: true,
      preserve_line_breaks: true,
    },
    onPdfImportOptionChange: vi.fn(),
    importWarnings: [],
    importCanApply: true,
    importMatchMode: 'strict_match',
    onTogglePdfPage: vi.fn(),
    onPdfStart: vi.fn(),
    targetNodeLabel: '测试节点',
    canAppend: true,
    canUndoLastImport: false,
    history: [],
    onPaste: vi.fn(),
    onFileChange: vi.fn(),
    onBatchStart: vi.fn(),
    onBatchDeleteImage: vi.fn(),
    onBatchMoveImage: vi.fn(),
    onBatchSetStructureImage: vi.fn(),
    onApplyReplace: vi.fn(),
    onApplyAppend: vi.fn(),
    onUndoLastImport: vi.fn(),
    onSelectHistory: vi.fn(),
    onDeleteHistory: vi.fn(),
    ...overrides,
  }
}

describe('PalaceMindMapImportDrawer', () => {
  const scrollIntoView = vi.fn()

  beforeEach(() => {
    scrollIntoView.mockReset()
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('uses a single scroll container for the main import panel', () => {
    render(<PalaceMindMapImportDrawer {...buildProps()} />)

    expect(screen.getByTestId('mindmap-import-dialog-content').className).toContain('overflow-hidden')
    expect(screen.getByTestId('mindmap-import-dialog-content').className).not.toContain('overflow-y-auto')
    expect(screen.getByTestId('mindmap-import-scroll-panel').className).toContain('overflow-y-auto')
    expect(screen.getByTestId('mindmap-import-results').className).not.toContain('overflow-y-auto')
  })

  it('auto-scrolls to the preview section after a result appears', () => {
    const { rerender } = render(<PalaceMindMapImportDrawer {...buildProps()} />)

    rerender(
      <PalaceMindMapImportDrawer
        {...buildProps({
          sourceTree: {
            title: '第二节 古希腊的教育阶段',
            children: [{ text: '荷马时期', children: [] }],
          },
        })}
      />,
    )

    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'smooth' })
  })

  it('prefers readonly mind map preview when editor_doc is available', () => {
    render(
      <PalaceMindMapImportDrawer
        {...buildProps({
          sourceTree: {
            title: '第二节 古希腊的教育阶段',
            children: [{ text: '荷马时期', children: [] }],
          },
          previewEditorDoc: {
            root: {
              data: { text: '第二节 古希腊的教育阶段', uid: 'root-1' },
              children: [{ data: { text: '荷马时期', uid: 'node-1' }, children: [] }],
            },
          },
        })}
      />,
    )

    expect(screen.getByTestId('mindmap-import-preview-frame')).toBeTruthy()
    expect(screen.getByTestId('mindmap-frame').textContent).toContain('preview:')
    expect(screen.queryByText('荷马时期')).toBeNull()
  })

  it('falls back to the lightweight tree when editor_doc is unavailable', () => {
    render(
      <PalaceMindMapImportDrawer
        {...buildProps({
          sourceTree: {
            title: '第二节 古希腊的教育阶段',
            children: [{ text: '荷马时期', children: [] }],
          },
          previewEditorDoc: null,
        })}
      />,
    )

    expect(screen.queryByTestId('mindmap-import-preview-frame')).toBeNull()
    expect(screen.getByText('荷马时期')).toBeTruthy()
  })
})
