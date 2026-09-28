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
    applying: false,
    undoing: false,
    error: '',
    sourceTree: null,
    previewEditorDoc: null,
    renderMindMapPreview: (_editorState, version) => (
      <div data-testid="mindmap-frame">{`preview:${version}`}</div>
    ),
    targetNodeLabel: '测试知识点',
    canAppend: true,
    canUndoLastImport: false,
    manualImportText: '',
    onManualImportTextChange: vi.fn(),
    manualImportFileName: '',
    manualImportFormatPrompt: '请输出 JSON 脑图',
    onManualImportParse: vi.fn(),
    onManualImportFileChange: vi.fn(),
    onApplyReplace: vi.fn(),
    onApplyAppend: vi.fn(),
    onUndoLastImport: vi.fn(),
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
  })

  afterEach(() => {
    vi.restoreAllMocks()
    window.localStorage.clear()
  })

  it('lets the user paste JSON and copy the format prompt', async () => {
    const onManualImportTextChange = vi.fn()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, {
      clipboard: { writeText },
    })

    render(
      <MindMapImportDrawer
        {...buildProps({
          manualImportFormatPrompt: '请输出 JSON 脑图',
          onManualImportTextChange,
        })}
      />,
    )

    expect(screen.getByText('文字转脑图')).toBeTruthy()
    expect(screen.getByText('手动解析 · 不调用 AI')).toBeTruthy()
    expect(screen.getByText('格式整理提示词')).toBeTruthy()
    expect(screen.queryByText('图片')).toBeNull()
    expect(screen.queryByText('PDF')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '复制提示词' }))
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('请输出 JSON 脑图')
    })
    fireEvent.change(screen.getByPlaceholderText(/根节点标题/), {
      target: { value: '{"title":"A","children":[]}' },
    })
    expect(onManualImportTextChange).toHaveBeenCalledWith('{"title":"A","children":[]}')
  })

  it('parses manual JSON when the parse button is clicked', () => {
    const onManualImportParse = vi.fn()
    render(
      <MindMapImportDrawer
        {...buildProps({
          manualImportText: '{"title":"A","children":[{"text":"B","children":[]}]}',
          onManualImportParse,
        })}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '解析为脑图草稿' }))
    expect(onManualImportParse).toHaveBeenCalled()
  })

  it('loads a JSON file through the file input', () => {
    const onManualImportFileChange = vi.fn()
    render(
      <MindMapImportDrawer
        {...buildProps({
          onManualImportFileChange,
        })}
      />,
    )
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['{"title":"A","children":[]}'], 'map.json', { type: 'application/json' })
    fireEvent.change(input, { target: { files: [file] } })
    expect(onManualImportFileChange).toHaveBeenCalled()
  })

  it('applies a parsed draft without calling image or PDF actions', () => {
    const onApplyReplace = vi.fn()
    render(
      <MindMapImportDrawer
        {...buildProps({
          sourceTree: {
            title: '第二节 古希腊的教育阶段',
            children: [{ text: '荷马时期', children: [] }],
          },
          onApplyReplace,
        })}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '应用到宫殿（覆盖）' }))
    expect(onApplyReplace).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: '开始识别' })).toBeNull()
    expect(screen.queryByText('PDF 资料库')).toBeNull()
  })

  it('expands on open even when its previous floating state was collapsed', async () => {
    window.localStorage.setItem(
      'memory-anki-floating-dialog:mindmap-import',
      JSON.stringify({ x: 80, y: 80, width: 820, height: null, collapsed: true, pinned: false }),
    )

    render(<MindMapImportDrawer {...buildProps()} />)

    expect(await screen.findByTestId('mindmap-import-dialog-content')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '恢复文字转脑图' })).toBeNull()
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
})
