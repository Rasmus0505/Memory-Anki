import * as React from 'react'
import type { MindMapEditorState } from '@/shared/api/contracts'
import { cn } from '@/shared/lib/utils'
import { ReviewFlowInfoPanel } from '@/features/review/components/ReviewFlowInfoPanel'
import { ReviewFlowMapPanel } from '@/features/review/components/ReviewFlowMapPanel'
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
  })

  return (
    <div className={cn('space-y-6', flow.screenGlowClass)}>
      {flow.fullscreen ? (
        <div className="fixed inset-0 z-50 bg-black/55 backdrop-blur-sm">
          <ReviewFlowInfoPanel
            visibleNonRootCount={flow.visibleNonRootCount}
            revealedNonRootCount={flow.revealedNonRootCount}
            redNodeCount={flow.redNodeCount}
            effectiveSeconds={flow.timer.effectiveSeconds}
            persistProgress={persistProgress}
            timer={flow.timer}
            fullscreen
          />
          <div className="flex h-full gap-4 p-4 sm:p-6">
            <div className="min-h-0 flex-1">
              <ReviewFlowMapPanel
                completed={flow.completed}
                visibleNonRootCount={flow.visibleNonRootCount}
                totalNodeCount={flow.totalNodeCount}
                fullscreen={flow.fullscreen}
                onToggleFullscreen={() =>
                  flow.setFullscreen((current: boolean) => !current)
                }
                onRestart={onRestart ? flow.handleRestart : undefined}
                onComplete={() => void flow.finishFlow('manual_complete')}
                submitting={submitting}
                visibleEditorState={flow.visibleEditorState}
                onNodeClick={flow.handleNodeClick}
                onNodeContextMenu={flow.handleNodeContextMenu}
              />
            </div>
            <div className="hidden w-[340px] shrink-0 xl:block xl:pt-24">
              <div className="space-y-4">
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
            </div>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div>
            <ReviewFlowMapPanel
              completed={flow.completed}
              visibleNonRootCount={flow.visibleNonRootCount}
              totalNodeCount={flow.totalNodeCount}
              fullscreen={flow.fullscreen}
              onToggleFullscreen={() =>
                flow.setFullscreen((current: boolean) => !current)
              }
              onRestart={onRestart ? flow.handleRestart : undefined}
              onComplete={() => void flow.finishFlow('manual_complete')}
              submitting={submitting}
              visibleEditorState={flow.visibleEditorState}
              onNodeClick={flow.handleNodeClick}
              onNodeContextMenu={flow.handleNodeContextMenu}
            />
          </div>
          <div className="space-y-4">
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
        </div>
      )}
    </div>
  )
}
