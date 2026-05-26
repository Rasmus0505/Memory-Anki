import * as React from 'react'
import {
  BilinkPreviewPopover,
  BilinkSearchPopover,
  useBilinkCounts,
  useBilinkOverlay,
  useBilinks,
} from '@/features/bilink'
import type { MindMapEditorState } from '@/shared/api/contracts'
import { cn } from '@/shared/lib/utils'
import { ReviewFlowInfoPanel } from '@/features/review/components/ReviewFlowInfoPanel'
import { ReviewFlowMapPanel } from '@/features/review/components/ReviewFlowMapPanel'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
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
    <div className={cn('space-y-6', flow.screenGlowClass)}>
      <div
        className={cn(
          'grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]',
          flow.fullscreen && 'grid-cols-1',
        )}
      >
        <div className={cn('space-y-4', flow.fullscreen && 'hidden')}>
          <ReviewFlowInfoPanel
            visibleNonRootCount={flow.visibleNonRootCount}
            revealedNonRootCount={flow.revealedNonRootCount}
            redNodeCount={flow.redNodeCount}
            effectiveSeconds={flow.timer.effectiveSeconds}
            persistProgress={persistProgress}
            timer={flow.timer}
            fullscreen={flow.fullscreen}
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
            <CardHeader className="flex flex-row items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base">复习脑图</CardTitle>
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
                  completed={flow.completed}
                  visibleNonRootCount={flow.visibleNonRootCount}
                  totalNodeCount={flow.totalNodeCount}
                  fullscreen={flow.fullscreen}
                  onToggleFullscreen={handleFullscreenToggle}
                  onRestart={onRestart ? flow.handleRestart : undefined}
                  onComplete={() => void flow.finishFlow('manual_complete')}
                  submitting={submitting}
                  visibleEditorState={flow.visibleEditorState}
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
