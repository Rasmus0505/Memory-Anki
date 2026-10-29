import * as React from "react";
import { useQuizLauncher } from "@/widgets/quiz-launcher";
import { getReviewSurpriseCopy } from "@/modules/memory/public";
import { useReviewFlowSession } from "@/modules/practice/public";
import { useMemoryAnkiShortcuts } from "@/modules/settings/public";
import type { MindMapSelection } from "@/modules/content/public";
import type { MindMapEditorState } from "@/shared/api/contracts";
import { normalizeMindMapDocument as normalizeEditorDocTree } from '@/modules/content/public'
import { useRouteResidency } from "@/shared/routing/RouteResidency";
import { cn } from "@/shared/lib/utils";
import type { MindMapReviewFlowProps } from "@/modules/practice/public";

const EMPTY_CHECKPOINT_NODE_UIDS: string[] = [];

/** A focused button/link owns Enter and Backspace; the card must not steal them. */
function isKeyboardControlTarget(event: KeyboardEvent) {
  return (
    event.target instanceof Element
    && Boolean(event.target.closest('button, a, [role="button"], [role="menuitem"]'))
  );
}

/** True when a modal dialog should block flip/rating shortcuts (not every role=dialog in the tree). */
function isBlockingDialogOpen(eventTarget?: EventTarget | null) {
  if (typeof document === "undefined") return false;
  const target = eventTarget instanceof Element ? eventTarget : null;
  if (target?.closest('[role="dialog"]')) return true;
  // Prefer visible modal dialogs; bare role=dialog can linger in non-blocking chrome.
  const modals = Array.from(document.querySelectorAll('[role="dialog"][aria-modal="true"]'));
  for (const modal of modals) {
    if (!(modal instanceof HTMLElement)) continue;
    // offsetParent null can mean fixed/fullscreen still visible — check client box.
    if (modal.getClientRects().length > 0) return true;
  }
  return false;
}

export function useMindMapReviewFlowController({
  title,
  palaceId,
  sessionKind,
  revealMode = "standard",
  checkpointNodeUids = EMPTY_CHECKPOINT_NODE_UIDS,
  displayMode = "review",
  reviewEditorState,
  editEditorState = null,
  onComplete,
  onModeToggle,
  onEditEditorStateChange,
  onRestart,
  initialSnapshot = null,
  onSnapshotChange,
  onFullscreenChange,
}: MindMapReviewFlowProps) {
  const [feedbackDialogOpen, setFeedbackDialogOpen] = React.useState(false);
  const [activeNodes, setActiveNodes] = React.useState<MindMapSelection[]>([]);
  const [comboBurst, setComboBurst] = React.useState<{
    milestoneStep: number;
    comboCount: number;
    copy: string;
    label: string | null;
  } | null>(null);
  const selectedNode = activeNodes[0] ?? null;
  const selectedNodeUid = selectedNode?.uid ? String(selectedNode.uid) : null;
  const reviewNodeUids = React.useMemo(() => {
    const doc = normalizeEditorDocTree(reviewEditorState.editor_doc);
    const result: string[] = [];
    const walk = (node: NonNullable<typeof doc.root>, isRoot = false) => {
      // Same identity order as canvas / guided rating model.
      const uid = String(node.data?.uid ?? node.data?.memoryAnkiId ?? '');
      if (!isRoot && uid) result.push(uid);
      (node.children ?? []).forEach((child) => walk(child, false));
    };
    if (doc.root) walk(doc.root, true);
    return result;
  }, [reviewEditorState.editor_doc]);


  const flow = useReviewFlowSession({
    title,
    sessionKind,
    revealMode,
    checkpointNodeUids,
    focusNodeUids: EMPTY_CHECKPOINT_NODE_UIDS,
    editorState: reviewEditorState,
    onComplete,
    onRestart,
    initialSnapshot,
    onSnapshotChange,
    onFullscreenChange,
  });

  const handleActiveNodes = React.useCallback((nodes: MindMapSelection[]) => {
    setActiveNodes(nodes);
  }, []);
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
  const mapDisplayMode: "review" | "edit" = resolvedDisplayMode;
  const mapEditorState = flow.visibleEditorState;
  const mapVisibleSyncKey = flow.visibleEditorSyncKey;

  const handleEditorStateChange = React.useCallback(
    (nextState: MindMapEditorState) => {
      onEditEditorStateChange?.(nextState);
    },
    [onEditEditorStateChange],
  );


  const handleShortcutHideChildCards = React.useCallback((): boolean => {
    if (isInlineEditMode) return false;
    if (isBlockingDialogOpen()) return false;
    const node = activeNodes[0];
    if (!node?.uid) return false;
    flow.handleNodeContextMenu([node]);
    return true;
  }, [activeNodes, flow, isInlineEditMode]);

  const handleShortcutFlipCurrent = React.useCallback(
    (event: KeyboardEvent): boolean => {
      if (isKeyboardControlTarget(event)) return false;
      if (isInlineEditMode || isCheckpointMode || flow.completed) return false;
      if (isBlockingDialogOpen()) return false;
      if (activeNodes.length === 0) return false;
      flow.handleNodeClick(activeNodes);
      return true;
    },
    [activeNodes, flow, isCheckpointMode, isInlineEditMode],
  );

  const handleShortcutRetractCurrent = React.useCallback(
    (event: KeyboardEvent): boolean => {
      if (isKeyboardControlTarget(event)) return false;
      if (isInlineEditMode || flow.completed) return false;
      if (isBlockingDialogOpen()) return false;
      if (activeNodes.length === 0) return false;
      return flow.handleNodeRetract(activeNodes);
    },
    [activeNodes, flow, isInlineEditMode],
  );

  const shortcutHandlers = React.useMemo(() => {
    if (isInlineEditMode) return {};
    return {
      flip_current_card: handleShortcutFlipCurrent,
      retract_current_card: handleShortcutRetractCurrent,
      hide_child_cards: handleShortcutHideChildCards,
    };
  }, [
    handleShortcutFlipCurrent,
    handleShortcutHideChildCards,
    handleShortcutRetractCurrent,
    isInlineEditMode,
  ]);

  // A resident page must not flip cards while the learner is on another route.
  const { isActive: routeActive } = useRouteResidency();
  useMemoryAnkiShortcuts("flip", shortcutHandlers, routeActive);

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

  // Space is deliberately not a shortcut here: a card can be in inline edit, and a
  // keypress meant for typing must never advance (翻卡) the card underneath. The
  // flip map owns Enter/Backspace; nothing else binds the space bar.
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


  const handleQuizBreakOpen = React.useCallback(() => {
    if (!palaceId) return;
    openQuizLauncher({
      palaceId,
      scene: sessionKind,
      reviewEditorDoc: reviewEditorState.editor_doc,
    });
  }, [
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
    handleQuizBreakOpen,
    handleToggleFeedbackSound,
    handleFeedbackVolumeChange,
    handleToggleFeedbackAnimation,
    handleToggleFeedbackSurprise,
    handleShortcutAdvanceReview,
  };
}

export type MindMapReviewFlowController = ReturnType<
  typeof useMindMapReviewFlowController
>;
