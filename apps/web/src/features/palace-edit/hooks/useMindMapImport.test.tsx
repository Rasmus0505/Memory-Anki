import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useMindMapImport } from '@/features/palace-edit/hooks/useMindMapImport'
import * as palaceApi from '@/shared/api/modules/palaces'
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
})
