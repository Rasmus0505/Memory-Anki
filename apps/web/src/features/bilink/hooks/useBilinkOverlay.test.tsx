import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BilinkItem, BilinkSearchResult } from '@/shared/api/contracts'
import * as bilinkApi from '@/features/bilink/api'
import * as palaceCatalogApi from '@/entities/palace/api'
import { useBilinkOverlay } from './useBilinkOverlay'

vi.mock('@/features/bilink/hooks/useBilinkSearch', () => ({
  useBilinkSearch: () => ({
    results: [],
    loading: false,
    error: '',
  }),
}))

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))

const searchResult: BilinkSearchResult = {
  type: 'node',
  palace_id: 5,
  palace_title: '目标宫殿',
  node_uid: 'node-1',
  node_text: 'Target Node',
  node_path: ['Root', 'Target Node'],
}

const panelItem: BilinkItem = {
  id: 3,
  direction: 'outgoing',
  source_palace_id: 1,
  source_palace_title: '当前宫殿',
  target_palace_id: 6,
  target_palace_title: '面板目标',
  src_uid: 'source-1',
  tgt_uid: 'target-1',
  text: 'Panel link',
  source_node_text: 'Source',
  target_node_text: 'Target',
  source_node_path: ['Source'],
  target_node_path: ['Target'],
}

function Harness() {
  const model = useBilinkOverlay({
    currentPalaceId: 1,
    allowCreate: true,
  })

  return (
    <div>
      <div data-testid="highlight-query">{model.bilinkPreviewHighlightQuery}</div>
      <div data-testid="preview-palace">{model.bilinkPreviewContext?.palace_title ?? ''}</div>
      <button type="button" onClick={() => model.setBilinkSearchQuery('Target')}>
        set-query
      </button>
      <button type="button" onClick={() => model.openBilinkSearch({ mode: 'toolbar', position: null })}>
        open-toolbar
      </button>
      <button type="button" onClick={() => void model.handleBilinkResultPreview(searchResult)}>
        preview-from-search
      </button>
      <button type="button" onClick={() => void model.handleBilinkSearchSelect(searchResult)}>
        select-from-search
      </button>
      <button
        type="button"
        onClick={() =>
          void model.handleBilinkNodeClick({
            palaceId: 7,
            nodeUid: 'badge-node',
            trigger: 'badge',
          })
        }
      >
        preview-from-badge
      </button>
      <button type="button" onClick={() => void model.handleBilinkPanelPreview(panelItem)}>
        preview-from-panel
      </button>
    </div>
  )
}

describe('useBilinkOverlay preview highlighting', () => {
  beforeEach(() => {
    vi.restoreAllMocks()

    vi.spyOn(bilinkApi, 'getBilinkNodeContextApi').mockImplementation(async (palaceId, nodeUid) => ({
      palace_id: palaceId,
      palace_title: `宫殿-${palaceId}`,
      node_uid: nodeUid ?? null,
      node_text: '节点',
      node_note: '',
      node_path: ['根节点'],
      parent_text: null,
      children: [],
      siblings: [],
    }))

    vi.spyOn(palaceCatalogApi, 'getPalaceEditorApi').mockImplementation(async (palaceId) => ({
      palace: {
        id: palaceId,
        title: `宫殿-${palaceId}`,
        description: '',
        attachments: [],
      },
      editor_doc: {
        root: {
          data: { text: 'Target root', uid: 'root-1' },
          children: [],
        },
      },
      editor_config: {},
      editor_local_config: {},
      lang: 'zh',
    }))
  })

  it('stores the current search term when preview opens from search results', async () => {
    render(<Harness />)

    fireEvent.click(screen.getByRole('button', { name: 'set-query' }))
    fireEvent.click(screen.getByRole('button', { name: 'preview-from-search' }))

    await waitFor(() => {
      expect(screen.getByTestId('highlight-query').textContent).toBe('Target')
      expect(screen.getByTestId('preview-palace').textContent).toBe('宫殿-5')
    })

    expect(bilinkApi.getBilinkNodeContextApi).toHaveBeenCalledWith(5, 'node-1')
  })

  it('only keeps preview highlighting for search-entry previews and clears it for badge or panel previews', async () => {
    render(<Harness />)

    fireEvent.click(screen.getByRole('button', { name: 'open-toolbar' }))
    fireEvent.click(screen.getByRole('button', { name: 'set-query' }))
    fireEvent.click(screen.getByRole('button', { name: 'select-from-search' }))

    await waitFor(() => {
      expect(screen.getByTestId('highlight-query').textContent).toBe('Target')
      expect(screen.getByTestId('preview-palace').textContent).toBe('宫殿-5')
    })

    fireEvent.click(screen.getByRole('button', { name: 'preview-from-badge' }))
    await waitFor(() => {
      expect(screen.getByTestId('highlight-query').textContent).toBe('')
      expect(screen.getByTestId('preview-palace').textContent).toBe('宫殿-7')
    })

    fireEvent.click(screen.getByRole('button', { name: 'preview-from-panel' }))
    await waitFor(() => {
      expect(screen.getByTestId('highlight-query').textContent).toBe('')
      expect(screen.getByTestId('preview-palace').textContent).toBe('宫殿-6')
    })
  })
})
