import type {
  RevealFlowMode,
  ReviewFlowSnapshot,
} from "@/entities/review/model/review-flow-tree";
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
   * Frozen formal-review due UIDs. Used for weak-retry / AI scope, and to
   * auto-reveal non-due cards so only due nodes need flipping.
   */
  reviewScopeNodeUids?: string[];
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
}
