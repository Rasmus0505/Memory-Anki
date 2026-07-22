import * as React from "react";
import { useQuizLauncher } from "@/widgets/quiz-launcher";
import { getReviewSurpriseCopy } from "@/modules/memory/public";
import { useReviewFlowSession } from "@/modules/practice/public";
import { useMemoryAnkiShortcuts } from "@/modules/settings/public";
import type { MindMapSelection } from "@/modules/content/public";
import type { MindMapEditorState } from "@/shared/api/contracts";
import { normalizeMindMapDocument as normalizeEditorDocTree } from '@/modules/content/public'
import { isEditableKeyboardTarget } from "@/shared/keyboard/keyboardTargets";
import { cn } from "@/shared/lib/utils";
import { toast } from "@/shared/feedback/toast";
import type { MindMapReviewFlowProps } from "@/modules/practice/public";
import { useMindMapRecallRatings } from '@/modules/practice/public';

const EMPTY_CHECKPOINT_NODE_UIDS: string[] = [];

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
  studySessionId = null,
  revealMode = "standard",
  checkpointNodeUids = EMPTY_CHECKPOINT_NODE_UIDS,
  reviewScopeNodeUids,
  autoRevealNonDueCards = true,
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
  const [activeNodes, setActiveNodes] = React.useState<MindMapSelection[]>([]);
  const [ratingMode, setRatingMode] = React.useState(false);
  const [comboBurst, setComboBurst] = React.useState<{
    milestoneStep: number;
    comboCount: number;
    copy: string;
    label: string | null;
  } | null>(null);
  const selectedNode = activeNodes[0] ?? null;
  const selectedNodeUid = selectedNode?.uid ? String(selectedNode.uid) : null;
  const recallRatings = useMindMapRecallRatings({ palaceId, studySessionId, enabled: Boolean(studySessionId), sourceScene: sessionKind === 'review' ? 'formal_review' : 'practice' });
  const reviewScopeKey = React.useMemo(
    () => JSON.stringify(reviewScopeNodeUids ?? null),
    [reviewScopeNodeUids],
  );
  const reviewNodeUids = React.useMemo(() => {
    const scoped = (JSON.parse(reviewScopeKey) as string[] | null)?.filter(Boolean) ?? [];
    if (scoped.length > 0) return scoped;
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
  }, [reviewEditorState.editor_doc, reviewScopeKey]);


  const flow = useReviewFlowSession({
    title,
    palaceId,
    sessionKind,
    revealMode,
    checkpointNodeUids,
    // Formal palace: focus=due so non-due open fully. Freestyle units pass
    // autoRevealNonDueCards=false for classic placeholder flip on every node.
    focusNodeUids: autoRevealNonDueCards ? reviewScopeNodeUids : EMPTY_CHECKPOINT_NODE_UIDS,
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
  // weakNodeUids / firstRatings stay on recallRatings for chips & AI; no auto
  // weak-retry re-hide — rating mode never mutates flip/placeholder state.
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


  const handleShortcutHideChildCards = React.useCallback((): boolean => {
    if (isInlineEditMode || ratingMode) return false;
    if (isBlockingDialogOpen()) return false;
    const node = activeNodes[0];
    if (!node?.uid) return false;
    flow.handleNodeContextMenu([node]);
    return true;
  }, [activeNodes, flow, isInlineEditMode, ratingMode]);

  // Refs keep A/S handlers current without rebinding window listeners every render.
  // Do not gate on React hover state: it lags behind hoveredNodeIdRef and is cleared
  // by mouseleave when reveal re-renders nodes between the two bulk-flip phases.
  const selectedNodeUidRef = React.useRef(selectedNodeUid);
  selectedNodeUidRef.current = selectedNodeUid;
  const isInlineEditModeRef = React.useRef(isInlineEditMode);
  isInlineEditModeRef.current = isInlineEditMode;
  const ratingModeRef = React.useRef(ratingMode);
  ratingModeRef.current = ratingMode;
  const flowCompletedRef = React.useRef(flow.completed);
  flowCompletedRef.current = flow.completed;
  const handleBulkRevealSubtreeRef = React.useRef(flow.handleBulkRevealSubtree);
  handleBulkRevealSubtreeRef.current = flow.handleBulkRevealSubtree;
  const handleBulkRevealDirectChildrenRef = React.useRef(flow.handleBulkRevealDirectChildren);
  handleBulkRevealDirectChildrenRef.current = flow.handleBulkRevealDirectChildren;

  const handleShortcutFlipSubtree = React.useCallback((): boolean => {
    if (isInlineEditModeRef.current || ratingModeRef.current || flowCompletedRef.current) {
      return false;
    }
    if (isBlockingDialogOpen()) return false;
    // Live hover / sticky / locked bulk / selection resolved inside handleBulkReveal*.
    return Boolean(handleBulkRevealSubtreeRef.current(selectedNodeUidRef.current));
  }, []);

  const handleShortcutFlipDirectChildren = React.useCallback((): boolean => {
    if (isInlineEditModeRef.current || ratingModeRef.current || flowCompletedRef.current) {
      return false;
    }
    if (isBlockingDialogOpen()) return false;
    return Boolean(handleBulkRevealDirectChildrenRef.current(selectedNodeUidRef.current));
  }, []);

  const shortcutScene =
    isInlineEditMode ? "edit" : sessionKind === "review" ? "review" : "practice";

  const shortcutHandlers = React.useMemo(() => {
    if (shortcutScene === "edit") return {};
    if (shortcutScene === "review") {
      return {
        hide_child_cards_review: handleShortcutHideChildCards,
        flip_subtree_cards_review: handleShortcutFlipSubtree,
        flip_direct_child_cards_review: handleShortcutFlipDirectChildren,
      };
    }
    return {
      hide_child_cards_practice: handleShortcutHideChildCards,
      flip_subtree_cards_practice: handleShortcutFlipSubtree,
      flip_direct_child_cards_practice: handleShortcutFlipDirectChildren,
    };
  }, [
    handleShortcutFlipDirectChildren,
    handleShortcutFlipSubtree,
    handleShortcutHideChildCards,
    shortcutScene,
  ]);

  useMemoryAnkiShortcuts(shortcutScene, shortcutHandlers, true);

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

  const handleSpacePourRef = React.useRef(flow.handleSpacePour)
  handleSpacePourRef.current = flow.handleSpacePour

  const canUseRatingMode = Boolean(palaceId && studySessionId && !isInlineEditMode && !flow.completed)
  React.useEffect(() => {
    if (canUseRatingMode || isInlineEditMode || !isCheckpointMode) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || (event.key !== ' ' && event.code !== 'Space')) return
      if (isEditableKeyboardTarget(event.target)) return
      event.preventDefault()
      event.stopPropagation()
      handleSpacePourRef.current()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [canUseRatingMode, isCheckpointMode, isInlineEditMode])

  React.useEffect(() => {
    if (canUseRatingMode || isInlineEditMode || isCheckpointMode) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return
      if (event.key !== ' ' && event.code !== 'Space') return
      if (isEditableKeyboardTarget(event.target)) return
      event.preventDefault()
      event.stopPropagation()
      handleShortcutAdvanceReview()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [canUseRatingMode, handleShortcutAdvanceReview, isCheckpointMode, isInlineEditMode])

  React.useEffect(() => {
    if (!canUseRatingMode && ratingMode) setRatingMode(false)
  }, [canUseRatingMode, ratingMode])

  const handleToggleRatingMode = React.useCallback(() => {
    if (!canUseRatingMode) return
    setRatingMode((current) => {
      const next = !current
      toast.success(next ? '已进入评分模式，点击节点即可评分' : '已退出评分模式')
      return next
    })
  }, [canUseRatingMode])

  React.useEffect(() => {
    if (!canUseRatingMode) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return
      if (event.key !== ' ' && event.code !== 'Space') return
      if (isEditableKeyboardTarget(event.target) || isBlockingDialogOpen(event.target)) return
      event.preventDefault()
      event.stopPropagation()
      handleToggleRatingMode()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [canUseRatingMode, handleToggleRatingMode])

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
    handleCycleFeedbackGlobalIntensity,
    handleShortcutAdvanceReview,
    recallRatings,
    ratingMode,
    canUseRatingMode,
    handleToggleRatingMode,
  };
}

export type MindMapReviewFlowController = ReturnType<
  typeof useMindMapReviewFlowController
>;


