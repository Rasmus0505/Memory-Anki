import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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
      children: [{ data: { text: 'Child', uid: 'child' }, children: [] }],
    },
  },
  editor_config: {},
  editor_local_config: {},
  lang: 'zh',
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

    const latestCall = mindMapFrameMock.mock.calls.at(-1)?.[0] as Record<string, unknown> | undefined
    expect(latestCall?.readonly).toBe(true)
    expect(latestCall?.showToolbarWhenReadonly).toBe(true)
    expect(latestCall?.showImportButtons).not.toBe(true)
  })
})
