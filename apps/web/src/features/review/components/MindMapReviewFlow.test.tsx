import * as React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MindMapReviewFlow } from '@/features/review/components/MindMapReviewFlow'
import {
  DEFAULT_REVIEW_FEEDBACK_SETTINGS,
  REVIEW_FEEDBACK_SETTINGS_STORAGE_KEY,
} from '@/features/review/reviewFeedbackSettings'

const appendTimeRecordMock = vi.fn()

vi.mock('@/entities/session/model', async () => {
  const actual = await vi.importActual<typeof import('@/entities/session/model')>(
    '@/entities/session/model',
  )
  return {
    ...actual,
    appendTimeRecord: (...args: unknown[]) => appendTimeRecordMock(...args),
  }
})

const timer = {
  effectiveSeconds: 7,
  idleSeconds: 0,
  pauseCount: 0,
  status: 'running' as const,
  startedAt: Date.now(),
  durationEdited: false,
  glowState: 'running' as const,
  start: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  leaveScene: vi.fn(),
  adjustDuration: vi.fn(),
  registerActivity: vi.fn(),
  logEvent: vi.fn(),
  complete: vi.fn(async () => ({ effectiveSeconds: 7 })),
  reset: vi.fn(),
}

const useTimedSessionMock = vi.fn()
const openQuizLauncherMock = vi.fn()

vi.mock('@/shared/hooks/useTimedSession', () => ({
  useTimedSession: (args: unknown) => useTimedSessionMock(args),
}))

vi.mock('@/features/palace-quiz/QuizLauncherProvider', () => ({
  useQuizLauncher: () => ({
    openQuizLauncher: (...args: unknown[]) => openQuizLauncherMock(...args),
  }),
}))

const mindMapFrameMock = vi.fn()

vi.mock('@/shared/components/mindmap-host', () => ({
  MindMapFrame: React.forwardRef((props: Record<string, unknown>, ref) => {
    React.useImperativeHandle(ref, () => ({
      setUiCleared: vi.fn((next: boolean) => {
        ;(props.onUiClearedChange as ((active: boolean) => void) | undefined)?.(next)
      }),
      toggleUiCleared: vi.fn(() => {
        ;(props.onUiClearedChange as ((active: boolean) => void) | undefined)?.(true)
      }),
      enterNativeFullscreen: vi.fn(async () => {
        ;(props.onFullscreenChange as ((active: boolean) => void) | undefined)?.(true)
      }),
      exitNativeFullscreen: vi.fn(async () => {
        ;(props.onFullscreenChange as ((active: boolean) => void) | undefined)?.(false)
      }),
    }))
    mindMapFrameMock(props)
    const fullscreen = Boolean(props.immersiveModeActive)
    const nextEditorState = {
      ...(props.editorState as Record<string, any>),
      editor_doc: {
        root: {
          data: { text: 'Root', uid: 'root' },
          children: [
            {
              data: { text: 'Child edited', uid: 'child' },
              children: [{ data: { text: 'Grandchild', uid: 'grandchild' }, children: [] }],
            },
          ],
        },
      },
    }
    return (
      <div data-testid="mind-map-frame">
        <div>{`frame-${props.readonly ? 'readonly' : 'editable'}-${fullscreen ? 'immersive' : 'plain'}`}</div>
        <button
          type="button"
          onClick={() => (props.onFullscreenToggle as ((active?: boolean) => void) | undefined)?.()}
        >
          宿主半屏切换
        </button>
        <button
          type="button"
          onClick={() => (props.onFullscreenChange as ((active: boolean) => void) | undefined)?.(false)}
        >
          退出原生全屏
        </button>
        {!props.readonly && (props.onEditorStateChange as ((nextState: unknown) => void) | undefined) ? (
          <button
            type="button"
            onClick={() =>
              (props.onEditorStateChange as ((nextState: unknown) => void) | undefined)?.(
                nextEditorState,
              )
            }
          >
            宿主编辑保存
          </button>
        ) : null}
      </div>
    )
  }),
  MindMapPageToolbar: ({
    modeToggle,
    bilinkSearchAction,
    quizAction,
    miniPalaceAction,
    immersiveAction,
    nativeFullscreenAction,
    clearUiAction,
  }: Record<string, any>) => (
    <div data-testid="mind-map-toolbar">
      {modeToggle ? <button type="button" onClick={modeToggle.onClick}>{modeToggle.label}</button> : null}
      {bilinkSearchAction ? <button type="button" onClick={bilinkSearchAction.onClick}>{bilinkSearchAction.label}</button> : null}
      {quizAction ? <button type="button" onClick={quizAction.onClick}>{quizAction.label}</button> : null}
      {miniPalaceAction ? <button type="button" onClick={miniPalaceAction.onClick}>{miniPalaceAction.label}</button> : null}
      {immersiveAction ? <button type="button" onClick={immersiveAction.onClick}>{immersiveAction.label}</button> : null}
      {nativeFullscreenAction ? <button type="button" onClick={nativeFullscreenAction.onClick}>{nativeFullscreenAction.label}</button> : null}
      {clearUiAction ? <button type="button" onClick={clearUiAction.onClick}>{clearUiAction.label}</button> : null}
    </div>
  ),
}))

const editorState = {
  editor_doc: {
    root: {
      data: { text: 'Root', uid: 'root' },
      children: [
        {
          data: { text: 'Child', uid: 'child' },
          children: [{ data: { text: 'Grandchild', uid: 'grandchild' }, children: [] }],
        },
      ],
    },
  },
  editor_config: {},
  editor_local_config: {},
  lang: 'zh',
}

const editEditorState = {
  ...editorState,
  editor_doc: {
    root: {
      data: { text: 'Root edit', uid: 'root' },
      children: [
        {
          data: { text: 'Child edit', uid: 'child' },
          children: [{ data: { text: 'Grandchild edit', uid: 'grandchild' }, children: [] }],
        },
      ],
    },
  },
}

function getLatestMindMapFrameProps() {
  return mindMapFrameMock.mock.calls.at(-1)?.[0] as Record<string, any> | undefined
}

function getVisibleTextsFromLatestFrame() {
  const latestCall = getLatestMindMapFrameProps()
  const root = latestCall?.editorState?.editor_doc?.root
  const child = root?.children?.[0]
  const grandchild = child?.children?.[0]
  return {
    root: root?.data?.text ?? null,
    child: child?.data?.text ?? null,
    grandchild: grandchild?.data?.text ?? null,
  }
}

function renderInRouter(node: React.ReactNode) {
  return render(<MemoryRouter>{node}</MemoryRouter>)
}

describe('MindMapReviewFlow', () => {
  beforeEach(() => {
    vi.useRealTimers()
    appendTimeRecordMock.mockReset()
    appendTimeRecordMock.mockResolvedValue(null)
    timer.complete.mockClear()
    timer.registerActivity.mockClear()
    timer.logEvent.mockClear()
    timer.reset.mockClear()
    mindMapFrameMock.mockClear()
    useTimedSessionMock.mockClear()
    openQuizLauncherMock.mockClear()
    useTimedSessionMock.mockImplementation(() => timer)
    window.localStorage.clear()
    window.localStorage.setItem(
      REVIEW_FEEDBACK_SETTINGS_STORAGE_KEY,
      JSON.stringify(DEFAULT_REVIEW_FEEDBACK_SETTINGS),
    )
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
      })),
    })
  })

  it('submits only once when completion is clicked rapidly', async () => {
    let resolveComplete: () => void = () => {}
    const onComplete = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveComplete = resolve
        }),
    )

    renderInRouter(
      <MindMapReviewFlow
        title="Root"
        palaceId={1}
        sessionKind="review"
        reviewEditorState={editorState}
        onComplete={onComplete}
      />,
    )

    const completeButton = screen.getByRole('button', { name: /完成/ })
    fireEvent.click(completeButton)
    fireEvent.click(completeButton)

    // Dialog opened - click "已完成" to trigger completion
    const completedButton = screen.getByRole('button', { name: /已完成/ })
    fireEvent.click(completedButton)
    fireEvent.click(completedButton)

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1))
    expect(timer.complete).toHaveBeenCalledTimes(1)

    resolveComplete()
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1))
  })

  it('disables local completion persistence for formal review sessions', () => {
    renderInRouter(
      <MindMapReviewFlow
        title="Root"
        palaceId={1}
        sessionKind="review"
        reviewEditorState={editorState}
        onComplete={vi.fn()}
      />,
    )

    expect(useTimedSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'review',
        persistCompletionRecord: false,
      }),
    )
  })

  it('records time when a formal review session is marked unfinished', async () => {
    renderInRouter(
      <MindMapReviewFlow
        title="Root"
        palaceId={1}
        sessionKind="review"
        reviewEditorState={editorState}
        onComplete={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /完成/ }))
    fireEvent.click(screen.getByRole('button', { name: /未完成/ }))

    await waitFor(() => {
      expect(timer.complete).toHaveBeenCalledWith(
        'saved',
        expect.objectContaining({
          revealed_remaining: false,
          red_marked_count: 0,
        }),
      )
    })
    expect(appendTimeRecordMock).toHaveBeenCalledTimes(1)
    expect(timer.reset).toHaveBeenCalledTimes(1)
  })

  it('uses shared toolbar controls while keeping the host frame readonly in review mode', async () => {
    renderInRouter(
      <MindMapReviewFlow
        title="Root"
        palaceId={1}
        sessionKind="review"
        reviewEditorState={editorState}
        onComplete={vi.fn()}
      />,
    )

    expect(screen.queryByRole('button', { name: '全屏导图' })).toBeNull()
    expect(screen.getByText('frame-readonly-plain')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '编辑' })).toBeNull()
    expect(screen.getByRole('button', { name: '搜索' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '做题' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '做题' }))
    expect(openQuizLauncherMock).toHaveBeenCalledWith(
      expect.objectContaining({
        palaceId: 1,
        scene: 'review',
      }),
    )

    fireEvent.click(screen.getByRole('button', { name: '宿主半屏切换' }))
    await waitFor(() => {
      expect(screen.getByText('frame-readonly-immersive')).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: '退出原生全屏' }))
    await waitFor(() => {
      expect(screen.getByText('frame-readonly-immersive')).toBeTruthy()
    })

    const latestCall = getLatestMindMapFrameProps()
    expect(latestCall?.readonly).toBe(true)
    expect(latestCall?.syncIntent).toBe('replace')
    expect(latestCall?.syncReason).toBe('review_flip')
    expect(latestCall?.preserveViewOnSync).toBe(true)
  })

  it('switches review flow into inline edit mode with a return-to-review label and hides completion', async () => {
    function Harness() {
      const [displayMode, setDisplayMode] = React.useState<'review' | 'edit'>('review')
      const [modeSyncVersion, setModeSyncVersion] = React.useState(0)
      const [nextEditorState, setNextEditorState] = React.useState(editorState)
      return (
        <MindMapReviewFlow
          title="Root"
          palaceId={1}
          sessionKind="review"
          displayMode={displayMode}
          modeSyncVersion={modeSyncVersion}
          viewMemoryScope={`review-session:1:${displayMode}`}
          reviewEditorState={nextEditorState}
          editEditorState={editEditorState}
          onModeToggle={() => {
            setDisplayMode((current) => (current === 'review' ? 'edit' : 'review'))
            setModeSyncVersion((current) => current + 1)
          }}
          onEditEditorStateChange={(nextState) =>
            setNextEditorState(nextState as typeof editorState)
          }
          onComplete={vi.fn()}
        />
      )
    }

    renderInRouter(<Harness />)

    expect(screen.getByText('frame-readonly-plain')).toBeTruthy()
    expect(screen.getByRole('button', { name: /完成/ })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '编辑' }))

    await waitFor(() => {
      expect(screen.getByText('frame-editable-plain')).toBeTruthy()
      expect(screen.getByRole('button', { name: '复习' })).toBeTruthy()
    })
    expect(screen.queryByRole('button', { name: /完成/ })).toBeNull()
    expect(timer.logEvent).toHaveBeenCalledWith('enter_edit_mode', {
      source: 'review_inline_edit',
    })
    expect(timer.registerActivity).toHaveBeenCalledWith('edit_operation', {
      source: 'review_inline_edit_enter',
    })

    fireEvent.click(screen.getByRole('button', { name: '复习' }))

    await waitFor(() => {
      expect(screen.getByText('frame-readonly-plain')).toBeTruthy()
      expect(screen.getByRole('button', { name: '编辑' })).toBeTruthy()
    })
    expect(screen.getByRole('button', { name: /完成/ })).toBeTruthy()
    expect(timer.logEvent).toHaveBeenCalledWith('exit_edit_mode', {
      source: 'review_inline_edit',
    })
    expect(timer.registerActivity).toHaveBeenCalledWith('practice_interaction', {
      source: 'review_inline_edit_exit',
    })
  })

  it('keeps reveal progress by node uid after editing and switching back to review mode', async () => {
    function Harness() {
      const [displayMode, setDisplayMode] = React.useState<'review' | 'edit'>('review')
      const [modeSyncVersion, setModeSyncVersion] = React.useState(0)
      const [nextEditorState, setNextEditorState] = React.useState(editorState)
      return (
        <MindMapReviewFlow
          title="Root"
          palaceId={1}
          sessionKind="review"
          displayMode={displayMode}
          modeSyncVersion={modeSyncVersion}
          viewMemoryScope={`review-session:1:${displayMode}`}
          reviewEditorState={nextEditorState}
          editEditorState={nextEditorState}
          onModeToggle={() => {
            setDisplayMode((current) => (current === 'review' ? 'edit' : 'review'))
            setModeSyncVersion((current) => current + 1)
          }}
          onEditEditorStateChange={(nextState) =>
            setNextEditorState(nextState as typeof editorState)
          }
          onComplete={vi.fn()}
        />
      )
    }

    renderInRouter(<Harness />)

    await act(async () => {
      getLatestMindMapFrameProps()?.onNodeClick?.([{ uid: 'root', text: 'Root' }])
    })
    await act(async () => {
      getLatestMindMapFrameProps()?.onNodeClick?.([{ uid: 'child', text: 'Child' }])
    })

    expect(getVisibleTextsFromLatestFrame()).toEqual({
      root: 'Root',
      child: 'Child',
      grandchild: null,
    })

    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    await waitFor(() => {
      expect(screen.getByText('frame-editable-plain')).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: '宿主编辑保存' }))
    await waitFor(() => {
      expect(timer.registerActivity).toHaveBeenCalledWith('edit_operation', {
        source: 'review_inline_edit',
      })
    })

    fireEvent.click(screen.getByRole('button', { name: '复习' }))

    await waitFor(() => {
      expect(getVisibleTextsFromLatestFrame()).toEqual({
        root: 'Root',
        child: 'Child edited',
        grandchild: null,
      })
    })
  })

  it('reveals placeholder and next hidden child through readonly left-click flow', async () => {
    renderInRouter(
      <MindMapReviewFlow
        title="Root"
        palaceId={1}
        sessionKind="practice"
        reviewEditorState={editorState}
        onComplete={vi.fn()}
      />,
    )

    expect(getVisibleTextsFromLatestFrame()).toEqual({
      root: 'Root',
      child: null,
      grandchild: null,
    })

    await act(async () => {
      getLatestMindMapFrameProps()?.onNodeClick?.([{ uid: 'root', text: 'Root' }])
    })
    expect(getLatestMindMapFrameProps()?.reviewFxSignal).toEqual(
      expect.objectContaining({
        type: 'category_expand',
        nodeUid: 'child',
        lineMode: 'spawn',
      }),
    )
    expect(getVisibleTextsFromLatestFrame()).toEqual({
      root: 'Root',
      child: '待回忆',
      grandchild: null,
    })
    expect(screen.getByText('连击 0')).toBeTruthy()

    await act(async () => {
      getLatestMindMapFrameProps()?.onNodeClick?.([{ uid: 'child', text: 'Child' }])
    })
    expect(getLatestMindMapFrameProps()?.reviewFxSignal).toEqual(
      expect.objectContaining({
        type: 'card_reveal',
        nodeUid: 'child',
        lineMode: 'confirm',
      }),
    )
    expect(getVisibleTextsFromLatestFrame()).toEqual({
      root: 'Root',
      child: 'Child',
      grandchild: null,
    })
    expect(screen.getByText('连击 1')).toBeTruthy()

    await act(async () => {
      getLatestMindMapFrameProps()?.onNodeClick?.([{ uid: 'child', text: 'Child' }])
    })
    expect(getLatestMindMapFrameProps()?.reviewFxSignal).toEqual(
      expect.objectContaining({
        type: 'next_level_expand',
        nodeUid: 'child',
        lineMode: 'spawn',
      }),
    )
    expect(getVisibleTextsFromLatestFrame()).toEqual({
      root: 'Root',
      child: 'Child',
      grandchild: '待回忆',
    })

    expect(timer.registerActivity).toHaveBeenCalledWith('practice_interaction', { source: 'left_click' })
  })

  it('keeps readonly left-click flip flow working after host fullscreen toggles', async () => {
    renderInRouter(
      <MindMapReviewFlow
        title="Root"
        palaceId={1}
        sessionKind="practice"
        reviewEditorState={editorState}
        onComplete={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '宿主半屏切换' }))
    await waitFor(() => {
      expect(screen.getByText('frame-readonly-immersive')).toBeTruthy()
    })

    await act(async () => {
      getLatestMindMapFrameProps()?.onNodeClick?.([{ uid: 'root', text: 'Root' }])
    })
    await act(async () => {
      getLatestMindMapFrameProps()?.onNodeClick?.([{ uid: 'child', text: 'Child' }])
    })

    await waitFor(() => {
      expect(getVisibleTextsFromLatestFrame()).toEqual({
        root: 'Root',
        child: 'Child',
        grandchild: null,
      })
    })

    fireEvent.click(screen.getByRole('button', { name: '宿主半屏切换' }))
    await waitFor(() => {
      expect(screen.getByText('frame-readonly-plain')).toBeTruthy()
    })

    await act(async () => {
      getLatestMindMapFrameProps()?.onNodeClick?.([{ uid: 'child', text: 'Child' }])
    })

    await waitFor(() => {
      expect(getVisibleTextsFromLatestFrame()).toEqual({
        root: 'Root',
        child: 'Child',
        grandchild: '待回忆',
      })
    })
  })

  it('runs dedicated mini-checkpoint mode through the shared flow and requires hover before space pour', async () => {
    const miniEditorState = {
      editor_doc: {
        root: {
          data: { text: 'Root', uid: 'root' },
          children: [
            {
              data: { text: 'Child', uid: 'child' },
              children: [{ data: { text: 'Grandchild', uid: 'grandchild' }, children: [] }],
            },
          ],
        },
      },
      editor_config: {},
      editor_local_config: {},
      lang: 'zh',
    }

    renderInRouter(
      <MindMapReviewFlow
        title="Root"
        palaceId={1}
        sessionKind="practice"
        revealMode="mini-checkpoint"
        checkpointNodeUids={['child']}
        reviewEditorState={miniEditorState}
        onComplete={vi.fn()}
      />,
    )

    expect(getLatestMindMapFrameProps()?.miniPalacePracticeActive).toBe(true)
    expect(getVisibleTextsFromLatestFrame()).toEqual({
      root: 'Root',
      child: '待回忆',
      grandchild: null,
    })

    await act(async () => {
      getLatestMindMapFrameProps()?.onMiniPalacePour?.()
    })

    expect(getVisibleTextsFromLatestFrame()).toEqual({
      root: 'Root',
      child: '待回忆',
      grandchild: null,
    })

    await act(async () => {
      getLatestMindMapFrameProps()?.onNodeClick?.([{ uid: 'child', text: 'Child' }])
    })
    expect(getVisibleTextsFromLatestFrame()).toEqual({
      root: 'Root',
      child: 'Child',
      grandchild: null,
    })

    await act(async () => {
      getLatestMindMapFrameProps()?.onNodeHover?.([{ uid: 'child', text: 'Child' }])
      getLatestMindMapFrameProps()?.onMiniPalacePour?.()
    })

    expect(getLatestMindMapFrameProps()?.reviewFxSignal).toEqual(
      expect.objectContaining({
        type: 'card_reveal',
        relatedNodeUids: ['grandchild'],
      }),
    )
    expect(getVisibleTextsFromLatestFrame()).toEqual({
      root: 'Root',
      child: 'Child',
      grandchild: 'Grandchild',
    })
  })

  it('keeps readonly right-click branch handling wired through the frame', async () => {
    renderInRouter(
      <MindMapReviewFlow
        title="Root"
        palaceId={1}
        sessionKind="practice"
        reviewEditorState={editorState}
        onComplete={vi.fn()}
      />,
    )

    await act(async () => {
      getLatestMindMapFrameProps()?.onNodeClick?.([{ uid: 'root', text: 'Root' }])
    })
    await act(async () => {
      getLatestMindMapFrameProps()?.onNodeClick?.([{ uid: 'child', text: 'Child' }])
    })
    await act(async () => {
      getLatestMindMapFrameProps()?.onNodeClick?.([{ uid: 'child', text: 'Child' }])
    })

    await waitFor(() => {
      expect(getVisibleTextsFromLatestFrame()).toEqual({
        root: 'Root',
        child: 'Child',
        grandchild: '待回忆',
      })
    })

    await act(async () => {
      getLatestMindMapFrameProps()?.onNodeContextMenu?.([{ uid: 'child', text: 'Child' }])
    })

    await waitFor(() => {
      expect(getVisibleTextsFromLatestFrame()).toEqual({
        root: 'Root',
        child: 'Child',
        grandchild: null,
      })
    })

    expect(timer.registerActivity).toHaveBeenCalledWith('practice_interaction', { source: 'right_click' })
  })

  it('saves feedback volume from the feedback settings dialog', async () => {
    renderInRouter(
      <MindMapReviewFlow
        title="Root"
        palaceId={1}
        sessionKind="practice"
        reviewEditorState={editorState}
        onComplete={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '反馈设置' }))

    const volumeInput = screen.getByLabelText('音量') as HTMLInputElement
    expect(volumeInput.value).toBe('1.5')
    expect(screen.getByText('150%')).toBeTruthy()

    fireEvent.change(volumeInput, { target: { value: '1.8' } })

    await waitFor(() => {
      const saved = JSON.parse(
        window.localStorage.getItem(REVIEW_FEEDBACK_SETTINGS_STORAGE_KEY) || '{}',
      ) as Record<string, unknown>
      expect(saved.volume).toBe(1.8)
    })
    expect(screen.getByText('180%')).toBeTruthy()
  })

  it('lets root right-click hide revealed descendants while keeping the root visible', async () => {
    renderInRouter(
      <MindMapReviewFlow
        title="Root"
        palaceId={1}
        sessionKind="practice"
        reviewEditorState={editorState}
        onComplete={vi.fn()}
      />,
    )

    await act(async () => {
      getLatestMindMapFrameProps()?.onNodeClick?.([{ uid: 'root', text: 'Root' }])
    })
    await act(async () => {
      getLatestMindMapFrameProps()?.onNodeClick?.([{ uid: 'child', text: 'Child' }])
    })
    await act(async () => {
      getLatestMindMapFrameProps()?.onNodeClick?.([{ uid: 'child', text: 'Child' }])
    })

    await waitFor(() => {
      expect(getVisibleTextsFromLatestFrame()).toEqual({
        root: 'Root',
        child: 'Child',
        grandchild: '待回忆',
      })
    })

    await act(async () => {
      getLatestMindMapFrameProps()?.onNodeContextMenu?.([{ uid: 'root', text: 'Root' }])
    })

    await waitFor(() => {
      expect(getVisibleTextsFromLatestFrame()).toEqual({
        root: 'Root',
        child: null,
        grandchild: null,
      })
    })
  })

  it('highlights completion readiness when all non-root nodes are revealed', async () => {
    renderInRouter(
      <MindMapReviewFlow
        title="Root"
        palaceId={1}
        sessionKind="practice"
        reviewEditorState={editorState}
        onComplete={vi.fn()}
      />,
    )

    await act(async () => {
      getLatestMindMapFrameProps()?.onNodeClick?.([{ uid: 'root', text: 'Root' }])
    })
    await act(async () => {
      getLatestMindMapFrameProps()?.onNodeClick?.([{ uid: 'child', text: 'Child' }])
    })
    await act(async () => {
      getLatestMindMapFrameProps()?.onNodeClick?.([{ uid: 'child', text: 'Child' }])
    })
    await act(async () => {
      getLatestMindMapFrameProps()?.onNodeClick?.([{ uid: 'grandchild', text: 'Grandchild' }])
    })

    expect(screen.getByText('可结算')).toBeTruthy()
    expect(screen.getByRole('button', { name: '完成结算' })).toBeTruthy()
  })

  it('shows a short completion ceremony before invoking onComplete', async () => {
    vi.useFakeTimers()
    const onComplete = vi.fn().mockResolvedValue(undefined)

    renderInRouter(
      <MindMapReviewFlow
        title="Root"
        palaceId={1}
        sessionKind="practice"
        reviewEditorState={editorState}
        onComplete={onComplete}
      />,
    )

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /完成/ }))
    })

    // Dialog opened - click "已完成"
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /已完成/ }))
    })

    expect(screen.getByText('通关结算中')).toBeTruthy()
    expect(onComplete).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(850)
    })

    expect(onComplete).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('dismisses the combo milestone burst on time even if the parent rerenders repeatedly', async () => {
    vi.useFakeTimers()
    const comboEditorState = {
      editor_doc: {
        root: {
          data: { text: 'Root', uid: 'root' },
          children: [
            { data: { text: 'Child A', uid: 'child-a' }, children: [] },
            { data: { text: 'Child B', uid: 'child-b' }, children: [] },
            { data: { text: 'Child C', uid: 'child-c' }, children: [] },
          ],
        },
      },
      editor_config: {},
      editor_local_config: {},
      lang: 'zh',
    }

    renderInRouter(
      <MindMapReviewFlow
        title="Root"
        palaceId={1}
        sessionKind="practice"
        reviewEditorState={comboEditorState}
        onComplete={vi.fn()}
      />,
    )

    await act(async () => {
      getLatestMindMapFrameProps()?.onNodeClick?.([{ uid: 'root', text: 'Root' }])
    })
    await act(async () => {
      getLatestMindMapFrameProps()?.onNodeClick?.([{ uid: 'child-a', text: 'Child A' }])
    })
    await act(async () => {
      getLatestMindMapFrameProps()?.onNodeClick?.([{ uid: 'root', text: 'Root' }])
    })
    await act(async () => {
      getLatestMindMapFrameProps()?.onNodeClick?.([{ uid: 'child-b', text: 'Child B' }])
    })
    await act(async () => {
      getLatestMindMapFrameProps()?.onNodeClick?.([{ uid: 'root', text: 'Root' }])
    })
    await act(async () => {
      getLatestMindMapFrameProps()?.onNodeClick?.([{ uid: 'child-c', text: 'Child C' }])
    })

    expect(screen.getByRole('status', { name: '连击 3' })).toBeTruthy()
    expect(screen.getAllByText('手感到了，继续揭晓。').length).toBeGreaterThan(0)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '反馈设置' }))
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '关闭弹窗' }))
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(700)
    })

    expect(screen.queryByRole('status', { name: '连击 3' })).toBeNull()
    expect(screen.getByText('连击 3')).toBeTruthy()
    vi.useRealTimers()
  })
})
