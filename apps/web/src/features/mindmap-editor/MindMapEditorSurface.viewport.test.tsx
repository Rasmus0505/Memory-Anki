import { render, screen } from '@testing-library/react'
import type * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MindMapEditorSurface } from './MindMapEditorSurface'
import type { MindMapEditorState } from '@/shared/api/contracts'

const mindMapCanvasMock = vi.hoisted(() => vi.fn())

vi.mock('@/shared/ui/mindmap-canvas', async () => {
  const actual = await vi.importActual<typeof import('@/shared/ui/mindmap-canvas')>(
    '@/shared/ui/mindmap-canvas',
  )
  return {
    ...actual,
    MindMapCanvas: (props: Record<string, unknown>) => {
      mindMapCanvasMock(props)
      return (
        <div
          data-testid="mock-mind-map-canvas"
          data-recovery-key={String(props.recoveryKey ?? '')}
          data-node-click-viewport-policy={String(props.nodeClickViewportPolicy ?? '')}
          data-content-change-viewport-policy={String(props.contentChangeViewportPolicy ?? '')}
        />
      )
    },
  }
})

const editorState: MindMapEditorState = {
  editor_doc: {
    root: {
      data: { text: 'Root', uid: 'root' },
      children: [
        {
          data: { text: 'Child', uid: 'child' },
          children: [],
        },
      ],
    },
  },
  editor_config: {},
  editor_local_config: {},
  lang: 'zh',
}

const expandedEditorState: MindMapEditorState = {
  ...editorState,
  editor_doc: {
    root: {
      data: { text: 'Root', uid: 'root' },
      children: [
        {
          data: { text: 'Child', uid: 'child' },
          children: [
            {
              data: { text: 'Grandchild', uid: 'grandchild' },
              children: [],
            },
          ],
        },
      ],
    },
  },
}

function renderFrame(props?: Partial<React.ComponentProps<typeof MindMapEditorSurface>>) {
  return render(
    <MindMapEditorSurface
      editorState={editorState}
      onEditorStateChange={vi.fn()}
      {...props}
    />,
  )
}

describe('MindMapEditorSurface viewport preservation', () => {
  beforeEach(() => {
    mindMapCanvasMock.mockClear()
  })

  it('keeps the canvas recovery key stable for preserved sync updates', () => {
    const { rerender } = renderFrame({
      preserveViewOnSync: true,
      syncReason: 'review_flip',
      externalSyncKey: 'first-reveal-state',
    })
    const initialRecoveryKey = screen
      .getByTestId('mock-mind-map-canvas')
      .getAttribute('data-recovery-key')

    rerender(
      <MindMapEditorSurface
        editorState={expandedEditorState}
        onEditorStateChange={vi.fn()}
        preserveViewOnSync
        syncReason="review_flip"
        externalSyncKey="second-reveal-state"
      />,
    )

    expect(screen.getByTestId('mock-mind-map-canvas').getAttribute('data-recovery-key')).toBe(
      initialRecoveryKey,
    )
  })

  it('derives preserve viewport policies for practice sync updates', () => {
    renderFrame({
      practiceModeActive: true,
      preserveViewOnSync: true,
      syncReason: 'review_flip',
      externalSyncKey: 'first-reveal-state',
    })

    const canvas = screen.getByTestId('mock-mind-map-canvas')

    expect(canvas.getAttribute('data-node-click-viewport-policy')).toBe('preserve')
    expect(canvas.getAttribute('data-content-change-viewport-policy')).toBe('preserve')
  })

  it('keeps preserve defaults outside practice mode', () => {
    renderFrame({
      readonly: true,
      practiceModeActive: false,
      preserveViewOnSync: true,
    })

    const canvas = screen.getByTestId('mock-mind-map-canvas')

    expect(canvas.getAttribute('data-node-click-viewport-policy')).toBe('preserve')
    expect(canvas.getAttribute('data-content-change-viewport-policy')).toBe('preserve')
  })

  it('still includes sync changes in the recovery key when view preservation is disabled', () => {
    const { rerender } = renderFrame({
      preserveViewOnSync: false,
      syncReason: 'replace',
      externalSyncKey: 'first-import-state',
    })
    const initialRecoveryKey = screen
      .getByTestId('mock-mind-map-canvas')
      .getAttribute('data-recovery-key')

    rerender(
      <MindMapEditorSurface
        editorState={expandedEditorState}
        onEditorStateChange={vi.fn()}
        syncReason="replace"
        externalSyncKey="second-import-state"
      />,
    )

    expect(screen.getByTestId('mock-mind-map-canvas').getAttribute('data-recovery-key')).not.toBe(
      initialRecoveryKey,
    )
  })
})
