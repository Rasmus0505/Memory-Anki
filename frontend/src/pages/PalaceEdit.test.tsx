import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import PalaceEdit from '@/pages/PalaceEdit'

const mockGetPalaceEditor = vi.fn()
const mockGetSubjects = vi.fn()
const mockGetPalaceVersions = vi.fn()
const mockGetPalaceVersionDetail = vi.fn()
const mockRestorePalaceVersion = vi.fn()

vi.mock('@/api/client', () => ({
  api: {
    getPalaceEditor: (...args: unknown[]) => mockGetPalaceEditor(...args),
    savePalaceEditor: vi.fn(),
    savePalaceEditorWithOptions: vi.fn(),
    getSubjects: (...args: unknown[]) => mockGetSubjects(...args),
    getSubjectTree: vi.fn(),
    getPalaceVersions: (...args: unknown[]) => mockGetPalaceVersions(...args),
    getPalaceVersionDetail: (...args: unknown[]) => mockGetPalaceVersionDetail(...args),
    restorePalaceVersion: (...args: unknown[]) => mockRestorePalaceVersion(...args),
    createPalace: vi.fn(),
    updatePalace: vi.fn(),
    uploadAttachment: vi.fn(),
    deleteAttachment: vi.fn(),
    linkPalaceChapters: vi.fn(),
  },
}))

vi.mock('@/hooks/usePersistedMindMapEditor', () => ({
  usePersistedMindMapEditor: () => ({
    meta: {
      id: 4,
      title: '测试宫殿',
      description: '',
      created_at: '2026-05-08T15:45:00',
      attachments: [],
      chapters: [],
    },
    editorState: {
      editor_doc: {
        root: {
          data: { text: 'Root', uid: 'root' },
          children: [{ data: { text: 'A', uid: 'a' }, children: [] }],
        },
      },
      editor_config: {},
      editor_local_config: {},
      lang: 'zh',
    },
    setEditorState: vi.fn(),
    isSaving: false,
    isLoading: false,
    error: '',
    reload: vi.fn(),
  }),
}))

vi.mock('@/components/mindmap-host', () => ({
  MindMapFrame: ({ editorState, readonly }: { editorState: Record<string, unknown>; readonly?: boolean }) => (
    <div data-testid={readonly ? 'readonly-mindmap' : 'editable-mindmap'}>
      {JSON.stringify(editorState.editor_doc)}
    </div>
  ),
}))

vi.mock('@/components/session/SessionTimerBar', () => ({
  SessionTimerBar: () => null,
}))

vi.mock('@/hooks/useTimedSession', () => ({
  useTimedSession: () => ({
    effectiveSeconds: 0,
    pauseCount: 0,
    status: 'idle',
    startedAt: null,
    start: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    complete: vi.fn(),
    adjustDuration: vi.fn(),
    registerActivity: vi.fn(),
  }),
}))

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/palaces/4/edit']}>
      <Routes>
        <Route path="/palaces/:id/edit" element={<PalaceEdit />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('PalaceEdit version dialog', () => {
  beforeEach(() => {
    mockGetSubjects.mockResolvedValue([])
    mockGetPalaceEditor.mockResolvedValue({})
    mockGetPalaceVersions.mockResolvedValue({
      palace_id: 4,
      palace_title: '测试宫殿',
      versions: [
        {
          id: 94,
          palace_id: 4,
          trigger_reason: 'editor_save',
          title: '测试宫殿',
          created_at: '2026-05-08T15:23:59.901732',
          created_at_value: '2026-05-08T15:20:00',
        },
      ],
    })
    mockGetPalaceVersionDetail.mockResolvedValue({
      id: 94,
      palace_id: 4,
      trigger_reason: 'editor_save',
      title: '测试宫殿',
      created_at: '2026-05-08T15:23:59.901732',
      created_at_value: '2026-05-08T15:20:00',
      editor_config: { theme: { template: 'avocado', config: {} }, layout: 'logicalStructure', config: {} },
      editor_local_config: {},
      editor_doc: {
        root: {
          data: { text: 'Preview Root', uid: 'root' },
          children: [{ data: { text: 'Preview Child', uid: 'child' }, children: [] }],
        },
      },
    })
  })

  it('renders restore point cards with effective snapshot wording and no raw save-time row', async () => {
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: '恢复点' }))

    expect(screen.queryByText(/这里保存的是当前记忆宫殿过去的快照/)).toBeNull()
    expect(screen.getByText(/自动恢复点/)).toBeTruthy()
    expect(screen.getByText(/恢复点 #94/)).toBeTruthy()
    expect(screen.queryByText(/保存时间：2026-05-08T15:23:59.901732/)).toBeNull()
  })

  it('opens preview inside the same dialog and can return to the list', async () => {
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: '恢复点' }))
    fireEvent.click(screen.getByRole('button', { name: '预览' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '返回列表' })).toBeTruthy()
      expect(screen.getByTestId('readonly-mindmap')).toBeTruthy()
      expect(screen.getByText('测试宫殿')).toBeTruthy()
      expect(mockGetPalaceVersionDetail).toHaveBeenCalledWith(4, 94)
    })

    fireEvent.click(screen.getByRole('button', { name: '返回列表' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '预览' })).toBeTruthy()
    })
  })
})
