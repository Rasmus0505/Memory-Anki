import * as React from "react";
import { toast } from "@/shared/feedback/toast";
import { useMiniPalaceController } from "@/features/mini-palace";
import { useQuizLauncher } from "@/features/palace-quiz/QuizLauncherProvider";
import { getReviewSurpriseCopy } from "@/features/review/model/review-feedback";
import { useReviewFlowSession } from "@/features/review/hooks/useReviewFlowSession";
import { useMemoryAnkiShortcuts } from "@/entities/preferences/model/memoryAnkiShortcuts";
import { persistStudySessionRecord } from "@/entities/session/model";
import type { MindMapSelection } from "@/shared/components/mindmap-host";
import type { MindMapEditorState } from "@/shared/api/contracts";
import { isEditableKeyboardTarget } from "@/shared/keyboard/keyboardTargets";
import { cn } from "@/shared/lib/utils";
import type { MindMapReviewFlowProps } from "@/features/review/model/mind-map-review-flow";

const EMPTY_CHECKPOINT_NODE_UIDS: string[] = [];

export function useMindMapReviewFlowController({
  title,
  palaceId,
  sessionKind,
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
  focusNodeUids: initialFocusNodeUids = [],
  onSnapshotChange,
  onFullscreenChange,
  onToggleFocusNode,
}: MindMapReviewFlowProps) {
  const initialFocusNodeUidsKey = React.useMemo(
    () =>
      JSON.stringify(
        initialFocusNodeUids.map((uid) => String(uid)).filter(Boolean).sort(),
      ),
    [initialFocusNodeUids],
  );
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
  const [focusNodeUids, setFocusNodeUids] = React.useState<string[]>(() =>
    initialFocusNodeUids.map((uid) => String(uid)).filter(Boolean),
  );
  const selectedNode = activeNodes[0] ?? null;
  const selectedNodeUid = selectedNode?.uid ? String(selectedNode.uid) : null;
  const selectedNodeText = selectedNode?.text ? String(selectedNode.text) : "";

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
  const inlineEditEnabled =
    typeof onModeToggle === "function" &&
    typeof onEditEditorStateChange === "function" &&
    Boolean(editEditorState);
  const miniPalaceSourceEditorState =
    inlineEditEnabled && editEditorState ? editEditorState : reviewEditorState;
  const miniPalace = useMiniPalaceController({
    palaceId,
    title,
    editorState: miniPalaceSourceEditorState,
    selectedNodeUid,
    selectedNodeText,
    timer: flow.timer,
  });
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
  const isDedicatedMiniMode = revealMode === "mini-checkpoint";
  const previousDisplayModeRef = React.useRef(resolvedDisplayMode);
  const mapDisplayMode: "review" | "edit" = miniPalace.isActive
    ? "review"
    : resolvedDisplayMode;
  const mapEditorState =
    miniPalace.visibleEditorState ??
    (miniPalace.isActive ? miniPalaceSourceEditorState : flow.visibleEditorState);
  const mapVisibleSyncKey = miniPalace.isActive
    ? miniPalace.visibleSyncKey
    : flow.visibleEditorSyncKey;

  React.useEffect(() => {
    setFocusNodeUids(JSON.parse(initialFocusNodeUidsKey) as string[]);
  }, [initialFocusNodeUidsKey]);

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

  const toggleFocusNodeUid = React.useCallback(
    async (nodeUid: string, source: string) => {
      if (!nodeUid) return;
      const previousFocusNodeUids = focusNodeUids;
      const wasFocused = previousFocusNodeUids.includes(nodeUid);
      const optimisticFocusNodeUids = wasFocused
        ? previousFocusNodeUids.filter((uid) => uid !== nodeUid)
        : [...previousFocusNodeUids, nodeUid];
      setFocusNodeUids(optimisticFocusNodeUids);
      flow.timer.registerActivity("edit_operation", { source });
      try {
        await onToggleFocusNode?.(nodeUid);
      } catch {
        setFocusNodeUids(previousFocusNodeUids);
      }
    },
    [flow.timer, focusNodeUids, onToggleFocusNode],
  );

  const handleEditNodeContextMenu = React.useCallback(
    (nodes: MindMapSelection[]) => {
      if (!isInlineEditMode) return;
      const nodeUid = nodes[0]?.uid ? String(nodes[0].uid) : "";
      if (!nodeUid) return;
      void toggleFocusNodeUid(nodeUid, "review_inline_edit_focus_contextmenu");
    },
    [isInlineEditMode, toggleFocusNodeUid],
  );

  const handleShortcutToggleFocusNode = React.useCallback(() => {
    if (!isInlineEditMode) return;
    const nodeUid = activeNodes[0]?.uid ? String(activeNodes[0].uid) : "";
    if (!nodeUid) return;
    void toggleFocusNodeUid(nodeUid, "shortcut_toggle_focus_node");
  }, [activeNodes, isInlineEditMode, toggleFocusNodeUid]);

  const handleShortcutHideChildCards = React.useCallback(() => {
    if (isInlineEditMode || miniPalace.isPracticing) return;
    const node = activeNodes[0];
    if (!node?.uid) return;
    flow.handleNodeContextMenu([node]);
  }, [activeNodes, flow, isInlineEditMode, miniPalace.isPracticing]);

  const shortcutHandlers = React.useMemo(
    () => ({
      toggle_focus_node: handleShortcutToggleFocusNode,
      hide_child_cards_review: handleShortcutHideChildCards,
    }),
    [handleShortcutHideChildCards, handleShortcutToggleFocusNode],
  );

  useMemoryAnkiShortcuts(
    isInlineEditMode ? "edit" : "review",
    shortcutHandlers,
    true,
  );

  const handleShortcutAdvanceReview = React.useCallback(() => {
    if (
      isInlineEditMode ||
      miniPalace.isActive ||
      isDedicatedMiniMode ||
      flow.completed ||
      activeNodes.length === 0
    ) {
      return;
    }
    flow.handleNodeClick(activeNodes);
  }, [
    activeNodes,
    flow,
    isDedicatedMiniMode,
    isInlineEditMode,
    miniPalace.isActive,
  ]);

  const handleSpacePourRef = React.useRef(miniPalace.handleSpacePour);
  handleSpacePourRef.current = miniPalace.isPracticing
    ? miniPalace.handleSpacePour
    : flow.handleSpacePour;

  React.useEffect(() => {
    if (!miniPalace.isPracticing && !isDedicatedMiniMode) return;
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
  }, [flow.handleSpacePour, isDedicatedMiniMode, miniPalace.isPracticing]);

  React.useEffect(() => {
    if (isInlineEditMode || miniPalace.isActive || isDedicatedMiniMode) return;
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
  }, [handleShortcutAdvanceReview, isDedicatedMiniMode, isInlineEditMode, miniPalace.isActive]);

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
    miniPalace,
    feedbackDialogOpen,
    setFeedbackDialogOpen,
    completionDialogOpen,
    setCompletionDialogOpen,
    savingIncomplete,
    comboBurst,
    setComboBurst,
    activeNodes,
    setActiveNodes,
    focusNodeUids,
    inlineEditEnabled,
    resolvedDisplayMode,
    isInlineEditMode,
    isDedicatedMiniMode,
    mapDisplayMode,
    mapEditorState,
    mapVisibleSyncKey,
    progressToneClassName,
    completeButtonClassName,
    cardFlashClassName,
    handleEditorStateChange,
    handleEditNodeContextMenu,
    handleFullscreenToggle,
    handleMarkUncompleted,
    handleQuizBreakOpen,
    handleToggleFeedbackSound,
    handleFeedbackVolumeChange,
    handleToggleFeedbackAnimation,
    handleToggleFeedbackSurprise,
    handleCycleFeedbackGlobalIntensity,
    handleShortcutAdvanceReview,
  };
}

export type MindMapReviewFlowController = ReturnType<
  typeof useMindMapReviewFlowController
>;
