import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MindMapFrame } from './MindMapFrame'
import { attachIframeBridge, buildEditorState, getHostBridge } from './MindMapFrame.test-utils'

describe('MindMapFrame host runtime behavior', () => {
  beforeEach(() => {
    window.__memoryAnkiMindMapHosts = {}
  })

  afterEach(() => {
    window.__memoryAnkiMindMapHosts = {}
    vi.restoreAllMocks()
  })

  it('keeps full replace dedupe separate from soft sync fingerprints in host runtime source', () => {
    const hostSource = readFileSync(resolve(process.cwd(), 'public/mind-map-host.html'), 'utf8')

    expect(hostSource).toContain('window.__memoryAnkiLastAppliedFullEditorFingerprint')
    expect(hostSource).toContain("markLastAppliedEditorFingerprint(nextFingerprint, 'soft')")
    expect(hostSource).toContain("markLastAppliedEditorFingerprint(nextFingerprint, 'full')")
  })

  it('keeps local baseline updates and stale pending soft sync discard logic in host runtime source', () => {
    const hostSource = readFileSync(resolve(process.cwd(), 'public/mind-map-host.html'), 'utf8')

    expect(hostSource).toContain('function updatePendingEditorStateBaseline(overrides = {})')
    expect(hostSource).toContain('function shouldDiscardStalePendingSoftPayload(payload)')
    expect(hostSource).toMatch(
      /function flushPendingSoftSync\(force = false\)[\s\S]*shouldDiscardStalePendingSoftPayload\(pendingPayload\)/,
    )
    expect(hostSource).toContain("syncState.pendingSoftPayload = null")
    expect(hostSource).toContain("getHostBridge()?.saveMindMapData?.(cloneValue(data))")
    expect(hostSource).toContain("updatePendingEditorStateBaseline({")
  })

  it('requests a host visual refresh after full editor sync updates the tree', () => {
    const hostSource = readFileSync(resolve(process.cwd(), 'public/mind-map-host.html'), 'utf8')

    expect(hostSource).toContain('function requestHostVisualRefresh()')
    expect(hostSource).toMatch(
      /function performFullEditorSync[\s\S]*requestHostVisualRefresh\(\)[\s\S]*markLastAppliedEditorFingerprint\(nextFingerprint, 'full'\)/,
    )
    expect(hostSource).toContain("syncState.pendingViewFitAfterRender =")
    expect(hostSource).toContain("viewPolicy === 'reset' && payload?.syncReason === 'review_flip'")
    expect(hostSource).toContain("typeof mindMap.view.fit === 'function'")
  })

  it('runs a resize-aware redraw and fit when the host viewport changes', () => {
    const hostSource = readFileSync(resolve(process.cwd(), 'public/mind-map-host.html'), 'utf8')

    expect(hostSource).toContain('const viewportRefreshState =')
    expect(hostSource).toContain('function requestResizeAwareHostVisualRefresh(options = {})')
    expect(hostSource).toMatch(
      /function scheduleMindMapResizeSync\(\)[\s\S]*requestResizeAwareHostVisualRefresh\({[\s\S]*fitChangedSize: resized/,
    )
    expect(hostSource).toMatch(
      /function requestResizeAwareHostVisualRefresh[\s\S]*window\.requestAnimationFrame\(\(\) => {[\s\S]*window\.requestAnimationFrame\(run\)/,
    )
    expect(hostSource).toMatch(
      /function requestResizeAwareHostVisualRefresh[\s\S]*mindMap\.view\.fit\(\)[\s\S]*requestHostVisualRefresh\(\)/,
    )
  })

  it('promotes the host to ready after a runtime event when app_inited was missed', async () => {
    const initialState = buildEditorState()
    const nextState = {
      ...buildEditorState('根节点'),
      editor_doc: {
        root: {
          data: { text: '根节点', uid: 'root-1' },
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
        externalSyncKey="review-sync:0"
        onEditorStateChange={vi.fn()}
      />,
    )
    const iframe = screen.getByTitle('mind-map-editor') as HTMLIFrameElement
    const bridgeMocks = attachIframeBridge(iframe)

    await waitFor(() => {
      expect(bridgeMocks.applyHostState).toHaveBeenCalled()
    })

    bridgeMocks.syncHostEditorState.mockClear()

    await act(async () => {
      getHostBridge()?.notify?.('node_click', [{ uid: 'root-1', text: '根节点' }])
    })

    rerender(
      <MindMapFrame
        editorState={nextState}
        readonly
        syncOnPropChange
        syncIntent="replace"
        syncReason="review_flip"
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
        }),
      )
    })
  })

  it('does not force-reset readonly interaction state on every readonly host sync', async () => {
    const { rerender } = render(
      <MindMapFrame
        editorState={buildEditorState()}
        readonly
        showToolbarWhenReadonly
        immersiveModeActive={false}
        bilinkCounts={{ root: 1 }}
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
    expect(bridgeMocks.resetReadonlyInteractionState).not.toHaveBeenCalled()
    const applyHostStateCallCount = bridgeMocks.applyHostState.mock.calls.length

    rerender(
      <MindMapFrame
        editorState={buildEditorState()}
        readonly
        showToolbarWhenReadonly
        immersiveModeActive
        bilinkCounts={{ root: 2 }}
        syncOnPropChange
        syncIntent="soft"
        syncReason="review_flip"
        onEditorStateChange={vi.fn()}
      />,
    )

    await waitFor(() => {
      expect(bridgeMocks.applyHostState.mock.calls.length).toBeGreaterThan(applyHostStateCallCount)
    })
    expect(bridgeMocks.resetReadonlyInteractionState).not.toHaveBeenCalled()
  })

  it('pushes viewMemoryScope changes into host state without remounting the iframe', async () => {
    const { rerender } = render(
      <MindMapFrame
        editorState={buildEditorState()}
        viewMemoryScope="palace-edit:101:edit"
        onEditorStateChange={vi.fn()}
      />,
    )
    const iframe = screen.getByTitle('mind-map-editor') as HTMLIFrameElement
    const bridgeMocks = attachIframeBridge(iframe)

    await waitFor(() => {
      expect(bridgeMocks.applyHostState).toHaveBeenCalledWith(
        expect.objectContaining({
          viewMemoryScope: 'palace-edit:101:edit',
        }),
      )
    })

    rerender(
      <MindMapFrame
        editorState={buildEditorState()}
        viewMemoryScope="palace-edit:101:practice"
        onEditorStateChange={vi.fn()}
      />,
    )

    await waitFor(() => {
      expect(bridgeMocks.applyHostState).toHaveBeenCalledWith(
        expect.objectContaining({
          viewMemoryScope: 'palace-edit:101:practice',
        }),
      )
    })
    expect(screen.getByTitle('mind-map-editor')).toBe(iframe)
  })

  it('pushes mode switch focus requests into host state without remounting the iframe', async () => {
    const { rerender } = render(
      <MindMapFrame
        editorState={buildEditorState()}
        focusRequestNodeUid="node-1"
        focusRequestNonce={1}
        onEditorStateChange={vi.fn()}
      />,
    )
    const iframe = screen.getByTitle('mind-map-editor') as HTMLIFrameElement
    const bridgeMocks = attachIframeBridge(iframe)

    await waitFor(() => {
      expect(bridgeMocks.applyHostState).toHaveBeenCalledWith(
        expect.objectContaining({
          focusRequestNodeUid: 'node-1',
          focusRequestNonce: 1,
        }),
      )
    })

    rerender(
      <MindMapFrame
        editorState={buildEditorState()}
        focusRequestNodeUid="node-2"
        focusRequestNonce={2}
        onEditorStateChange={vi.fn()}
      />,
    )

    await waitFor(() => {
      expect(bridgeMocks.applyHostState).toHaveBeenCalledWith(
        expect.objectContaining({
          focusRequestNodeUid: 'node-2',
          focusRequestNonce: 2,
        }),
      )
    })
    expect(screen.getByTitle('mind-map-editor')).toBe(iframe)
  })

  it('restores queued mode switch focus requests after host renders', () => {
    const hostSource = readFileSync(resolve(process.cwd(), 'public/mind-map-host.html'), 'utf8')

    expect(hostSource).toContain('pendingFocusRequest')
    expect(hostSource).toContain('function centerNodeInViewport(node)')
    expect(hostSource).toContain('mindMap.view.translateXY(deltaX, deltaY)')
    expect(hostSource).toMatch(
      /restorePendingViewMemoryFocusIfNeeded\(\)[\s\S]*restorePendingSyncFocusIfNeeded\(\)[\s\S]*restorePendingFocusRequestIfNeeded\(\)/,
    )
  })

  it('forwards a review return label into host state for the shared toolbar toggle', async () => {
    render(
      <MindMapFrame
        editorState={buildEditorState()}
        practiceToggleLabel="复习"
        onPracticeToggle={vi.fn()}
        onEditorStateChange={vi.fn()}
      />,
    )
    const iframe = screen.getByTitle('mind-map-editor') as HTMLIFrameElement
    const bridgeMocks = attachIframeBridge(iframe)

    await waitFor(() => {
      expect(bridgeMocks.applyHostState).toHaveBeenCalledWith(
        expect.objectContaining({
          showPracticeButton: true,
          practiceToggleLabel: '复习',
        }),
      )
    })
  })

  it('shows the English toolbar button and forwards english open requests', async () => {
    const onEnglishOpen = vi.fn()

    render(
      <MindMapFrame
        editorState={buildEditorState()}
        onEnglishOpen={onEnglishOpen}
        onEditorStateChange={vi.fn()}
      />,
    )
    const iframe = screen.getByTitle('mind-map-editor') as HTMLIFrameElement
    const bridgeMocks = attachIframeBridge(iframe)

    await waitFor(() => {
      expect(bridgeMocks.applyHostState).toHaveBeenCalledWith(
        expect.objectContaining({
          showEnglishButton: true,
        }),
      )
    })

    await act(async () => {
      getHostBridge()?.notify?.('english_open', null)
    })

    expect(onEnglishOpen).toHaveBeenCalledTimes(1)
  })

  it('reapplies host toolbar state when a runtime event promotes a host that missed app_inited', async () => {
    render(
      <MindMapFrame
        editorState={buildEditorState()}
        readonly
        showToolbarWhenReadonly
        practiceToggleLabel="编辑"
        onPracticeToggle={vi.fn()}
        onEditorStateChange={vi.fn()}
      />,
    )
    const iframe = screen.getByTitle('mind-map-editor') as HTMLIFrameElement
    const bridgeMocks = attachIframeBridge(iframe)

    await waitFor(() => {
      expect(bridgeMocks.applyHostState).toHaveBeenCalledWith(
        expect.objectContaining({
          showPracticeButton: true,
          practiceToggleLabel: '编辑',
        }),
      )
    })

    bridgeMocks.applyHostState.mockClear()

    await act(async () => {
      getHostBridge()?.notify?.('node_click', [{ uid: 'root-1', text: '根节点' }])
    })

    expect(bridgeMocks.applyHostState).toHaveBeenCalledWith(
      expect.objectContaining({
        showPracticeButton: true,
        practiceToggleLabel: '编辑',
      }),
    )
  })

  it('forwards ai split requests and pushes ai split host state into the iframe', async () => {
    const onAiSplitRequest = vi.fn()

    render(
      <MindMapFrame
        editorState={buildEditorState()}
        aiSplitBusy
        onAiSplitRequest={onAiSplitRequest}
        onEditorStateChange={vi.fn()}
      />,
    )
    const iframe = screen.getByTitle('mind-map-editor') as HTMLIFrameElement
    const bridgeMocks = attachIframeBridge(iframe)

    await waitFor(() => {
      expect(bridgeMocks.applyHostState).toHaveBeenCalledWith(
        expect.objectContaining({
          aiSplitBusy: true,
          aiSplitEnabled: true,
        }),
      )
    })

    const hostBridge = Object.values(window.__memoryAnkiMindMapHosts ?? {})[0]
    await act(async () => {
      hostBridge?.notify?.('ai_split_request', {
        target_node_uid: 'node-1',
        target_node_text: '原节点',
        target_node_note: '原备注',
        target_node_type: 'peg',
        is_root: false,
        selection_snapshot: { target_node_uid: 'node-1' },
      })
    })

    expect(onAiSplitRequest).toHaveBeenCalledWith({
      target_node_uid: 'node-1',
      target_node_text: '原节点',
      target_node_note: '原备注',
      target_node_type: 'peg',
      is_root: false,
    })
  })

  it('keeps host registries isolated when multiple mind map frames render together', async () => {
    render(
      <>
        <MindMapFrame editorState={buildEditorState('主脑图')} forceSyncKey="main-1" onEditorStateChange={vi.fn()} />
        <MindMapFrame editorState={buildEditorState('知识大纲')} onEditorStateChange={vi.fn()} />
      </>,
    )

    const iframes = screen.getAllByTitle('mind-map-editor') as HTMLIFrameElement[]
    expect(iframes).toHaveLength(2)

    const bridgeMocks = iframes.map((iframe) => attachIframeBridge(iframe))
    const hostEntries = Object.entries(window.__memoryAnkiMindMapHosts ?? {})
    expect(hostEntries).toHaveLength(2)

    const iframeHostIds = iframes.map((iframe) => {
      const src = iframe.getAttribute('src') || ''
      return new URL(src, 'http://localhost').searchParams.get('host')
    })
    expect(new Set(iframeHostIds).size).toBe(2)
    expect(
      new URL(iframes[0]?.getAttribute('src') || '', 'http://localhost').searchParams.get('v'),
    ).toBe('2026-06-09-mode-focus')
    expect(new Set(hostEntries.map(([hostId]) => hostId)).size).toBe(2)

    await act(async () => {
      hostEntries[0]?.[1]?.notify?.('app_inited', null)
      hostEntries[1]?.[1]?.notify?.('app_inited', null)
    })

    await waitFor(() => {
      expect(bridgeMocks[0]?.applyHostState).toHaveBeenCalled()
      expect(bridgeMocks[1]?.applyHostState).toHaveBeenCalled()
    })
  })
})
