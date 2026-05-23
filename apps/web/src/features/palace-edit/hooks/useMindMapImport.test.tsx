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
      <button type="button" onClick={() => void handleLoadPreview()}>
        load
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
})
