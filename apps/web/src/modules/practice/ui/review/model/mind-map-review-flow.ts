import type {
  RevealFlowMode,
  ReviewFlowSnapshot,
} from "@/modules/memory/public";
import type { MindMapEditorState } from "@/shared/api/contracts";

export interface CompleteFlowPayload {
  durationSeconds: number;
  completionMode: "manual_complete" | "auto_complete";
  revealedRemaining: boolean;
  redNodeIds: string[];
  finalize: (options?: { persistTimeRecord?: boolean }) => Promise<void>;
  cancel: () => void;
}

export interface MindMapReviewFlowProps {
  title: string;
  palaceId: number | null;
  sessionKind: "practice" | "review";
  studySessionId?: string | null;
  revealMode?: RevealFlowMode;
  checkpointNodeUids?: string[];
  /**
   * Frozen formal-review due UIDs. Used for weak-retry / AI scope / rating limits.
   * When autoRevealNonDueCards is true (default), also drives flip focus so
   * non-due cards skip placeholder and open fully.
   */
  reviewScopeNodeUids?: string[];
  /**
   * Formal palace review: true — auto-reveal non-due cards, only due need flip.
   * Freestyle unit review: false — every unit node goes hidden → 待回忆 → content.
   */
  autoRevealNonDueCards?: boolean;
  displayMode?: "review" | "edit";
  modeSyncVersion?: number;
  viewMemoryScope?: string | null;
  persistKey?: string | null;
  reviewEditorState: MindMapEditorState;
  editEditorState?: MindMapEditorState | null;
  /**
   * Full document for subtree rating cascade. Prefer this over any reveal-filtered
   * visible tree so parent ratings still walk all descendants.
   */
  ratingTreeEditorState?: MindMapEditorState | null;
  onComplete: (payload: CompleteFlowPayload) => void | Promise<void>;
  onModeToggle?: () => void | Promise<void>;
  onEditEditorStateChange?: (nextState: MindMapEditorState) => void;
  onRestart?: () => boolean | void | Promise<boolean | void>;
  submitting?: boolean;
  editSaving?: boolean;
  editError?: string | null;
  persistProgress?: boolean;
  initialSnapshot?: ReviewFlowSnapshot | null;
  onSnapshotChange?: (snapshot: ReviewFlowSnapshot) => void;
  onFullscreenChange?: (active: boolean) => void;
  ratingMode?: boolean;
  onToggleRatingMode?: () => void;
  /**
   * default: full review chrome (combo panel, AI, keyboard badges).
   * compact: freestyle / PWA card — thin progress row so the map keeps the viewport.
   */
  chromeDensity?: "default" | "compact";
  /**
   * Extra overflow-menu actions for the flip-card toolbar (e.g. freestyle
   * “查看完整导图”). Merged before built-in 翻卡快捷键.
   */
  extraMoreActions?: Array<{
    label: string
    onClick: () => void
    disabled?: boolean
    opensOverlay?: boolean
    destructive?: boolean
    separatorBefore?: boolean
  }>
}
