import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import BatchGenerationWorkspacePage from './BatchGenerationWorkspacePage'

const navigate = vi.fn()
const getBatchWorkspace = vi.fn()
const deleteBatchWorkspace = vi.fn()
const appConfirm = vi.fn()
const previewBatchPrompt = vi.fn()
const previewAiPromptCompositionApi = vi.fn()

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => navigate }
})

vi.mock('@/entities/batch-generation/api', () => ({
  getBatchWorkspace: (...args: unknown[]) => getBatchWorkspace(...args),
  deleteBatchWorkspace: (...args: unknown[]) => deleteBatchWorkspace(...args),
  createBatchWorkspace: vi.fn(),
  uploadBatchPdfs: vi.fn(),
  updateBatchSection: vi.fn(),
  confirmBatchOutline: vi.fn(),
  previewBatchPrompt: (...args: unknown[]) => previewBatchPrompt(...args),
  saveBatchDraft: vi.fn(),
  buildBatchPublishPlan: vi.fn(),
}))

vi.mock('@/entities/preferences/api', () => ({
  previewAiPromptCompositionApi: (...args: unknown[]) => previewAiPromptCompositionApi(...args),
}))

vi.mock('@/shared/components/ui/native-dialog', () => ({
  appConfirm: (...args: unknown[]) => appConfirm(...args),
}))

const workspace = {
  id: 'workspace-1',
  title: '批量测试',
  status: 'draft',
  assets: [],
  books: [{
    id: 'book-1',
    title: '德国教育史',
    gate_status: 'ready',
    representative_section_id: null,
    sections: [{
      id: 'section-1',
      book_id: 'book-1',
      title: '德国近代教育',
      start_page: 64,
      end_page: 68,
      output_mode: 'both',
      issues: [],
      drafts: [],
      existing_palace_id: null,
    }],
  }],
}

function renderPage() {
  return render(
    <MemoryRouter>
      <BatchGenerationWorkspacePage />
    </MemoryRouter>,
  )
}

describe('BatchGenerationWorkspacePage', () => {
  beforeEach(() => {
    navigate.mockReset()
    getBatchWorkspace.mockReset().mockResolvedValue(workspace)
    deleteBatchWorkspace.mockReset().mockResolvedValue({ id: workspace.id, deleted: true })
    appConfirm.mockReset().mockResolvedValue(true)
    previewBatchPrompt.mockReset().mockResolvedValue({ messages: [] })
    previewAiPromptCompositionApi.mockReset().mockResolvedValue({ text: '服务器编译后的批量生成提示词' })
    window.localStorage.clear()
    window.localStorage.setItem('memory-anki-batch-workspace-id', workspace.id)
  })

  it('restores the saved workspace without clearing it', async () => {
    renderPage()
    expect(await screen.findByText('批量测试')).toBeTruthy()
    expect(window.localStorage.getItem('memory-anki-batch-workspace-id')).toBe(workspace.id)
    expect(deleteBatchWorkspace).not.toHaveBeenCalled()
  })

  it('deletes the current workspace after confirmation and returns to creation', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: '删除当前工作区' }))

    await waitFor(() => expect(deleteBatchWorkspace).toHaveBeenCalledWith(workspace.id))
    expect(window.localStorage.getItem('memory-anki-batch-workspace-id')).toBeNull()
    expect(navigate).toHaveBeenCalledWith('/palaces/new', { replace: true })
  })

  it('keeps the workspace when deletion is cancelled', async () => {
    appConfirm.mockResolvedValue(false)
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: '删除当前工作区' }))

    await waitFor(() => expect(appConfirm).toHaveBeenCalled())
    expect(deleteBatchWorkspace).not.toHaveBeenCalled()
    expect(window.localStorage.getItem('memory-anki-batch-workspace-id')).toBe(workspace.id)
  })

  it('compiles the batch prompt through the prompt catalog before previewing', async () => {
    renderPage()
    fireEvent.click(await screen.findByDisplayValue('德国近代教育'))
    fireEvent.click(await screen.findByRole('button', { name: '宫殿调用包' }))

    await waitFor(() => expect(previewAiPromptCompositionApi).toHaveBeenCalledWith('batch_palace_generation', {}))
    expect(previewBatchPrompt).toHaveBeenCalledWith(
      'section-1',
      expect.objectContaining({ system_prompt: '服务器编译后的批量生成提示词' }),
    )
  })
})
