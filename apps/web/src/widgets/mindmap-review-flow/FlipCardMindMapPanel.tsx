import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, CornerUpLeft, Eye, Network } from 'lucide-react'
import {
  MindMapEditorSurface,
  MindMapPageToolbar,
  type MindMapEditorSurfaceHandle,
  type MindMapEditorSurfaceProps,
  type MindMapPageToolbarProps,
  type MindMapSelection,
} from '@/modules/content/public'
import type { MindMapEditorState, MindMapRecallRating, MindMapRecallRound } from '@/shared/api/contracts'
import type { MindMapReviewFxPayload } from '@/modules/content/public'
import { listMindMapNodeMasteryApi } from '@/modules/content/public'
import { cn } from '@/shared/lib/utils'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { detectClientSource } from '@/shared/lib/clientSource'
import { resolveMindMapSceneChrome } from '@/shared/ui/mindmap-canvas'
import {
  buildGuidedMindMapModel,
  getGuidedPath,
  toGuidedSelection,
} from './flipCardGuidedModel'
import { RatingSubtreeConflictOverlay } from './RatingSubtreeConflictOverlay'
import {
  useFlipCardRatingControls,
  type FlipCardRateNodeHandler,
} from './useFlipCardRatingControls'

type FlipCardToolbarExtensions = Pick<
  MindMapPageToolbarProps,
  | 'embedded'
  | 'taskControl'
  | 'searchControl'
  | 'focusAction'
  | 'fitAction'
  | 'ratingAction'
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
  | 'mutedNodeUids'
  | 'masteryByNodeUid'
  | 'countBadgeByNodeUid'
  | 'onCountBadgeClick'
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
  onToggleFullscreen: (active?: boolean) => void
  onToggleMode?: () => void
  visibleEditorState: MindMapEditorState
  editableEditorState?: MindMapEditorState | null
  /**
   * Full palace document used only for rating scope / subtree cascade.
   * Must not be the reveal-filtered visible tree, or unrevealed children are treated as leaves.
   */
  ratingTreeEditorState?: MindMapEditorState | null
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
  recallRatings?: Map<string, MindMapRecallRating>
  recallRound?: MindMapRecallRound
  weakNodeUids?: string[]
  directRatedUids?: ReadonlySet<string>
  /** Any node scored this round (direct or batch_inherited); drives 避开 conflict counts. */
  sessionRatedUids?: ReadonlySet<string>
  /**
   * Formal due-scope UIDs for this review round. When set in rating mode:
   * only these nodes may *start* a rating; others are muted/translucent.
   * Parent subtree cascade still walks the full rating tree (including
   * unrevealed due children) and follows backend formal-review behavior.
   */
  rateableNodeUids?: string[] | null
  onRateNode?: FlipCardRateNodeHandler
  onUndoRating?: () => { node_uid: string } | null
  onOpenRatingHistory?: () => void
  ratingMode?: boolean
  onToggleRatingMode?: () => void
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
  onToggleFullscreen,
  onToggleMode,
  visibleEditorState,
  editableEditorState = null,
  ratingTreeEditorState = null,
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
  recallRatings = new Map(),
  recallRound = 'first',
  weakNodeUids = [],
  directRatedUids,
  sessionRatedUids,
  rateableNodeUids = null,
  onRateNode,
  onUndoRating,
  onOpenRatingHistory,
  ratingMode = false,
  onToggleRatingMode,
  segments,
  activeSegmentId,
  segmentColorMode,
  segmentRangeDraft,
  highlightedNodeUids,
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
  const [longTermMasteryByUid, setLongTermMasteryByUid] = useState<
    Record<string, { masteryScore: number; status: string }>
  >({})
  const isEditMode = displayMode === 'edit'
  const sceneChrome = resolveMindMapSceneChrome({
    mode: isEditMode ? 'edit' : sessionKind === 'review' ? 'review' : 'practice',
    ratingMode: !isEditMode && ratingMode,
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
  // Rating cascade must walk the full document, not the reveal-filtered visible tree.
  const ratingTreeModel = useMemo(
    () =>
      buildGuidedMindMapModel(
        ratingTreeEditorState ?? editableEditorState ?? frameEditorState,
      ),
    [editableEditorState, frameEditorState, ratingTreeEditorState],
  )
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

  const rateableUidSet = useMemo(() => {
    if (!rateableNodeUids || rateableNodeUids.length === 0) return null
    return new Set(rateableNodeUids.filter(Boolean))
  }, [rateableNodeUids])

  const ratingScopeMutedUids = useMemo(() => {
    if (!ratingMode || isEditMode || !rateableUidSet) return [] as string[]
    return guidedModel.nodes
      .map((node) => node.uid)
      .filter((uid) => uid !== guidedModel.rootUid && !rateableUidSet.has(uid))
  }, [guidedModel.nodes, guidedModel.rootUid, isEditMode, rateableUidSet, ratingMode])

  const resolvedMutedNodeUids = useMemo(() => {
    if (!mutedNodeUidsProp?.length) return ratingScopeMutedUids
    if (!ratingScopeMutedUids.length) return mutedNodeUidsProp
    return [...new Set([...mutedNodeUidsProp, ...ratingScopeMutedUids])]
  }, [mutedNodeUidsProp, ratingScopeMutedUids])

  const ratingControls = useFlipCardRatingControls({
    ratingMode,
    isEditMode,
    guidedNodes: ratingTreeModel.nodes,
    rootUid: ratingTreeModel.rootUid,
    byUid: guidedModel.byUid,
    guidedCurrentNode,
    recallRound,
    directRatedUids,
    sessionRatedUids,
    rateableNodeUids: rateableUidSet,
    onRateNode,
    onUndoRating,
    onNodeActive,
    selectGuidedNode,
  })

  const ratingMasteryByNodeUid = useMemo(() => {
    const hasLongTerm = Object.keys(longTermMasteryByUid).length > 0
    if (!hasLongTerm) {
      // Keep host mastery identity stable — a fresh {} every render rebuilds graphData.
      return masteryByNodeUid
    }
    const next = { ...(masteryByNodeUid ?? {}) }
    Object.entries(longTermMasteryByUid).forEach(([uid, item]) => {
      next[uid] = {
        ...(next[uid] ?? {}),
        status: next[uid]?.status ?? item.status,
        masteryScore: item.masteryScore,
      }
    })
    return next
  }, [longTermMasteryByUid, masteryByNodeUid])

  const guidedEligibleNodes = useMemo(() => {
    const nonRoot = guidedModel.nodes.filter((node) => node.uid !== guidedModel.rootUid)
    const roundScoped =
      recallRound === 'weak_retry'
        ? nonRoot.filter((node) => weakNodeUids.includes(node.uid))
        : nonRoot
    if (!rateableUidSet) return roundScoped
    return roundScoped.filter((node) => rateableUidSet.has(node.uid))
  }, [guidedModel.nodes, guidedModel.rootUid, rateableUidSet, recallRound, weakNodeUids])

  const statusChipsByNodeUid = useMemo(() => {
    if (!ratingMode || isEditMode) return undefined
    const chips: Record<
      string,
      Array<{ text: string; tone: 'danger' | 'success' | 'warning' | 'info' | 'neutral'; style: 'filled' | 'outline' }>
    > = {}
    const sessionTone = (rating: MindMapRecallRating) =>
      rating === 1 ? 'danger' as const : rating === 2 ? 'warning' as const : rating === 3 ? 'info' as const : 'success' as const
    const sessionLabel = (rating: MindMapRecallRating) =>
      rating === 1 ? '忘记' : rating === 2 ? '困难' : rating === 3 ? '记得' : '轻松'
    const scoreTone = (score: number) =>
      score < 40 ? 'danger' as const : score < 70 ? 'warning' as const : 'success' as const

    guidedModel.nodes.forEach((node) => {
      const nodeChips: Array<{ text: string; tone: 'danger' | 'success' | 'warning' | 'info' | 'neutral'; style: 'filled' | 'outline' }> = []
      const sessionRating = recallRatings.get(node.uid)
      if (sessionRating) {
        nodeChips.push({ text: sessionLabel(sessionRating), tone: sessionTone(sessionRating), style: 'filled' })
      }
      const longTerm = longTermMasteryByUid[node.uid] ?? (
        typeof masteryByNodeUid?.[node.uid]?.masteryScore === 'number'
          ? { masteryScore: masteryByNodeUid[node.uid]!.masteryScore as number, status: masteryByNodeUid[node.uid]?.status ?? 'unknown' }
          : null
      )
      if (longTerm && Number.isFinite(longTerm.masteryScore)) {
        nodeChips.push({
          text: String(Math.round(longTerm.masteryScore)),
          tone: scoreTone(longTerm.masteryScore),
          style: 'outline',
        })
      }
      if (nodeChips.length) chips[node.uid] = nodeChips
    })
    return Object.keys(chips).length ? chips : undefined
  }, [guidedModel.nodes, isEditMode, longTermMasteryByUid, masteryByNodeUid, ratingMode, recallRatings])

  useEffect(() => {
    if (!ratingMode || isEditMode || !currentPalaceId) {
      if (!ratingMode) setLongTermMasteryByUid({})
      return
    }
    let active = true
    void listMindMapNodeMasteryApi(currentPalaceId)
      .then((response) => {
        if (!active) return
        const next: Record<string, { masteryScore: number; status: string }> = {}
        response.items.forEach((item) => {
          if (typeof item.mastery_score === 'number' && item.evidence_summary?.event_count > 0) {
            next[item.node_uid] = { masteryScore: item.mastery_score, status: item.status }
          }
        })
        setLongTermMasteryByUid(next)
      })
      .catch(() => {
        if (active) setLongTermMasteryByUid({})
      })
    return () => {
      active = false
    }
  }, [currentPalaceId, isEditMode, ratingMode])

  useEffect(() => {
    if (!guidedCurrentUid || activeGuidedUid === guidedCurrentUid) return
    setActiveGuidedUid(guidedCurrentUid)
  }, [activeGuidedUid, guidedCurrentUid])

  useEffect(() => {
    if (!onRateNode || activeGuidedUid) return
    const first = guidedEligibleNodes[0]
    if (first) selectGuidedNode(first.uid)
  }, [activeGuidedUid, guidedEligibleNodes, onRateNode, selectGuidedNode])

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
    if (ratingMode && nodes[0]?.uid) {
      selectGuidedNode(String(nodes[0].uid))
      return
    }
    onNodeClick(nodes)
  }, [onNodeClick, ratingMode, selectGuidedNode])

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

  const ratingConflictOverlay = ratingControls.pendingSubtreeRating ? (
    <RatingSubtreeConflictOverlay
      conflictCount={ratingControls.pendingSubtreeRating.conflictCount}
      onResolve={ratingControls.resolvePendingSubtreeRating}
    />
  ) : null

  return (
    <div className={cn('h-full min-h-0', fullscreen && 'flex h-full flex-col', className)}>
      {!isEditMode ? (
        <div className="mb-3 space-y-2 rounded-xl border border-border/70 bg-background/95 p-2 shadow-sm md:hidden">
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
                    {node.text}
                  </span>
                </span>
              ))
            ) : (
              <span className="truncate">未命名导图</span>
            )}
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            <Button type="button" size="sm" variant="outline" className="min-h-11 px-1 text-xs" disabled={!guidedParentNode} onClick={() => selectGuidedNode(guidedParentNode?.uid ?? null, { syncCanvas: true })}>
              <CornerUpLeft className="size-4" />上级
            </Button>
            <Button type="button" size="sm" variant="outline" className="min-h-11 px-1 text-xs" disabled={!guidedNextNode} onClick={handleGuidedNext}>
              <ArrowRight className="size-4" />下一个
            </Button>
            <Button type="button" size="sm" className="min-h-11 px-1 text-xs" disabled={!guidedCurrentNode} onClick={handleGuidedReveal}>
              <Eye className="size-4" />揭示
            </Button>
            <Button type="button" size="sm" variant="outline" className="min-h-11 px-1 text-xs" onClick={handleGuidedGlobal}>
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
      <MindMapEditorSurface
        ref={frameRef}
        editorState={frameEditorState}
        presentationStrategy={resolvedPresentationStrategy}
        readonly={!isEditMode}
        practiceModeActive={!isEditMode}
        sceneChrome={sceneChrome}
        sceneTransitionKey={frameSceneTransitionKey}
        viewMemoryScope={viewMemoryScope}
        immersiveModeActive={fullscreen}
        toolbarContent={
          <MindMapPageToolbar
            {...toolbarExtensions}
            embedded
            ratingAction={onToggleRatingMode ? { label: '评分', active: ratingMode, onClick: onToggleRatingMode } : null}
            moreActions={[
              ...(toolbarExtensions?.moreActions ?? []),
              ...(onOpenRatingHistory ? [{ label: '本轮评分记录', onClick: onOpenRatingHistory }] : []),
            ]}
            modeToggle={onToggleMode ? { label: isEditMode ? '复习' : '编辑', onClick: onToggleMode } : null}
            quizAction={currentPalaceId ? { label: '做题', onClick: handleOpenQuizPage } : null}
            immersiveAction={
              hidePresentationOverflowActions || resolvedPresentationStrategy === 'viewport-only'
                ? null
                : {
                    label: fullscreen ? '退出网页内全屏' : '网页内全屏',
                    active: fullscreen,
                    onClick: () => { void onToggleFullscreen() },
                  }
            }
            nativeFullscreenAction={
              hidePresentationOverflowActions
                ? null
                : {
                    label: resolvedPresentationStrategy === 'viewport-only'
                      ? nativeFullscreenActive ? '退出全屏' : '全屏'
                      : nativeFullscreenActive ? '退出系统全屏' : '系统全屏',
                    active: nativeFullscreenActive,
                    onClick: () => {
                      void (nativeFullscreenActive
                        ? frameRef.current?.exitFullscreen()
                        : frameRef.current?.enterFullscreen())
                    },
                  }
            }
            clearUiAction={
              hidePresentationOverflowActions
                ? null
                : {
                    label: '清屏',
                    active: uiCleared,
                    onClick: () => frameRef.current?.toggleUiCleared(),
                  }
            }
          />
        }
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
        mutedNodeUids={resolvedMutedNodeUids}
        masteryByNodeUid={ratingMasteryByNodeUid}
        statusChipsByNodeUid={statusChipsByNodeUid}
        countBadgeByNodeUid={countBadgeByNodeUid}
        onCountBadgeClick={onCountBadgeClick}
        buildSelectionToolbarActions={ratingMode && onRateNode ? ratingControls.buildSelectionToolbarActions : undefined}
        selectionToolbarPreferPosition="bottom"
        frameOverlay={ratingConflictOverlay}
        focusRequestNodeUid={focusRequestNodeUid}
        focusRequestNonce={focusRequestNonce}
        onEditorStateChange={isEditMode && onEditorStateChange ? onEditorStateChange : () => {}}
        onNodeActive={handleNodeActive}
        onNodeClick={isEditMode ? onEditNodeClick : handlePanelNodeClick}
        onNodeContextMenu={
          isEditMode
            ? onEditNodeContextMenu
            : ratingMode
              ? undefined
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
          fullscreen ? 'h-full' : 'h-[64vh]',
          surfaceClassName,
        )}
      />
    </div>
  )
})
