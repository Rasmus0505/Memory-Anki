import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, CornerUpLeft, Eye, Network } from 'lucide-react'
import {
  MindMapFrame,
  MindMapPageToolbar,
  type MindMapFrameHandle,
  type MindMapSelection,
} from '@/shared/components/mindmap-host'
import type { MindMapEditorState, MindMapRecallRating, MindMapRecallRound } from '@/shared/api/contracts'
import type { MindMapReviewFxPayload } from '@/shared/components/mindmap-host/hostBridgeUtils'
import { normalizeEditorDocTree } from '@/shared/components/mindmap/editorDocAdapter'
import { cn } from '@/shared/lib/utils'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'

interface ReviewFlowMapPanelProps {
  fullscreen: boolean
  displayMode?: 'review' | 'edit'
  modeSyncVersion?: number
  viewMemoryScope?: string | null
  onToggleFullscreen: (active?: boolean) => void
  onToggleMode?: () => void
  visibleEditorState: MindMapEditorState
  editableEditorState?: MindMapEditorState | null
  visibleEditorSyncKey?: string | number | null
  currentPalaceId?: number | null
  focusNodeUids?: string[]
  reviewFxSignal?: MindMapReviewFxPayload | null
  showMiniPalaceButton?: boolean
  miniPalaceDraft?: {
    active: boolean
    selectedNodeUids: string[]
  }
  miniPalacePracticeActive?: boolean
  onEditorStateChange?: (nextState: MindMapEditorState) => void
  onNodeClick: (nodes: MindMapSelection[]) => void
  onNodeContextMenu: (nodes: MindMapSelection[]) => void
  onEditNodeContextMenu?: (nodes: MindMapSelection[]) => void
  onNodeActive?: (nodes: MindMapSelection[]) => void
  onNodeHover?: (nodes: MindMapSelection[]) => void
  onQuizBreakOpen?: () => void
  onMiniPalaceOpen?: () => void
  onMiniPalacePour?: () => void
  recallRatings?: Map<string, MindMapRecallRating>
  recallRound?: MindMapRecallRound
  weakNodeUids?: string[]
  onRateNode?: (nodeUid: string, rating: MindMapRecallRating, round: MindMapRecallRound) => void
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

export function ReviewFlowMapPanel({
  fullscreen,
  displayMode = 'review',
  modeSyncVersion = 0,
  viewMemoryScope = null,
  onToggleFullscreen,
  onToggleMode,
  visibleEditorState,
  editableEditorState = null,
  visibleEditorSyncKey = null,
  currentPalaceId = null,
  focusNodeUids = [],
  reviewFxSignal = null,
  showMiniPalaceButton = false,
  miniPalaceDraft = {
    active: false,
    selectedNodeUids: [],
  },
  miniPalacePracticeActive = false,
  onEditorStateChange,
  onNodeClick,
  onNodeContextMenu,
  onEditNodeContextMenu,
  onNodeActive,
  onNodeHover,
  onQuizBreakOpen,
  onMiniPalaceOpen,
  onMiniPalacePour,
  recallRatings = new Map(),
  recallRound = 'first',
  weakNodeUids = [],
  onRateNode,
  onOpenRatingHistory,
}: ReviewFlowMapPanelProps) {
  const navigate = useNavigate()
  const frameRef = useRef<MindMapFrameHandle | null>(null)
  const [nativeFullscreenActive, setNativeFullscreenActive] = useState(false)
  const [uiCleared, setUiCleared] = useState(false)
  const [hostReadyTimedOut, setHostReadyTimedOut] = useState(false)
  const [activeGuidedUid, setActiveGuidedUid] = useState<string | null>(null)
  const [ratingAdvancePending, setRatingAdvancePending] = useState(false)
  const isEditMode = displayMode === 'edit'
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
    if (!guidedCurrentUid || activeGuidedUid === guidedCurrentUid) return
    setActiveGuidedUid(guidedCurrentUid)
  }, [activeGuidedUid, guidedCurrentUid])

  const selectGuidedNode = useCallback((nodeUid: string | null) => {
    if (nodeUid) setActiveGuidedUid(nodeUid)
  }, [])

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
    setActiveGuidedUid(guidedModel.rootUid)
    frameRef.current?.fitView?.()
  }, [guidedModel.rootUid])

  const handleGuidedReveal = useCallback(() => {
    if (!guidedCurrentNode) return
    setActiveGuidedUid(guidedCurrentNode.uid)
    onNodeClick([toGuidedSelection(guidedCurrentNode)])
  }, [guidedCurrentNode, onNodeClick])
  const handleGuidedRating = useCallback((rating: MindMapRecallRating) => {
    if (!guidedCurrentNode || !onRateNode) return
    onRateNode(guidedCurrentNode.uid, rating, recallRound)
    onNodeClick([toGuidedSelection(guidedCurrentNode)])
    setRatingAdvancePending(true)
  }, [guidedCurrentNode, onNodeClick, onRateNode, recallRound])

  useEffect(() => {
    if (isEditMode || !onRateNode) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return
      if (event.key === ' ' || event.code === 'Space') {
        if (!guidedCurrentRevealed) {
          event.preventDefault()
          handleGuidedReveal()
        }
        return
      }
      const rating = event.key === '1' ? 1 : event.key === '3' ? 3 : event.key === '5' ? 5 : null
      if (!rating || !guidedCurrentRevealed || guidedCurrentNode?.uid === guidedModel.rootUid) return
      event.preventDefault()
      handleGuidedRating(rating)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [guidedCurrentNode?.uid, guidedCurrentRevealed, guidedModel.rootUid, handleGuidedRating, handleGuidedReveal, isEditMode, onRateNode])
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
  const handleImmersiveToggle = useCallback(async () => {
    if (nativeFullscreenActive) {
      await frameRef.current?.exitNativeFullscreen()
      onToggleFullscreen(true)
      return
    }
    onToggleFullscreen()
  }, [nativeFullscreenActive, onToggleFullscreen])

  const handleNativeFullscreenToggle = useCallback(async () => {
    if (nativeFullscreenActive) {
      await frameRef.current?.exitNativeFullscreen()
      return
    }
    if (fullscreen) {
      onToggleFullscreen(false)
    }
    await frameRef.current?.enterNativeFullscreen()
  }, [fullscreen, nativeFullscreenActive, onToggleFullscreen])

  const handleOpenQuizPage = useCallback(() => {
    if (onQuizBreakOpen) {
      onQuizBreakOpen()
      return
    }
    if (!currentPalaceId) return
    navigate(`/palaces/${currentPalaceId}/quiz`)
  }, [currentPalaceId, navigate, onQuizBreakOpen])

  return (
    <div className={cn('h-full min-h-0', fullscreen && 'flex h-full flex-col')}>
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
              onClick={() => selectGuidedNode(guidedNextNode?.uid ?? null)}
            >
              <ArrowRight className="size-4" />
              下一个
            </Button>
            {guidedCurrentRevealed && onRateNode && guidedCurrentNode?.uid !== guidedModel.rootUid ? (
              <div className="col-span-2 grid grid-cols-3 gap-1">
                <Button type="button" size="sm" variant="destructive" className="min-h-11 px-1 text-xs" onClick={() => handleGuidedRating(1)}>忘记 1</Button>
                <Button type="button" size="sm" variant="outline" className="min-h-11 px-1 text-xs" onClick={() => handleGuidedRating(3)}>模糊 3</Button>
                <Button type="button" size="sm" className="min-h-11 px-1 text-xs" onClick={() => handleGuidedRating(5)}>记住 5</Button>
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
            <div className="mt-1 text-xs text-muted-foreground">Space 揭示；揭示后按 1 忘记、3 模糊、5 记住，评分后自动进入下一个。</div>
          </div>
          {guidedCurrentRevealed && guidedCurrentNode?.uid !== guidedModel.rootUid ? (
            <div className="flex shrink-0 gap-2"><Button variant="destructive" onClick={() => handleGuidedRating(1)}>忘记 1</Button><Button variant="outline" onClick={() => handleGuidedRating(3)}>模糊 3</Button><Button onClick={() => handleGuidedRating(5)}>记住 5</Button></div>
          ) : <Button onClick={handleGuidedReveal} disabled={!guidedCurrentNode}><Eye className="size-4" />揭示</Button>}
        </div>
      ) : null}      <MindMapPageToolbar
        moreActions={onOpenRatingHistory ? [{ label: '本轮评分记录', onClick: onOpenRatingHistory }] : []}
        className={cn('mb-3', !isEditMode && 'hidden md:block')}
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
        miniPalaceAction={
          showMiniPalaceButton && onMiniPalaceOpen
            ? {
                label: '训练关卡',
                onClick: onMiniPalaceOpen,
              }
            : null
        }
        immersiveAction={{
          label: '半屏编辑',
          active: fullscreen,
          onClick: () => {
            void handleImmersiveToggle()
          },
        }}
        nativeFullscreenAction={{
          label: '全屏编辑',
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
      <MindMapFrame
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
        focusNodeUids={focusNodeUids}
        miniPalaceDraft={miniPalaceDraft}
        miniPalacePracticeActive={miniPalacePracticeActive}
        reviewFxSignal={reviewFxSignal}
        onEditorStateChange={isEditMode && onEditorStateChange ? onEditorStateChange : () => {}}
        onNodeActive={handleNodeActive}
        onNodeClick={isEditMode ? undefined : onNodeClick}
        onNodeContextMenu={isEditMode ? onEditNodeContextMenu : onNodeContextMenu}
        onNodeHover={isEditMode ? undefined : onNodeHover}
        onMiniPalacePour={onMiniPalacePour}
        onFullscreenToggle={onToggleFullscreen}
        onFullscreenChange={setNativeFullscreenActive}
        onUiClearedChange={setUiCleared}
        onReady={() => setHostReadyTimedOut(false)}
        onReadyTimeout={() => setHostReadyTimedOut(true)}
        className={cn(
          'w-full rounded-lg border border-border/70 bg-background',
          fullscreen ? 'h-full' : 'h-[64vh]',
        )}
      />
    </div>
  )
}
