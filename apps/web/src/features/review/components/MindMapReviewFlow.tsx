import { RotateCcw, Settings2, Sparkles, SquareCheckBig, Volume2, Waves } from "lucide-react";
import { BilinkPreviewPopover, BilinkSearchPopover } from "@/features/bilink";
import { CompletionDecisionDialog } from "@/features/review/components/CompletionDecisionDialog";
import { ReviewFeedbackSettingsDialog } from "@/features/review/components/ReviewFeedbackSettingsDialog";
import { ReviewFlowMapPanel } from "@/features/review/components/ReviewFlowMapPanel";
import { useMindMapReviewFlowController } from "@/features/review/hooks/useMindMapReviewFlowController";
import type { MindMapReviewFlowProps } from "@/features/review/model/mind-map-review-flow";
import { MiniPalacePanel } from "@/features/mini-palace";
import { ComboMilestoneBurst, CompletionCelebration } from "@/shared/components/celebration";
import { SessionTimerBar } from "@/shared/components/session/SessionTimerBar";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { cn } from "@/shared/lib/utils";
import { VoiceCoachSettingsDialog } from "@/features/voice-coach";

export type { ReviewFlowSnapshot } from "@/entities/review/model/review-flow-tree";
export type {
  CompleteFlowPayload,
  MindMapReviewFlowProps,
} from "@/features/review/model/mind-map-review-flow";

export function MindMapReviewFlow({
  modeSyncVersion = 0,
  viewMemoryScope = null,
  editSaving = false,
  editError = null,
  submitting = false,
  ...props
}: MindMapReviewFlowProps) {
  const review = useMindMapReviewFlowController({
    ...props,
    modeSyncVersion,
    viewMemoryScope,
    editSaving,
    editError,
    submitting,
  });

  return (
    <div className={cn("space-y-5", review.flow.screenGlowClass)}>
      {review.comboBurst ? (
        <ComboMilestoneBurst
          milestoneStep={review.comboBurst.milestoneStep}
          comboCount={review.comboBurst.comboCount}
          copy={review.comboBurst.copy}
          onComplete={() => review.setComboBurst(null)}
        />
      ) : null}

      {review.flow.feedback.completionCeremonyActive &&
      review.flow.feedback.animationEnabled ? (
        <CompletionCelebration
          maxCombo={review.flow.feedback.maxComboCount}
          completedNodes={review.flow.visibleNonRootCount}
          totalNodes={Math.max(review.flow.totalNodeCount - 1, 0)}
        />
      ) : null}

      <div
        className={cn(
          "grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]",
          review.flow.fullscreen && "grid-cols-1",
        )}
      >
        <div className={cn("space-y-4", review.flow.fullscreen && "hidden")}>
          <SessionTimerBar
            effectiveSeconds={review.flow.timer.effectiveSeconds}
            idleSeconds={review.flow.timer.idleSeconds}
            automationScene={props.sessionKind === "review" ? "review" : "practice"}
            pauseCount={review.flow.timer.pauseCount}
            status={review.flow.timer.status}
            onStart={() => review.flow.timer.start({ source: "manual" })}
            onPause={() => review.flow.timer.pause({ source: "manual" })}
            onResume={() => review.flow.timer.resume({ source: "manual" })}
            onAdjustDuration={review.flow.timer.adjustDuration}
            showCompleteAction={false}
            showRestartAction={false}
            className="sticky top-5 z-20"
          />
        </div>

        <div className={cn("space-y-4", review.flow.fullscreen && "space-y-0")}>
          <Card
            className={cn(
              "relative min-h-[74vh] overflow-hidden border-border/70 bg-card/92",
              review.cardFlashClassName,
              review.flow.fullscreen &&
                "fixed inset-x-5 bottom-5 top-5 z-[90] min-h-0 bg-card/96 shadow-2xl",
            )}
          >
            {review.flow.feedback.completionCeremonyActive ? (
              <div className="pointer-events-none absolute inset-x-0 top-0 z-[100] flex justify-center px-4 pt-4">
                <div className="memory-anki-review-completion-banner inline-flex items-center gap-2 rounded-full border border-warning/30 bg-warning/10 px-4 py-2 text-sm font-semibold text-warning shadow-lg">
                  <Sparkles className="h-4 w-4" />
                  通关结算中
                </div>
              </div>
            ) : null}
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 flex-1 flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle className="text-base">
                    {props.sessionKind === "practice" ? "练习脑图" : "复习脑图"}
                  </CardTitle>
                  {!review.inlineEditEnabled && !review.isInlineEditMode ? (
                    <Badge variant="secondary">翻卡模式</Badge>
                  ) : null}
                  <Badge variant="outline">
                    已出现 {review.flow.visibleNonRootCount} /{" "}
                    {Math.max(review.flow.totalNodeCount - 1, 0)}
                  </Badge>
                  {review.flow.redNodeCount > 0 ? (
                    <Badge variant="outline">红标 {review.flow.redNodeCount}</Badge>
                  ) : null}
                  {review.flow.completed ? (
                    <Badge className="bg-success text-white hover:bg-success">
                      本次已完成
                    </Badge>
                  ) : null}
                </div>

                {!review.isInlineEditMode ? (
                  <div className="rounded-3xl border border-border/70 bg-card/90 px-4 py-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <div
                          className={cn(
                            "memory-anki-review-combo-badge inline-flex min-w-[108px] items-center justify-center rounded-2xl border px-3 py-2 text-sm font-semibold",
                            review.flow.feedback.animationEnabled &&
                              review.flow.feedback.feedbackFlashState === "card_reveal" &&
                              "memory-anki-review-combo-badge-pop",
                          )}
                        >
                          连击 {review.flow.feedback.comboCount}
                        </div>
                        <Badge variant="outline">
                          最高 {review.flow.feedback.maxComboCount}
                        </Badge>
                        <Badge variant="outline">
                          {review.flow.feedback.nextMilestone == null
                            ? "已越过全部里程碑"
                            : `下一里程碑 ${review.flow.feedback.nextMilestone}`}
                        </Badge>
                        {review.flow.feedback.allClearReady ? (
                          <Badge className="bg-warning text-white hover:bg-warning">
                            可结算
                          </Badge>
                        ) : null}
                        {review.flow.feedback.surpriseText ? (
                          <Badge className="max-w-full bg-success text-white hover:bg-success">
                            {review.flow.feedback.surpriseText}
                          </Badge>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge
                          variant={
                            review.flow.feedback.settings.mode === "immersive"
                              ? "secondary"
                              : "outline"
                          }
                        >
                          {review.flow.feedback.settings.mode === "immersive"
                            ? "沉浸反馈"
                            : "安静模式"}
                        </Badge>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={review.flow.feedback.toggleMode}
                        >
                          <Waves className="mr-2 h-4 w-4" />
                          {review.flow.feedback.settings.mode === "immersive"
                            ? "一键降噪"
                            : "恢复沉浸"}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => review.setFeedbackDialogOpen(true)}
                        >
                          <Settings2 className="mr-2 h-4 w-4" />
                          反馈设置
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => review.setVoiceCoachDialogOpen(true)}
                        >
                          <Volume2 className="mr-2 h-4 w-4" />
                          {review.voiceCoach.enabled ? "语音教练" : "开启语音"}
                        </Button>
                      </div>
                    </div>
                    <div className="mt-3">
                      <div className="h-2.5 overflow-hidden rounded-full bg-border">
                        <div
                          className={cn(
                            "h-full rounded-full transition-[width,background] duration-300",
                            review.progressToneClassName,
                          )}
                          style={{ width: `${review.flow.feedback.progressPercent}%` }}
                        />
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {props.onRestart && !review.isInlineEditMode ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={review.miniPalace.isActive}
                    onClick={review.flow.handleRestart}
                  >
                    <RotateCcw className="mr-2 h-4 w-4" />
                    重新开始
                  </Button>
                ) : null}
                {review.isInlineEditMode && editSaving ? (
                  <Badge variant="secondary">自动保存中</Badge>
                ) : null}
                {review.isInlineEditMode && editError ? (
                  <Badge variant="destructive">保存异常</Badge>
                ) : null}
                {!review.isInlineEditMode ? (
                  <Button
                    type="button"
                    size="sm"
                    disabled={
                      submitting ||
                      review.flow.feedback.completionCeremonyActive ||
                      review.miniPalace.isActive
                    }
                    className={review.completeButtonClassName}
                    onClick={() => review.setCompletionDialogOpen(true)}
                  >
                    <SquareCheckBig className="mr-2 h-4 w-4" />
                    {review.flow.feedback.allClearReady ? "完成结算" : "完成"}
                  </Button>
                ) : null}
              </div>
            </CardHeader>
            <CardContent
              className={cn(
                "min-h-[64vh]",
                review.flow.fullscreen && "h-[calc(100vh-108px)] min-h-0",
              )}
            >
              <div className="h-full min-h-0">
                <ReviewFlowMapPanel
                  fullscreen={review.flow.fullscreen}
                  displayMode={review.mapDisplayMode}
                  modeSyncVersion={modeSyncVersion}
                  viewMemoryScope={viewMemoryScope}
                  onToggleFullscreen={review.handleFullscreenToggle}
                  onToggleMode={
                    review.inlineEditEnabled &&
                    props.onModeToggle &&
                    !review.miniPalace.isActive
                      ? () => {
                          void props.onModeToggle?.();
                        }
                      : undefined
                  }
                  visibleEditorState={review.mapEditorState ?? review.flow.visibleEditorState}
                  editableEditorState={props.editEditorState}
                  visibleEditorSyncKey={review.mapVisibleSyncKey}
                  bilinkCounts={review.bilinkCounts.counts}
                  bilinkItems={review.bilinks.items}
                  currentPalaceId={props.palaceId}
                  focusNodeUids={review.focusNodeUids}
                  bilinkInsertionText={review.bilinkOverlay.bilinkInsertionText}
                  bilinkInsertionNonce={review.bilinkOverlay.bilinkInsertionNonce}
                  reviewFxSignal={review.flow.feedback.reviewFxSignal}
                  showMiniPalaceButton={Boolean(props.palaceId)}
                  miniPalaceDraft={review.miniPalace.hostDraft}
                  miniPalacePracticeActive={
                    review.miniPalace.isPracticing || review.isDedicatedMiniMode
                  }
                  onEditorStateChange={review.handleEditorStateChange}
                  onNodeActive={review.setActiveNodes}
                  onNodeClick={
                    review.miniPalace.isActive
                      ? review.miniPalace.handleNodeClick
                      : review.flow.handleNodeClick
                  }
                  onNodeContextMenu={
                    review.miniPalace.isActive
                      ? review.miniPalace.handleNodeContextMenu
                      : review.flow.handleNodeContextMenu
                  }
                  onNodeHover={
                    review.miniPalace.isPracticing
                      ? review.miniPalace.handleNodeHover
                      : review.isDedicatedMiniMode
                        ? review.flow.handleNodeHover
                        : undefined
                  }
                  onEditNodeContextMenu={review.handleEditNodeContextMenu}
                  onBilinkTrigger={review.bilinkOverlay.handleBilinkTrigger}
                  onBilinkNodeClick={review.bilinkOverlay.handleBilinkNodeClick}
                  onBilinkToolbarSearch={() =>
                    review.bilinkOverlay.openBilinkSearch({
                      mode: "toolbar",
                      position: null,
                    })
                  }
                  onQuizBreakOpen={review.handleQuizBreakOpen}
                  onMiniPalaceOpen={review.miniPalace.openPanel}
                  onMiniPalacePour={
                    review.miniPalace.isPracticing
                      ? review.miniPalace.handleSpacePour
                      : review.flow.handleSpacePour
                  }
                />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <BilinkSearchPopover
        open={review.bilinkOverlay.bilinkSearchOpen}
        mode={review.bilinkOverlay.bilinkSearchMode}
        position={review.bilinkOverlay.bilinkSearchPosition}
        query={review.bilinkOverlay.bilinkSearchQuery}
        loading={review.bilinkOverlay.bilinkSearchLoading}
        error={review.bilinkOverlay.bilinkSearchError}
        results={review.bilinkOverlay.bilinkSearchResults}
        onQueryChange={review.bilinkOverlay.setBilinkSearchQuery}
        onClose={review.bilinkOverlay.closeBilinkSearch}
        onSelect={review.bilinkOverlay.handleBilinkSearchSelect}
        onPreview={review.bilinkOverlay.handleBilinkResultPreview}
      />

      <BilinkPreviewPopover
        open={review.bilinkOverlay.bilinkPreviewOpen}
        loading={review.bilinkOverlay.bilinkPreviewLoading}
        error={review.bilinkOverlay.bilinkPreviewError}
        context={review.bilinkOverlay.bilinkPreviewContext}
        editorState={review.bilinkOverlay.bilinkPreviewEditorState}
        highlightQuery={review.bilinkOverlay.bilinkPreviewHighlightQuery}
        onClose={() => review.bilinkOverlay.setBilinkPreviewOpen(false)}
        onJump={review.bilinkOverlay.jumpToBilinkContext}
      />

      <ReviewFeedbackSettingsDialog
        open={review.feedbackDialogOpen}
        onOpenChange={review.setFeedbackDialogOpen}
        mode={review.flow.feedback.settings.mode}
        soundEnabled={review.flow.feedback.settings.soundEnabled}
        volume={review.flow.feedback.settings.volume}
        animationEnabled={review.flow.feedback.settings.animationEnabled}
        surpriseEnabled={review.flow.feedback.settings.surpriseEnabled}
        globalIntensity={review.flow.feedback.settings.globalIntensity}
        onToggleMode={review.flow.feedback.toggleMode}
        onToggleSound={review.handleToggleFeedbackSound}
        onVolumeChange={review.handleFeedbackVolumeChange}
        onToggleAnimation={review.handleToggleFeedbackAnimation}
        onToggleSurprise={review.handleToggleFeedbackSurprise}
        onCycleGlobalIntensity={review.handleCycleFeedbackGlobalIntensity}
      />

      <VoiceCoachSettingsDialog
        open={review.voiceCoachDialogOpen}
        onOpenChange={review.setVoiceCoachDialogOpen}
        onTest={review.voiceCoach.playTestEvent}
      />

      <CompletionDecisionDialog
        open={review.completionDialogOpen}
        onOpenChange={review.setCompletionDialogOpen}
        durationSeconds={Math.max(1, review.flow.timer.effectiveSeconds)}
        onMarkCompleted={() => {
          review.setCompletionDialogOpen(false);
          void review.flow.finishFlow("manual_complete");
        }}
        onMarkUncompleted={() => {
          void review.handleMarkUncompleted();
        }}
        submitting={submitting || review.savingIncomplete}
      />

      <MiniPalacePanel controller={review.miniPalace} />
    </div>
  );
}
