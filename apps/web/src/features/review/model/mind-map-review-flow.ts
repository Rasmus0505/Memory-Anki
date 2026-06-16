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
}

export interface MindMapReviewFlowProps {
  title: string;
  palaceId: number | null;
  sessionKind: "practice" | "review";
  revealMode?: RevealFlowMode;
  checkpointNodeUids?: string[];
  displayMode?: "review" | "edit";
  modeSyncVersion?: number;
  viewMemoryScope?: string | null;
  persistKey?: string | null;
  reviewEditorState: MindMapEditorState;
  editEditorState?: MindMapEditorState | null;
  onComplete: (payload: CompleteFlowPayload) => void | Promise<void>;
  onModeToggle?: () => void | Promise<void>;
  onEditEditorStateChange?: (nextState: MindMapEditorState) => void;
  onRestart?: () => void;
  submitting?: boolean;
  editSaving?: boolean;
  editError?: string | null;
  persistProgress?: boolean;
  initialSnapshot?: ReviewFlowSnapshot | null;
  focusNodeUids?: string[];
  onSnapshotChange?: (snapshot: ReviewFlowSnapshot) => void;
  onFullscreenChange?: (active: boolean) => void;
  onToggleFocusNode?: (nodeUid: string) => void | Promise<void>;
}
