import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MindMapFrame } from './MindMapFrame'
import { attachIframeBridge, buildEditorState, getHostBridge } from './MindMapFrame.test-utils'

function readHostRuntimeSource() {
  return [
    'public/mind-map-host.html',
    'public/mind-map-host-bridge.js',
    'public/mind-map-host.css',
  ]
    .map((path) => readFileSync(resolve(process.cwd(), path), 'utf8'))
    .join('\n')
}

describe('MindMapFrame host runtime behavior', () => {
  beforeEach(() => {
    window.__memoryAnkiMindMapHosts = {}
  })

  afterEach(() => {
    window.__memoryAnkiMindMapHosts = {}
    vi.restoreAllMocks()
  })

  it('keeps full replace dedupe separate from soft sync fingerprints in host runtime source', () => {
    const hostSource = readHostRuntimeSource()

    expect(hostSource).toContain('window.__memoryAnkiLastAppliedFullEditorFingerprint')
    expect(hostSource).toContain("markLastAppliedEditorFingerprint(nextFingerprint, 'soft')")
    expect(hostSource).toContain("markLastAppliedEditorFingerprint(nextFingerprint, 'full')")
  })

  it('keeps local baseline updates and stale pending soft sync discard logic in host runtime source', () => {
    const hostSource = readHostRuntimeSource()

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
    const hostSource = readHostRuntimeSource()

    expect(hostSource).toContain('function requestHostVisualRefresh()')
    expect(hostSource).toContain("typeof renderer?.reRender === 'function'")
    expect(hostSource).not.toContain('() => renderer?.reRender?.()')
    expect(hostSource).toMatch(
      /function performFullEditorSync[\s\S]*requestHostVisualRefresh\(\)[\s\S]*markLastAppliedEditorFingerprint\(nextFingerprint, 'full'\)/,
    )
    expect(hostSource).toContain("syncState.pendingViewFitAfterRender =")
    expect(hostSource).toContain("viewPolicy === 'reset' && payload?.syncReason === 'review_flip'")
    expect(hostSource).toContain("typeof mindMap.view.fit === 'function'")
  })

  it('applies unified paper map appearance before interaction overlays after host renders', () => {
    const hostSource = readHostRuntimeSource()
    const applyUnifiedSection =
      hostSource.match(/function applyUnifiedMindMapAppearance\(\)[\s\S]*?function clearReviewFxState/)?.[0] ?? ''
    const paperReflowSection =
      hostSource.match(/function runPaperLayoutReflow\(\)[\s\S]*?function requestPaperLayoutReflow/)?.[0] ?? ''

    expect(hostSource).toContain('const paperLayoutReflowState =')
    expect(hostSource).toContain('function requestPaperLayoutReflow()')
    expect(hostSource).toContain('function runPaperLayoutReflow()')
    expect(hostSource).toContain('function markPaperLayoutReflowComplete()')
    expect(hostSource).toContain('function applyUnifiedMindMapAppearance()')
    expect(hostSource).toContain("document.body.classList.add('memory-anki-paper-map')")
    expect(hostSource).toContain('line-height: 1.2;')
    expect(hostSource).toContain('overflow-wrap: break-word;')
    expect(hostSource).toContain('min-width: 0;')
    expect(hostSource).toContain('white-space: normal;')
    expect(hostSource).toContain('width: 100%;')
    expect(hostSource).toContain('function applyPaperNodeTextStyle(node, style)')
    expect(hostSource).toMatch(
      /body\.memory-anki-paper-map \.smm-node\.memory-anki-paper-node \{[\s\S]*overflow: visible;/,
    )
    expect(hostSource).toMatch(
      /body\.memory-anki-paper-map \.smm-node\.memory-anki-paper-node foreignObject \{[\s\S]*overflow: visible;/,
    )
    expect(applyUnifiedSection).not.toContain('requestPaperLayoutReflow(')
    expect(paperReflowSection).toContain('markPaperLayoutReflowComplete()')
    expect(paperReflowSection).not.toContain('captureHostSyncFocusSnapshot(')
    expect(paperReflowSection).not.toContain('setFullData(')
    expect(paperReflowSection).not.toContain('setData(')
    expect(paperReflowSection).not.toContain('window.__memoryAnkiPendingTransformRestore')
    expect(hostSource).toMatch(
      /function requestHostVisualRefresh[\s\S]*applyUnifiedMindMapAppearance\(\)[\s\S]*updateKeyboardFocusClass\(\)[\s\S]*applySegmentNodeStyles\(\)[\s\S]*renderBilinkBadges\(\)/,
    )
    expect(hostSource).toMatch(
      /window\.\$bus\.\$on\('node_tree_render_end'[\s\S]*markPaperLayoutReflowComplete\(\)[\s\S]*applyUnifiedMindMapAppearance\(\)[\s\S]*updateKeyboardFocusClass\(\)[\s\S]*applySegmentNodeStyles\(\)[\s\S]*renderBilinkBadges\(\)/,
    )
    expect(hostSource).toMatch(
      /window\.\$bus\.\$on\('app_inited'[\s\S]*applyUnifiedMindMapAppearance\(\)[\s\S]*updateKeyboardFocusClass\(\)[\s\S]*applySegmentNodeStyles\(\)[\s\S]*renderBilinkBadges\(\)/,
    )
    expect(hostSource).toMatch(
      /window\.\$bus\.\$on\('app_inited'[\s\S]*renderBilinkBadges\(\)[\s\S]*scheduleMindMapResizeSync\(\)[\s\S]*getHostBridge\(\)\?\.notify\?\.\('app_inited', null\)/,
    )
    expect(hostSource).toMatch(
      /function applyPaperNodeStyle\(node\)[\s\S]*applyPaperNodeTextStyle\(node, style\)/,
    )
  })

  it('keeps medium-length imported Chinese cards on the wider default width path', () => {
    const hostSource = readHostRuntimeSource()

    expect(hostSource).toContain('const HOST_IMPORTED_NODE_AUTO_WIDTH_THRESHOLD = 12')
    expect(hostSource).toContain('const HOST_IMPORTED_NODE_LEGACY_MEDIUM_TEXT_WIDTH = 132')
    expect(hostSource).toContain('const HOST_IMPORTED_NODE_MEASURE_PADDING = 28')
    expect(hostSource).toContain('function getImportedNodeMeasureContext()')
    expect(hostSource).toContain('function measureImportedNodeTextWidth(plainText)')
    expect(hostSource).toContain('function hasLegacyImportedMediumTextWidth(value)')
    expect(hostSource).toMatch(
      /function resolveImportedNodeTextWidth\(plainText\)[\s\S]*if \(textLength < HOST_IMPORTED_NODE_AUTO_WIDTH_THRESHOLD\) return null[\s\S]*const measuredTextWidth = measureImportedNodeTextWidth\(plainText\)[\s\S]*const desiredWidth = measuredTextWidth \+ HOST_IMPORTED_NODE_MEASURE_PADDING[\s\S]*if \(textLength >= 78 \|\| desiredWidth > HOST_IMPORTED_NODE_WIDE_TEXT_WIDTH\) \{[\s\S]*return HOST_IMPORTED_NODE_EXTRA_WIDE_TEXT_WIDTH[\s\S]*if \(textLength >= 34 \|\| desiredWidth > HOST_IMPORTED_NODE_LEGACY_MEDIUM_TEXT_WIDTH\) \{[\s\S]*return HOST_IMPORTED_NODE_WIDE_TEXT_WIDTH[\s\S]*return null/,
    )
    expect(hostSource).toMatch(
      /function normalizeImportedNodePresentation\(node, depth = 0\)[\s\S]*const targetWidth = resolveImportedNodeTextWidth\(plainText\)[\s\S]*currentCustomTextWidth !== targetWidth[\s\S]*hasLegacyMediumTextWidth \|\| Number\.isFinite\(currentCustomTextWidth\)[\s\S]*delete data\.customTextWidth/,
    )
  })

  it('does not infer review placeholder colors from legacy text-width metadata', () => {
    const hostSource = readHostRuntimeSource()
    const reviewRoleSection =
      hostSource.match(/function getPaperReviewRole\(data, isRoot\)[\s\S]*?function buildPaperNodeStyle/)?.[0] ?? ''

    expect(reviewRoleSection).not.toContain('customTextWidth')
  })

  it('suppresses native pan during right-button selection drag and prefers node bodies over slot gaps', () => {
    const hostSource = readHostRuntimeSource()
    const dragIntentSection =
      hostSource.match(/function buildSelectionDragIntent\(\)[\s\S]*?function updateSelectionDragPreview/)?.[0] ?? ''

    expect(hostSource).toContain('ownsPointerSequence: false')
    expect(hostSource).toContain('pointerCaptureElement: null')
    expect(hostSource).toContain('function ownsSelectionDragPointer(event)')
    expect(hostSource).toContain('function tryCaptureSelectionDragPointer(event)')
    expect(hostSource).toContain('function suppressSelectionDragNativePointerEvent(event, options = {})')
    expect(hostSource).toMatch(
      /document\.addEventListener\(\s*'lostpointercapture'[\s\S]*resetSelectionDragState\(\)/,
    )
    expect(hostSource).toMatch(
      /window\.addEventListener\('blur'[\s\S]*selectionDragState\.ownsPointerSequence[\s\S]*resetSelectionDragState\(\)/,
    )
    expect(hostSource).toMatch(
      /document\.addEventListener\('visibilitychange'[\s\S]*selectionDragState\.ownsPointerSequence[\s\S]*resetSelectionDragState\(\)/,
    )
    expect(hostSource).toMatch(
      /function shouldSuppressSelectionDragContextMenu\(\)[\s\S]*selectionDragState\.stage === 'pending' \|\| selectionDragState\.stage === 'dragging'/,
    )
    expect(hostSource).toMatch(
      /document\.addEventListener\(\s*'pointerdown'[\s\S]*suppressSelectionDragNativePointerEvent\(event, \{ capturePointer: true \}\)/,
    )
    expect(hostSource).toMatch(
      /document\.addEventListener\(\s*'pointermove'[\s\S]*suppressSelectionDragNativePointerEvent\(event\)/,
    )
    expect(hostSource).toMatch(
      /document\.addEventListener\(\s*'pointerup'[\s\S]*suppressSelectionDragNativePointerEvent\(event\)/,
    )
    expect(hostSource).toContain(
      'function buildSelectionDragChildIntent(layouts, pointerX, pointerY, excludedNodeUids = null)',
    )
    expect(hostSource).toContain('function getNodeBodyRect(nodeOrUid)')
    expect(hostSource).toContain('bodyRect: isMeaningfulClientRect(bodyRect) ? bodyRect : rect')
    expect(hostSource).toContain('excludedNodeUids?.has(layout.uid)')
    expect(hostSource).toContain('return pointInRect(layout.bodyRect || layout.rect, pointerX, pointerY)')
    expect(hostSource).toContain(
      'function collectSelectionDragExcludedNodeUids(node, excluded = new Set(), includeSelf = false)',
    )
    expect(hostSource).toContain('if (uid && includeSelf)')
    expect(hostSource).toContain('node.children.forEach(child => collectSelectionDragExcludedNodeUids(child, excluded, true))')
    expect(dragIntentSection.indexOf('const childIntent = buildSelectionDragChildIntent(')).toBeGreaterThan(-1)
    expect(dragIntentSection.indexOf('const slotBands = buildSelectionDragSiblingSlotBands(layouts)')).toBeGreaterThan(-1)
    expect(
      dragIntentSection.indexOf('const childIntent = buildSelectionDragChildIntent('),
    ).toBeLessThan(dragIntentSection.indexOf('const slotBands = buildSelectionDragSiblingSlotBands(layouts)'))
  })

  it('keeps source node eligible as a child target while excluding descendants in host runtime source', () => {
    const hostSource = readHostRuntimeSource()

    expect(hostSource).toContain('const excludedNodeUids = collectSelectionDragExcludedNodeUids(sourceNode)')
    expect(hostSource).not.toContain('excluded.add(uid)\n        }\n        if (Array.isArray(node.children)) {\n          node.children.forEach(child => collectSelectionDragExcludedNodeUids(child, excluded))')
    expect(hostSource).toMatch(
      /function collectSelectionDragExcludedNodeUids\(node, excluded = new Set\(\), includeSelf = false\)[\s\S]*if \(uid && includeSelf\) \{[\s\S]*node\.children\.forEach\(child => collectSelectionDragExcludedNodeUids\(child, excluded, true\)\)/,
    )
  })

  it('keeps only minimal utility controls inside the hosted mind map runtime', () => {
    const hostSource = readHostRuntimeSource()

    expect(hostSource).toContain('.memory-anki-restore-ui-button')
    expect(hostSource).toContain('.memory-anki-exit-fullscreen-button')
    expect(hostSource).toMatch(
      /\.sidebarTriggerContainer,[\s\S]*\.navigatorContainer[\s\S]*display: none !important/,
    )
    expect(hostSource).not.toContain('function ensureSegmentToolbar()')
    expect(hostSource).toContain('window.setUiCleared = setUiCleared')
    expect(hostSource).toContain('window.exitNativeFullscreen = exitNativeFullscreenIfNeeded')
  })

  it('keeps mini palace runtime support inside the host interaction layer', () => {
    const hostSource = readHostRuntimeSource()

    expect(hostSource).toContain('lastHoveredNodeUid')
    expect(hostSource).toContain('function getMiniPalaceDraft()')
    expect(hostSource).toContain('function applyMiniPalaceNodeStyles()')
    expect(hostSource).toMatch(
      /function registerReadonlyClickListener[\s\S]*getMiniPalaceDraft\(\)[\s\S]*mini_palace_select_toggle/,
    )
    expect(hostSource).toMatch(
      /function registerContextMenuListener[\s\S]*getMiniPalaceDraft\(\)/,
    )
    expect(hostSource).toMatch(
      /function registerReadonlyHoverListener\(\)[\s\S]*notify\?\.\('node_hover', \[serializeNode\(node\)\]\)/,
    )
    expect(hostSource).toMatch(
      /if \(event\.key === ' ' \|\| event\.code === 'Space'\) \{[\s\S]*if \(!interactionState\.lastHoveredNodeUid\) return[\s\S]*notify\?\.\('mini_palace_pour', null\)/,
    )
  })

  it('keeps host utility buttons wired to fullscreen exit and ui clear notifications', () => {
    const hostSource = readHostRuntimeSource()

    expect(hostSource).toContain("button.className = 'memory-anki-restore-ui-button'")
    expect(hostSource).toContain("button.className = 'memory-anki-exit-fullscreen-button'")
    expect(hostSource).toContain("button.textContent = '退全屏'")
    expect(hostSource).toContain("getHostBridge()?.notify?.('ui_cleared_change', uiChromeState.cleared)")
    expect(hostSource).toContain('const fullscreenActive = Boolean(document.fullscreenElement) || immersiveToggleState.parentFullscreenActive')
    expect(hostSource).toContain('button.hidden = !fullscreenActive')
  })

  it('runs a resize-aware redraw and fit when the host viewport changes', () => {
    const hostSource = readHostRuntimeSource()

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
    const hostSource = readHostRuntimeSource()

    expect(hostSource).toContain('pendingFocusRequest')
    expect(hostSource).toContain('function centerNodeInViewport(node)')
    expect(hostSource).toContain('mindMap.view.translateXY(deltaX, deltaY)')
    expect(hostSource).toMatch(
      /function restorePendingFocusRequestIfNeeded\(options = {}\)[\s\S]*options\.clearOnSuccess !== false/,
    )
    expect(hostSource).toContain(
      'restorePendingFocusRequestIfNeeded({ clearOnSuccess: false })',
    )
    expect(hostSource).toMatch(
      /restorePendingViewMemoryFocusIfNeeded\(\)[\s\S]*restorePendingSyncFocusIfNeeded\(\)[\s\S]*restorePendingFocusRequestIfNeeded\(\)/,
    )
  })

  it('forwards mini palace draft state without toolbar-only visibility flags', async () => {
    render(
      <MindMapFrame
        editorState={buildEditorState()}
        miniPalaceDraft={{ active: true, selectedNodeUids: ['node-1'] }}
        onEditorStateChange={vi.fn()}
      />,
    )
    const iframe = screen.getByTitle('mind-map-editor') as HTMLIFrameElement
    const bridgeMocks = attachIframeBridge(iframe)

    await waitFor(() => {
      expect(bridgeMocks.applyHostState).toHaveBeenCalledWith(
        expect.objectContaining({
          miniPalaceDraft: {
            active: true,
            selectedNodeUids: ['node-1'],
          },
        }),
      )
    })
  })

  it('exposes host utility commands through the frame ref', async () => {
    const ref = { current: null as import('./MindMapFrame').MindMapFrameHandle | null }

    render(
      <MindMapFrame
        ref={ref}
        editorState={buildEditorState()}
        onEditorStateChange={vi.fn()}
      />,
    )
    const iframe = screen.getByTitle('mind-map-editor') as HTMLIFrameElement
    const bridgeMocks = attachIframeBridge(iframe)

    await waitFor(() => {
      expect(bridgeMocks.applyHostState).toHaveBeenCalled()
    })
    const resizeDispatchCountBeforeFullscreen = bridgeMocks.dispatchEvent.mock.calls.length

    await act(async () => {
      ref.current?.setUiCleared(true)
      ref.current?.toggleUiCleared()
      await ref.current?.enterNativeFullscreen()
      expect(iframe.classList.contains('memory-anki-mindmap-native-fullscreen')).toBe(true)
      await ref.current?.exitNativeFullscreen()
    })

    expect(bridgeMocks.setUiCleared).toHaveBeenCalledWith(true)
    expect(bridgeMocks.toggleUiCleared).toHaveBeenCalledTimes(1)
    expect(iframe.classList.contains('memory-anki-mindmap-native-fullscreen')).toBe(false)
    expect(bridgeMocks.dispatchEvent.mock.calls.length).toBeGreaterThanOrEqual(
      resizeDispatchCountBeforeFullscreen + 2,
    )
  })

  it('reapplies current host state when a runtime event promotes a host that missed app_inited', async () => {
    render(
      <MindMapFrame
        editorState={buildEditorState()}
        readonly
        practiceModeActive
        onEditorStateChange={vi.fn()}
      />,
    )
    const iframe = screen.getByTitle('mind-map-editor') as HTMLIFrameElement
    const bridgeMocks = attachIframeBridge(iframe)

    await waitFor(() => {
      expect(bridgeMocks.applyHostState).toHaveBeenCalledWith(
        expect.objectContaining({
          readonly: true,
          practiceModeActive: true,
        }),
      )
    })

    bridgeMocks.applyHostState.mockClear()

    await act(async () => {
      getHostBridge()?.notify?.('node_click', [{ uid: 'root-1', text: '根节点' }])
    })

    expect(bridgeMocks.applyHostState).toHaveBeenCalledWith(
      expect.objectContaining({
        readonly: true,
        practiceModeActive: true,
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
    ).toBe('2026-06-10-card-width-drag-fix')
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
