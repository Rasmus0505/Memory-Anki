import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  Harness,
  buildJob,
  buildMindmapJob,
  setupUseMindMapImportTestContext,
} from '@/features/palace-edit/hooks/useMindMapImport.test-support'
import * as palaceApi from '@/shared/api/modules/palaces'

describe('useMindMapImport apply flows', () => {
  beforeEach(() => {
    setupUseMindMapImportTestContext()
  })

  it('increments applied sync version on apply and undo', async () => {
    render(<Harness />)

    fireEvent.click(screen.getByRole('button', { name: 'load' }))
    await waitFor(() => {
      expect(screen.getByTestId('preview-doc-root').textContent).toBe('Imported')
    })
    expect(palaceApi.runImportJobApi).not.toHaveBeenCalled()

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

  it('exposes preview editor docs for single image, batch, and pdf imports', async () => {
    render(<Harness />)

    fireEvent.click(screen.getByRole('button', { name: 'load' }))
    await waitFor(() => {
      expect(screen.getByTestId('preview-doc-root').textContent).toBe('Imported')
    })

    fireEvent.click(screen.getByRole('button', { name: 'enable-batch' }))
    fireEvent.click(screen.getByRole('button', { name: 'queue-batch' }))
    fireEvent.click(screen.getByRole('button', { name: 'start-batch' }))
    await waitFor(() => {
      expect(screen.getByTestId('preview-doc-root').textContent).toBe('Batch Imported')
    })

    fireEvent.click(screen.getByRole('button', { name: 'enable-pdf' }))
    fireEvent.click(screen.getByRole('button', { name: 'set-pdf-pages' }))
    fireEvent.click(screen.getByRole('button', { name: 'set-range-prompt' }))
    fireEvent.click(screen.getByRole('button', { name: 'start-pdf' }))
    await waitFor(() => {
      expect(screen.getByTestId('preview-doc-root').textContent).toBe('PDF Imported')
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
    expect(palaceApi.createBatchImportJobApi).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'start-batch' }))
    await waitFor(() => {
      expect(palaceApi.createBatchImportJobApi).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({ entityKey: 'palace_1' }),
      )
    })
  })

  it('builds a fallback preview doc when history only contains source_tree', async () => {
    const context = setupUseMindMapImportTestContext()
    context.nextImageJobFactory = () =>
      buildJob({
        id: 'job-fallback',
        source_kind: 'image-single',
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
    context.nextImageJobFactory = () => buildMindmapJob('job-reused', 'Imported', '导入脑图')

    render(<Harness />)

    fireEvent.click(screen.getByRole('button', { name: 'load' }))
    await waitFor(() => {
      expect(screen.getByTestId('reused-result').textContent).toBe('true')
      expect(screen.getByTestId('current-job-status').textContent).toBe('completed')
      expect(screen.getByTestId('preview-doc-root').textContent).toBe('Imported')
    })
    expect(palaceApi.runImportJobApi).not.toHaveBeenCalled()
  })
})
