import * as React from "react";
import { toast } from "@/shared/feedback/toast";
import { useQuizLauncher } from "@/widgets/quiz-launcher";
import { getReviewSurpriseCopy } from "@/entities/review/model/review-feedback";
import { useReviewFlowSession } from "@/features/review/hooks/useReviewFlowSession";
import { useMemoryAnkiShortcuts } from "@/entities/preferences/model/memoryAnkiShortcuts";
import { persistStudySessionRecord } from "@/entities/session/model";
import type { MindMapSelection } from "@/features/mindmap-editor";
import type { MindMapEditorState } from "@/shared/api/contracts";
import { normalizeMindMapDocument as normalizeEditorDocTree } from '@/entities/mindmap-document'
import { isEditableKeyboardTarget } from "@/shared/keyboard/keyboardTargets";
import { cn } from "@/shared/lib/utils";
import type { MindMapReviewFlowProps } from "@/features/review/model/mind-map-review-flow";
import { useMindMapRecallRatings } from '@/features/review/hooks/useMindMapRecallRatings';

const EMPTY_CHECKPOINT_NODE_UIDS: string[] = [];

export function useMindMapReviewFlowController({
  title,
  palaceId,
  sessionKind,
  studySessionId = null,
  revealMode = "standard",
  checkpointNodeUids = EMPTY_CHECKPOINT_NODE_UIDS,
  displayMode = "review",
  persistKey = null,
  reviewEditorState,
  editEditorState = null,
  onComplete,
  onModeToggle,
  onEditEditorStateChange,
  onRestart,
  persistProgress = false,
  initialSnapshot = null,
  onSnapshotChange,
  onFullscreenChange,
}: MindMapReviewFlowProps) {
  const [feedbackDialogOpen, setFeedbackDialogOpen] = React.useState(false);
  const [completionDialogOpen, setCompletionDialogOpen] = React.useState(false);
  const [savingIncomplete, setSavingIncomplete] = React.useState(false);
  const [activeNodes, setActiveNodes] = React.useState<MindMapSelection[]>([]);
  const [comboBurst, setComboBurst] = React.useState<{
    milestoneStep: number;
    comboCount: number;
    copy: string;
    label: string | null;
  } | null>(null);
  const selectedNode = activeNodes[0] ?? null;
  const selectedNodeUid = selectedNode?.uid ? String(selectedNode.uid) : null;
  const recallRatings = useMindMapRecallRatings({ palaceId, studySessionId, enabled: sessionKind === 'review' && Boolean(studySessionId) });
  const reviewNodeUids = React.useMemo(() => {
    const doc = normalizeEditorDocTree(reviewEditorState.editor_doc);
    const result: string[] = [];
    const walk = (node: NonNullable<typeof doc.root>, isRoot = false) => {
      const uid = String(node.data?.uid ?? node.data?.memoryAnkiId ?? '');
      if (!isRoot && uid) result.push(uid);
      (node.children ?? []).forEach((child) => walk(child, false));
    };
    if (doc.root) walk(doc.root, true);
    return result;
  }, [reviewEditorState.editor_doc]);


  const flow = useReviewFlowSession({
    title,
    palaceId,
    sessionKind,
    revealMode,
    checkpointNodeUids,
    persistKey,
    editorState: reviewEditorState,
    onComplete,
    onRestart,
    persistProgress,
    initialSnapshot,
    onSnapshotChange,
    onFullscreenChange,
  });

  const handleActiveNodes = React.useCallback((nodes: MindMapSelection[]) => {
    flow.timer.registerActivity("practice_interaction", { source: "review_node_navigation" });
    setActiveNodes(nodes);
  }, [flow.timer]);
  const { startWeakRetryRound } = flow;
  const { firstRatings, round: recallRound, setRound: setRecallRound, weakNodeUids } = recallRatings;

  React.useEffect(() => {
    if (recallRound !== 'first' || reviewNodeUids.length === 0) return;
    if (!reviewNodeUids.every((uid) => firstRatings.has(uid))) return;
    if (weakNodeUids.length > 0) {
      startWeakRetryRound(weakNodeUids);
      setRecallRound('weak_retry');
    }
  }, [firstRatings, recallRound, reviewNodeUids, setRecallRound, startWeakRetryRound, weakNodeUids]);
  const inlineEditEnabled =
    typeof onModeToggle === "function" &&
    typeof onEditEditorStateChange === "function" &&
    Boolean(editEditorState);
  const { openQuizLauncher } = useQuizLauncher();

  const animationEnabled = flow.feedback.animationEnabled;
  React.useEffect(() => {
    if (!animationEnabled) {
      return;
    }
    const milestoneCelebration = flow.feedback.milestoneCelebration;
    if (!milestoneCelebration) return;
    setComboBurst({
      milestoneStep: milestoneCelebration.milestoneStep,
      comboCount: milestoneCelebration.comboCount,
      copy: getReviewSurpriseCopy(
        milestoneCelebration.comboCount,
        flow.feedback.settings.celebration.milestone.steps,
      ),
      label: flow.feedback.milestoneLabel,
    });
  }, [
    animationEnabled,
    flow.feedback.comboCount,
    flow.feedback.milestoneCelebration,
    flow.feedback.milestoneLabel,
    flow.feedback.settings.celebration.milestone.steps,
  ]);

  const resolvedDisplayMode =
    inlineEditEnabled && displayMode === "edit" ? "edit" : "review";
  const isInlineEditMode = resolvedDisplayMode === "edit";
  const isCheckpointMode = revealMode === "segment-checkpoint";
  const previousDisplayModeRef = React.useRef(resolvedDisplayMode);
  const mapDisplayMode: "review" | "edit" = resolvedDisplayMode;
  const mapEditorState = flow.visibleEditorState;
  const mapVisibleSyncKey = flow.visibleEditorSyncKey;
React.useEffect(() => {
    const previousDisplayMode = previousDisplayModeRef.current;
    if (previousDisplayMode === resolvedDisplayMode) return;
    if (resolvedDisplayMode === "edit") {
      flow.timer.logEvent("enter_edit_mode", {
        source: "review_inline_edit",
      });
      flow.timer.registerActivity("edit_operation", {
        source: "review_inline_edit_enter",
      });
    } else {
      flow.timer.logEvent("exit_edit_mode", {
        source: "review_inline_edit",
      });
      flow.timer.registerActivity("practice_interaction", {
        source: "review_inline_edit_exit",
      });
    }
    previousDisplayModeRef.current = resolvedDisplayMode;
  }, [flow.timer, resolvedDisplayMode]);

  const handleEditorStateChange = React.useCallback(
    (nextState: MindMapEditorState) => {
      flow.timer.registerActivity("edit_operation", {
        source: "review_inline_edit",
      });
      onEditEditorStateChange?.(nextState);
    },
    [flow.timer, onEditEditorStateChange],
  );


  const handleShortcutHideChildCards = React.useCallback(() => {
    if (isInlineEditMode) return;
    const node = activeNodes[0];
    if (!node?.uid) return;
    flow.handleNodeContextMenu([node]);
  }, [activeNodes, flow, isInlineEditMode]);

  const shortcutHandlers = React.useMemo(
    () => ({
      hide_child_cards_review: handleShortcutHideChildCards,
    }),
    [handleShortcutHideChildCards],
  );

  useMemoryAnkiShortcuts(
    isInlineEditMode ? "edit" : "review",
    shortcutHandlers,
    true,
  );

  const handleShortcutAdvanceReview = React.useCallback(() => {
    if (
      isInlineEditMode ||
      isCheckpointMode ||
      flow.completed ||
      activeNodes.length === 0
    ) {
      return;
    }
    flow.handleNodeClick(activeNodes);
  }, [
    activeNodes,
    flow,
    isCheckpointMode,
    isInlineEditMode,
  ]);

  const handleSpacePourRef = React.useRef(flow.handleSpacePour);
  handleSpacePourRef.current = flow.handleSpacePour;

  React.useEffect(() => {
    if (!isCheckpointMode) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === " " || event.code === "Space") {
        if (isEditableKeyboardTarget(event.target)) return;
        event.preventDefault();
        event.stopPropagation();
        handleSpacePourRef.current();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [flow.handleSpacePour, isCheckpointMode]);

  React.useEffect(() => {
    if (isInlineEditMode || isCheckpointMode) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key !== " " && event.code !== "Space") return;
      if (isEditableKeyboardTarget(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      handleShortcutAdvanceReview();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [handleShortcutAdvanceReview, isCheckpointMode, isInlineEditMode]);

  const handleFullscreenToggle = React.useCallback(
    (active?: boolean) => {
      if (typeof active === "boolean") {
        flow.setFullscreen(active);
        return;
      }
      flow.setFullscreen((current: boolean) => !current);
    },
    [flow],
  );

  const handleMarkUncompleted = React.useCallback(async () => {
    if (savingIncomplete) return;
    setCompletionDialogOpen(false);
    setSavingIncomplete(true);
    try {
      flow.timer.registerActivity("practice_interaction", {
        source: "complete_unfinished",
      });
      const record = await flow.timer.complete("saved", {
        revealed_remaining: false,
        red_marked_count: flow.redNodeCount,
      });
      if (record && sessionKind === "review") {
        await persistStudySessionRecord(record);
      }
      toast.success("已保存进度和本段时长，下次可继续");
    } catch {
      toast.error("进度已保留，但本段时长保存失败，请稍后重试");
    } finally {
      flow.timer.reset();
      setSavingIncomplete(false);
    }
  }, [flow.redNodeCount, flow.timer, savingIncomplete, sessionKind]);

  const handleQuizBreakOpen = React.useCallback(() => {
    flow.timer.registerActivity("practice_interaction", {
      source: "quiz_launcher_open",
    });
    if (!palaceId) return;
    openQuizLauncher({
      palaceId,
      scene: sessionKind,
      reviewEditorDoc: reviewEditorState.editor_doc,
    });
  }, [
    flow.timer,
    openQuizLauncher,
    palaceId,
    reviewEditorState.editor_doc,
    sessionKind,
  ]);

  const handleToggleFeedbackSound = React.useCallback(() => {
    flow.feedback.updateSettings((current) => ({
      ...current,
      soundEnabled: !current.soundEnabled,
    }));
  }, [flow.feedback]);

  const handleFeedbackVolumeChange = React.useCallback(
    (volume: number) => {
      flow.feedback.updateSettings((current) => ({
        ...current,
        volume,
      }));
    },
    [flow.feedback],
  );

  const handleToggleFeedbackAnimation = React.useCallback(() => {
    flow.feedback.updateSettings((current) => ({
      ...current,
      animationEnabled: !current.animationEnabled,
    }));
  }, [flow.feedback]);

  const handleToggleFeedbackSurprise = React.useCallback(() => {
    flow.feedback.updateSettings((current) => ({
      ...current,
      surpriseEnabled: !current.surpriseEnabled,
    }));
  }, [flow.feedback]);

  const handleCycleFeedbackGlobalIntensity = React.useCallback(() => {
    flow.feedback.updateSettings((current) => ({
      ...current,
      globalIntensity:
        current.globalIntensity === "balanced"
          ? "immersive"
          : current.globalIntensity === "immersive"
            ? "quiet"
            : "balanced",
    }));
  }, [flow.feedback]);

  const progressToneClassName =
    flow.feedback.progressTone === "all-clear"
      ? "memory-anki-review-progress-all-clear"
      : flow.feedback.progressTone === "surge"
        ? "memory-anki-review-progress-surge"
        : flow.feedback.progressTone === "warmup"
          ? "memory-anki-review-progress-warmup"
          : "memory-anki-review-progress-calm";
  const completeButtonClassName = cn(
    flow.feedback.allClearReady &&
      !flow.feedback.completionCeremonyActive &&
      "memory-anki-review-complete-ready border-warning bg-warning text-white hover:bg-warning",
  );
  const cardFlashClassName =
    flow.feedback.animationEnabled &&
    flow.feedback.feedbackFlashState !== "idle"
      ? `memory-anki-review-card-flash memory-anki-review-card-flash-${flow.feedback.feedbackFlashState}`
      : "";

  return {
    flow,
    feedbackDialogOpen,
    setFeedbackDialogOpen,
    completionDialogOpen,
    setCompletionDialogOpen,
    savingIncomplete,
    comboBurst,
    setComboBurst,
    activeNodes,
    selectedNodeUid,
    reviewNodeUids,
    handleActiveNodes,
    inlineEditEnabled,
    resolvedDisplayMode,
    isInlineEditMode,
    isCheckpointMode,
    mapDisplayMode,
    mapEditorState,
    mapVisibleSyncKey,
    progressToneClassName,
    completeButtonClassName,
    cardFlashClassName,
    handleEditorStateChange,
    handleFullscreenToggle,
    handleMarkUncompleted,
    handleQuizBreakOpen,
    handleToggleFeedbackSound,
    handleFeedbackVolumeChange,
    handleToggleFeedbackAnimation,
    handleToggleFeedbackSurprise,
    handleCycleFeedbackGlobalIntensity,
    handleShortcutAdvanceReview,
    recallRatings,
  };
}

export type MindMapReviewFlowController = ReturnType<
  typeof useMindMapReviewFlowController
>;


