import { MindMapFrame, type MindMapSelection } from '@/shared/components/mindmap-host'
import type { BilinkItem, MindMapEditorState } from '@/shared/api/contracts'
import { cn } from '@/shared/lib/utils'

interface ReviewFlowMapPanelProps {
  fullscreen: boolean
  onToggleFullscreen: (active?: boolean) => void
  visibleEditorState: MindMapEditorState
  bilinkCounts?: Record<string, number>
  bilinkItems?: BilinkItem[]
  currentPalaceId?: number | null
  bilinkInsertionText?: string | null
  bilinkInsertionNonce?: number
  onNodeClick: (nodes: MindMapSelection[]) => void
  onNodeContextMenu: (nodes: MindMapSelection[]) => void
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
  onToggleFullscreen,
  visibleEditorState,
  bilinkCounts = {},
  bilinkItems = [],
  currentPalaceId = null,
  bilinkInsertionText = null,
  bilinkInsertionNonce = 0,
  onNodeClick,
  onNodeContextMenu,
  onBilinkTrigger,
  onBilinkNodeClick,
  onBilinkToolbarSearch,
}: ReviewFlowMapPanelProps) {
  return (
    <div className={cn('h-full min-h-0', fullscreen && 'flex h-full flex-col')}>
      <MindMapFrame
        editorState={visibleEditorState}
        readonly
        showToolbarWhenReadonly
        immersiveModeActive={fullscreen}
        syncOnPropChange
        preserveViewOnSync
        bilinkCounts={bilinkCounts}
        bilinkItems={bilinkItems}
        bilinkCurrentPalaceId={currentPalaceId}
        bilinkInsertionText={bilinkInsertionText}
        bilinkInsertionNonce={bilinkInsertionNonce}
        showBilinkSearchButton
        onEditorStateChange={() => {}}
        onNodeClick={onNodeClick}
        onNodeContextMenu={onNodeContextMenu}
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
