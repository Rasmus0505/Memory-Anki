import { MindMapFrame, type MindMapSelection } from '@/shared/components/mindmap-host'
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
  onEditorStateChange?: (nextState: MindMapEditorState) => void
  onNodeClick: (nodes: MindMapSelection[]) => void
  onNodeContextMenu: (nodes: MindMapSelection[]) => void
  onEditNodeContextMenu?: (nodes: MindMapSelection[]) => void
  onNodeActive?: (nodes: MindMapSelection[]) => void
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
  onEditorStateChange,
  onNodeClick,
  onNodeContextMenu,
  onEditNodeContextMenu,
  onNodeActive,
  onBilinkTrigger,
  onBilinkNodeClick,
  onBilinkToolbarSearch,
}: ReviewFlowMapPanelProps) {
  const isEditMode = displayMode === 'edit'
  const frameEditorState = isEditMode && editableEditorState ? editableEditorState : visibleEditorState
  const frameSyncIntent = isEditMode ? 'soft' : 'replace'

  return (
    <div className={cn('h-full min-h-0', fullscreen && 'flex h-full flex-col')}>
      <MindMapFrame
        editorState={frameEditorState}
        readonly={!isEditMode}
        showToolbarWhenReadonly={!isEditMode}
        practiceModeActive={!isEditMode}
        practiceToggleLabel={isEditMode ? '复习' : '编辑'}
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
        bilinkInsertionText={bilinkInsertionText}
        bilinkInsertionNonce={bilinkInsertionNonce}
        reviewFxSignal={reviewFxSignal}
        showBilinkSearchButton
        onEditorStateChange={isEditMode && onEditorStateChange ? onEditorStateChange : () => {}}
        onNodeActive={onNodeActive}
        onNodeClick={isEditMode ? undefined : onNodeClick}
        onNodeContextMenu={isEditMode ? onEditNodeContextMenu : onNodeContextMenu}
        onPracticeToggle={onToggleMode}
        onBilinkTrigger={onBilinkTrigger}
        onBilinkNodeClick={onBilinkNodeClick}
        onBilinkToolbarSearch={onBilinkToolbarSearch}
        onFullscreenToggle={onToggleFullscreen}
        onFullscreenChange={(active) => {
          if (!active) {
            onToggleFullscreen(false)
          }
        }}
        className={cn(
          'w-full rounded-2xl border border-border/70 bg-white',
          fullscreen ? 'h-full' : 'h-[64vh]',
        )}
      />
    </div>
  )
}
