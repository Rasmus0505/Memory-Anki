import * as React from 'react'
import { StrictMode } from 'react'
import {
  fireEvent as testingLibraryFireEvent,
  render as testingLibraryRender,
  screen as testingLibraryScreen,
  waitFor as testingLibraryWaitFor,
} from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, vi } from 'vitest'
import * as bilinkApi from '@/features/bilink/api/bilink'
import PalaceEditPage from '@/features/palace-edit/PalaceEditPage'
import * as appLogs from '@/shared/logs/model/appLogs'
import * as knowledgeApi from '@/shared/api/modules/knowledge'
import * as palaceApi from '@/shared/api/modules/palaces'

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

const mindMapFrameMockState = vi.hoisted(() => ({
  nextMountId: 1,
}))

export const timedSessionMock = {
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
}

export const shouldAutoStartOnPageEnterMock = vi.fn((_config?: unknown) => false)

vi.mock('@/shared/hooks/useTimedSession', () => ({
  useTimedSession: () => timedSessionMock,
  shouldAutoStartOnPageEnter: (config: unknown) => shouldAutoStartOnPageEnterMock(config),
}))

vi.mock('@/shared/components/mindmap-host', () => ({
  MindMapFrame: ({
    syncIntent = 'soft',
    forceSyncKey = null,
    forceSyncIntent = 'replace',
    syncReason = null,
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
    aiSplitBusy = false,
    syncOnPropChange = false,
    externalSyncKey = null,
    viewMemoryScope = null,
    onAiSplitRequest,
    onNodeClick,
    onNodeContextMenu,
    editorState,
  }: {
    syncIntent?: 'soft' | 'replace'
    forceSyncKey?: string | number | null
    forceSyncIntent?: 'soft' | 'replace'
    syncReason?: string | null
    onPracticeToggle?: () => void
    onMindMapImportOpen?: () => void
    onImageTextImportOpen?: () => void
    practiceToggleLabel?: '练习' | '编辑' | '复习'
    practiceModeActive?: boolean
    readonly?: boolean
    showToolbarWhenReadonly?: boolean
    preserveViewOnSync?: boolean
    showImportButtons?: boolean
    aiSplitBusy?: boolean
    syncOnPropChange?: boolean
    externalSyncKey?: string | number | null
    viewMemoryScope?: string | null
    onFullscreenToggle?: (active?: boolean) => void
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
    }) => void
    onNodeClick?: (nodes: Array<{ uid: string | null; text: string }>) => void
    onNodeContextMenu?: (nodes: Array<{ uid: string | null; text: string }>) => void
  }) => {
    const mountIdRef = React.useRef<number | null>(null)
    if (mountIdRef.current == null) {
      mountIdRef.current = mindMapFrameMockState.nextMountId++
    }
    const root = editorState?.editor_doc?.root
    const child = root?.children?.[0]
    const grandchild = child?.children?.[0]
    return (
      <div data-testid="mindmap-frame">
        <div>{`mindmap-${practiceModeActive ? 'practice' : 'edit'}-${readonly ? 'readonly' : 'editable'}-${showToolbarWhenReadonly ? 'toolbar' : 'plain'}-${preserveViewOnSync ? 'preserve' : 'reset'}-${showImportButtons ? 'import' : 'noimport'}-${syncOnPropChange ? 'sync' : 'nosync'}`}</div>
        <div>{`mindmap-mount-${mountIdRef.current}`}</div>
        <div>{`sync-${syncIntent}-${forceSyncIntent}-${String(forceSyncKey ?? '')}-${String(externalSyncKey ?? '')}-${String(syncReason ?? '')}`}</div>
        <div>{`scope-${String(viewMemoryScope ?? '')}`}</div>
        <div>{`aisplit-${aiSplitBusy ? 'busy' : 'idle'}`}</div>
        <div>{`root-${String(root?.data?.text ?? '')}`}</div>
        <div>{`child-${String(child?.data?.text ?? '')}`}</div>
        <div>{`grandchild-${String(grandchild?.data?.text ?? '')}`}</div>
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
              })
            }
          >
            AI分卡
          </button>
        ) : null}
      </div>
    )
  },
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
  PalaceSegmentsPanel: () => <div>segments</div>,
}))

vi.mock('@/features/palace-edit/components/PalaceVersionDialog', () => ({
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
  mindMapFrameMockState.nextMountId = 1
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  timedSessionMock.status = 'idle'
  timedSessionMock.startedAt = null
  timedSessionMock.start.mockReset()
  timedSessionMock.pause.mockReset()
  timedSessionMock.resume.mockReset()
  timedSessionMock.adjustDuration.mockReset()
  timedSessionMock.registerActivity.mockReset()
  timedSessionMock.logEvent.mockReset()
  timedSessionMock.complete.mockReset()
  timedSessionMock.reset.mockReset()
  shouldAutoStartOnPageEnterMock.mockReset()
  shouldAutoStartOnPageEnterMock.mockReturnValue(false)
  vi.spyOn(bilinkApi, 'getBilinksApi').mockResolvedValue({ items: [] } as never)
  vi.spyOn(bilinkApi, 'getBilinkCountsApi').mockResolvedValue({ counts: {} } as never)
  vi.spyOn(bilinkApi, 'searchBilinkNodesApi').mockResolvedValue({ items: [] } as never)
  vi.spyOn(bilinkApi, 'getBilinkNodeContextApi').mockResolvedValue({ error: '' } as never)
  vi.spyOn(bilinkApi, 'createBilinkApi').mockResolvedValue({ item: {} } as never)
  vi.spyOn(bilinkApi, 'deleteBilinkApi').mockResolvedValue({ ok: true } as never)
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
  vi.spyOn(palaceApi, 'updatePalaceApi').mockResolvedValue({ ok: true } as never)
  vi.spyOn(palaceApi, 'getPalaceVersionsApi').mockResolvedValue({
    versions: [{ id: 1, created_at: '2026-05-29T10:00:00', snapshot_count: 1 }],
    removed_duplicates: 0,
  } as never)
  vi.spyOn(palaceApi, 'restorePalaceVersionApi').mockResolvedValue({ ok: true } as never)
  vi.spyOn(palaceApi, 'splitMindMapNodeApi').mockResolvedValue({
    ok: true,
    editor_doc: {
      root: {
        data: { text: '测试宫殿', uid: 'root-1' },
        children: [{ data: { text: 'AI分类', uid: 'split-1' }, children: [] }],
      },
    },
    generated_children_count: 1,
    reassigned_existing_children_count: 0,
    model: 'qwen3.6-flash',
  } as never)
  vi.spyOn(appLogs, 'logAiCall').mockImplementation(() => ({
    id: 'log-1',
    kind: 'ai_call',
    createdAt: new Date().toISOString(),
    feature: 'AI 分卡',
    route: '',
    stage: 'start',
    requestSummary: '',
    responseSummary: '',
    errorMessage: '',
    jobId: '',
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
