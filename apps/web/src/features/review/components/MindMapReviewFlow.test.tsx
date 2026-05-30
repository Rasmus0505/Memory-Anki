import * as React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MindMapReviewFlow } from '@/features/review/components/MindMapReviewFlow'

const timer = {
  effectiveSeconds: 7,
  pauseCount: 0,
  status: 'running' as const,
  startedAt: Date.now(),
  glowState: 'running' as const,
  start: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  adjustDuration: vi.fn(),
  registerActivity: vi.fn(),
  logEvent: vi.fn(),
  complete: vi.fn(async () => ({ effectiveSeconds: 7 })),
}

vi.mock('@/shared/hooks/useTimedSession', () => ({
  useTimedSession: () => timer,
}))

const mindMapFrameMock = vi.fn()

vi.mock('@/shared/components/mindmap-host', () => ({
  MindMapFrame: (props: Record<string, unknown>) => {
    mindMapFrameMock(props)
    const fullscreen = Boolean(props.immersiveModeActive)
    return (
      <div data-testid="mind-map-frame">
        <div>{`toolbar-${props.showToolbarWhenReadonly ? 'shown' : 'hidden'}-${fullscreen ? 'immersive' : 'plain'}`}</div>
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
      </div>
    )
  },
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

describe('MindMapReviewFlow', () => {
  beforeEach(() => {
    timer.complete.mockClear()
    timer.registerActivity.mockClear()
    mindMapFrameMock.mockClear()
  })

  it('submits only once when completion is clicked rapidly', async () => {
    let resolveComplete: () => void = () => {}
    const onComplete = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveComplete = resolve
        }),
    )

    render(
      <MindMapReviewFlow
        title="Root"
        palaceId={1}
        sessionKind="review"
        editorState={editorState}
        onComplete={onComplete}
      />,
    )

    const completeButton = screen.getByRole('button', { name: /完成/ })
    fireEvent.click(completeButton)
    fireEvent.click(completeButton)

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1))
    expect(timer.complete).toHaveBeenCalledTimes(1)

    resolveComplete()
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1))
  })

  it('shows readonly host toolbar and uses host fullscreen controls instead of outer button', async () => {
    render(
      <MindMapReviewFlow
        title="Root"
        palaceId={1}
        sessionKind="review"
        editorState={editorState}
        onComplete={vi.fn()}
      />,
    )

    expect(screen.queryByRole('button', { name: '全屏导图' })).toBeNull()
    expect(screen.getByText('toolbar-shown-plain')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '宿主半屏切换' }))
    await waitFor(() => {
      expect(screen.getByText('toolbar-shown-immersive')).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: '退出原生全屏' }))
    await waitFor(() => {
      expect(screen.getByText('toolbar-shown-plain')).toBeTruthy()
    })

    const latestCall = getLatestMindMapFrameProps()
    expect(latestCall?.readonly).toBe(true)
    expect(latestCall?.showToolbarWhenReadonly).toBe(true)
    expect(latestCall?.syncReason).toBe('review_flip')
    expect(latestCall?.showImportButtons).not.toBe(true)
    expect(latestCall?.showBilinkSearchButton).toBe(true)
  })

  it('reveals placeholder and next hidden child through readonly left-click flow', async () => {
    render(
      <MindMapReviewFlow
        title="Root"
        palaceId={1}
        sessionKind="practice"
        editorState={editorState}
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
      getLatestMindMapFrameProps()?.onNodeClick?.([{ uid: 'child', text: 'Child' }])
    })
    expect(getVisibleTextsFromLatestFrame()).toEqual({
      root: 'Root',
      child: 'Child',
      grandchild: '待回忆',
    })

    expect(timer.registerActivity).toHaveBeenCalledWith('practice_interaction', { source: 'left_click' })
  })

  it('keeps readonly left-click flip flow working after host fullscreen toggles', async () => {
    render(
      <MindMapReviewFlow
        title="Root"
        palaceId={1}
        sessionKind="practice"
        editorState={editorState}
        onComplete={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '宿主半屏切换' }))
    await waitFor(() => {
      expect(screen.getByText('toolbar-shown-immersive')).toBeTruthy()
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

    fireEvent.click(screen.getByRole('button', { name: '退出原生全屏' }))
    await waitFor(() => {
      expect(screen.getByText('toolbar-shown-plain')).toBeTruthy()
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

  it('keeps readonly right-click branch handling wired through the frame', async () => {
    render(
      <MindMapReviewFlow
        title="Root"
        palaceId={1}
        sessionKind="practice"
        editorState={editorState}
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

  it('lets root right-click hide revealed descendants while keeping the root visible', async () => {
    render(
      <MindMapReviewFlow
        title="Root"
        palaceId={1}
        sessionKind="practice"
        editorState={editorState}
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
})
