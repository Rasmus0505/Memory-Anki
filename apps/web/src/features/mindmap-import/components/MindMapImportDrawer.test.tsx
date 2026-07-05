import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MindMapImportDrawer } from '@/features/mindmap-import/components/MindMapImportDrawer'

vi.mock('@/shared/components/mindmap-host', () => ({
  MindMapFrame: ({ forceSyncKey }: { forceSyncKey?: string | number | null }) => (
    <div data-testid="mindmap-frame">{String(forceSyncKey ?? '')}</div>
  ),
}))

function buildProps(
  overrides: Partial<React.ComponentProps<typeof MindMapImportDrawer>> = {},
): React.ComponentProps<typeof MindMapImportDrawer> {
  return {
    open: true,
    onOpenChange: vi.fn(),
    mode: 'mindmap',
    onModeChange: vi.fn(),
    sourceKind: 'image-single',
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
    importWarnings: [],
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

describe('MindMapImportDrawer', () => {
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
    render(<MindMapImportDrawer {...buildProps()} />)

    expect(screen.getByTestId('mindmap-import-dialog-content').className).toContain('overflow-hidden')
    expect(screen.getByTestId('mindmap-import-dialog-content').className).not.toContain('overflow-y-auto')
    expect(screen.getByTestId('mindmap-import-scroll-panel').className).toContain('overflow-y-auto')
    expect(screen.getByTestId('mindmap-import-results').className).not.toContain('overflow-y-auto')
  })

  it('auto-scrolls to the preview section after a result appears', async () => {
    const { rerender } = render(<MindMapImportDrawer {...buildProps()} />)

    rerender(
      <MindMapImportDrawer
        {...buildProps({
          sourceTree: {
            title: '第二节 古希腊的教育阶段',
            children: [{ text: '荷马时期', children: [] }],
          },
        })}
      />,
    )

    await waitFor(() => {
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'smooth' })
    })
  })

  it('does not auto-scroll again when reopening with the same existing result', async () => {
    const props = buildProps({
      sourceTree: {
        title: '第二节 古希腊的教育阶段',
        children: [{ text: '荷马时期', children: [] }],
      },
    })
    const { rerender } = render(<MindMapImportDrawer {...props} />)

    await waitFor(() => {
      expect(scrollIntoView).toHaveBeenCalledTimes(1)
    })

    rerender(<MindMapImportDrawer {...props} open={false} />)
    rerender(<MindMapImportDrawer {...props} open />)

    expect(scrollIntoView).toHaveBeenCalledTimes(1)
  })

  it('prefers readonly mind map preview when editor_doc is available', () => {
    render(
      <MindMapImportDrawer
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
      <MindMapImportDrawer
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
      <MindMapImportDrawer
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
      <MindMapImportDrawer
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
      <MindMapImportDrawer
        {...buildProps({
          loading: true,
          streamPreviewText: '{"title":"第一段"}',
        })}
      />,
    )

    const previewContent = screen.getByTestId('mindmap-import-stream-preview-content')
    previewContent.scrollTop = 360

    rerender(
      <MindMapImportDrawer
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
      <MindMapImportDrawer
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
      <MindMapImportDrawer
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
      <MindMapImportDrawer
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

  it('does not render the removed pdf preview sidebar', () => {
    render(<MindMapImportDrawer {...buildProps()} />)

    expect(screen.queryByTestId('mindmap-import-pdf-sidebar')).toBeNull()
    expect(screen.queryByText('当前识别页预览')).toBeNull()
    expect(screen.queryByRole('button', { name: '学科 PDF' })).toBeNull()
  })

  it('shows a pending pause label while waiting for the current step to finish', () => {
    render(
      <MindMapImportDrawer
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
    render(<MindMapImportDrawer {...buildProps()} />)

    expect(screen.queryByText('严格还原 PDF 自带脑图结构')).toBeNull()
    expect(screen.queryByText('当前结果仅供预览，不可直接覆盖或追加到正式脑图。')).toBeNull()
  })
})
