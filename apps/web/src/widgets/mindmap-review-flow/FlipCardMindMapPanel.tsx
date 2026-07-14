import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, CornerUpLeft, Eye, Network, Undo2 } from 'lucide-react'
import {
  MindMapEditorSurface,
  MindMapPageToolbar,
  type MindMapEditorSurfaceHandle,
  type MindMapEditorSurfaceProps,
  type MindMapPageToolbarProps,
  type MindMapSelection,
} from '@/features/mindmap-editor'
import type { MindMapEditorState, MindMapRecallRating, MindMapRecallRound } from '@/shared/api/contracts'
import type { MindMapReviewFxPayload } from '@/features/mindmap-editor'
import { normalizeMindMapDocument as normalizeEditorDocTree } from '@/entities/mindmap-document'
import { cn } from '@/shared/lib/utils'
import { isEditableKeyboardTarget } from '@/shared/keyboard/keyboardTargets'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'

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
  | 'masteryByNodeUid'
  | 'focusRequestNodeUid'
  | 'focusRequestNonce'
  | 'feedbackFxSignal'
  | 'onSegmentSelect'
  | 'onCreateSegmentFromSelection'
  | 'onSegmentRangeDraftChange'
  | 'onSegmentRangeModeToggle'
  | 'onSegmentRangeConfirm'
>

export interface FlipCardMindMapPanelProps extends FlipCardSurfaceExtensions {
  fullscreen: boolean
  displayMode?: 'review' | 'edit'
  modeSyncVersion?: number
  viewMemoryScope?: string | null
  className?: string
  surfaceClassName?: string
  toolbarExtensions?: FlipCardToolbarExtensions
  onToggleFullscreen: (active?: boolean) => void
  onToggleMode?: () => void
  visibleEditorState: MindMapEditorState
  editableEditorState?: MindMapEditorState | null
  visibleEditorSyncKey?: string | number | null
  currentPalaceId?: number | null
  reviewFxSignal?: MindMapReviewFxPayload | null
  onEditorStateChange?: (nextState: MindMapEditorState) => void
  onNodeClick: (nodes: MindMapSelection[]) => void
  onNodeContextMenu: (nodes: MindMapSelection[]) => void
  onEditNodeContextMenu?: (nodes: MindMapSelection[]) => void
  onNodeActive?: (nodes: MindMapSelection[]) => void
  onNodeHover?: (nodes: MindMapSelection[]) => void
  onQuizBreakOpen?: () => void
  onNativeFullscreenChange?: (active: boolean) => void
  onUiClearedChange?: (active: boolean) => void
  recallRatings?: Map<string, MindMapRecallRating>
  recallRound?: MindMapRecallRound
  weakNodeUids?: string[]
  onRateNode?: (nodeUid: string, rating: MindMapRecallRating, round: MindMapRecallRound, evidence?: { source?: 'manual' | 'inferred'; confidence?: number | null; responseMs?: number | null }) => void
  onUndoRating?: () => { node_uid: string } | null
  onOpenRatingHistory?: () => void
}

interface GuidedMindMapNode {
  uid: string
  text: string
  parentUid: string | null
}

function getGuidedNodeText(value: unknown, fallback: string) {
  if (typeof value !== 'string') return fallback
  return (
    value
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .trim() || fallback
  )
}

function buildGuidedMindMapModel(editorState: MindMapEditorState) {
  const doc = normalizeEditorDocTree(editorState.editor_doc)
  const nodes: GuidedMindMapNode[] = []
  const byUid = new Map<string, GuidedMindMapNode>()

  const walk = (
    node: NonNullable<ReturnType<typeof normalizeEditorDocTree>['root']>,
    parentUid: string | null,
    indexPath: number[],
  ) => {
    const data = node.data ?? {}
    const uid = String(data.uid ?? (indexPath.join('-') || 'root'))
    const fallback = indexPath.length === 0 ? '未命名导图' : '未命名知识点'
    const guidedNode = {
      uid,
      text: getGuidedNodeText(data.text, fallback),
      parentUid,
    }
    nodes.push(guidedNode)
    byUid.set(uid, guidedNode)
    ;(node.children ?? []).forEach((child, index) => {
      walk(child, uid, [...indexPath, index])
    })
  }

  if (doc.root) {
    walk(doc.root, null, [])
  }

  const rootUid = nodes[0]?.uid ?? null
  return { nodes, byUid, rootUid }
}

function getGuidedPath(
  byUid: Map<string, GuidedMindMapNode>,
  nodeUid: string | null,
) {
  const path: GuidedMindMapNode[] = []
  let current = nodeUid ? byUid.get(nodeUid) ?? null : null
  while (current) {
    path.unshift(current)
    current = current.parentUid ? byUid.get(current.parentUid) ?? null : null
  }
  return path
}

function toGuidedSelection(node: GuidedMindMapNode): MindMapSelection {
  return {
    uid: node.uid,
    text: node.text,
    note: '',
    memoryAnkiId: null,
    memoryAnkiNodeType: null,
    rawData: {},
  }
}

export const FlipCardMindMapPanel = forwardRef<MindMapEditorSurfaceHandle, FlipCardMindMapPanelProps>(function FlipCardMindMapPanel({
  fullscreen,
  displayMode = 'review',
  modeSyncVersion = 0,
  viewMemoryScope = null,
  className,
  surfaceClassName,
  toolbarExtensions,
  onToggleFullscreen,
  onToggleMode,
  visibleEditorState,
  editableEditorState = null,
  visibleEditorSyncKey = null,
  currentPalaceId = null,
  reviewFxSignal = null,
  onEditorStateChange,
  onNodeClick,
  onNodeContextMenu,
  onEditNodeContextMenu,
  onNodeActive,
  onNodeHover,
  onQuizBreakOpen,
  onNativeFullscreenChange,
  onUiClearedChange,
  segments,
  activeSegmentId,
  segmentColorMode,
  segmentRangeDraft,
  highlightedNodeUids,
  masteryByNodeUid,
  focusRequestNodeUid,
  focusRequestNonce,
  feedbackFxSignal,
  onSegmentSelect,
  onCreateSegmentFromSelection,
  onSegmentRangeDraftChange,
  onSegmentRangeModeToggle,
  onSegmentRangeConfirm,
  recallRatings = new Map(),
  recallRound = 'first',
  weakNodeUids = [],
  onRateNode,
  onUndoRating,
  onOpenRatingHistory,
}: FlipCardMindMapPanelProps, forwardedRef) {
  const navigate = useNavigate()
  const frameRef = useRef<MindMapEditorSurfaceHandle | null>(null)
  const [nativeFullscreenActive, setNativeFullscreenActive] = useState(false)
  const [uiCleared, setUiCleared] = useState(false)
  const [hostReadyTimedOut, setHostReadyTimedOut] = useState(false)
  const [activeGuidedUid, setActiveGuidedUid] = useState<string | null>(null)
  const [ratingAdvancePending, setRatingAdvancePending] = useState(false)
  const [inferredNodeUid, setInferredNodeUid] = useState<string | null>(null)
  const nodeEnteredAtRef = useRef(0)
  const isEditMode = displayMode === 'edit'

  useImperativeHandle(forwardedRef, () => ({
    setUiCleared: (nextValue) => frameRef.current?.setUiCleared(nextValue),
    toggleUiCleared: () => frameRef.current?.toggleUiCleared(),
    focusNode: (nodeUid) => frameRef.current?.focusNode(nodeUid),
    fitView: () => frameRef.current?.fitView(),
    enterNativeFullscreen: () => frameRef.current?.enterNativeFullscreen() ?? Promise.resolve(),
    exitNativeFullscreen: () => frameRef.current?.exitNativeFullscreen() ?? Promise.resolve(),
  }), [])
  const frameEditorState = isEditMode && editableEditorState ? editableEditorState : visibleEditorState
  const frameSyncIntent = 'soft'
  const frameForceSyncKey = modeSyncVersion > 0 ? `${displayMode}:${modeSyncVersion}` : undefined
  const guidedModel = useMemo(
    () => buildGuidedMindMapModel(frameEditorState),
    [frameEditorState],
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
  const guidedCurrentRevealed = Boolean(guidedCurrentNode && guidedCurrentNode.text !== '待回忆')
  const guidedEligibleNodes = useMemo(() => {
    const nonRoot = guidedModel.nodes.filter((node) => node.uid !== guidedModel.rootUid)
    return recallRound === 'weak_retry' ? nonRoot.filter((node) => weakNodeUids.includes(node.uid)) : nonRoot
  }, [guidedModel.nodes, guidedModel.rootUid, recallRound, weakNodeUids])


  useEffect(() => {
    nodeEnteredAtRef.current = Date.now()
  }, [guidedCurrentUid])

  useEffect(() => {
    if (!guidedCurrentUid || activeGuidedUid === guidedCurrentUid) return
    setActiveGuidedUid(guidedCurrentUid)
  }, [activeGuidedUid, guidedCurrentUid])

  const selectGuidedNode = useCallback((nodeUid: string | null) => {
    if (!nodeUid) return
    setActiveGuidedUid(nodeUid)
    const node = guidedModel.byUid.get(nodeUid)
    if (node) onNodeActive?.([toGuidedSelection(node)])
  }, [guidedModel.byUid, onNodeActive])

  useEffect(() => {
    if (!onRateNode || activeGuidedUid) return
    const first = guidedEligibleNodes[0]
    if (first) selectGuidedNode(first.uid)
  }, [activeGuidedUid, guidedEligibleNodes, onRateNode, selectGuidedNode])

  useEffect(() => {
    if (!ratingAdvancePending) return
    const next = guidedEligibleNodes.find((node) => !recallRatings.has(node.uid)) ?? null
    if (!next) return
    setRatingAdvancePending(false)
    selectGuidedNode(next.uid)
  }, [guidedEligibleNodes, ratingAdvancePending, recallRatings, selectGuidedNode])
  const handleGuidedGlobal = useCallback(() => {
    selectGuidedNode(guidedModel.rootUid)
    frameRef.current?.fitView?.()
  }, [guidedModel.rootUid, selectGuidedNode])

  const handleGuidedReveal = useCallback(() => {
    if (!guidedCurrentNode) return
    setActiveGuidedUid(guidedCurrentNode.uid)
    onNodeClick([toGuidedSelection(guidedCurrentNode)])
  }, [guidedCurrentNode, onNodeClick])
  const handleGuidedRating = useCallback((rating: MindMapRecallRating, source: 'manual' | 'inferred' = 'manual') => {
    if (!guidedCurrentNode || !onRateNode) return
    onRateNode(guidedCurrentNode.uid, rating, recallRound, {
      source,
      confidence: source === 'inferred' ? 0.35 : null,
      responseMs: Math.max(0, Date.now() - nodeEnteredAtRef.current),
    })
    if (source === 'inferred') setInferredNodeUid(guidedCurrentNode.uid)
    else setInferredNodeUid(null)
    onNodeClick([toGuidedSelection(guidedCurrentNode)])
    setRatingAdvancePending(true)
  }, [guidedCurrentNode, onNodeClick, onRateNode, recallRound])

  const handleGuidedNext = useCallback(() => {
    if (!guidedNextNode) return
    if (guidedCurrentNode && guidedCurrentRevealed && guidedCurrentNode.uid !== guidedModel.rootUid && !recallRatings.has(guidedCurrentNode.uid)) {
      handleGuidedRating(2, 'inferred')
      return
    }
    selectGuidedNode(guidedNextNode.uid)
  }, [guidedCurrentNode, guidedCurrentRevealed, guidedModel.rootUid, guidedNextNode, handleGuidedRating, recallRatings, selectGuidedNode])

  const handleUndoRating = useCallback(() => {
    const latest = onUndoRating?.()
    if (latest?.node_uid) selectGuidedNode(latest.node_uid)
  }, [onUndoRating, selectGuidedNode])

  useEffect(() => {
    if (isEditMode || !onRateNode) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return
      if (isEditableKeyboardTarget(event.target) || document.querySelector('[role="dialog"]')) return
      if (event.key === ' ' || event.code === 'Space') {
        if (!guidedCurrentRevealed) {
          event.preventDefault()
          handleGuidedReveal()
        }
        return
      }
      if (event.key === 'Backspace' && onUndoRating) {
        event.preventDefault()
        handleUndoRating()
        return
      }
      const key = event.key.toLowerCase()
      const rating = key === '1' || key === 'j' ? 1 : key === '2' || key === 'k' ? 2 : key === '3' || key === 'l' ? 3 : null
      if (!rating || !guidedCurrentRevealed || guidedCurrentNode?.uid === guidedModel.rootUid) return
      event.preventDefault()
      handleGuidedRating(rating)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [guidedCurrentNode?.uid, guidedCurrentRevealed, guidedModel.rootUid, handleGuidedRating, handleGuidedReveal, handleUndoRating, isEditMode, onRateNode, onUndoRating])
  const handleNodeActive = useCallback(
    (nodes: MindMapSelection[]) => {
      const nextUid = nodes[0]?.uid ?? null
      if (nextUid) {
        setActiveGuidedUid(nextUid)
      }
      onNodeActive?.(nodes)
    },
    [onNodeActive],
  )
  const handleImmersiveToggle = useCallback(() => {
    onToggleFullscreen()
  }, [onToggleFullscreen])

  const handleNativeFullscreenToggle = useCallback(async () => {
    if (nativeFullscreenActive) {
      await frameRef.current?.exitNativeFullscreen()
      return
    }
    await frameRef.current?.enterNativeFullscreen()
  }, [nativeFullscreenActive])

  const handleOpenQuizPage = useCallback(() => {
    if (onQuizBreakOpen) {
      onQuizBreakOpen()
      return
    }
    if (!currentPalaceId) return
    navigate(`/palaces/${currentPalaceId}/quiz`)
  }, [currentPalaceId, navigate, onQuizBreakOpen])

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
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="min-h-11 px-1 text-xs"
              disabled={!guidedParentNode}
              onClick={() => selectGuidedNode(guidedParentNode?.uid ?? null)}
            >
              <CornerUpLeft className="size-4" />
              上级
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="min-h-11 px-1 text-xs"
              disabled={!guidedNextNode}
              onClick={handleGuidedNext}
            >
              <ArrowRight className="size-4" />
              下一个
            </Button>
            {guidedCurrentRevealed && onRateNode && guidedCurrentNode?.uid !== guidedModel.rootUid ? (
              <div className="col-span-2 grid grid-cols-3 gap-1">
                <Button type="button" size="sm" variant="destructive" className="min-h-11 px-1 text-xs" onClick={() => handleGuidedRating(1)}>忘记 1</Button>
                <Button type="button" size="sm" variant="outline" className="min-h-11 px-1 text-xs" onClick={() => handleGuidedRating(2)}>模糊 2</Button>
                <Button type="button" size="sm" className="min-h-11 px-1 text-xs" onClick={() => handleGuidedRating(3)}>记得 3</Button>
              </div>
            ) : (
              <Button type="button" size="sm" className="min-h-11 px-1 text-xs" disabled={!guidedCurrentNode} onClick={handleGuidedReveal}>
                <Eye className="size-4" />揭示
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="min-h-11 px-1 text-xs"
              onClick={handleGuidedGlobal}
            >
              <Network className="size-4" />
              全局
            </Button>
          </div>
        </div>
      ) : null}
      {!isEditMode && onRateNode ? (
        <div className="mb-3 hidden items-center justify-between gap-3 rounded-xl border border-border/70 bg-background/95 p-3 md:flex">
          <div className="min-w-0">
            <div className="flex items-center gap-2"><Badge variant={recallRound === 'weak_retry' ? 'warning' : 'secondary'}>{recallRound === 'weak_retry' ? '弱点回合' : '首次回忆'}</Badge><span className="truncate text-sm font-medium">{guidedCurrentNode?.text ?? '选择一个节点'}</span></div>
            <div className="mt-1 text-xs text-muted-foreground">Space 揭示；按 1/2/3（或 J/K/L）选择忘记/模糊/记得；Backspace 返回最近评分。</div>
          </div>
          {inferredNodeUid ? <Badge variant="outline">已自动记为模糊，可按 Backspace 修正</Badge> : null}
          {onUndoRating ? <Button size="sm" variant="ghost" onClick={handleUndoRating}><Undo2 className="size-4" />撤销</Button> : null}
          {guidedCurrentRevealed && guidedCurrentNode?.uid !== guidedModel.rootUid ? (
            <div className="flex shrink-0 gap-2"><Button variant="destructive" onClick={() => handleGuidedRating(1)}>忘记 1</Button><Button variant="outline" onClick={() => handleGuidedRating(2)}>模糊 2</Button><Button onClick={() => handleGuidedRating(3)}>记得 3</Button></div>
          ) : <Button onClick={handleGuidedReveal} disabled={!guidedCurrentNode}><Eye className="size-4" />揭示</Button>}
        </div>
      ) : null}      <MindMapPageToolbar
        {...toolbarExtensions}
        moreActions={[
          ...(toolbarExtensions?.moreActions ?? []),
          ...(onOpenRatingHistory ? [{ label: '本轮评分记录', onClick: onOpenRatingHistory }] : []),
        ]}
        className={cn('mb-3', !isEditMode && !toolbarExtensions?.taskControl && 'hidden md:block')}
        modeToggle={
          onToggleMode
            ? {
                label: isEditMode ? '复习' : '编辑',
                onClick: onToggleMode,
              }
            : null
        }
        quizAction={
          currentPalaceId
            ? {
                label: '做题',
                onClick: handleOpenQuizPage,
              }
            : null
        }
        immersiveAction={{
          label: fullscreen ? '退出网页内全屏' : '网页内全屏',
          active: fullscreen,
          onClick: () => {
            void handleImmersiveToggle()
          },
        }}
        nativeFullscreenAction={{
          label: nativeFullscreenActive ? '退出系统全屏' : '系统全屏',
          active: nativeFullscreenActive,
          onClick: () => {
            void handleNativeFullscreenToggle()
          },
        }}
        clearUiAction={{
          label: '清屏',
          active: uiCleared,
          onClick: () => frameRef.current?.toggleUiCleared(),
        }}
      />
      {hostReadyTimedOut ? (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
          <span>脑图宿主初始化偏慢，已继续等待。若长时间不显示，可先返回后重新进入。</span>
          <Badge className="bg-warning text-white hover:bg-warning">宿主超时</Badge>
        </div>
      ) : null}
      <MindMapEditorSurface
        ref={frameRef}
        editorState={frameEditorState}
        readonly={!isEditMode}
        practiceModeActive={!isEditMode}
        viewMemoryScope={viewMemoryScope}
        immersiveModeActive={fullscreen}
        syncOnPropChange
        syncIntent={frameSyncIntent}
        preserveViewOnSync
        syncReason={isEditMode ? null : 'review_flip'}
        externalSyncKey={isEditMode ? null : visibleEditorSyncKey}
        forceSyncKey={frameForceSyncKey}
        forceSyncIntent="soft"
        initialViewPolicy="preserve"
        mobileViewPolicy={isEditMode ? 'map' : 'auto'}
        nodeClickViewportPolicy={isEditMode ? 'guided-center' : 'preserve'}
        reviewFxSignal={reviewFxSignal}
        feedbackFxSignal={feedbackFxSignal}
        segments={segments}
        activeSegmentId={activeSegmentId}
        segmentColorMode={segmentColorMode}
        segmentRangeDraft={segmentRangeDraft}
        highlightedNodeUids={highlightedNodeUids}
        masteryByNodeUid={masteryByNodeUid}
        focusRequestNodeUid={focusRequestNodeUid}
        focusRequestNonce={focusRequestNonce}
        onEditorStateChange={isEditMode && onEditorStateChange ? onEditorStateChange : () => {}}
        onNodeActive={handleNodeActive}
        onNodeClick={isEditMode ? undefined : onNodeClick}
        onNodeContextMenu={isEditMode ? onEditNodeContextMenu : onNodeContextMenu}
        onNodeHover={isEditMode ? undefined : onNodeHover}
        onSegmentSelect={onSegmentSelect}
        onCreateSegmentFromSelection={onCreateSegmentFromSelection}
        onSegmentRangeDraftChange={onSegmentRangeDraftChange}
        onSegmentRangeModeToggle={onSegmentRangeModeToggle}
        onSegmentRangeConfirm={onSegmentRangeConfirm}
        onFullscreenToggle={onToggleFullscreen}
        onFullscreenChange={(active) => {
          setNativeFullscreenActive(active)
          onNativeFullscreenChange?.(active)
        }}
        onUiClearedChange={(active) => {
          setUiCleared(active)
          onUiClearedChange?.(active)
        }}
        onReady={() => setHostReadyTimedOut(false)}
        onReadyTimeout={() => setHostReadyTimedOut(true)}
        className={cn(
          'w-full rounded-lg border border-border/70 bg-background',
          fullscreen ? 'h-full' : 'h-[64vh]',
          surfaceClassName,
        )}
      />
    </div>
  )
})
