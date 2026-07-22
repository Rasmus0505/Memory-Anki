import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MindMapImportDrawer } from '@/modules/produce/ui/mindmap-import/components/MindMapImportDrawer'

function buildProps(
  overrides: Partial<React.ComponentProps<typeof MindMapImportDrawer>> = {},
): React.ComponentProps<typeof MindMapImportDrawer> {
  return {
    open: true,
    onOpenChange: vi.fn(),
    mode: 'mindmap',
    onModeChange: vi.fn(),
    sourceKind: 'image-batch',
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
    renderMindMapPreview: (_editorState, version) => (
      <div data-testid="mindmap-frame">{`preview:${version}`}</div>
    ),
    extractedText: '',
    imagePreviewUrl: '',
    batchImages: [],
    batchStatus: 'idle',
    batchMeta: null,
    importWarnings: [],
    currentJobId: null,
    currentJobStatus: null,
    currentJobStage: null,
    currentJobUsage: null,
    currentJobError: null,
    currentJobResolvedAi: null,
    currentJobPauseRequested: false,
    canResumeJob: false,
    canPauseJob: false,
    reusedExistingResult: false,
    onResumeJob: vi.fn(),
    onPauseJob: vi.fn(),
    targetNodeLabel: '测试知识点',
    canAppend: true,
    canUndoLastImport: false,
    history: [],
    onPaste: vi.fn(),
    onFileChange: vi.fn(),
    onBatchStart: vi.fn(),
    onBatchDeleteImage: vi.fn(),
    onBatchMoveImage: vi.fn(),
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
    window.localStorage.clear()
  })

  it('expands on open even when its previous floating state was collapsed', async () => {
    window.localStorage.setItem(
      'memory-anki-floating-dialog:mindmap-import',
      JSON.stringify({ x: 80, y: 80, width: 820, height: null, collapsed: true, pinned: false }),
    )

    render(<MindMapImportDrawer {...buildProps()} />)

    expect(await screen.findByTestId('mindmap-import-dialog-content')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '恢复图片转脑图' })).toBeNull()
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
    renderMindMapPreview: (_editorState, version) => (
      <div data-testid="mindmap-frame">{`preview:${version}`}</div>
    ),
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
          streamPhase: 'extracting_text',
          streamStatusMessage: '正在识别全部上传页文字',
          streamStep: 2,
          streamTotalSteps: 4,
        })}
      />,
    )

    expect(screen.getByTestId('mindmap-import-stream-status').textContent).toContain('正在识别全部上传页文字')
    expect(screen.getByTestId('mindmap-import-stream-status').textContent).toContain('第 2/4 步')
    expect(screen.getByTestId('mindmap-import-stream-status').textContent).toContain('extracting text')
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
    renderMindMapPreview: (_editorState, version) => (
      <div data-testid="mindmap-frame">{`preview:${version}`}</div>
    ),
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

  it('shows interrupted jobs as resumable', () => {
    render(
      <MindMapImportDrawer
        {...buildProps({
          currentJobId: 'job-interrupted',
          currentJobStatus: 'interrupted',
          currentJobStage: 'merge',
          canResumeJob: true,
        })}
      />,
    )

    expect(screen.getByText('已中断')).toBeTruthy()
    expect(screen.getByText('合并')).toBeTruthy()
    expect(screen.getByRole('button', { name: '继续识别' })).toBeTruthy()
  })

  it('renders structured job error details', () => {
    render(
      <MindMapImportDrawer
        {...buildProps({
          currentJobId: 'job-failed',
          currentJobStatus: 'failed',
          currentJobStage: 'structure',
          currentJobUsage: {
            structure: 1,
            ocr: 0,
            merge: 0,
            text: 0,
            total: 1,
          },
          currentJobError: {
            code: 'provider_network_error',
            stage: 'structure',
            message: '模型请求超时，请稍后继续识别。',
            retryable: true,
            raw_snippet: 'timed out after 60 seconds',
            request_id: 'req-1',
          },
        })}
      />,
    )

    expect(screen.getByText('识别失败（阶段：结构识别）')).toBeTruthy()
    expect(screen.getByText('provider_network_error')).toBeTruthy()
    expect(screen.getByText('timed out after 60 seconds')).toBeTruthy()
    expect(screen.getByText(/已完成 1 次 AI 调用/)).toBeTruthy()
  })

  it('uses one image queue and starts recognition explicitly', () => {
    render(<MindMapImportDrawer {...buildProps()} />)

    expect(screen.getByText('选择一张或多张图片，或直接在这里粘贴')).toBeTruthy()
    expect(screen.queryByText('单图')).toBeNull()
    expect(screen.queryByText('多图')).toBeNull()
    const startButton = screen.getByRole('button', { name: '开始识别' }) as HTMLButtonElement
    expect(startButton.disabled).toBe(true)
  })

  it('shows the persistent PDF library and starts selected pages explicitly', () => {
    const onPdfStart = vi.fn()
    render(
      <MindMapImportDrawer
        {...buildProps({
          sourceKind: 'pdf-document',
          pdfDocuments: [{
            id: 'pdf-1',
            original_name: '课程资料.pdf',
            mime_type: 'application/pdf',
            file_size: 1024,
            page_count: 12,
            created_at: '2026-07-13T00:00:00',
          }],
          selectedPdfDocumentId: 'pdf-1',
          pdfPageSelection: '1-3,8',
          onPdfStart,
        })}
      />,
    )

    expect(screen.getByText('PDF 资料库')).toBeTruthy()
    expect(screen.getByText(/持久化保存/)).toBeTruthy()
    expect((screen.getByLabelText('选择 PDF 资料') as HTMLSelectElement).value).toBe('pdf-1')
    fireEvent.click(screen.getByRole('button', { name: '开始转脑图' }))
    expect(onPdfStart).toHaveBeenCalledTimes(1)
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

  it('shows pipeline artifacts and manual retry actions without applying automatically', () => {
    const onRetryVision = vi.fn()
    const onReformatFromOcr = vi.fn()
    const onApplyReplace = vi.fn()
    render(
      <MindMapImportDrawer
        {...buildProps({
          sourceTree: { title: '德国近代教育', children: [{ text: '第斯多惠—影响', children: [] }] },
          currentJobResult: {
            pipeline_strategy: 'vision_ocr_fallback',
            fallback_reason: '模型输出因长度限制被截断。',
            vision_response: '{"title":"德国近代教育"',
            vision_resolved_ai: {
              scene_key: 'vision_batch_mindmap', model_key: 'qwen3-vl-flash', model_label: 'Qwen3 VL Flash', provider: 'qwen', model_type: 'vl', has_vision: true, thinking_enabled: false,
            },
            formatter_resolved_ai: {
              scene_key: 'mindmap_ocr_formatter', model_key: 'deepseek-v4-flash', model_label: 'DeepSeek V4 Flash', provider: 'deepseek', model_type: 'llm', has_vision: false, thinking_enabled: false,
            },
            ocr_pages: [{ page_number: 68, text: '第斯多惠\n影响' }],
          },
          onRetryVision,
          onReformatFromOcr,
          onApplyReplace,
        })}
      />,
    )

    expect(screen.getByText('回退原因：模型输出因长度限制被截断。')).toBeTruthy()
    expect(screen.getByText('逐页 OCR 原文（1 页）')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '使用 OCR 原文重新整理' }))
    fireEvent.click(screen.getByRole('button', { name: '重试视觉识别' }))
    expect(onReformatFromOcr).toHaveBeenCalledTimes(1)
    expect(onRetryVision).toHaveBeenCalledTimes(1)
    expect(onApplyReplace).not.toHaveBeenCalled()
  })})
