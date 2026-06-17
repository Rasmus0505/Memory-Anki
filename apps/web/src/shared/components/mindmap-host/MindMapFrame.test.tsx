import { useState } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MindMapFrame } from './MindMapFrame'
import { attachIframeBridge, buildEditorState, getHostBridge } from './MindMapFrame.test-utils'

describe('MindMapFrame sync behavior', () => {
  beforeEach(() => {
    window.__memoryAnkiMindMapHosts = {}
  })

  afterEach(() => {
    window.__memoryAnkiMindMapHosts = {}
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('always includes the unified mind map frame surface class', () => {
    render(
      <MindMapFrame
        editorState={buildEditorState()}
        className="h-[320px] w-full rounded-2xl bg-white"
        onEditorStateChange={vi.fn()}
      />,
    )

    expect(screen.getByTitle('mind-map-editor').className).toContain('memory-anki-mindmap-frame')
  })

  it('dispatches a resize signal into the iframe host after load', async () => {
    render(
      <MindMapFrame
        editorState={buildEditorState()}
        className="h-[320px] w-full rounded-2xl bg-white"
        onEditorStateChange={vi.fn()}
      />,
    )

    const iframe = screen.getByTitle('mind-map-editor') as HTMLIFrameElement
    const bridgeMocks = attachIframeBridge(iframe)

    await waitFor(() => {
      expect(bridgeMocks.dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'resize' }))
    })
  })

  it('does not immediately sync back into the host after a local edit save callback updates props', async () => {
    function Harness() {
      const [editorState, setEditorState] = useState(buildEditorState())
      return (
        <MindMapFrame
          editorState={editorState}
          syncOnPropChange
          onEditorStateChange={(nextState) => setEditorState(nextState as typeof editorState)}
        />
      )
    }

    render(<Harness />)
    const iframe = screen.getByTitle('mind-map-editor') as HTMLIFrameElement
    const bridgeMocks = attachIframeBridge(iframe)

    await waitFor(() => {
      expect(bridgeMocks.applyHostState).toHaveBeenCalled()
    })

    const hostBridge = getHostBridge()
    await act(async () => {
      hostBridge?.notify?.('initial_hydration_complete', { fingerprint: 'ready' })
    })
    const syncCallCountBeforeLocalSave = bridgeMocks.syncHostEditorState.mock.calls.length
    await act(async () => {
      hostBridge?.saveMindMapData?.({
        root: {
          data: { text: '本地修改', uid: 'root-1' },
          children: [],
        },
      })
    })

    await waitFor(() => {
      expect(hostBridge?.getMindMapData?.()).toEqual({
        root: {
          data: { text: '本地修改', uid: 'root-1' },
          children: [],
        },
      })
    })
    expect(bridgeMocks.syncHostEditorState).toHaveBeenCalledTimes(syncCallCountBeforeLocalSave)
  })

  it('ignores stale soft prop syncs while a local edit is still waiting for props to catch up', async () => {
    const initialState = buildEditorState()
    const onEditorStateChange = vi.fn()
    const { rerender } = render(
      <MindMapFrame
        editorState={initialState}
        syncOnPropChange
        syncIntent="soft"
        onEditorStateChange={onEditorStateChange}
      />,
    )
    const iframe = screen.getByTitle('mind-map-editor') as HTMLIFrameElement
    const bridgeMocks = attachIframeBridge(iframe)

    await waitFor(() => {
      expect(bridgeMocks.applyHostState).toHaveBeenCalled()
    })

    await act(async () => {
      getHostBridge()?.notify?.('app_inited', null)
      getHostBridge()?.notify?.('initial_hydration_complete', { fingerprint: 'ready' })
    })

    bridgeMocks.syncHostEditorState.mockClear()

    await act(async () => {
      getHostBridge()?.saveMindMapData?.({
        root: {
          data: { text: '本地修改', uid: 'root-1' },
          children: [],
        },
      })
    })

    expect(onEditorStateChange).toHaveBeenCalledWith(
      expect.objectContaining({
        editor_doc: {
          root: {
            data: { text: '本地修改', uid: 'root-1' },
            children: [],
          },
        },
      }),
    )

    rerender(
      <MindMapFrame
        editorState={initialState}
        syncOnPropChange
        syncIntent="soft"
        onEditorStateChange={onEditorStateChange}
      />,
    )

    expect(bridgeMocks.syncHostEditorState).not.toHaveBeenCalled()
  })

  it('blocks host save callbacks until initial hydration completes', async () => {
    const onEditorStateChange = vi.fn()

    render(
      <MindMapFrame
        editorState={buildEditorState()}
        syncOnPropChange
        onEditorStateChange={onEditorStateChange}
      />,
    )
    const iframe = screen.getByTitle('mind-map-editor') as HTMLIFrameElement
    const bridgeMocks = attachIframeBridge(iframe)

    await waitFor(() => {
      expect(bridgeMocks.applyHostState).toHaveBeenCalled()
    })

    const hostBridge = getHostBridge()

    await act(async () => {
      hostBridge?.saveMindMapData?.({
        root: {
          data: { text: '旧 bootstrap', uid: 'root-1' },
          children: [],
        },
      })
    })

    expect(onEditorStateChange).not.toHaveBeenCalled()

    await act(async () => {
      hostBridge?.notify?.('initial_hydration_complete', { fingerprint: 'fresh-sync' })
    })

    await act(async () => {
      hostBridge?.saveMindMapData?.({
        root: {
          data: { text: '真正编辑', uid: 'root-1' },
          children: [],
        },
      })
    })

    expect(onEditorStateChange).toHaveBeenCalledTimes(1)
    expect(onEditorStateChange).toHaveBeenCalledWith(
      expect.objectContaining({
        editor_doc: {
          root: {
            data: { text: '真正编辑', uid: 'root-1' },
            children: [],
          },
        },
      }),
    )
  })

  it('forwards review fx signals into the iframe runtime and clears them when removed', async () => {
    const reviewFxSignal = {
      type: 'card_reveal' as const,
      nodeUid: 'node-1',
      relatedNodeUids: ['node-1'],
      intensity: 'full' as const,
      milestoneStep: null,
      anchor: { x: 0.56, y: 0.48 },
      lineMode: 'confirm' as const,
      depthHint: 2 as const,
      targetRole: 'placeholder' as const,
      isBranchCompletion: false,
      nonce: 1,
    }
    const { rerender } = render(
      <MindMapFrame
        editorState={buildEditorState()}
        reviewFxSignal={reviewFxSignal}
        onEditorStateChange={vi.fn()}
      />,
    )
    const iframe = screen.getByTitle('mind-map-editor') as HTMLIFrameElement
    const bridgeMocks = attachIframeBridge(iframe)

    await waitFor(() => {
      expect(bridgeMocks.emitReviewFx).toHaveBeenCalledWith(reviewFxSignal)
    })

    rerender(
      <MindMapFrame
        editorState={buildEditorState()}
        reviewFxSignal={null}
        onEditorStateChange={vi.fn()}
      />,
    )

    await waitFor(() => {
      expect(bridgeMocks.clearReviewFx).toHaveBeenCalled()
    })
  })

  it('forwards general feedback fx signals into the iframe runtime', async () => {
    const feedbackFxSignal = {
      type: 'node_create' as const,
      nodeUid: 'node-1',
      relatedNodeUids: ['node-1'],
      intensity: 'full' as const,
      lineMode: 'confirm' as const,
      nonce: 2,
    }

    render(
      <MindMapFrame
        editorState={buildEditorState()}
        feedbackFxSignal={feedbackFxSignal}
        onEditorStateChange={vi.fn()}
      />,
    )
    const iframe = screen.getByTitle('mind-map-editor') as HTMLIFrameElement
    const bridgeMocks = attachIframeBridge(iframe)

    await waitFor(() => {
      expect(bridgeMocks.emitFeedbackFx).toHaveBeenCalledWith(feedbackFxSignal)
    })
  })

  it('uses soft sync for prop updates and replace sync for forceSyncKey updates without remounting the iframe', async () => {
    const initialState = buildEditorState()
    const nextState = buildEditorState('服务端回写')
    const { rerender } = render(
      <MindMapFrame
        editorState={initialState}
        syncOnPropChange
        syncIntent="soft"
        syncReason="review_flip"
        onEditorStateChange={vi.fn()}
      />,
    )
    const iframe = screen.getByTitle('mind-map-editor') as HTMLIFrameElement
    const bridgeMocks = attachIframeBridge(iframe)

    await waitFor(() => {
      expect(bridgeMocks.applyHostState).toHaveBeenCalled()
    })

    await act(async () => {
      getHostBridge()?.notify?.('app_inited', null)
    })

    rerender(
      <MindMapFrame
        editorState={nextState}
        syncOnPropChange
        syncIntent="soft"
        syncReason="review_flip"
        onEditorStateChange={vi.fn()}
      />,
    )

    await waitFor(() => {
      expect(bridgeMocks.syncHostEditorState).toHaveBeenCalledWith(
        expect.objectContaining({
          syncIntent: 'soft',
          syncReason: 'review_flip',
          editorState: nextState,
        }),
      )
    })

    const sameIframe = screen.getByTitle('mind-map-editor') as HTMLIFrameElement
    expect(sameIframe).toBe(iframe)

    rerender(
      <MindMapFrame
        editorState={nextState}
        syncOnPropChange
        syncIntent="soft"
        forceSyncKey="replace-1"
        forceSyncIntent="replace"
        onEditorStateChange={vi.fn()}
      />,
    )

    await waitFor(() => {
      expect(bridgeMocks.syncHostEditorState).toHaveBeenCalledWith(
        expect.objectContaining({
          syncIntent: 'replace',
          syncReason: null,
          editorState: nextState,
        }),
      )
    })
    expect(screen.getByTitle('mind-map-editor')).toBe(iframe)
  })

  it('uses replace sync for readonly review flip prop updates while preserving the current viewport', async () => {
    const initialState = buildEditorState()
    const nextState = {
      ...buildEditorState('Root'),
      editor_doc: {
        root: {
          data: { text: 'Root', uid: 'root-1' },
          children: [{ data: { text: '待回忆', uid: 'child-1' }, children: [] }],
        },
      },
    }
    const { rerender } = render(
      <MindMapFrame
        editorState={initialState}
        readonly
        syncOnPropChange
        syncIntent="replace"
        syncReason="review_flip"
        preserveViewOnSync
        externalSyncKey="review-sync:0"
        onEditorStateChange={vi.fn()}
      />,
    )
    const iframe = screen.getByTitle('mind-map-editor') as HTMLIFrameElement
    const bridgeMocks = attachIframeBridge(iframe)

    await waitFor(() => {
      expect(bridgeMocks.applyHostState).toHaveBeenCalled()
    })

    await act(async () => {
      getHostBridge()?.notify?.('app_inited', null)
    })

    bridgeMocks.syncHostEditorState.mockClear()

    rerender(
      <MindMapFrame
        editorState={nextState}
        readonly
        syncOnPropChange
        syncIntent="replace"
        syncReason="review_flip"
        preserveViewOnSync
        externalSyncKey="review-sync:1"
        onEditorStateChange={vi.fn()}
      />,
    )

    await waitFor(() => {
      expect(bridgeMocks.syncHostEditorState).toHaveBeenCalledWith(
        expect.objectContaining({
          syncIntent: 'replace',
          syncReason: 'review_flip',
          editorState: nextState,
          preserveView: true,
          viewPolicy: 'preserve',
        }),
      )
    })
  })

  it('still syncs editor doc changes before the first external sync key bump', async () => {
    const initialState = buildEditorState()
    const nextState = {
      ...buildEditorState('导入后根节点'),
      editor_doc: {
        root: {
          data: { text: '导入后根节点', uid: 'root-1' },
          children: [{ data: { text: '新增分支', uid: 'child-1' }, children: [] }],
        },
      },
    }
    const { rerender } = render(
      <MindMapFrame
        editorState={initialState}
        syncOnPropChange
        syncIntent="soft"
        externalSyncKey={0}
        onEditorStateChange={vi.fn()}
      />,
    )
    const iframe = screen.getByTitle('mind-map-editor') as HTMLIFrameElement
    const bridgeMocks = attachIframeBridge(iframe)

    await waitFor(() => {
      expect(bridgeMocks.applyHostState).toHaveBeenCalled()
    })

    await act(async () => {
      getHostBridge()?.notify?.('app_inited', null)
    })

    bridgeMocks.syncHostEditorState.mockClear()

    rerender(
      <MindMapFrame
        editorState={nextState}
        syncOnPropChange
        syncIntent="soft"
        externalSyncKey={0}
        onEditorStateChange={vi.fn()}
      />,
    )

    await waitFor(() => {
      expect(bridgeMocks.syncHostEditorState).toHaveBeenCalledWith(
        expect.objectContaining({
          syncIntent: 'soft',
          editorState: nextState,
        }),
      )
    })
  })

  it('keeps syncing prop updates after the iframe load handler resets hostReady on an already-initialized host', async () => {
    const initialState = buildEditorState()
    const nextState = buildEditorState('练习占位同步')
    const { rerender } = render(
      <MindMapFrame
        editorState={initialState}
        syncOnPropChange
        syncIntent="soft"
        syncReason="review_flip"
        onEditorStateChange={vi.fn()}
      />,
    )
    const iframe = screen.getByTitle('mind-map-editor') as HTMLIFrameElement
    const bridgeMocks = attachIframeBridge(iframe)

    await waitFor(() => {
      expect(bridgeMocks.applyHostState).toHaveBeenCalled()
    })

    await act(async () => {
      getHostBridge()?.notify?.('app_inited', null)
    })

    bridgeMocks.syncHostEditorState.mockClear()
    fireEvent.load(iframe)

    rerender(
      <MindMapFrame
        editorState={nextState}
        syncOnPropChange
        syncIntent="soft"
        syncReason="review_flip"
        onEditorStateChange={vi.fn()}
      />,
    )

    await waitFor(() => {
      expect(bridgeMocks.syncHostEditorState).toHaveBeenCalledWith(
        expect.objectContaining({
          syncIntent: 'soft',
          syncReason: 'review_flip',
          editorState: nextState,
        }),
      )
    })
  })

  it('treats a truthy external sync key as the readonly doc sync trigger for review flip updates', async () => {
    const initialState = buildEditorState()
    const { rerender } = render(
      <MindMapFrame
        editorState={initialState}
        readonly
        syncOnPropChange
        syncIntent="soft"
        syncReason="review_flip"
        externalSyncKey="practice-sync:0"
        onEditorStateChange={vi.fn()}
      />,
    )
    const iframe = screen.getByTitle('mind-map-editor') as HTMLIFrameElement
    const bridgeMocks = attachIframeBridge(iframe)

    await waitFor(() => {
      expect(bridgeMocks.applyHostState).toHaveBeenCalled()
    })

    await act(async () => {
      getHostBridge()?.notify?.('app_inited', null)
    })

    bridgeMocks.syncHostEditorState.mockClear()

    rerender(
      <MindMapFrame
        editorState={initialState}
        readonly
        syncOnPropChange
        syncIntent="soft"
        syncReason="review_flip"
        externalSyncKey="practice-sync:1"
        onEditorStateChange={vi.fn()}
      />,
    )

    await waitFor(() => {
      expect(bridgeMocks.syncHostEditorState).toHaveBeenCalledWith(
        expect.objectContaining({
          syncIntent: 'soft',
          syncReason: 'review_flip',
          editorState: initialState,
        }),
      )
    })
  })

  it('queues initial replace sync until host app_inited and applies reset view policy only once', async () => {
    const nextState = buildEditorState('首开同步')
    const { rerender } = render(
      <MindMapFrame
        editorState={nextState}
        syncOnPropChange
        forceSyncKey="replace-1"
        forceSyncIntent="replace"
        initialViewPolicy="reset"
        onEditorStateChange={vi.fn()}
      />,
    )
    const iframe = screen.getByTitle('mind-map-editor') as HTMLIFrameElement
    const bridgeMocks = attachIframeBridge(iframe)

    await waitFor(() => {
      expect(bridgeMocks.applyHostState).toHaveBeenCalled()
    })
    expect(bridgeMocks.syncHostEditorState).not.toHaveBeenCalled()

    await act(async () => {
      getHostBridge()?.notify?.('app_inited', null)
    })

    await waitFor(() => {
      expect(bridgeMocks.syncHostEditorState).toHaveBeenCalledWith(
        expect.objectContaining({
          syncIntent: 'replace',
          syncReason: null,
          editorState: nextState,
          viewPolicy: 'reset',
        }),
      )
    })

    rerender(
      <MindMapFrame
        editorState={nextState}
        syncOnPropChange
        forceSyncKey="replace-2"
        forceSyncIntent="replace"
        initialViewPolicy="reset"
        onEditorStateChange={vi.fn()}
      />,
    )

    await waitFor(() => {
      expect(bridgeMocks.syncHostEditorState).toHaveBeenCalledWith(
        expect.objectContaining({
          syncIntent: 'replace',
          syncReason: null,
          editorState: nextState,
          viewPolicy: 'preserve',
        }),
      )
    })
  })

})
