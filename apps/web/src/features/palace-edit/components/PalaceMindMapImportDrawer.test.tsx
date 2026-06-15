import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
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
    streamPhase: '',
    streamStatusMessage: '',
    streamStep: null,
    streamTotalSteps: null,
    streamPreviewText: '',
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
    pdfImportMode: 'direct_generation',
    onPdfImportModeChange: vi.fn(),
    structurePage: 1,
    onStructurePageChange: vi.fn(),
    pdfPreviewPage: 1,
    onPdfPreviewPageChange: vi.fn(),
    analyzedPdfPages: [],
    rangePrompt: '古希腊',
    onRangePromptChange: vi.fn(),
    pdfImportOptions: {
      quote_original_text_only: true,
      mount_on_original_leaf_only: true,
      preserve_emphasis_marks: true,
      semantic_split_long_paragraphs: true,
      preserve_line_breaks: true,
    },
    onPdfImportOptionChange: vi.fn(),
    importWarnings: [],
    pdfOcrGroundingUsed: null,
    pdfOcrTextChars: null,
    currentJobId: null,
    currentJobStatus: null,
    currentJobStage: null,
    currentJobUsage: null,
    currentJobResolvedAi: null,
    currentJobPauseRequested: false,
    canResumeJob: false,
    canPauseJob: false,
    reusedExistingResult: false,
    onResumeJob: vi.fn(),
    onPauseJob: vi.fn(),
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
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get() {
        return 480
      },
    })
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get() {
        return 120
      },
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

  it('does not auto-scroll again when reopening with the same existing result', () => {
    const props = buildProps({
      sourceTree: {
        title: '第二节 古希腊的教育阶段',
        children: [{ text: '荷马时期', children: [] }],
      },
    })
    const { rerender } = render(<PalaceMindMapImportDrawer {...props} />)

    expect(scrollIntoView).toHaveBeenCalledTimes(1)

    rerender(<PalaceMindMapImportDrawer {...props} open={false} />)
    rerender(<PalaceMindMapImportDrawer {...props} open />)

    expect(scrollIntoView).toHaveBeenCalledTimes(1)
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

  it('shows streaming phase details while loading', () => {
    render(
      <PalaceMindMapImportDrawer
        {...buildProps({
          loading: true,
          streamPhase: 'extracting_structure',
          streamStatusMessage: '正在提取结构图',
          streamStep: 2,
          streamTotalSteps: 4,
        })}
      />,
    )

    expect(screen.getByTestId('mindmap-import-stream-status').textContent).toContain('正在提取结构图')
    expect(screen.getByTestId('mindmap-import-stream-status').textContent).toContain('第 2/4 步')
    expect(screen.getByTestId('mindmap-import-stream-status').textContent).toContain('extracting structure')
  })

  it('renders raw model preview without replacing the formal tree preview', () => {
    render(
      <PalaceMindMapImportDrawer
        {...buildProps({
          loading: true,
          streamPreviewText: '{"title":"第二节 古希腊的教育阶段"',
          sourceTree: {
            title: '第二节 古希腊的教育阶段',
            children: [{ text: '荷马时期', children: [] }],
          },
          previewEditorDoc: null,
        })}
      />,
    )

    expect(screen.getByTestId('mindmap-import-stream-preview').textContent).toContain('"title":"第二节 古希腊的教育阶段"')
    expect(screen.getByText('荷马时期')).toBeTruthy()
  })

  it('auto-scrolls streaming preview to the latest output while loading', () => {
    const { rerender } = render(
      <PalaceMindMapImportDrawer
        {...buildProps({
          loading: true,
          streamPreviewText: '{"title":"第一段"}',
        })}
      />,
    )

    const previewContent = screen.getByTestId('mindmap-import-stream-preview-content')
    previewContent.scrollTop = 360

    rerender(
      <PalaceMindMapImportDrawer
        {...buildProps({
          loading: true,
          streamPreviewText: '{"title":"第二节 古希腊的教育阶段","children":["荷马时期"]}',
        })}
      />,
    )

    expect(previewContent.scrollTop).toBe(480)
  })

  it('does not steal scroll when the user has scrolled up in the streaming preview', () => {
    const { rerender } = render(
      <PalaceMindMapImportDrawer
        {...buildProps({
          loading: true,
          streamPreviewText: '{"title":"第一段"}',
        })}
      />,
    )

    const previewContent = screen.getByTestId('mindmap-import-stream-preview-content')
    previewContent.scrollTop = 100
    fireEvent.scroll(previewContent)

    rerender(
      <PalaceMindMapImportDrawer
        {...buildProps({
          loading: true,
          streamPreviewText: '{"title":"第一段","children":["第二段"]}',
        })}
      />,
    )

    expect(previewContent.scrollTop).toBe(100)
  })

  it('renders pause controls for running jobs', () => {
    render(
      <PalaceMindMapImportDrawer
        {...buildProps({
          currentJobId: 'job-1',
          currentJobStatus: 'running',
          currentJobStage: 'merge',
          canPauseJob: true,
        })}
      />,
    )

    expect(screen.getByRole('button', { name: '暂停识别' })).toBeTruthy()
  })

  it('shows direct-generation copy by default and toggles to structured mode', () => {
    const onPdfImportModeChange = vi.fn()
    render(
      <PalaceMindMapImportDrawer
        {...buildProps({
          pdfImportMode: 'direct_generation',
          onPdfImportModeChange,
        })}
      />,
    )

    expect(screen.getByText('按范围直接生成')).toBeTruthy()
    expect(screen.getByText(/默认模式。会综合所选页的正文与版面关系，生成完整脑图草稿/)).toBeTruthy()
    expect(screen.getByText('长段和明显列表才自动分点')).toBeTruthy()
    expect(screen.getByText(/短定义和一两行节点保持原文粒度/)).toBeTruthy()
    expect(screen.queryByText('当前结构页')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /结构页补全模式/ }))
    expect(onPdfImportModeChange).toHaveBeenCalledWith('structured_merge')
  })

  it('does not render the removed pdf preview sidebar', () => {
    render(<PalaceMindMapImportDrawer {...buildProps()} />)

    expect(screen.queryByTestId('mindmap-import-pdf-sidebar')).toBeNull()
    expect(screen.queryByText('当前识别页预览')).toBeNull()
  })

  it('shows the pdf execution summary and OCR grounding status', () => {
    render(
      <PalaceMindMapImportDrawer
        {...buildProps({
          sourceTree: {
            title: '第一节 古罗马的教育阶段',
            children: [{ text: '共和时期的罗马教育', children: [] }],
          },
          selectedPdfPages: [26, 27, 28],
          pdfImportMode: 'direct_generation',
          importWarnings: ['未获得稳定的 OCR 正文，本次将继续根据页面图片直接生成脑图，正文补全可信度可能下降。'],
          pdfOcrGroundingUsed: false,
          pdfOcrTextChars: null,
        })}
      />,
    )

    expect(screen.getByTestId('mindmap-import-pdf-summary').textContent).toContain('页码：26, 27, 28')
    expect(screen.getByTestId('mindmap-import-pdf-summary').textContent).toContain('模式：按范围直接生成')
    expect(screen.getByTestId('mindmap-import-pdf-summary').textContent).toContain('结构页：无')
    expect(screen.getByTestId('mindmap-import-pdf-summary').textContent).toContain('OCR grounding：未启用，本次仅按图片直读')
    expect(screen.getByTestId('mindmap-import-pdf-summary').textContent).toContain('正文补全可信度可能下降')
  })

  it('shows a pending pause label while waiting for the current step to finish', () => {
    render(
      <PalaceMindMapImportDrawer
        {...buildProps({
          currentJobId: 'job-1',
          currentJobStatus: 'running',
          currentJobStage: 'merge',
          currentJobPauseRequested: true,
          canPauseJob: true,
        })}
      />,
    )

    const button = screen.getByRole('button', { name: '正在暂停…' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
  })

  it('does not render the removed strict-restore copy', () => {
    render(<PalaceMindMapImportDrawer {...buildProps()} />)

    expect(screen.queryByText('严格还原 PDF 自带脑图结构')).toBeNull()
    expect(screen.queryByText('当前结果仅供预览，不可直接覆盖或追加到正式脑图。')).toBeNull()
  })
})
