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
  /**
   * Toolbar mode-toggle copy. Defaults: enter edit = "编辑", leave edit = "复习".
   * Freestyle uses leaveEdit = "返回随心" so the user knows progress continues on this card.
   */
  modeToggleLabels?: {
    enterEdit?: string;
    leaveEdit?: string;
  };
  onEditEditorStateChange?: (nextState: MindMapEditorState) => void;
  onRestart?: () => boolean | void | Promise<boolean | void>;
  submitting?: boolean;
  editSaving?: boolean;
  editError?: string | null;
  persistProgress?: boolean;
  initialSnapshot?: ReviewFlowSnapshot | null;
  onSnapshotChange?: (snapshot: ReviewFlowSnapshot) => void;
  onFullscreenChange?: (active: boolean) => void;
  /**
   * default: full review chrome (combo panel, AI, keyboard badges).
   * compact: freestyle / PWA card — thin progress row so the map keeps the viewport.
   */
  chromeDensity?: "default" | "compact";
  /**
   * card: self-framed surface (default).
   * host: flush fill so an outer freestyle shell owns border/radius — avoids double frames.
   */
  chromeFrame?: "card" | "host";
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
