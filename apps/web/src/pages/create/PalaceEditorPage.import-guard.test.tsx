import * as React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PalaceEditPage from '@/pages/create/PalaceEditorPage'
import * as palaceApi from '@/modules/content/public'
import * as knowledgeApi from '@/modules/content/public'

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

const importedEditorState = {
  editor_doc: {
    root: {
      data: { text: '导入脑图', uid: 'import-root' },
      children: [{ data: { text: '新增知识点', uid: 'import-child-1' }, children: [] }],
    },
  },
  editor_config: {},
  editor_local_config: {},
  lang: 'zh',
}

const emptyEditorState = {
  editor_doc: {
    root: {
      data: { text: '测试宫殿', uid: 'root-1' },
      children: [],
    },
  },
  editor_config: {},
  editor_local_config: {},
  lang: 'zh',
}

const timedSessionMock = {
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
  leaveScene: vi.fn(),
  adjustDuration: vi.fn(),
  registerActivity: vi.fn(),
  logEvent: vi.fn(),
  complete: vi.fn(),
  reset: vi.fn(),
}

const importHookState = vi.hoisted(() => ({
  triggerReplace: (() => {}) as () => void,
}))

vi.mock('@/shared/hooks/useTimedSession', () => ({
  useTimedSession: () => timedSessionMock,
  shouldAutoStartOnPageEnter: () => false,
}))

vi.mock('@/modules/produce/ui/mindmap-import', () => ({
  useMindMapImport: (options: {
    applyEditorState?: (
      nextState: typeof importedEditorState,
      context?: { source: 'import'; jobId: string | null; applyMode: 'replace' | 'append'; sourceTitle: string },
    ) => Promise<void> | void
  }) => {
    importHookState.triggerReplace = () => {
      void options.applyEditorState?.(importedEditorState, {
        source: 'import',
        jobId: 'job-image-1',
        applyMode: 'replace',
        sourceTitle: '导入脑图',
      })
    }
    return {
      importOpen: true,
      setImportOpen: vi.fn(),
      importMode: 'mindmap',
      setImportMode: vi.fn(),
      importSourceKind: 'image-single',
      setImportSourceKind: vi.fn(),
      mindMapImportWorkflow: 'single',
      setMindMapImportWorkflow: vi.fn(),
      importLoading: false,
      importStreamPhase: '',
      importStreamStatusMessage: '',
      importStreamStep: null,
      importStreamTotalSteps: null,
      importStreamPreviewText: '',
      importApplying: false,
      importUndoing: false,
      importError: '',
      importSourceTree: { title: '导入脑图', children: [{ text: '新增知识点', children: [] }] },
      importPreviewEditorDoc: importedEditorState.editor_doc,
      importExtractedText: '',
      importImagePreviewUrl: '',
      importBatchImages: [],

      importBatchStatus: 'idle',
      importBatchMeta: null,
      importCanAppend: true,
      importCanUndoLastImport: false,
      importExternalSyncKey: 'import:0',
      importAppliedSyncVersion: 0,
      importWarnings: [],
      currentJobId: 'job-image-1',
      currentJobStatus: 'completed',
      currentJobStage: 'completed',
      currentJobUsage: null,
      currentJobError: null,
      currentJobPauseRequested: false,
      canResumeJob: false,
      canPauseJob: false,
      importReusedExistingResult: false,
      handleResumeJob: vi.fn(),
      handlePauseJob: vi.fn(),
      handleImportPaste: vi.fn(),
      handleImportFileChange: vi.fn(),
      handleBatchImportStart: vi.fn(),
      handleDeleteBatchImage: vi.fn(),
      handleMoveBatchImage: vi.fn(),

      clearBatchQueue: vi.fn(),
      handleImportApplyReplace: importHookState.triggerReplace,
      handleImportApplyAppend: vi.fn(),
      handleImportSelectHistory: vi.fn(),
      handleImportDeleteHistory: vi.fn(),
      handleUndoLastImport: vi.fn(),
      importHistory: [],
    }
  },
  MindMapImportDrawer: ({
    onApplyReplace,
  }: {
    onApplyReplace: () => void
  }) => (
    <button type="button" onClick={onApplyReplace}>
      覆盖当前脑图
    </button>
  ),
}))

vi.mock('@/modules/content/ui/mindmap-editor', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/modules/content/ui/mindmap-editor')>()),
  MindMapEditorSurface: React.forwardRef(({
    editorState,
    onEditorStateChange,
  }: {
    editorState: typeof importedEditorState
    onEditorStateChange?: (nextState: typeof importedEditorState) => void
  }, ref) => {
    React.useImperativeHandle(ref, () => ({
      setUiCleared: vi.fn(),
      toggleUiCleared: vi.fn(),
      focusNode: vi.fn(),
      fitView: vi.fn(),
      enterFullscreen: vi.fn(async () => {}),
      exitFullscreen: vi.fn(async () => {}),
      enterNativeFullscreen: vi.fn(async () => {}),
      exitNativeFullscreen: vi.fn(async () => {}),
    }))
    return (
      <div>
        <div data-testid="mindmap-root-text">
          {String((editorState.editor_doc as { root?: { data?: { text?: string } } })?.root?.data?.text ?? '')}
        </div>
        <div data-testid="mindmap-first-child-text">
          {String(
            (
              (editorState.editor_doc as {
                root?: { children?: Array<{ data?: { text?: string } }> }
              })?.root?.children?.[0]?.data?.text ?? ''
            ),
          )}
        </div>
        <button
          type="button"
          onClick={() =>
            onEditorStateChange?.({
              ...emptyEditorState,
            })
          }
        >
          trigger-empty-sync
        </button>
      </div>
    )
  }),
  MindMapPageToolbar: ({
    importMindMapAction,
    importTextAction,
  }: Record<string, any>) => (
    <div>
      {importMindMapAction ? <button type="button" onClick={importMindMapAction.onClick}>{importMindMapAction.label}</button> : null}
      {importTextAction ? <button type="button" onClick={importTextAction.onClick}>{importTextAction.label}</button> : null}
    </div>
  ),
}))

vi.mock('@/shared/components/session/SessionTimerBar', () => ({
  SessionTimerBar: () => <div>timer</div>,
}))

vi.mock('@/widgets/quiz-launcher', () => ({
  useQuizLauncher: () => ({
    openQuizLauncher: vi.fn(),
  }),
}))

vi.mock('@/modules/content/ui/palace-edit/components/PalaceAttachmentPanel', () => ({
  PalaceAttachmentPanel: () => <div>attachments</div>,
}))

vi.mock('@/modules/content/ui/palace-edit/components/PalaceChapterPanel', () => ({
  PalaceChapterPanel: () => <div>chapters</div>,
}))

vi.mock('@/modules/content/ui/palace-edit/components/PalaceMetaPanel', () => ({
  PalaceMetaPanel: () => <div>meta</div>,
}))

vi.mock('@/modules/content/ui/palace-edit/components/PalaceSegmentsPanel', () => ({
  PalaceSegmentsPanel: () => <div>segments</div>,
}))

vi.mock('./PalaceVersionDialog', () => ({
  PalaceVersionDialog: () => null,
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('PalaceEditPage import apply guard', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    timedSessionMock.registerActivity.mockReset()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.spyOn(knowledgeApi, 'getSubjectsApi').mockResolvedValue([])
    vi.spyOn(knowledgeApi, 'getSubjectTreeApi').mockResolvedValue({ chapters: [], subject: null } as never)
    vi.spyOn(palaceApi, 'getPracticeSessionProgressApi').mockResolvedValue({ progress: null } as never)
    vi.spyOn(palaceApi, 'savePracticeSessionProgressApi').mockResolvedValue({ progress: {} } as never)
    vi.spyOn(palaceApi, 'clearPracticeSessionProgressApi').mockResolvedValue({ ok: true } as never)
    vi.spyOn(palaceApi, 'updatePalaceApi').mockResolvedValue({ ok: true } as never)
    vi.spyOn(palaceApi, 'getPalaceVersionsApi').mockResolvedValue({
      versions: [],
      removed_duplicates: 0,
    } as never)
    vi.spyOn(palaceApi, 'splitMindMapNodeApi').mockResolvedValue({
      ok: true,
      editor_doc: importedEditorState.editor_doc,
      generated_children_count: 1,
      reassigned_existing_children_count: 0,
      model: 'qwen3.6-flash',
    } as never)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('ignores blank native sync while import apply is saving and during the first post-reload sync window', async () => {
    const saveRequest = deferred<{
      palace: {
        id: number
        title: string
        description: string
        created_at: null
        attachments: []
        chapters: []
      }
      editor_doc: typeof importedEditorState.editor_doc
      editor_config: Record<string, never>
      editor_local_config: Record<string, never>
      lang: string
    }>()

    let loadCount = 0
    vi.spyOn(palaceApi, 'getPalaceEditorApi').mockImplementation(async () => {
      loadCount += 1
      if (loadCount === 1) {
        return {
          palace: {
            id: 101,
            title: '测试宫殿',
            description: '',
            created_at: null,
            attachments: [],
            chapters: [],
          },
          ...emptyEditorState,
        } as never
      }
      return {
        palace: {
          id: 101,
          title: '测试宫殿',
          description: '',
          created_at: null,
          attachments: [],
          chapters: [],
        },
        ...importedEditorState,
      } as never
    })

    const savePalaceEditorApi = vi.spyOn(palaceApi, 'savePalaceEditorApi').mockImplementation(async () => {
      return saveRequest.promise as never
    })

    render(
      <MemoryRouter initialEntries={['/palaces/101/edit']}>
        <Routes>
          <Route path="/palaces/:id/edit" element={<PalaceEditPage />} />
        </Routes>
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: '测试宫殿' })).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: '覆盖当前脑图' }))
    await waitFor(() => {
      expect(savePalaceEditorApi).toHaveBeenCalledTimes(1)
    })

    fireEvent.click(screen.getByRole('button', { name: 'trigger-empty-sync' }))
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 700))
    })
    expect(savePalaceEditorApi).toHaveBeenCalledTimes(1)

    saveRequest.resolve({
      palace: {
        id: 101,
        title: '测试宫殿',
        description: '',
        created_at: null,
        attachments: [],
        chapters: [],
      },
      ...importedEditorState,
    })

    await waitFor(() => {
      expect(loadCount).toBeGreaterThanOrEqual(2)
    })

    fireEvent.click(screen.getByRole('button', { name: 'trigger-empty-sync' }))
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 700))
    })
    expect(savePalaceEditorApi).toHaveBeenCalledTimes(1)
  }, 10000)

  it('keeps the imported result after dangerous-save confirmation when the backend returns a normalized palace editor state', async () => {
    const initialEditorState = {
      editor_doc: {
        root: {
          data: { text: '测试宫殿', uid: 'root-1' },
          children: [{ data: { text: '旧知识点', uid: 'old-child' }, children: [] }],
        },
      },
      editor_config: {},
      editor_local_config: {},
      lang: 'zh',
    }
    const normalizedSavedState = {
      editor_doc: {
        root: {
          data: { text: '测试宫殿', uid: 'import-root', memoryAnkiRootKind: 'palace' },
          children: [
            {
              data: {
                text: '新增知识点',
                uid: 'import-child-1',
                memoryAnkiId: 88,
                memoryAnkiNodeType: 'peg',
              },
              children: [],
            },
          ],
        },
      },
      editor_config: {},
      editor_local_config: {},
      lang: 'zh',
    }

    let loadCount = 0
    vi.spyOn(palaceApi, 'getPalaceEditorApi').mockImplementation(async () => {
      loadCount += 1
      return {
        palace: {
          id: 101,
          title: '测试宫殿',
          description: '',
          created_at: null,
          attachments: [],
          chapters: [],
        },
        ...(loadCount === 1 ? initialEditorState : normalizedSavedState),
      } as never
    })

    const savePalaceEditorApi = vi
      .spyOn(palaceApi, 'savePalaceEditorApi')
      .mockRejectedValue(
        new Error('检测到危险结构变更：新导图知识点数骤减，已拒绝保存。请在正式编辑中确认后再执行。'),
      )
    const savePalaceEditorWithOptionsApi = vi
      .spyOn(palaceApi, 'savePalaceEditorWithOptionsApi')
      .mockResolvedValue({
        palace: {
          id: 101,
          title: '测试宫殿',
          description: '',
          created_at: null,
          attachments: [],
          chapters: [],
        },
        ...normalizedSavedState,
      } as never)

    render(
      <MemoryRouter initialEntries={['/palaces/101/edit']}>
        <Routes>
          <Route path="/palaces/:id/edit" element={<PalaceEditPage />} />
        </Routes>
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: '测试宫殿' })).toBeTruthy()
    })
    expect(screen.getByTestId('mindmap-first-child-text').textContent).toBe('旧知识点')

    fireEvent.click(screen.getByRole('button', { name: '覆盖当前脑图' }))

    await waitFor(() => {
      expect(savePalaceEditorApi).toHaveBeenCalledTimes(1)
    })
    await waitFor(() => {
      expect(savePalaceEditorWithOptionsApi).toHaveBeenCalledWith(101, {
        ...importedEditorState,
        confirm_dangerous_change: true,
        editor_source: 'palace_edit',
      })
    })
    await waitFor(() => {
      expect(screen.getByTestId('mindmap-first-child-text').textContent).toBe('新增知识点')
    })
    expect(window.confirm).toHaveBeenCalledTimes(1)
  })
})
