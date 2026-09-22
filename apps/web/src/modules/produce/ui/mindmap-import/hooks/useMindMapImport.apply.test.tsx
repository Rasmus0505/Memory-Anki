import { useState } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  Harness,
  buildEditorState,
  buildJob,
  buildMindmapJob,
  setupUseMindMapImportTestContext,
} from '@/modules/produce/ui/mindmap-import/hooks/useMindMapImport.test-support'
import { useMindMapImport } from '@/modules/produce/ui/mindmap-import/hooks/useMindMapImport'
import * as importApi from '@/modules/produce/domain/knowledge-import-entity/api'
import type { MindMapEditorState } from '@/shared/api/contracts'

function ManualPreviewHarness() {
  const [editorState, setEditorState] = useState<MindMapEditorState | null>(buildEditorState())
  const model = useMindMapImport({
    entityKey: 'palace_1',
    editorState,
    setEditorState,
    selectedNodeUid: 'a-1',
  })
  const previewRoot = (() => {
    const doc = model.importPreviewEditorDoc
    if (!doc || typeof doc !== 'object' || !('root' in doc)) return ''
    const root = doc.root
    if (!root || typeof root !== 'object' || !('data' in root)) return ''
    const data = root.data
    if (!data || typeof data !== 'object' || !('text' in data)) return ''
    return typeof data.text === 'string' ? data.text : ''
  })()
  return (
    <div>
      <button type="button" onClick={() => model.openManualJsonPreview('{"title":"剪贴板根","children":[{"text":"子节点","children":[]}]}')}>
        open-json
      </button>
      <button type="button" onClick={() => model.openManualJsonPreview('')}>
        open-empty
      </button>
      <div data-testid="open">{String(model.importOpen)}</div>
      <div data-testid="kind">{model.importSourceKind}</div>
      <div data-testid="preview-root">{previewRoot}</div>
      <div data-testid="error">{model.importError}</div>
      <div data-testid="manual-text">{model.manualImportText}</div>
    </div>
  )
}

describe('useMindMapImport apply flows', () => {
  beforeEach(() => {
    setupUseMindMapImportTestContext()
  })

  it('increments applied sync version on apply and undo', async () => {
    render(<Harness />)

    fireEvent.click(screen.getByRole('button', { name: 'load' }))
    fireEvent.click(screen.getByRole('button', { name: 'start-batch' }))
    await waitFor(() => {
      expect(screen.getByTestId('preview-doc-root').textContent).toBe('Imported')
    })
    expect(importApi.runImportJobApi).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'replace' }))
    await waitFor(() => {
      expect(screen.getByTestId('sync-version').textContent).toBe('1')
    })

    fireEvent.click(screen.getByRole('button', { name: 'undo' }))
    await waitFor(() => {
      expect(screen.getByTestId('sync-version').textContent).toBe('2')
    })
  })

  it('awaits explicit applyEditorState callbacks for apply and undo', async () => {
    const applyEditorState = vi.fn(async () => undefined)

    render(<Harness applyEditorState={applyEditorState} />)

    fireEvent.click(screen.getByRole('button', { name: 'load' }))
    fireEvent.click(screen.getByRole('button', { name: 'start-batch' }))
    await waitFor(() => {
      expect(screen.getByTestId('preview-doc-root').textContent).toBe('Imported')
    })

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

  it('exposes preview editor docs for one-image and multi-image queue imports', async () => {
    const context = setupUseMindMapImportTestContext()
    let runCount = 0
    context.nextBatchJobFactory = () => {
      runCount += 1
      return runCount === 1
        ? buildMindmapJob('job-one-image', 'Imported', '导入脑图')
        : buildJob({
            ...buildMindmapJob('job-multi-image', 'Batch Imported', '批量导入'),
            source_kind: 'image-batch',
          })
    }
    render(<Harness />)

    fireEvent.click(screen.getByRole('button', { name: 'load' }))
    fireEvent.click(screen.getByRole('button', { name: 'start-batch' }))
    await waitFor(() => {
      expect(screen.getByTestId('preview-doc-root').textContent).toBe('Imported')
    })

    fireEvent.click(screen.getByRole('button', { name: 'enable-batch' }))
    fireEvent.click(screen.getByRole('button', { name: 'queue-batch' }))
    fireEvent.click(screen.getByRole('button', { name: 'start-batch' }))
    await waitFor(() => {
      expect(screen.getByTestId('preview-doc-root').textContent).toBe('Batch Imported')
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
    expect(importApi.createBatchImportJobApi).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'start-batch' }))
    await waitFor(() => {
      expect(importApi.createBatchImportJobApi).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({ entityKey: 'palace_1' }),
      )
    })
  })

  it('builds a fallback preview doc when history only contains source_tree', async () => {
    const context = setupUseMindMapImportTestContext()
    context.nextBatchJobFactory = () =>
      buildJob({
        id: 'job-fallback',
        source_kind: 'image-batch',
        mode: 'mindmap',
        result: {
          source_tree: {
            title: '旧草稿',
            children: [{ text: '补充节点', children: [] }],
          },
          editor_doc: null,
          warnings: [],
          can_apply: true,
          match_mode: 'strict_match',
        },
      })

    render(<Harness />)

    fireEvent.click(screen.getByRole('button', { name: 'load' }))
    fireEvent.click(screen.getByRole('button', { name: 'start-batch' }))
    await waitFor(() => {
      expect(screen.getByTestId('preview-doc-root').textContent).toBe('旧草稿')
    })

    fireEvent.click(screen.getByRole('button', { name: 'replace' }))
    await waitFor(() => {
      expect(screen.getByTestId('sync-version').textContent).toBe('1')
    })
  })

  it('reuses an existing completed result without rerunning recognition', async () => {
    const context = setupUseMindMapImportTestContext()
    context.nextBatchJobFactory = () => buildMindmapJob('job-reused', 'Imported', '导入脑图')

    render(<Harness />)

    fireEvent.click(screen.getByRole('button', { name: 'load' }))
    fireEvent.click(screen.getByRole('button', { name: 'start-batch' }))
    await waitFor(() => {
      expect(screen.getByTestId('reused-result').textContent).toBe('true')
      expect(screen.getByTestId('current-job-status').textContent).toBe('completed')
      expect(screen.getByTestId('preview-doc-root').textContent).toBe('Imported')
    })
    expect(importApi.runImportJobApi).not.toHaveBeenCalled()
  })

  it('opens a manual-json preview from clipboard text without hydrating history', async () => {
    vi.spyOn(importApi, 'listPdfDocumentsApi').mockResolvedValue({ items: [] })
    render(<ManualPreviewHarness />)

    fireEvent.click(screen.getByRole('button', { name: 'open-json' }))
    await waitFor(() => {
      expect(screen.getByTestId('open').textContent).toBe('true')
      expect(screen.getByTestId('kind').textContent).toBe('manual-json')
      expect(screen.getByTestId('preview-root').textContent).toBe('剪贴板根')
      expect(screen.getByTestId('error').textContent).toBe('')
    })
    expect(importApi.listImportJobsApi).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'open-empty' }))
    await waitFor(() => {
      expect(screen.getByTestId('open').textContent).toBe('true')
      expect(screen.getByTestId('kind').textContent).toBe('manual-json')
      expect(screen.getByTestId('preview-root').textContent).toBe('')
      expect(screen.getByTestId('error').textContent).toContain('请先粘贴')
      expect(screen.getByTestId('manual-text').textContent).toBe('')
    })
  })
})


