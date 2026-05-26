import { RotateCcw, Sparkles, SquareCheckBig } from 'lucide-react'
import { MindMapFrame, type MindMapSelection } from '@/shared/components/mindmap-host'
import type { BilinkItem, MindMapEditorState } from '@/shared/api/contracts'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { cn } from '@/shared/lib/utils'

interface ReviewFlowMapPanelProps {
  completed: boolean
  visibleNonRootCount: number
  totalNodeCount: number
  fullscreen: boolean
  onToggleFullscreen: (active?: boolean) => void
  onRestart?: () => void
  onComplete: () => void
  submitting: boolean
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
  completed,
  visibleNonRootCount,
  totalNodeCount,
  fullscreen,
  onToggleFullscreen,
  onRestart,
  onComplete,
  submitting,
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
    <div className={cn('flex min-h-0 flex-col overflow-hidden rounded-2xl border border-border/70 bg-card', fullscreen && 'h-full')}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 px-4 py-3">
        <div className="flex items-center gap-3">
          <div>
            <div className="text-sm font-semibold text-foreground">手动翻牌复习</div>
            <div className="mt-1 text-xs text-muted-foreground">
              左键揭示或放出子卡，右键标红没记住；正式复习会在全部正文翻开后自动完成。
            </div>
          </div>
          {completed ? (
            <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">
              本次已完成
            </Badge>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">
            已出现 {visibleNonRootCount} / {Math.max(totalNodeCount - 1, 0)}
          </Badge>
          <Badge variant="secondary">翻卡模式</Badge>
        </div>
      </div>

      <div className="border-b border-border/70 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="default">
            <Sparkles className="mr-2 h-4 w-4" />
            翻卡模式
          </Button>
          {onRestart ? (
            <Button type="button" size="sm" variant="outline" onClick={onRestart}>
              <RotateCcw className="mr-2 h-4 w-4" />
              重新开始练习
            </Button>
          ) : null}
          <Button type="button" size="sm" disabled={submitting} onClick={onComplete}>
            <SquareCheckBig className="mr-2 h-4 w-4" />
            完成
          </Button>
        </div>
      </div>

      <div className={cn('p-4', fullscreen && 'flex-1 min-h-0')}>
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
    </div>
  )
}
