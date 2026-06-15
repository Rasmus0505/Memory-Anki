import { useCallback, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  MindMapFrame,
  MindMapPageToolbar,
  type MindMapFrameHandle,
  type MindMapSelection,
} from '@/shared/components/mindmap-host'
import type { BilinkItem, MindMapEditorState } from '@/shared/api/contracts'
import type { MindMapReviewFxPayload } from '@/shared/components/mindmap-host/hostBridgeUtils'
import { cn } from '@/shared/lib/utils'

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
  bilinkCounts?: Record<string, number>
  bilinkItems?: BilinkItem[]
  currentPalaceId?: number | null
  focusNodeUids?: string[]
  bilinkInsertionText?: string | null
  bilinkInsertionNonce?: number
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
  onBilinkTrigger?: (payload: {
    nodeUid: string | null
    left: number
    top: number
    query: string
  }) => void
  onBilinkNodeClick?: (payload: {
    palaceId: number | null
    nodeUid: string | null
    trigger: 'badge' | 'mark'
  }) => void
  onBilinkToolbarSearch?: () => void
  onQuizBreakOpen?: () => void
  onMiniPalaceOpen?: () => void
  onMiniPalacePour?: () => void
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
  bilinkCounts = {},
  bilinkItems = [],
  currentPalaceId = null,
  focusNodeUids = [],
  bilinkInsertionText = null,
  bilinkInsertionNonce = 0,
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
  onBilinkTrigger,
  onBilinkNodeClick,
  onBilinkToolbarSearch,
  onQuizBreakOpen,
  onMiniPalaceOpen,
  onMiniPalacePour,
}: ReviewFlowMapPanelProps) {
  const navigate = useNavigate()
  const frameRef = useRef<MindMapFrameHandle | null>(null)
  const [nativeFullscreenActive, setNativeFullscreenActive] = useState(false)
  const [uiCleared, setUiCleared] = useState(false)
  const isEditMode = displayMode === 'edit'
  const frameEditorState = isEditMode && editableEditorState ? editableEditorState : visibleEditorState
  const frameSyncIntent = isEditMode ? 'soft' : 'replace'
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
      <MindMapPageToolbar
        className="mb-3"
        modeToggle={
          onToggleMode
            ? {
                label: isEditMode ? '复习' : '编辑',
                onClick: onToggleMode,
              }
            : null
        }
        bilinkSearchAction={
          onBilinkToolbarSearch
            ? {
                label: '搜索',
                onClick: onBilinkToolbarSearch,
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
                label: '小宫殿',
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
        forceSyncKey={`${displayMode}:${modeSyncVersion}`}
        forceSyncIntent="replace"
        initialViewPolicy="preserve"
        bilinkCounts={bilinkCounts}
        bilinkItems={bilinkItems}
        bilinkCurrentPalaceId={currentPalaceId}
        focusNodeUids={focusNodeUids}
        miniPalaceDraft={miniPalaceDraft}
        miniPalacePracticeActive={miniPalacePracticeActive}
        bilinkInsertionText={bilinkInsertionText}
        bilinkInsertionNonce={bilinkInsertionNonce}
        reviewFxSignal={reviewFxSignal}
        onEditorStateChange={isEditMode && onEditorStateChange ? onEditorStateChange : () => {}}
        onNodeActive={onNodeActive}
        onNodeClick={isEditMode ? undefined : onNodeClick}
        onNodeContextMenu={isEditMode ? onEditNodeContextMenu : onNodeContextMenu}
        onNodeHover={isEditMode ? undefined : onNodeHover}
        onBilinkTrigger={onBilinkTrigger}
        onBilinkNodeClick={onBilinkNodeClick}
        onMiniPalacePour={onMiniPalacePour}
        onFullscreenToggle={onToggleFullscreen}
        onFullscreenChange={setNativeFullscreenActive}
        onUiClearedChange={setUiCleared}
        className={cn(
          'w-full rounded-2xl border border-border/70 bg-background',
          fullscreen ? 'h-full' : 'h-[64vh]',
        )}
      />
    </div>
  )
}
