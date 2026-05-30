import * as React from 'react'
import { RotateCcw, SquareCheckBig } from 'lucide-react'
import {
  BilinkPreviewPopover,
  BilinkSearchPopover,
  useBilinkCounts,
  useBilinkOverlay,
  useBilinks,
} from '@/features/bilink'
import type { MindMapEditorState } from '@/shared/api/contracts'
import { cn } from '@/shared/lib/utils'
import { ReviewFlowMapPanel } from '@/features/review/components/ReviewFlowMapPanel'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { SessionTimerBar } from '@/shared/components/session/SessionTimerBar'
import {
  useReviewFlowSession,
} from '@/features/review/hooks/useReviewFlowSession'
import type { ReviewFlowSnapshot } from '@/features/review/model/review-flow-tree'

export type { ReviewFlowSnapshot } from '@/features/review/model/review-flow-tree'

interface CompleteFlowPayload {
  durationSeconds: number
  completionMode: 'manual_complete' | 'auto_complete'
  revealedRemaining: boolean
  redNodeIds: string[]
}

interface MindMapReviewFlowProps {
  title: string
  palaceId: number | null
  sessionKind: 'practice' | 'review'
  editorState: MindMapEditorState
  onComplete: (payload: CompleteFlowPayload) => void | Promise<void>
  onRestart?: () => void
  submitting?: boolean
  persistProgress?: boolean
  initialSnapshot?: ReviewFlowSnapshot | null
  onSnapshotChange?: (snapshot: ReviewFlowSnapshot) => void
  onFullscreenChange?: (active: boolean) => void
}

export function MindMapReviewFlow({
  title,
  palaceId,
  sessionKind,
  editorState,
  onComplete,
  onRestart,
  submitting = false,
  persistProgress = false,
  initialSnapshot = null,
  onSnapshotChange,
  onFullscreenChange,
}: MindMapReviewFlowProps) {
  const flow = useReviewFlowSession({
    title,
    palaceId,
    sessionKind,
    editorState,
    onComplete,
    onRestart,
    persistProgress,
    initialSnapshot,
    onSnapshotChange,
    onFullscreenChange,
  })
  const bilinks = useBilinks(palaceId)
  const bilinkCounts = useBilinkCounts(palaceId)
  const bilinkOverlay = useBilinkOverlay({
    currentPalaceId: palaceId,
    allowCreate: false,
  })

  const handleFullscreenToggle = React.useCallback((active?: boolean) => {
    if (typeof active === 'boolean') {
      flow.setFullscreen(active)
      return
    }
    flow.setFullscreen((current: boolean) => !current)
  }, [flow])

  return (
    <div className={cn('space-y-5', flow.screenGlowClass)}>
      <div
        className={cn(
          'grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]',
          flow.fullscreen && 'grid-cols-1',
        )}
      >
        <div className={cn('space-y-4', flow.fullscreen && 'hidden')}>
          <SessionTimerBar
            effectiveSeconds={flow.timer.effectiveSeconds}
            idleSeconds={flow.timer.idleSeconds}
            pauseCount={flow.timer.pauseCount}
            status={flow.timer.status}
            onStart={() => flow.timer.start({ source: 'manual' })}
            onPause={() => flow.timer.pause({ source: 'manual' })}
            onResume={() => flow.timer.resume({ source: 'manual' })}
            onAdjustDuration={flow.timer.adjustDuration}
            showCompleteAction={false}
            showRestartAction={false}
            className="sticky top-5 z-20"
          />
        </div>

        <div className={cn('space-y-4', flow.fullscreen && 'space-y-0')}>
          <Card
            className={cn(
              'min-h-[74vh] border-border/70 bg-card/92',
              flow.fullscreen &&
                'fixed inset-x-5 bottom-5 top-5 z-[90] min-h-0 bg-card/96 shadow-2xl',
            )}
          >
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-base">
                  {sessionKind === 'practice' ? '练习脑图' : '复习脑图'}
                </CardTitle>
                <Badge variant="secondary">翻卡模式</Badge>
                <Badge variant="outline">
                  已出现 {flow.visibleNonRootCount} / {Math.max(flow.totalNodeCount - 1, 0)}
                </Badge>
                {flow.redNodeCount > 0 ? (
                  <Badge variant="outline">红标 {flow.redNodeCount}</Badge>
                ) : null}
                {flow.completed ? (
                  <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">
                    本次已完成
                  </Badge>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {onRestart ? (
                  <Button type="button" size="sm" variant="outline" onClick={flow.handleRestart}>
                    <RotateCcw className="mr-2 h-4 w-4" />
                    重新开始
                  </Button>
                ) : null}
                <Button type="button" size="sm" disabled={submitting} onClick={() => void flow.finishFlow('manual_complete')}>
                  <SquareCheckBig className="mr-2 h-4 w-4" />
                  完成
                </Button>
              </div>
            </CardHeader>
            <CardContent
              className={cn(
                'min-h-[64vh]',
                flow.fullscreen && 'h-[calc(100vh-108px)] min-h-0',
              )}
            >
              <div className="h-full min-h-0">
                <ReviewFlowMapPanel
                  fullscreen={flow.fullscreen}
                  onToggleFullscreen={handleFullscreenToggle}
                  visibleEditorState={flow.visibleEditorState}
                  visibleEditorSyncKey={flow.visibleEditorSyncKey}
                  bilinkCounts={bilinkCounts.counts}
                  bilinkItems={bilinks.items}
                  currentPalaceId={palaceId}
                  bilinkInsertionText={bilinkOverlay.bilinkInsertionText}
                  bilinkInsertionNonce={bilinkOverlay.bilinkInsertionNonce}
                  onNodeClick={flow.handleNodeClick}
                  onNodeContextMenu={flow.handleNodeContextMenu}
                  onBilinkTrigger={bilinkOverlay.handleBilinkTrigger}
                  onBilinkNodeClick={bilinkOverlay.handleBilinkNodeClick}
                  onBilinkToolbarSearch={() =>
                    bilinkOverlay.openBilinkSearch({
                      mode: 'toolbar',
                      position: null,
                    })
                  }
                />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <BilinkSearchPopover
        open={bilinkOverlay.bilinkSearchOpen}
        mode={bilinkOverlay.bilinkSearchMode}
        position={bilinkOverlay.bilinkSearchPosition}
        query={bilinkOverlay.bilinkSearchQuery}
        loading={bilinkOverlay.bilinkSearchLoading}
        error={bilinkOverlay.bilinkSearchError}
        results={bilinkOverlay.bilinkSearchResults}
        onQueryChange={bilinkOverlay.setBilinkSearchQuery}
        onClose={bilinkOverlay.closeBilinkSearch}
        onSelect={bilinkOverlay.handleBilinkSearchSelect}
        onPreview={bilinkOverlay.handleBilinkResultPreview}
      />

      <BilinkPreviewPopover
        open={bilinkOverlay.bilinkPreviewOpen}
        loading={bilinkOverlay.bilinkPreviewLoading}
        error={bilinkOverlay.bilinkPreviewError}
        context={bilinkOverlay.bilinkPreviewContext}
        editorState={bilinkOverlay.bilinkPreviewEditorState}
        onClose={() => bilinkOverlay.setBilinkPreviewOpen(false)}
        onJump={bilinkOverlay.jumpToBilinkContext}
      />
    </div>
  )
}
