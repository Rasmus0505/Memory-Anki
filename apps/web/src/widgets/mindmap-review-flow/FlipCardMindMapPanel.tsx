import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, CornerUpLeft, Eye, Network } from 'lucide-react'
import {
  MindMapEditorSurface,
  type MindMapEditorSurfaceHandle,
  type MindMapEditorSurfaceProps,
  type MindMapPageToolbarProps,
  type MindMapSelection,
} from '@/modules/content/public'
import type { MindMapEditorState } from '@/shared/api/contracts'
import type { MindMapReviewFxPayload } from '@/modules/content/public'
import { cn } from '@/shared/lib/utils'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { detectClientSource } from '@/shared/lib/clientSource'
import { resolveMindMapSceneChrome } from '@/shared/ui/mindmap-canvas'
import { stripMindMapHtml } from '@/shared/lib/mindmapRichText'
import { buildFlipCardToolbar } from './buildFlipCardToolbar'
import {
  buildGuidedMindMapModel,
  getGuidedPath,
  toGuidedSelection,
} from './flipCardGuidedModel'
import { useMindMapEnglishMode } from './useMindMapEnglishMode'

type FlipCardToolbarExtensions = Pick<
  MindMapPageToolbarProps,
  | 'embedded'
  | 'taskControl'
  | 'searchControl'
  | 'focusAction'
  | 'fitAction'
  | 'moreActions'
  | 'segmentControl'
  | 'importMindMapAction'
  | 'importTextAction'
  | 'englishAction'
>

type FlipCardSurfaceExtensions = Pick<
  MindMapEditorSurfaceProps,
  | 'segments'
  | 'activeSegmentId'
  | 'segmentColorMode'
  | 'segmentRangeDraft'
  | 'highlightedNodeUids'
  | 'statusChipsByNodeUid'
  | 'ankiEditMode'
  | 'mutedNodeUids'
  | 'masteryByNodeUid'
  | 'countBadgeByNodeUid'
  | 'onCountBadgeClick'
  | 'confirmDeleteNodes'
  | 'focusRequestNodeUid'
  | 'focusRequestNonce'
  | 'feedbackFxSignal'
  | 'presentationStrategy'
  | 'aiSplitBusy'
  | 'onAiSplitRequest'
  | 'onSegmentSelect'
  | 'onCreateSegmentFromSelection'
  | 'onSegmentRangeDraftChange'
  | 'onSegmentRangeModeToggle'
  | 'onSegmentRangeConfirm'
>

export interface FlipCardMindMapPanelProps extends FlipCardSurfaceExtensions {
  fullscreen: boolean
  displayMode?: 'review' | 'edit'
  sessionKind?: 'review' | 'practice'
  modeSyncVersion?: number
  viewMemoryScope?: string | null
  className?: string
  surfaceClassName?: string
  toolbarExtensions?: FlipCardToolbarExtensions
  /** When true, hide 网页内全屏 / 系统全屏 / 清屏 from the overflow menu only (features stay available). */
  hidePresentationOverflowActions?: boolean
  /**
   * compact: freestyle/PWA — denser mobile guided rail so the map keeps height.
   */
  chromeDensity?: 'default' | 'compact'
  onToggleFullscreen: (active?: boolean) => void
  onToggleMode?: () => void
  /** Defaults: enter edit "编辑", leave edit "复习". Freestyle uses "返回随心". */
  modeToggleLabels?: {
    enterEdit?: string
    leaveEdit?: string
  }
  visibleEditorState: MindMapEditorState
  editableEditorState?: MindMapEditorState | null
  visibleEditorSyncKey?: string | number | null
  /** Shared host identity across build/learn so ReactFlow/fullscreen are not rebuilt on mode switch. */
  hostForceSyncKey?: string | number | null
  hostExternalSyncKey?: string | number | null
  preserveViewOnSync?: boolean
  initialViewPolicy?: 'preserve' | 'reset'
  forceSyncIntent?: 'soft' | 'replace'
  currentPalaceId?: number | null
  reviewFxSignal?: MindMapReviewFxPayload | null
  onEditorStateChange?: (nextState: MindMapEditorState) => void
  onNodeClick: (nodes: MindMapSelection[]) => void
  onNodeContextMenu: (nodes: MindMapSelection[]) => void
  onEditNodeClick?: (nodes: MindMapSelection[]) => void
  onEditNodeContextMenu?: (nodes: MindMapSelection[]) => void
  onNodeActive?: (nodes: MindMapSelection[]) => void
  onNodeHover?: (nodes: MindMapSelection[]) => void
  onQuizBreakOpen?: () => void
  onNativeFullscreenChange?: (active: boolean) => void
  onUiClearedChange?: (active: boolean) => void
  /**
   * Current permanent-mark unit membership. Nodes outside the unit are dimmed,
   * while ancestors remain visible as path context.
   */
  activeUnitNodeUids?: string[] | null
}

export const FlipCardMindMapPanel = forwardRef<MindMapEditorSurfaceHandle, FlipCardMindMapPanelProps>(function FlipCardMindMapPanel({
  fullscreen,
  displayMode = 'review',
  sessionKind = 'practice',
  modeSyncVersion = 0,
  viewMemoryScope = null,
  className,
  surfaceClassName,
  toolbarExtensions,
  hidePresentationOverflowActions = false,
  chromeDensity = 'default',
  onToggleFullscreen,
  onToggleMode,
  modeToggleLabels,
  visibleEditorState,
  editableEditorState = null,
  visibleEditorSyncKey = null,
  hostForceSyncKey = null,
  hostExternalSyncKey = null,
  preserveViewOnSync,
  initialViewPolicy,
  forceSyncIntent,
  currentPalaceId = null,
  reviewFxSignal = null,
  onEditorStateChange,
  onNodeClick,
  onNodeContextMenu,
  onEditNodeClick,
  onEditNodeContextMenu,
  onNodeActive,
  onNodeHover,
  onQuizBreakOpen,
  onNativeFullscreenChange,
  onUiClearedChange,
  masteryByNodeUid,
  countBadgeByNodeUid,
  onCountBadgeClick,
  confirmDeleteNodes,
  focusRequestNodeUid,
  focusRequestNonce,
  feedbackFxSignal,
  presentationStrategy,
  aiSplitBusy = false,
  onAiSplitRequest,
  onSegmentSelect,
  onCreateSegmentFromSelection,
  onSegmentRangeDraftChange,
  onSegmentRangeModeToggle,
  onSegmentRangeConfirm,
  activeUnitNodeUids = null,
  segments,
  activeSegmentId,
  segmentColorMode,
  segmentRangeDraft,
  highlightedNodeUids,
  statusChipsByNodeUid: hostStatusChipsByNodeUid,
  ankiEditMode = false,
  mutedNodeUids: mutedNodeUidsProp,
}: FlipCardMindMapPanelProps, forwardedRef) {
  const navigate = useNavigate()
  const resolvedPresentationStrategy = presentationStrategy
    ?? (detectClientSource() === 'pwa' ? 'viewport-only' : 'native-preferred')
  const frameRef = useRef<MindMapEditorSurfaceHandle | null>(null)
  const onNativeFullscreenChangeRef = useRef(onNativeFullscreenChange)
  const onUiClearedChangePropRef = useRef(onUiClearedChange)
  onNativeFullscreenChangeRef.current = onNativeFullscreenChange
  onUiClearedChangePropRef.current = onUiClearedChange
  const [nativeFullscreenActive, setNativeFullscreenActive] = useState(false)
  const [uiCleared, setUiCleared] = useState(false)
  const [hostReadyTimedOut, setHostReadyTimedOut] = useState(false)
  const [activeGuidedUid, setActiveGuidedUid] = useState<string | null>(null)
  const isEditMode = displayMode === 'edit'
  const {
    englishModeActive,
    handleToggleEnglishMode,
    handleEnglishWordClick,
    readingContentRef,
    handleReadingContentPointerDown,
    englishChrome,
    aiRunConfigDialog,
  } = useMindMapEnglishMode()
  const sceneChrome = resolveMindMapSceneChrome({
    mode: isEditMode ? 'edit' : sessionKind === 'review' ? 'review' : 'practice',
    ratingMode: false,
  })

  useImperativeHandle(forwardedRef, () => ({
    setUiCleared: (nextValue) => frameRef.current?.setUiCleared(nextValue),
    toggleUiCleared: () => frameRef.current?.toggleUiCleared(),
    focusNode: (nodeUid) => frameRef.current?.focusNode(nodeUid),
    fitView: () => frameRef.current?.fitView(),
    enterFullscreen: () => frameRef.current?.enterFullscreen() ?? Promise.resolve(),
    exitFullscreen: () => frameRef.current?.exitFullscreen() ?? Promise.resolve(),
    enterNativeFullscreen: () => frameRef.current?.enterNativeFullscreen() ?? Promise.resolve(),
    exitNativeFullscreen: () => frameRef.current?.exitNativeFullscreen() ?? Promise.resolve(),
  }), [])

  const frameEditorState = isEditMode && editableEditorState ? editableEditorState : visibleEditorState
  // Prefer a host-stable key so review/edit/learn toggles do not remount the canvas provider.
  // modeSyncVersion only bumps soft content identity — never force a ReactFlow recovery remount.
  const frameForceSyncKey = hostForceSyncKey ?? undefined
  const frameExternalSyncKey = isEditMode
    ? (hostExternalSyncKey ?? (modeSyncVersion > 0 ? `mode-sync:${modeSyncVersion}` : null))
    : (visibleEditorSyncKey ?? hostExternalSyncKey ?? (modeSyncVersion > 0 ? `mode-sync:${modeSyncVersion}` : null))
  // Mode switches re-layout the tree; keep camera continuity and re-anchor the center card.
  const framePreserveViewOnSync = preserveViewOnSync ?? true
  const frameInitialViewPolicy = initialViewPolicy ?? 'preserve'
  const frameForceSyncIntent = forceSyncIntent ?? 'soft'
  const frameSceneTransitionKey = `${sceneChrome}:${isEditMode ? 'edit' : 'review'}:${sessionKind}`
  const guidedModel = useMemo(() => buildGuidedMindMapModel(frameEditorState), [frameEditorState])
  const guidedCurrentUid =
    activeGuidedUid && guidedModel.byUid.has(activeGuidedUid)
      ? activeGuidedUid
      : guidedModel.rootUid
  const guidedCurrentIndex = guidedCurrentUid
    ? guidedModel.nodes.findIndex((node) => node.uid === guidedCurrentUid)
    : -1
  const guidedCurrentNode = guidedCurrentUid
    ? guidedModel.byUid.get(guidedCurrentUid) ?? null
    : null
  const guidedParentNode = guidedCurrentNode?.parentUid
    ? guidedModel.byUid.get(guidedCurrentNode.parentUid) ?? null
    : null
  const guidedNextNode =
    guidedCurrentIndex >= 0
      ? guidedModel.nodes[guidedCurrentIndex + 1] ?? null
      : guidedModel.nodes[0] ?? null
  const guidedPath = useMemo(
    () => getGuidedPath(guidedModel.byUid, guidedCurrentUid),
    [guidedCurrentUid, guidedModel.byUid],
  )

  const selectGuidedNode = useCallback((nodeUid: string | null, options?: { syncCanvas?: boolean }) => {
    if (!nodeUid) return
    setActiveGuidedUid(nodeUid)
    if (options?.syncCanvas) frameRef.current?.focusNode?.(nodeUid)
    const node = guidedModel.byUid.get(nodeUid)
    if (node) onNodeActive?.([toGuidedSelection(node)])
  }, [guidedModel.byUid, onNodeActive])

  const activeUnitUidSet = useMemo(() => {
    if (!activeUnitNodeUids || activeUnitNodeUids.length === 0) return null
    return new Set(activeUnitNodeUids.filter(Boolean))
  }, [activeUnitNodeUids])

  const unitScopeMutedUids = useMemo(() => {
    if (isEditMode || !activeUnitUidSet) return [] as string[]
    const keepFullOpacity = new Set<string>(activeUnitUidSet)
    for (const uid of activeUnitUidSet) {
      let current = guidedModel.byUid.get(uid)
      while (current?.parentUid) {
        keepFullOpacity.add(current.parentUid)
        current = guidedModel.byUid.get(current.parentUid)
      }
    }
    return guidedModel.nodes
      .map((node) => node.uid)
      .filter((uid) => uid !== guidedModel.rootUid && !keepFullOpacity.has(uid))
  }, [
    guidedModel.byUid,
    guidedModel.nodes,
    guidedModel.rootUid,
    activeUnitUidSet,
    isEditMode,
  ])

  const resolvedMutedNodeUids = useMemo(() => {
    if (!mutedNodeUidsProp?.length) return unitScopeMutedUids
    if (!unitScopeMutedUids.length) return mutedNodeUidsProp
    return [...new Set([...mutedNodeUidsProp, ...unitScopeMutedUids])]
  }, [mutedNodeUidsProp, unitScopeMutedUids])

  useEffect(() => {
    if (!guidedCurrentUid || activeGuidedUid === guidedCurrentUid) return
    setActiveGuidedUid(guidedCurrentUid)
  }, [activeGuidedUid, guidedCurrentUid])

  const handleGuidedGlobal = useCallback(() => {
    selectGuidedNode(guidedModel.rootUid, { syncCanvas: true })
    frameRef.current?.fitView?.()
  }, [guidedModel.rootUid, selectGuidedNode])

  const handleGuidedReveal = useCallback(() => {
    if (!guidedCurrentNode) return
    setActiveGuidedUid(guidedCurrentNode.uid)
    onNodeClick([toGuidedSelection(guidedCurrentNode)])
  }, [guidedCurrentNode, onNodeClick])

  const handleGuidedNext = useCallback(() => {
    if (!guidedNextNode) return
    selectGuidedNode(guidedNextNode.uid, { syncCanvas: true })
  }, [guidedNextNode, selectGuidedNode])

  const handlePanelNodeClick = useCallback((nodes: MindMapSelection[]) => {
    if (englishModeActive) return
    onNodeClick(nodes)
  }, [englishModeActive, onNodeClick])

  const handleNodeActive = useCallback(
    (nodes: MindMapSelection[]) => {
      const nextUid = nodes[0]?.uid ?? null
      if (nextUid) setActiveGuidedUid(nextUid)
      onNodeActive?.(nodes)
    },
    [onNodeActive],
  )

  const handleOpenQuizPage = useCallback(() => {
    if (onQuizBreakOpen) {
      onQuizBreakOpen()
      return
    }
    if (!currentPalaceId) return
    navigate(`/palaces/${currentPalaceId}/quiz`)
  }, [currentPalaceId, navigate, onQuizBreakOpen])

  const handleSurfaceFullscreenChange = useCallback((active: boolean) => {
    setNativeFullscreenActive(active)
    onNativeFullscreenChangeRef.current?.(active)
  }, [])

  const handleSurfaceUiClearedChange = useCallback((active: boolean) => {
    setUiCleared(active)
    onUiClearedChangePropRef.current?.(active)
  }, [])

  const handleSurfaceReady = useCallback(() => {
    setHostReadyTimedOut(false)
  }, [])

  const handleSurfaceReadyTimeout = useCallback(() => {
    setHostReadyTimedOut(true)
  }, [])

  const compactChrome = chromeDensity === 'compact'

  return (
    <div
      className={cn('flex h-full min-h-0 flex-col', fullscreen && 'flex h-full flex-col', className)}
      data-english-mode={englishModeActive ? 'true' : 'false'}
    >
      {/* compact freestyle: no second guided rail — tap nodes to reveal; map toolbar is enough.
          default density keeps the mobile guided path + 上级/下一个/揭示/全局 rail. */}
      {!isEditMode && !compactChrome ? (
        <div
          className={cn(
            // text-foreground: avoid inheriting light shell text onto light chrome (PWA freestyle).
            'mb-3 shrink-0 space-y-2 rounded-xl border border-border/70 bg-background/95 p-2 text-foreground shadow-sm md:hidden',
          )}
        >
          <div className="flex min-h-9 items-center gap-1 overflow-hidden px-1 text-xs text-muted-foreground">
            {guidedPath.length > 0 ? (
              guidedPath.map((node, index) => (
                <span key={node.uid} className="inline-flex min-w-0 items-center gap-1">
                  {index > 0 ? <span className="shrink-0 text-muted-foreground/50">/</span> : null}
                  <span
                    className={cn(
                      'max-w-[8rem] truncate',
                      index === guidedPath.length - 1 && 'font-medium text-foreground',
                    )}
                  >
                    {stripMindMapHtml(node.text)}
                  </span>
                </span>
              ))
            ) : (
              <span className="truncate">未命名导图</span>
            )}
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="min-h-11 px-1 text-xs"
              disabled={!guidedParentNode}
              onClick={() => selectGuidedNode(guidedParentNode?.uid ?? null, { syncCanvas: true })}
            >
              <CornerUpLeft className="size-4" />上级
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="min-h-11 px-1 text-xs"
              disabled={!guidedNextNode}
              onClick={handleGuidedNext}
            >
              <ArrowRight className="size-4" />下一个
            </Button>
            <Button
              type="button"
              size="sm"
              className="min-h-11 px-1 text-xs"
              disabled={!guidedCurrentNode}
              onClick={handleGuidedReveal}
            >
              <Eye className="size-4" />揭示
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="min-h-11 px-1 text-xs"
              onClick={handleGuidedGlobal}
            >
              <Network className="size-4" />全局
            </Button>
          </div>
        </div>
      ) : null}
      {hostReadyTimedOut ? (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
          <span>脑图宿主初始化偏慢，已继续等待。若长时间不显示，可先返回后重新进入。</span>
          <Badge className="bg-warning text-white hover:bg-warning">宿主超时</Badge>
        </div>
      ) : null}
      <div
        ref={readingContentRef}
        className="flex min-h-0 flex-1 flex-col"
        onPointerDown={englishModeActive ? handleReadingContentPointerDown : undefined}
      >
      <MindMapEditorSurface
        ref={frameRef}
        editorState={frameEditorState}
        presentationStrategy={resolvedPresentationStrategy}
        readonly={!isEditMode}
        practiceModeActive={!isEditMode}
        englishInteractionActive={englishModeActive}
        onEnglishWordClick={englishModeActive ? handleEnglishWordClick : undefined}
        sceneChrome={sceneChrome}
        sceneTransitionKey={frameSceneTransitionKey}
        viewMemoryScope={viewMemoryScope}
        immersiveModeActive={fullscreen}
        toolbarContent={buildFlipCardToolbar({
          toolbarExtensions,
          isEditMode,
          englishModeActive,
          fullscreen,
          uiCleared,
          nativeFullscreenActive,
          hidePresentationOverflowActions,
          resolvedPresentationStrategy,
          currentPalaceId,
          modeToggleLabels,
          frameRef,
          onToggleMode,
          onToggleEnglishMode: handleToggleEnglishMode,
          onOpenQuizPage: handleOpenQuizPage,
          onToggleFullscreen,
        })}
        syncOnPropChange
        syncIntent="soft"
        preserveViewOnSync={framePreserveViewOnSync}
        syncReason={isEditMode ? null : 'review_flip'}
        externalSyncKey={frameExternalSyncKey}
        forceSyncKey={frameForceSyncKey}
        forceSyncIntent={frameForceSyncIntent}
        initialViewPolicy={frameInitialViewPolicy}
        mobileViewPolicy={isEditMode ? 'map' : 'auto'}
        nodeClickViewportPolicy={isEditMode ? 'guided-center' : 'preserve'}
        reviewFxSignal={reviewFxSignal}
        feedbackFxSignal={feedbackFxSignal}
        aiSplitBusy={aiSplitBusy}
        segments={segments}
        activeSegmentId={activeSegmentId}
        segmentColorMode={segmentColorMode}
        segmentRangeDraft={segmentRangeDraft}
        highlightedNodeUids={highlightedNodeUids}
        ankiEditMode={ankiEditMode}
        mutedNodeUids={resolvedMutedNodeUids}
        masteryByNodeUid={masteryByNodeUid}
        statusChipsByNodeUid={hostStatusChipsByNodeUid}
        countBadgeByNodeUid={countBadgeByNodeUid}
        onCountBadgeClick={onCountBadgeClick}
        selectionToolbarPreferPosition="bottom"
        focusRequestNodeUid={focusRequestNodeUid}
        focusRequestNonce={focusRequestNonce}
        onEditorStateChange={isEditMode && onEditorStateChange ? onEditorStateChange : () => {}}
        confirmDeleteNodes={isEditMode ? confirmDeleteNodes : undefined}
        onNodeActive={handleNodeActive}
        onNodeClick={isEditMode ? onEditNodeClick : handlePanelNodeClick}
        onNodeContextMenu={
          isEditMode
            ? onEditNodeContextMenu
            : onNodeContextMenu
        }
        onNodeHover={isEditMode ? undefined : onNodeHover}
        onSegmentSelect={onSegmentSelect}
        onCreateSegmentFromSelection={onCreateSegmentFromSelection}
        onSegmentRangeDraftChange={onSegmentRangeDraftChange}
        onSegmentRangeModeToggle={onSegmentRangeModeToggle}
        onSegmentRangeConfirm={onSegmentRangeConfirm}
        onAiSplitRequest={onAiSplitRequest}
        onFullscreenToggle={onToggleFullscreen}
        onFullscreenChange={handleSurfaceFullscreenChange}
        onUiClearedChange={handleSurfaceUiClearedChange}
        onReady={handleSurfaceReady}
        onReadyTimeout={handleSurfaceReadyTimeout}
        className={cn(
          'w-full rounded-lg border border-border/70 bg-background',
          fullscreen || compactChrome ? 'min-h-0 flex-1' : 'h-[64vh]',
          surfaceClassName,
        )}
      />
      </div>
      {englishChrome}
      {aiRunConfigDialog}
    </div>
  )
})
