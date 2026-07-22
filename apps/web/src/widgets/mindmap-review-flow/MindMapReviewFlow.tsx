import { Bot, RotateCcw, Sparkles, SquareCheckBig } from "lucide-react";
import { FlipCardMindMapPanel } from "./FlipCardMindMapPanel";
import { AiLearningWorkbench } from "./AiLearningWorkbench";
import { MindMapRatingHistoryDrawer } from "@/features/review/components/MindMapRatingHistoryDrawer";
import { useMindMapReviewFlowController } from "./useMindMapReviewFlowController";
import type { MindMapReviewFlowProps } from "@/features/review/model/mind-map-review-flow";
import { usePalaceQuizNodeBindings } from "@/features/palace-quiz/hooks/usePalaceQuizNodeBindings";
import { NodeBoundQuizDialog } from "@/widgets/node-bound-quiz";
import { ComboMilestoneBurst, CompletionCelebration } from "@/shared/components/celebration";
import { FlipCardShortcutsDialog } from "@/features/shortcuts/FlipCardShortcutsDialog";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/shared/components/ui/tooltip";
import { getReviewFeedbackEffectiveVolume } from "@/shared/feedback/reviewFeedbackSettings";
import { toast } from "@/shared/feedback/toast";
import { cn } from "@/shared/lib/utils";
import * as React from "react";
import type { MindMapRecallRating, MindMapRecallRound } from "@/shared/api/contracts";
import type { RatingConflictPolicy } from "@/features/review/api";

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
  const effectiveVolume = getReviewFeedbackEffectiveVolume(review.flow.feedback.settings);
  const [aiWorkbenchOpen, setAiWorkbenchOpen] = React.useState(false);
  const [flipShortcutsOpen, setFlipShortcutsOpen] = React.useState(false);
  const [nodeQuizOpen, setNodeQuizOpen] = React.useState(false);
  const [nodeQuizNodeUid, setNodeQuizNodeUid] = React.useState<string | null>(null);
  const [nodeQuizQuestionIds, setNodeQuizQuestionIds] = React.useState<number[]>([]);
  const flipShortcutScene =
    props.sessionKind === "review" ? ("review" as const) : ("practice" as const);
  const editorDocForBindings =
    (review.mapEditorState ?? review.flow.visibleEditorState ?? props.reviewEditorState)?.editor_doc;
  const quizNodeBindings = usePalaceQuizNodeBindings({
    palaceId: props.palaceId,
    editorDoc: editorDocForBindings,
    enabled: Boolean(props.palaceId),
  });
  const getOpenQuestionIds = quizNodeBindings.getOpenQuestionIds;
  const handleOpenNodeQuiz = React.useCallback(
    (nodeUid: string) => {
      const ids = getOpenQuestionIds(nodeUid);
      if (!ids.length) {
        toast.message("该卡片没有未完成的关联题目。");
        return;
      }
      setNodeQuizNodeUid(nodeUid);
      setNodeQuizQuestionIds(ids);
      setNodeQuizOpen(true);
    },
    [getOpenQuestionIds],
  );

  return (
    <div className={cn("space-y-5", review.flow.screenGlowClass)}>
      {review.comboBurst ? (
        <ComboMilestoneBurst
          key={review.flow.feedback.milestoneCelebration?.nonce ?? review.comboBurst.comboCount}
          milestoneStep={review.comboBurst.milestoneStep}
          comboCount={review.comboBurst.comboCount}
          copy={review.comboBurst.copy}
          label={review.comboBurst.label}
          confettiAmount={review.flow.feedback.settings.scenes.milestone.confettiAmount}
          reducedMotion={
            !review.flow.feedback.animationEnabled ||
            !review.flow.feedback.settings.celebration.milestone.animationEnabled
          }
          soundEnabled={review.flow.feedback.settings.celebration.milestone.soundEnabled}
          volume={effectiveVolume}
          confettiPreset={review.flow.feedback.settings.scenes.milestone.confettiPreset}
          onComplete={() => review.setComboBurst(null)}
        />
      ) : null}

      {review.flow.feedback.completionCeremonyActive &&
      review.flow.feedback.animationEnabled ? (
        <CompletionCelebration
          maxCombo={review.flow.feedback.maxComboCount}
          completedNodes={review.flow.visibleNonRootCount}
          totalNodes={Math.max(review.flow.totalNodeCount - 1, 0)}
          confettiAmount={review.flow.feedback.settings.scenes.completion.confettiAmount}
          reducedMotion={
            !review.flow.feedback.animationEnabled ||
            !review.flow.feedback.settings.celebration.sessionComplete.animationEnabled
          }
          soundEnabled={review.flow.feedback.settings.celebration.sessionComplete.soundEnabled}
          volume={effectiveVolume}
          confettiPreset={review.flow.feedback.settings.scenes.completion.confettiPreset}
        />
      ) : null}

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
                  <Sparkles className="size-4" />
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
                  {!review.isInlineEditMode ? (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Badge
                            variant="outline"
                            className="cursor-help"
                            title="Space：推进当前选中节点的揭示；1-5：在结算弹窗中选择反馈"
                          >
                            Space / 1-5
                          </Badge>
                        </TooltipTrigger>
                        <TooltipContent>
                          Space 推进当前选中节点；结算弹窗中可用数字键选择反馈。
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  ) : null}
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
                  <div className="rounded-lg border border-border/70 bg-card/90 px-4 py-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <div
                          className={cn(
                            "memory-anki-review-combo-badge inline-flex min-w-[108px] items-center justify-center rounded-lg border px-3 py-2 text-sm font-semibold",
                            review.flow.feedback.animationEnabled &&
                              review.flow.feedback.feedbackFlashState === "card_reveal" &&
                              "memory-anki-review-combo-badge-pop",
                          )}
                        >
                          推进链 {review.flow.feedback.comboCount}
                        </div>
                        <Badge variant="outline">
                          势能峰值 {review.flow.feedback.maxComboCount}
                        </Badge>
                        <Badge variant="outline">
                          {review.flow.feedback.nextMilestone == null
                            ? "已越过全部里程碑"
                            : `下一知识点 ${review.flow.feedback.nextMilestone}${review.flow.feedback.milestoneLabel ? ` · ${review.flow.feedback.milestoneLabel}` : ""}`}
                        </Badge>
                        {review.flow.feedback.allClearReady ? (
                          <Badge className="bg-warning text-white hover:bg-warning">
                            可攻克全域
                          </Badge>
                        ) : null}
                        {review.flow.feedback.surpriseText ? (
                          <Badge className="max-w-full bg-success text-white hover:bg-success">
                            {review.flow.feedback.surpriseText}
                          </Badge>
                        ) : null}
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
                {!review.isInlineEditMode ? (
                  <Button type="button" size="sm" variant={aiWorkbenchOpen ? "secondary" : "outline"} onClick={() => setAiWorkbenchOpen((value) => !value)}>
                    <Bot className="mr-2 size-4" />
                    AI 学习
                  </Button>
                ) : null}
                {props.onRestart && !review.isInlineEditMode ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => { void review.flow.handleRestart() }}
                  >
                    <RotateCcw className="mr-2 size-4" />
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
                      false
                    }
                    className={review.completeButtonClassName}
                    onClick={() => {
                      void review.flow.finishFlow("manual_complete");
                    }}
                  >
                    <SquareCheckBig className="mr-2 size-4" />
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
              <div className="relative flex h-full min-h-0">
                <div className="min-w-0 flex-1">
                  <FlipCardMindMapPanel
                    fullscreen={review.flow.fullscreen}
                    displayMode={review.mapDisplayMode}
                    sessionKind={props.sessionKind === 'review' ? 'review' : 'practice'}
                    modeSyncVersion={modeSyncVersion}
                    viewMemoryScope={viewMemoryScope}
                    onToggleFullscreen={review.handleFullscreenToggle}
                    onToggleMode={
                      review.inlineEditEnabled && props.onModeToggle
                        ? () => {
                            void props.onModeToggle?.();
                          }
                        : undefined
                    }
                    visibleEditorState={review.mapEditorState ?? review.flow.visibleEditorState}
                    editableEditorState={props.editEditorState}
                    ratingTreeEditorState={
                      // Prefer the explicit full rating tree over reveal-filtered visible state.
                      props.ratingTreeEditorState ?? props.editEditorState ?? props.reviewEditorState
                    }
                    visibleEditorSyncKey={review.mapVisibleSyncKey}
                    currentPalaceId={props.palaceId}
                    reviewFxSignal={review.flow.feedback.reviewFxSignal}
                    onEditorStateChange={review.handleEditorStateChange}
                    onNodeActive={review.handleActiveNodes}
                    onNodeClick={review.flow.handleNodeClick}
                    onNodeContextMenu={review.flow.handleNodeContextMenu}
                    onNodeHover={review.flow.handleNodeHover}
                    toolbarExtensions={{
                      moreActions: [
                        ...(props.extraMoreActions ?? []),
                        {
                          label: "翻卡快捷键",
                          onClick: () => setFlipShortcutsOpen(true),
                          opensOverlay: true,
                        },
                      ],
                    }}
                    onQuizBreakOpen={review.handleQuizBreakOpen}
                    countBadgeByNodeUid={quizNodeBindings.countBadgeByNodeUid}
                    onCountBadgeClick={handleOpenNodeQuiz}
                    // Always merge first + weak_retry so entering the retry round
                    // never blanks already-scored chips (记得/困难/轻松).
                    recallRatings={review.recallRatings.displayRatings}
                    recallRound={review.recallRatings.round}
                    weakNodeUids={review.recallRatings.weakNodeUids}
                    directRatedUids={review.recallRatings.directRatedUids}
                    sessionRatedUids={review.recallRatings.sessionRatedUids}
                    rateableNodeUids={
                      // Explicit scope (formal frozen due / freestyle unit) always gates rating.
                      // Unscoped practice keeps unrestricted rating (null).
                      Array.isArray(props.reviewScopeNodeUids) &&
                      props.reviewScopeNodeUids.length > 0
                        ? review.reviewNodeUids
                        : props.sessionKind === 'review' && review.reviewNodeUids.length > 0
                          ? review.reviewNodeUids
                          : null
                    }
                    onRateNode={
                      props.studySessionId
                        ? (
                            nodeUid: string,
                            rating: MindMapRecallRating,
                            round: MindMapRecallRound,
                            scope?: 'single' | 'subtree',
                            evidence?: {
                              source?: 'manual' | 'inferred'
                              confidence?: number | null
                              responseMs?: number | null
                            },
                            conflictPolicy?: RatingConflictPolicy,
                          ) => {
                            void review.recallRatings
                              .rateNode(nodeUid, rating, round, scope, evidence, conflictPolicy)
                              .catch((error: unknown) => {
                                toast.error(
                                  error instanceof Error && error.message
                                    ? error.message
                                    : '节点评分保存失败',
                                )
                              })
                          }
                        : undefined
                    }
                    onUndoRating={props.studySessionId ? review.recallRatings.undoLastRating : undefined}
                    onOpenRatingHistory={props.studySessionId ? () => review.recallRatings.setHistoryOpen(true) : undefined}
                    ratingMode={review.ratingMode}
                    onToggleRatingMode={review.canUseRatingMode ? review.handleToggleRatingMode : undefined}
                  />
                </div>
                <AiLearningWorkbench
                  open={aiWorkbenchOpen}
                  onOpenChange={setAiWorkbenchOpen}
                  title={props.title}
                  palaceId={props.palaceId}
                  reviewSessionId={props.studySessionId ? Number(props.studySessionId) : null}
                  editorState={review.mapEditorState ?? review.flow.visibleEditorState}
                  sourceRevision={(review.mapEditorState ?? review.flow.visibleEditorState).editor_fingerprint ?? String(modeSyncVersion)}
                  activeNodeUid={review.selectedNodeUid}
                  reviewNodeUids={review.reviewNodeUids}
                  redNodeUids={[...review.flow.redNodeIds]}
                  ratings={new Map([...review.recallRatings.firstRatings, ...review.recallRatings.retryRatings])}
                  fullscreen={review.flow.fullscreen}
                />
              </div>
            </CardContent>
          </Card>
      </div>

      <MindMapRatingHistoryDrawer
        open={review.recallRatings.historyOpen}
        onOpenChange={review.recallRatings.setHistoryOpen}
        events={review.recallRatings.currentEvents}
        onCorrect={(nodeUid, rating, round) => {
          void review.recallRatings.rateNode(nodeUid, rating, round).catch((error: unknown) => {
            toast.error(error instanceof Error && error.message ? error.message : '节点评分保存失败')
          })
        }}
      />

      <NodeBoundQuizDialog
        open={nodeQuizOpen}
        onOpenChange={setNodeQuizOpen}
        palaceId={props.palaceId}
        nodeUid={nodeQuizNodeUid}
        questionIds={nodeQuizQuestionIds}
        onQuestionCompleted={quizNodeBindings.markQuestionCompleted}
      />

      <FlipCardShortcutsDialog
        open={flipShortcutsOpen}
        onOpenChange={setFlipShortcutsOpen}
        scene={flipShortcutScene}
      />

    </div>
  );
}




