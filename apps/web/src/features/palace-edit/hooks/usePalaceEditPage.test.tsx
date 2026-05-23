import { StrictMode } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import PalaceEditPage from '@/features/palace-edit/PalaceEditPage'
import * as palaceApi from '@/shared/api/modules/palaces'
import * as knowledgeApi from '@/shared/api/modules/knowledge'

vi.mock('@/shared/hooks/useTimedSession', () => ({
  useTimedSession: () => ({
    effectiveSeconds: 0,
    idleSeconds: 0,
    pauseCount: 0,
    status: 'idle',
    startedAt: null,
    durationEdited: false,
    glowState: 'idle',
    start: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    adjustDuration: vi.fn(),
    registerActivity: vi.fn(),
    logEvent: vi.fn(),
    complete: vi.fn(),
    reset: vi.fn(),
  }),
}))

vi.mock('@/shared/components/mindmap-host', () => ({
  MindMapFrame: ({
    onPracticeToggle,
    onMindMapImportOpen,
    onImageTextImportOpen,
    onFullscreenToggle,
    practiceToggleLabel = '练习',
    practiceModeActive = false,
    readonly = false,
    showToolbarWhenReadonly = false,
    preserveViewOnSync = false,
    showImportButtons = false,
  }: {
    onPracticeToggle?: () => void
    onMindMapImportOpen?: () => void
    onImageTextImportOpen?: () => void
    practiceToggleLabel?: '练习' | '复习'
    practiceModeActive?: boolean
    readonly?: boolean
    showToolbarWhenReadonly?: boolean
    preserveViewOnSync?: boolean
    showImportButtons?: boolean
    onFullscreenToggle?: (active?: boolean) => void
  }) => (
    <div>
      <div>{`mindmap-${practiceModeActive ? 'practice' : 'edit'}-${readonly ? 'readonly' : 'editable'}-${showToolbarWhenReadonly ? 'toolbar' : 'plain'}-${preserveViewOnSync ? 'preserve' : 'reset'}-${showImportButtons ? 'import' : 'noimport'}`}</div>
      {onPracticeToggle ? (
        <button type="button" onClick={onPracticeToggle}>
          {practiceToggleLabel}
        </button>
      ) : null}
      {onMindMapImportOpen ? (
        <button type="button" onClick={onMindMapImportOpen}>
          转脑图
        </button>
      ) : null}
      {onImageTextImportOpen ? (
        <button type="button" onClick={onImageTextImportOpen}>
          转文字
        </button>
      ) : null}
      {onFullscreenToggle ? (
        <button type="button" onClick={() => onFullscreenToggle()}>
          切换半屏
        </button>
      ) : null}
    </div>
  ),
}))

vi.mock('@/features/palace-edit/components/PalaceAttachmentPanel', () => ({
  PalaceAttachmentPanel: () => <div>attachments</div>,
}))

vi.mock('@/features/palace-edit/components/PalaceChapterPanel', () => ({
  PalaceChapterPanel: () => <div>chapters</div>,
}))

vi.mock('@/features/palace-edit/components/PalaceMetaPanel', () => ({
  PalaceMetaPanel: () => <div>meta</div>,
}))

vi.mock('@/features/palace-edit/components/PalaceSegmentsPanel', () => ({
  PalaceSegmentsPanel: () => <div>segments</div>,
}))

vi.mock('@/features/palace-edit/components/PalaceVersionDialog', () => ({
  PalaceVersionDialog: () => null,
}))

vi.mock('@/features/palace-edit/components/PalaceMindMapImportDrawer', () => ({
  PalaceMindMapImportDrawer: ({
    open,
    onApplyReplace,
    onApplyAppend,
    className,
    overlayClassName,
  }: {
    open: boolean
    onApplyReplace: () => void
    onApplyAppend: () => void
    className?: string
    overlayClassName?: string
  }) =>
    open ? (
      <div>
        <div>{`drawer-${className ?? 'plain'}-${overlayClassName ?? 'overlay-plain'}`}</div>
        <button type="button" onClick={onApplyReplace}>
          覆盖当前脑图
        </button>
        <button type="button" onClick={onApplyAppend}>
          追加到选中节点
        </button>
      </div>
    ) : null,
}))

vi.mock('@/shared/components/session/SessionTimerBar', () => ({
  SessionTimerBar: () => <div>timer</div>,
}))

vi.mock('@/features/palace-edit/components/PalaceKnowledgeOutlinePanel', () => ({
  PalaceKnowledgeOutlinePanel: () => <div>outline</div>,
}))

describe('usePalaceEditPage draft creation', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(knowledgeApi, 'getSubjectsApi').mockResolvedValue([])
    vi.spyOn(knowledgeApi, 'getSubjectTreeApi').mockResolvedValue({ chapters: [], subject: null } as never)
    vi.spyOn(palaceApi, 'getPracticeSessionProgressApi').mockResolvedValue({ progress: null } as never)
    vi.spyOn(palaceApi, 'savePracticeSessionProgressApi').mockResolvedValue({ progress: {} } as never)
    vi.spyOn(palaceApi, 'clearPracticeSessionProgressApi').mockResolvedValue({ ok: true } as never)
    vi.spyOn(palaceApi, 'previewMindMapImportApi').mockResolvedValue({
      ok: true,
      source_tree: {
        title: '导入脑图',
        children: [{ text: '新增节点', children: [] }],
      },
      editor_doc: {
        root: {
          data: { text: '导入脑图', uid: 'import-root' },
          children: [{ data: { text: '新增节点', uid: 'import-child-1' }, children: [] }],
        },
      },
    } as never)
  })

  it('creates only one draft palace in StrictMode for /palaces/new', async () => {
    const createPalaceApi = vi
      .spyOn(palaceApi, 'createPalaceApi')
      .mockResolvedValue({ id: 101 } as never)

    vi.spyOn(palaceApi, 'getPalaceEditorApi').mockResolvedValue({
      palace: {
        id: 101,
        title: '未命名宫殿',
        description: '',
        created_at: null,
        attachments: [],
        chapters: [],
      },
      editor_doc: { root: { data: { text: '未命名宫殿', uid: 'root-1' }, children: [] } },
      editor_config: {},
      editor_local_config: {},
      lang: 'zh',
    } as never)

    render(
      <StrictMode>
        <MemoryRouter initialEntries={['/palaces/new']}>
          <Routes>
            <Route path="/palaces/new" element={<PalaceEditPage />} />
            <Route path="/palaces/:id/edit" element={<PalaceEditPage />} />
          </Routes>
        </MemoryRouter>
      </StrictMode>,
    )

    await waitFor(() => {
      expect(createPalaceApi).toHaveBeenCalledTimes(1)
    })
  })

  it('switches palace edit page into inline practice mode without changing layout or restarting the session', async () => {
    vi.spyOn(palaceApi, 'getPalaceEditorApi').mockResolvedValue({
      palace: {
        id: 101,
        title: '测试宫殿',
        description: '',
        created_at: null,
        attachments: [],
        chapters: [],
      },
      editor_doc: { root: { data: { text: '测试宫殿', uid: 'root-1' }, children: [] } },
      editor_config: {},
      editor_local_config: {},
      lang: 'zh',
    } as never)

    render(
      <MemoryRouter initialEntries={['/palaces/101/edit']}>
        <Routes>
          <Route path="/palaces/:id/edit" element={<PalaceEditPage />} />
        </Routes>
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText('测试宫殿')).toBeTruthy()
    })

    await waitFor(() => {
      expect(palaceApi.getPracticeSessionProgressApi).toHaveBeenCalledWith(101)
    })

    expect(screen.getByText('outline')).toBeTruthy()
    expect(screen.getByText('mindmap-edit-editable-plain-reset-import')).toBeTruthy()
    expect(screen.getByRole('button', { name: '转脑图' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '转文字' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '练习' }))
    await waitFor(() => {
      expect(screen.getByText('outline')).toBeTruthy()
      expect(screen.getByText('mindmap-practice-readonly-toolbar-preserve-import')).toBeTruthy()
      expect(screen.getByRole('button', { name: '复习' })).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: '复习' }))
    await waitFor(() => {
      expect(screen.getByText('outline')).toBeTruthy()
      expect(screen.getByText('mindmap-edit-editable-plain-reset-import')).toBeTruthy()
      expect(screen.getByRole('button', { name: '练习' })).toBeTruthy()
    })

    expect(palaceApi.clearPracticeSessionProgressApi).not.toHaveBeenCalled()
  })

  it('forces a preserve-view sync after import apply in edit mode', async () => {
    vi.spyOn(palaceApi, 'getPalaceEditorApi').mockResolvedValue({
      palace: {
        id: 101,
        title: '测试宫殿',
        description: '',
        created_at: null,
        attachments: [],
        chapters: [],
      },
      editor_doc: {
        root: {
          data: { text: '测试宫殿', uid: 'root-1' },
          children: [{ data: { text: '原节点', uid: 'node-1' }, children: [] }],
        },
      },
      editor_config: {},
      editor_local_config: {},
      lang: 'zh',
    } as never)

    render(
      <MemoryRouter initialEntries={['/palaces/101/edit']}>
        <Routes>
          <Route path="/palaces/:id/edit" element={<PalaceEditPage />} />
        </Routes>
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText('mindmap-edit-editable-plain-reset-import')).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: '转脑图' }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '覆盖当前脑图' })).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: '覆盖当前脑图' }))

    expect(screen.getByText('mindmap-edit-editable-plain-reset-import')).toBeTruthy()
  })

  it('raises the import drawer above the immersive card when fullscreen is active', async () => {
    vi.spyOn(palaceApi, 'getPalaceEditorApi').mockResolvedValue({
      palace: {
        id: 101,
        title: '测试宫殿',
        description: '',
        created_at: null,
        attachments: [],
        chapters: [],
      },
      editor_doc: {
        root: {
          data: { text: '测试宫殿', uid: 'root-1' },
          children: [{ data: { text: '原节点', uid: 'node-1' }, children: [] }],
        },
      },
      editor_config: {},
      editor_local_config: {},
      lang: 'zh',
    } as never)

    render(
      <MemoryRouter initialEntries={['/palaces/101/edit']}>
        <Routes>
          <Route path="/palaces/:id/edit" element={<PalaceEditPage />} />
        </Routes>
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText('测试宫殿')).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: '切换半屏' }))
    fireEvent.click(screen.getByRole('button', { name: '转脑图' }))

    await waitFor(() => {
      expect(screen.getByText('drawer-z-[130]-z-[120]')).toBeTruthy()
    })
  })
})
