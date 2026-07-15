import * as React from 'react'
import { StrictMode } from 'react'
import {
  fireEvent as testingLibraryFireEvent,
  render as testingLibraryRender,
  screen as testingLibraryScreen,
  waitFor as testingLibraryWaitFor,
} from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { vi } from 'vitest'
import PalaceEditPage from '@/pages/create/PalaceEditorPage'
import * as appLogs from '@/shared/logs/model/appLogs'
import * as knowledgeApi from '@/entities/knowledge/api'
import * as importApi from '@/entities/knowledge-import/api'
import * as palaceApi from '@/entities/palace/api'

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}))

const mindMapFrameMockState = vi.hoisted(() => ({
  nextMountId: 1,
}))

export const promptForAiOptionsMock = vi.fn()

export const timedSessionMock = {
  sessionId: 'timed-session-1',
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
  setSceneActive: vi.fn(),
  leaveScene: vi.fn(),
  adjustDuration: vi.fn(),
  registerActivity: vi.fn(),
  logEvent: vi.fn(),
  complete: vi.fn(),
  reset: vi.fn(),
}

export const shouldAutoStartOnPageEnterMock = vi.fn<(config: unknown, scene: unknown) => boolean>(() => false)

vi.mock('@/shared/hooks/useTimedSession', () => ({
  useTimedSession: () => timedSessionMock,
  shouldAutoStartOnPageEnter: (config: unknown, scene: unknown) =>
    shouldAutoStartOnPageEnterMock(config, scene),
}))

vi.mock('@/entities/ai-runtime', () => ({
  useAiRunConfigDialog: () => ({
    promptForAiOptions: (...args: unknown[]) => promptForAiOptionsMock(...args),
    aiRunConfigDialog: null,
  }),
}))

vi.mock('@/widgets/quiz-launcher', () => ({
  useQuizLauncher: () => ({
    openQuizLauncher: vi.fn(),
  }),
}))

vi.mock('@/features/mindmap-editor', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/mindmap-editor')>()),
  MindMapEditorSurface: React.forwardRef(({
    syncIntent = 'soft',
    forceSyncKey = null,
    forceSyncIntent = 'replace',
    syncReason = null,
    onFullscreenToggle,
    toolbarContent,
    practiceModeActive = false,
    readonly = false,
    preserveViewOnSync = false,
    initialViewPolicy = 'preserve',
    mobileViewPolicy = 'map',
    nodeClickViewportPolicy = 'guided-center',
    aiSplitBusy = false,
    syncOnPropChange = false,
    externalSyncKey = null,
    viewMemoryScope = null,
    focusRequestNodeUid = null,
    focusRequestNonce = 0,
    onAiSplitRequest,
    onNodeActive,
    onNodeClick,
    onNodeContextMenu,
    editorState,
  }: {
    syncIntent?: 'soft' | 'replace'
    forceSyncKey?: string | number | null
    forceSyncIntent?: 'soft' | 'replace'
    syncReason?: string | null
    practiceModeActive?: boolean
    readonly?: boolean
    preserveViewOnSync?: boolean
    initialViewPolicy?: 'preserve' | 'reset'
    mobileViewPolicy?: 'map' | 'guided' | 'auto'
    nodeClickViewportPolicy?: 'preserve' | 'guided-center'
    aiSplitBusy?: boolean
    syncOnPropChange?: boolean
    externalSyncKey?: string | number | null
    viewMemoryScope?: string | null
    focusRequestNodeUid?: string | null
    focusRequestNonce?: number
    onFullscreenToggle?: (active?: boolean) => void
    toolbarContent?: React.ReactNode
    editorState?: {
      editor_doc?: {
        root?: {
          data?: { text?: string; uid?: string }
          children?: Array<{
            data?: { text?: string; uid?: string }
            children?: Array<{
              data?: { text?: string; uid?: string }
              children?: Array<unknown>
            }>
          }>
        }
      }
    }
    onAiSplitRequest?: (payload: {
      target_node_uid: string | null
      target_node_text: string
      target_node_note: string
      target_node_type: string | null
      is_root: boolean
      split_mode: 'parallel' | 'hierarchy'
    }) => void
    onNodeActive?: (nodes: Array<{ uid: string | null; text: string }>) => void
    onNodeClick?: (nodes: Array<{ uid: string | null; text: string }>) => void
    onNodeContextMenu?: (nodes: Array<{ uid: string | null; text: string }>) => void
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
    const mountIdRef = React.useRef<number | null>(null)
    if (mountIdRef.current == null) {
      mountIdRef.current = mindMapFrameMockState.nextMountId++
    }
    const root = editorState?.editor_doc?.root
    const child = root?.children?.[0]
    const grandchild = child?.children?.[0]
    const shellMode = practiceModeActive ? 'toolbar' : 'plain'
    const viewPolicy = preserveViewOnSync ? 'preserve' : initialViewPolicy
    return (
      <div data-testid="mindmap-frame">
        {toolbarContent}
        <div>{`mindmap-${practiceModeActive ? 'practice' : 'edit'}-${readonly ? 'readonly' : 'editable'}-${shellMode}-${viewPolicy}-import-${syncOnPropChange ? 'sync' : 'nosync'}`}</div>
        <div>{`mindmap-mount-${mountIdRef.current}`}</div>
        <div>{`sync-${syncIntent}-${forceSyncIntent}-${String(forceSyncKey ?? '')}-${String(externalSyncKey ?? '')}-${String(syncReason ?? '')}`}</div>
        <div>{`flip-policies-${mobileViewPolicy}-${nodeClickViewportPolicy}`}</div>
        <div>{`scope-${String(viewMemoryScope ?? '')}`}</div>
        <div>{`focus-${String(focusRequestNodeUid ?? '')}:${String(focusRequestNonce)}`}</div>
        <div>{`aisplit-${aiSplitBusy ? 'busy' : 'idle'}`}</div>
        <div>{`root-${String(root?.data?.text ?? '')}`}</div>
        <div>{`child-${String(child?.data?.text ?? '')}`}</div>
        <div>{`grandchild-${String(grandchild?.data?.text ?? '')}`}</div>
        {onFullscreenToggle ? (
          <button type="button" onClick={() => onFullscreenToggle()}>
            切换半屏
          </button>
        ) : null}
        {onNodeClick && root?.data?.uid ? (
          <button
            type="button"
            onClick={() =>
              onNodeClick([{ uid: root.data?.uid ?? null, text: String(root.data?.text ?? '') }])
            }
          >
            点击根节点
          </button>
        ) : null}
        {onNodeClick && child?.data?.uid ? (
          <button
            type="button"
            onClick={() =>
              onNodeClick([{ uid: child.data?.uid ?? null, text: String(child.data?.text ?? '') }])
            }
          >
            点击首子节点
          </button>
        ) : null}
        {onNodeClick && grandchild?.data?.uid ? (
          <button
            type="button"
            onClick={() =>
              onNodeClick([
                { uid: grandchild.data?.uid ?? null, text: String(grandchild.data?.text ?? '') },
              ])
            }
          >
            点击首孙节点
          </button>
        ) : null}
        {onNodeActive && root?.data?.uid ? (
          <button
            type="button"
            onClick={() =>
              onNodeActive([{ uid: root.data?.uid ?? null, text: String(root.data?.text ?? '') }])
            }
          >
            选中根节点
          </button>
        ) : null}
        {onNodeActive && child?.data?.uid ? (
          <button
            type="button"
            onClick={() =>
              onNodeActive([{ uid: child.data?.uid ?? null, text: String(child.data?.text ?? '') }])
            }
          >
            选中首子节点
          </button>
        ) : null}
        {onNodeContextMenu && child?.data?.uid ? (
          <button
            type="button"
            onClick={() =>
              onNodeContextMenu([{ uid: child.data?.uid ?? null, text: String(child.data?.text ?? '') }])
            }
          >
            右键首子节点
          </button>
        ) : null}
        {onAiSplitRequest ? (
          <button
            type="button"
            onClick={() =>
              onAiSplitRequest({
                target_node_uid: 'node-1',
                target_node_text: '原节点',
                target_node_note: '原备注',
                target_node_type: 'peg',
                is_root: false,
                split_mode: 'parallel',
              })
            }
          >
            AI分卡
          </button>
        ) : null}
      </div>
    )
  }),
  MindMapPageToolbar: ({
    taskControl,
    segmentControl,
    modeControl,
    modeToggle,
    moreActions,
    importMindMapAction,
    importTextAction,
    englishAction,
    immersiveAction,
    nativeFullscreenAction,
    clearUiAction,
  }: Record<string, any>) => (
    <div data-testid="mindmap-toolbar">
      {taskControl ? (
        <>
          <button type="button" onClick={() => taskControl.onChange('build')}>
            构建
          </button>
          <button type="button" onClick={() => taskControl.onChange('learn')}>
            学习
          </button>
        </>
      ) : null}
      {segmentControl ? (
        <>
          <button type="button" onClick={segmentControl.onToggle}>
            学习组
          </button>
          {segmentControl.active ? (
            <>
              <select
                aria-label="学习组目标"
                value={segmentControl.targetSegmentId == null ? 'new' : String(segmentControl.targetSegmentId)}
                onChange={(event) =>
                  segmentControl.onTargetChange(
                    event.currentTarget.value === 'new' ? 'new' : Number(event.currentTarget.value),
                  )
                }
              >
                <option value="new">新建学习组</option>
                {(segmentControl.options ?? []).map((option: { id: number; name: string }) => (
                  <option key={option.id} value={String(option.id)}>
                    {option.name}
                  </option>
                ))}
              </select>
              <button type="button" onClick={segmentControl.onConfirm}>
                确认
              </button>
              <button type="button" onClick={segmentControl.onCancel}>
                取消
              </button>
            </>
          ) : null}
        </>
      ) : null}
      {modeControl ? (
        <>
          <button type="button" onClick={() => modeControl.onChange('edit')}>
            编辑模式
          </button>
          <button type="button" onClick={() => modeControl.onChange('preview')}>
            预览模式
          </button>
          <button type="button" onClick={() => modeControl.onChange('recall')}>
            回忆模式
          </button>
        </>
      ) : null}
      {modeToggle ? <button type="button" onClick={modeToggle.onClick}>{modeToggle.label}</button> : null}
      {(moreActions ?? []).map((action: { label: string; onClick: () => void; disabled?: boolean }) => (
        <button key={action.label} type="button" disabled={action.disabled} onClick={action.onClick}>{action.label}</button>
      ))}
      {importMindMapAction ? <button type="button" onClick={importMindMapAction.onClick}>{importMindMapAction.label}</button> : null}
      {importTextAction ? <button type="button" onClick={importTextAction.onClick}>{importTextAction.label}</button> : null}
      {englishAction ? <button type="button" onClick={englishAction.onClick}>{englishAction.label}</button> : null}
      {immersiveAction ? <button type="button" onClick={immersiveAction.onClick}>{immersiveAction.label}</button> : null}
      {nativeFullscreenAction ? <button type="button" onClick={nativeFullscreenAction.onClick}>{nativeFullscreenAction.label}</button> : null}
      {clearUiAction ? <button type="button" onClick={clearUiAction.onClick}>{clearUiAction.label}</button> : null}
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
  PalaceMetaPanel: ({
    onSave,
    onEstablishCreatedAt,
  }: {
    onSave?: () => void
    onEstablishCreatedAt?: () => void
  }) => (
    <div>
      <div>meta</div>
      <button type="button" onClick={onSave}>
        保存元信息
      </button>
      <button type="button" onClick={onEstablishCreatedAt}>
        建立创建时间
      </button>
    </div>
  ),
}))

vi.mock('@/features/palace-edit/components/PalaceSegmentsPanel', () => ({
  PalaceSegmentsPanel: ({ selectedNodeCount, segmentDialogOpen, segmentName, setSegmentName, onSave }: {
    selectedNodeCount: number
    segmentDialogOpen: boolean
    segmentName: string
    setSegmentName: (value: string) => void
    onSave: () => void
  }) => (
    <div>
      <div>{`selected-segment-nodes-${selectedNodeCount}`}</div>
      {segmentDialogOpen ? (
        <>
          <input placeholder="例如：第二学习组" value={segmentName} onChange={(event) => setSegmentName(event.target.value)} />
          <button type="button" onClick={onSave}>保存学习组</button>
        </>
      ) : null}
    </div>
  ),
}))

vi.mock('./PalaceVersionDialog', () => ({
  PalaceVersionDialog: ({
    open,
    onRestoreVersion,
  }: {
    open: boolean
    onRestoreVersion?: (versionId: number) => void
  }) =>
    open ? (
      <div>
        <button type="button" onClick={() => onRestoreVersion?.(1)}>
          恢复版本1
        </button>
      </div>
    ) : null,
}))

vi.mock('@/features/mindmap-import', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/mindmap-import')>()
  return {
    ...actual,
    MindMapImportDrawer: ({
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
  }
})

vi.mock('@/shared/components/session/SessionTimerBar', () => ({
  SessionTimerBar: () => <div>timer</div>,
}))

export function getMindMapTexts() {
  return {
    root: testingLibraryScreen.getByText(/^root-/).textContent,
    child: testingLibraryScreen.getByText(/^child-/).textContent,
    grandchild: testingLibraryScreen.getByText(/^grandchild-/).textContent,
  }
}

export function renderPalaceEditPage(initialEntry = '/palaces/101/edit') {
  return testingLibraryRender(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/palaces/new" element={<PalaceEditPage />} />
        <Route path="/palaces/:id/edit" element={<PalaceEditPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

export function renderPalaceEditPageStrict() {
  return testingLibraryRender(
    <StrictMode>
      <MemoryRouter initialEntries={['/palaces/new']}>
        <Routes>
          <Route path="/palaces/new" element={<PalaceEditPage />} />
          <Route path="/palaces/:id/edit" element={<PalaceEditPage />} />
        </Routes>
      </MemoryRouter>
    </StrictMode>,
  )
}

export function setupPalaceEditPageTestDefaults() {
  vi.restoreAllMocks()
  window.localStorage.clear()
  mindMapFrameMockState.nextMountId = 1
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  timedSessionMock.status = 'idle'
  timedSessionMock.startedAt = null
  timedSessionMock.start.mockReset()
  timedSessionMock.pause.mockReset()
  timedSessionMock.resume.mockReset()
  timedSessionMock.setSceneActive.mockReset()
  timedSessionMock.adjustDuration.mockReset()
  timedSessionMock.registerActivity.mockReset()
  timedSessionMock.logEvent.mockReset()
  timedSessionMock.complete.mockReset()
  timedSessionMock.reset.mockReset()
  promptForAiOptionsMock.mockReset()
  promptForAiOptionsMock.mockResolvedValue({})
  shouldAutoStartOnPageEnterMock.mockReset()
  shouldAutoStartOnPageEnterMock.mockReturnValue(false)
  vi.spyOn(knowledgeApi, 'getSubjectsApi').mockResolvedValue([{ id: 1, name: '测试学科', color: '#6366f1', sort_order: 0 }])
  vi.spyOn(knowledgeApi, 'getSubjectTreeApi').mockResolvedValue({ chapters: [], subject: null } as never)
  vi.spyOn(palaceApi, 'getPracticeSessionProgressApi').mockResolvedValue({ progress: null } as never)
  vi.spyOn(palaceApi, 'savePracticeSessionProgressApi').mockResolvedValue({ progress: {} } as never)
  vi.spyOn(palaceApi, 'clearPracticeSessionProgressApi').mockResolvedValue({ ok: true } as never)
  vi.spyOn(importApi, 'previewMindMapImportApi').mockResolvedValue({
    ok: true,
    source_tree: {
      title: '导入脑图',
      children: [{ text: '新增知识点', children: [] }],
    },
    editor_doc: {
      root: {
        data: { text: '导入脑图', uid: 'import-root' },
        children: [{ data: { text: '新增知识点', uid: 'import-child-1' }, children: [] }],
      },
    },
  } as never)
  vi.spyOn(palaceApi, 'updatePalaceApi').mockResolvedValue({ ok: true } as never)
  vi.spyOn(palaceApi, 'getPalaceVersionsApi').mockResolvedValue({
    versions: [{ id: 1, created_at: '2026-05-29T10:00:00', snapshot_count: 1 }],
    removed_duplicates: 0,
  } as never)
  vi.spyOn(palaceApi, 'restorePalaceVersionApi').mockResolvedValue({ ok: true } as never)
  vi.spyOn(palaceApi, 'splitMindMapNodeApi').mockImplementation(async (_palaceId, request) => ({
    ok: true,
    editor_doc: {
      root: {
        data: { text: '测试宫殿', uid: 'root-1' },
        children: [{ data: { text: 'AI分类', uid: 'split-1' }, children: [] }],
      },
    },
    generated_children_count: 1,
    replacement_node_count: 1,
    reassigned_existing_children_count: 0,
    split_mode: request.split_mode,
    owner_id: request.owner_id,
    operation_id: request.operation_id,
    model: 'qwen3.6-flash',
  } as never))
  vi.spyOn(appLogs, 'logAiCall').mockImplementation(() => ({
    id: 'log-1',
    kind: 'ai_call',
    createdAt: new Date().toISOString(),
    feature: 'AI 整理',
    route: '',
    stage: 'start',
    requestSummary: '',
    responseSummary: '',
    errorMessage: '',
    jobId: '',
    requestId: '',
    meta: {},
  }))
}

export function mockPalaceEditorResponse(editorDoc?: Record<string, unknown>) {
  vi.spyOn(palaceApi, 'getPalaceEditorApi').mockResolvedValue({
    palace: {
      id: 101,
      title: '测试宫殿',
      description: '',
      created_at: null,
      attachments: [],
      chapters: [],
    },
    editor_doc:
      editorDoc ?? { root: { data: { text: '测试宫殿', uid: 'root-1' }, children: [] } },
    editor_config: {},
    editor_local_config: {},
    lang: 'zh',
  } as never)
}

export const fireEvent = testingLibraryFireEvent
export const screen = testingLibraryScreen
export const waitFor = testingLibraryWaitFor
