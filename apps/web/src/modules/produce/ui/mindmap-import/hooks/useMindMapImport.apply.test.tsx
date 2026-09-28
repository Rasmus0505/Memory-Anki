import { useState } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useMindMapImport } from '@/modules/produce/ui/mindmap-import/hooks/useMindMapImport'
import type { MindMapEditorState } from '@/shared/api/contracts'

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}))

function buildEditorState(text = '当前脑图'): MindMapEditorState {
  return {
    editor_doc: {
      root: {
        data: { text, uid: 'a-1' },
        children: [],
      },
    },
    editor_config: {},
    editor_local_config: {},
    lang: 'zh',
  }
}

function rootText(editorState: MindMapEditorState | null) {
  const doc = editorState?.editor_doc
  if (!doc || typeof doc !== 'object' || !('root' in doc)) return ''
  const root = doc.root
  if (!root || typeof root !== 'object' || !('data' in root)) return ''
  const data = root.data
  if (!data || typeof data !== 'object' || !('text' in data)) return ''
  return typeof data.text === 'string' ? data.text : ''
}

function ApplyHarness({
  applyEditorState,
}: {
  applyEditorState?: (nextState: MindMapEditorState) => Promise<void> | void
}) {
  const [editorState, setEditorState] = useState<MindMapEditorState | null>(buildEditorState())
  const model = useMindMapImport({
    entityKey: 'palace_1',
    editorState,
    setEditorState,
    applyEditorState,
    selectedNodeUid: 'a-1',
  })
  return (
    <div>
      <button type="button" onClick={() => model.openManualJsonPreview('{"title":"剪贴板根","children":[{"text":"子节点","children":[]}]}')}>
        open-json
      </button>
      <button type="button" onClick={() => model.openManualJsonPreview('')}>
        open-empty
      </button>
      <button type="button" onClick={model.handleImportApplyReplace}>replace</button>
      <button type="button" onClick={model.handleUndoLastImport}>undo</button>
      <div data-testid="open">{String(model.importOpen)}</div>
      <div data-testid="kind">{model.importSourceKind}</div>
      <div data-testid="preview-root">{rootText({ editor_doc: model.importPreviewEditorDoc, editor_config: {}, editor_local_config: {}, lang: 'zh' })}</div>
      <div data-testid="error">{model.importError}</div>
      <div data-testid="manual-text">{model.manualImportText}</div>
      <div data-testid="sync-version">{String(model.importAppliedSyncVersion)}</div>
      <div data-testid="applied-root">{rootText(editorState)}</div>
    </div>
  )
}

describe('useMindMapImport manual JSON apply', () => {
  it('opens a manual JSON preview from clipboard text', async () => {
    render(<ApplyHarness />)

    fireEvent.click(screen.getByRole('button', { name: 'open-json' }))
    await waitFor(() => {
      expect(screen.getByTestId('open').textContent).toBe('true')
      expect(screen.getByTestId('kind').textContent).toBe('manual-json')
      expect(screen.getByTestId('preview-root').textContent).toBe('剪贴板根')
      expect(screen.getByTestId('error').textContent).toBe('')
    })

    fireEvent.click(screen.getByRole('button', { name: 'open-empty' }))
    await waitFor(() => {
      expect(screen.getByTestId('open').textContent).toBe('true')
      expect(screen.getByTestId('kind').textContent).toBe('manual-json')
      expect(screen.getByTestId('preview-root').textContent).toBe('')
      expect(screen.getByTestId('error').textContent).toContain('请先粘贴')
      expect(screen.getByTestId('manual-text').textContent).toBe('')
    })
  })

  it('increments applied sync version on apply and undo', async () => {
    render(<ApplyHarness />)

    fireEvent.click(screen.getByRole('button', { name: 'open-json' }))
    fireEvent.click(screen.getByRole('button', { name: 'replace' }))
    await waitFor(() => {
      expect(screen.getByTestId('sync-version').textContent).toBe('1')
      expect(screen.getByTestId('applied-root').textContent).toBe('剪贴板根')
    })

    fireEvent.click(screen.getByRole('button', { name: 'undo' }))
    await waitFor(() => {
      expect(screen.getByTestId('sync-version').textContent).toBe('2')
      expect(screen.getByTestId('applied-root').textContent).toBe('当前脑图')
    })
  })

  it('awaits explicit applyEditorState callbacks for apply and undo', async () => {
    const applyEditorState = vi.fn(async () => undefined)
    render(<ApplyHarness applyEditorState={applyEditorState} />)

    fireEvent.click(screen.getByRole('button', { name: 'open-json' }))
    fireEvent.click(screen.getByRole('button', { name: 'replace' }))
    await waitFor(() => {
      expect(applyEditorState).toHaveBeenCalledTimes(1)
      expect(screen.getByTestId('sync-version').textContent).toBe('1')
    })

    fireEvent.click(screen.getByRole('button', { name: 'undo' }))
    await waitFor(() => {
      expect(applyEditorState).toHaveBeenCalledTimes(2)
      expect(screen.getByTestId('sync-version').textContent).toBe('2')
    })
  })
})
