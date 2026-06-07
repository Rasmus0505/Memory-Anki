import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { useState } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MindMapFrame } from './MindMapFrame'

function buildEditorState(label = '根节点') {
  return {
    editor_doc: {
      root: {
        data: { text: label, uid: 'root-1' },
        children: [],
      },
    },
    editor_config: {},
    editor_local_config: {},
    lang: 'zh' as const,
  }
}

function attachIframeBridge(iframe: HTMLIFrameElement) {
  const syncHostEditorState = vi.fn()
  const applyHostState = vi.fn()
  const resetReadonlyInteractionState = vi.fn()
  Object.defineProperty(iframe, 'contentWindow', {
    configurable: true,
    value: {
      syncHostEditorState,
      applyHostState,
      resetReadonlyInteractionState,
    },
  })
  fireEvent.load(iframe)
  return { syncHostEditorState, applyHostState, resetReadonlyInteractionState }
}

function getHostBridge(index = 0) {
  return Object.values(window.__memoryAnkiMindMapHosts ?? {})[index]
}

describe('MindMapFrame sync behavior', () => {
  beforeEach(() => {
    window.__memoryAnkiMindMapHosts = {}
  })

  afterEach(() => {
    window.__memoryAnkiMindMapHosts = {}
    vi.restoreAllMocks()
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

  it('keeps full replace dedupe separate from soft sync fingerprints in host runtime source', () => {
    const hostSource = readFileSync(resolve(process.cwd(), 'public/mind-map-host.html'), 'utf8')

    expect(hostSource).toContain('window.__memoryAnkiLastAppliedFullEditorFingerprint')
    expect(hostSource).toContain("markLastAppliedEditorFingerprint(nextFingerprint, 'soft')")
    expect(hostSource).toContain("markLastAppliedEditorFingerprint(nextFingerprint, 'full')")
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
    ).toBe('2026-06-04-english-toolbar')
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
