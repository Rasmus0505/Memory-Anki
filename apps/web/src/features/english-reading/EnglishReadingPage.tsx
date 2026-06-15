import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpenText,
  ExternalLink,
  FileText,
  LoaderCircle,
  Pin,
  PinOff,
  Volume2,
  PencilLine,
  RefreshCcw,
  Settings2,
  Sparkles,
  Trash2,
  TrendingUp,
} from "lucide-react";
import { Children } from "react";
import { createElement } from "react";
import type {
  ChangeEvent,
  DragEvent,
  KeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { LoadingState } from "@/shared/components/state-placeholders";
import { useAiRunConfigDialog } from "@/features/ai-config/useAiRunConfigDialog";
import type {
  AiRuntimeOptions,
  CefrLevel,
  ReadingDictionaryEntry,
  ReadingSentenceTranslationResponse,
  ReadingCompletionResponse,
  ReadingDifficultyDelta,
  ReadingDifficultyDirection,
  ReadingGenerateRequest,
  ReadingGenerateStreamStatusEvent,
  ReadingMaterial,
  ReadingProfile,
  ReadingRenderSentence,
  ReadingSessionResult,
  ReadingVersion,
  ReadingWorkspaceStats,
  SentenceAnnotation,
  SpanAnnotation,
} from "@/shared/api/contracts";
import { PageIntro } from "@/shared/components/layout/PageIntro";
import { SessionTimerBar } from "@/shared/components/session/SessionTimerBar";
import { TimerAutomationDialog } from "@/shared/components/session/TimerAutomationDialog";
import {
  readTimerAutomationConfig,
  resetTimerAutomationConfig,
  saveTimerAutomationConfig,
  shouldAutoStartOnPageEnter,
  type TimerAutomationConfig,
} from "@/shared/components/session/timer-automation-config";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Textarea } from "@/shared/components/ui/textarea";
import { cn } from "@/shared/lib/utils";
import { useTimedSession } from "@/shared/hooks/useTimedSession";
import { useRouteResidency } from "@/app/router/RouteResidency";
import {
  completeTask,
  failTask,
  registerTask,
  updateTask,
  dismissTask,
} from "@/shared/background-tasks/backgroundTaskRegistry";
import {
  completeEnglishReadingMaterialApi,
  createEnglishReadingMaterialApi,
  deleteEnglishReadingMaterialApi,
  generateEnglishReadingVersionStreamApi,
  getEnglishReadingDictionaryApi,
  getEnglishReadingMaterialApi,
  getEnglishReadingWorkspaceApi,
  getEnglishReadingVersionApi,
  translateEnglishReadingSentenceApi,
  updateEnglishReadingMaterialApi,
  updateEnglishReadingProfileApi,
} from "@/features/english-reading/api/englishReadingApi";

const CEFR_LEVELS: CefrLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];
const READING_FILE_ACCEPT =
  ".txt,.md,.pdf,text/plain,text/markdown,application/pdf";
const READING_FILE_SUFFIXES = [".txt", ".md", ".pdf"] as const;
const READING_DIFFICULTY_OPTIONS: ReadonlyArray<ReadingDifficultyDelta> = [
  0.5, 1, 1.5, 2,
];
const LOOKUP_WORD_RE = /[A-Za-z]+(?:[-'][A-Za-z]+)*/g;
const DICTIONARY_PANEL_WIDTH = 312;
const DICTIONARY_PANEL_SAFE_MARGIN = 16;
const DICTIONARY_PANEL_MIN_HEIGHT = 220;
const DICTIONARY_PANEL_DEFAULT_HEIGHT = 320;
const SENTENCE_TRANSLATION_LONG_PRESS_MS = 320;
const SENTENCE_TRANSLATION_LONG_PRESS_MOVE_TOLERANCE_PX = 10;
const SENTENCE_TRANSLATION_PANEL_TARGET_WIDTH = 460;
const SENTENCE_TRANSLATION_PANEL_MIN_WIDTH = 320;
const SENTENCE_TRANSLATION_PANEL_MAX_WIDTH = 540;
const SENTENCE_TRANSLATION_PANEL_MIN_HEIGHT = 170;
const SENTENCE_TRANSLATION_PANEL_SAFE_MARGIN = 16;
const SENTENCE_TRANSLATION_PANEL_GAP = 12;
const SENTENCE_TRANSLATION_TRIGGER_WIDTH = 132;
const SENTENCE_TRANSLATION_TRIGGER_HEIGHT = 40;

type DictionaryPanelState = {
  left: number;
  top: number;
  maxHeight: number;
  pinned: boolean;
  dragging: boolean;
  entry: ReadingDictionaryEntry | null;
  error: string | null;
  loading: boolean;
  queryWord: string;
};

type SentenceTranslationPanelState = {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
  pinned: boolean;
  dragging: boolean;
  loading: boolean;
  error: string | null;
  cacheKey: string;
  originalText: string;
  translatedText: string;
  resolvedAi?: ReadingSentenceTranslationResponse["resolved_ai"];
};

type SentenceSelectionPayload = {
  cacheKey: string;
  originalText: string;
  rect: DOMRect;
};

type SentenceTranslationTriggerState = {
  left: number;
  top: number;
  payload: SentenceSelectionPayload;
};

type GenerationRequest =
  | { kind: "initial" }
  | {
      kind: "regenerate";
      direction: ReadingDifficultyDirection;
      delta: ReadingDifficultyDelta;
    };

function normalizeRuntimeAiOptions(
  aiOptions: AiRuntimeOptions | undefined,
): AiRuntimeOptions | undefined {
  if (!aiOptions) return undefined;
  const model = aiOptions.model?.trim();
  const hasThinking = aiOptions.thinking_enabled !== undefined;
  if (!model && !hasThinking) {
    return undefined;
  }
  return {
    ...(model ? { model } : {}),
    ...(hasThinking ? { thinking_enabled: aiOptions.thinking_enabled } : {}),
  };
}

function clampLevelIndex(index: number) {
  return Math.min(CEFR_LEVELS.length - 1, Math.max(0, index));
}

function formatWorkingBand(value: number) {
  const base = Math.floor(value);
  const safeBase = clampLevelIndex(base);
  const level = CEFR_LEVELS[safeBase];
  const offset = value - safeBase;
  if (offset >= 0.66 && safeBase < CEFR_LEVELS.length - 1) {
    return `${level}+`;
  }
  if (offset <= 0.2) {
    return level;
  }
  return `${level} 中段`;
}

function formatMinutes(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainSeconds = seconds % 60;
  if (minutes <= 0) return `${remainSeconds} 秒`;
  return `${minutes} 分 ${remainSeconds} 秒`;
}

function formatDifficultyDelta(value: ReadingDifficultyDelta) {
  return value % 1 === 0 ? `${value.toFixed(1)} 级` : `${value} 级`;
}

function getGenerationSuccessMessage(request: GenerationRequest) {
  if (request.kind === "initial") {
    return "i+1 阅读材料已生成。";
  }
  if (request.direction === "easier") {
    return "已按更简单的难度重新生成。";
  }
  if (request.direction === "harder") {
    return "已按更高的难度重新生成。";
  }
  return "已重新生成当前内容。";
}

function summarizeFeedback(feedback: ReadingSessionResult["feedback"]) {
  if (feedback === "too_easy") return "太简单";
  if (feedback === "too_hard") return "有点难";
  return "刚刚好";
}

function isSupportedReadingFile(file: File) {
  const normalizedName = file.name.trim().toLowerCase();
  return READING_FILE_SUFFIXES.some((suffix) =>
    normalizedName.endsWith(suffix),
  );
}

function normalizeLookupWord(value: string) {
  const normalized = value.trim().toLowerCase();
  return /^[a-z]+(?:[-'][a-z]+)*$/.test(normalized) ? normalized : "";
}

function buildLookupTextParts(text: string) {
  const parts: Array<{ kind: "text" | "word"; value: string }> = [];
  let cursor = 0;
  for (const match of text.matchAll(LOOKUP_WORD_RE)) {
    const start = match.index ?? 0;
    const value = match[0] ?? "";
    if (start > cursor) {
      parts.push({ kind: "text", value: text.slice(cursor, start) });
    }
    parts.push({ kind: "word", value });
    cursor = start + value.length;
  }
  if (cursor < text.length) {
    parts.push({ kind: "text", value: text.slice(cursor) });
  }
  return parts.length > 0 ? parts : [{ kind: "text" as const, value: text }];
}

function resolveDictionaryPanelLeft(rawLeft: number) {
  const viewportWidth = window.innerWidth;
  const safeMargin = DICTIONARY_PANEL_SAFE_MARGIN;
  const panelWidth = Math.min(
    DICTIONARY_PANEL_WIDTH,
    Math.max(240, viewportWidth - safeMargin * 2),
  );
  return Math.min(
    Math.max(safeMargin, rawLeft),
    Math.max(safeMargin, viewportWidth - panelWidth - safeMargin),
  );
}

function resolveDictionaryPanelTop(rawTop: number) {
  const viewportHeight = window.innerHeight;
  const safeMargin = DICTIONARY_PANEL_SAFE_MARGIN;
  return Math.min(
    Math.max(safeMargin, rawTop),
    Math.max(
      safeMargin,
      viewportHeight - DICTIONARY_PANEL_MIN_HEIGHT - safeMargin,
    ),
  );
}

function resolveDictionaryPanelMaxHeight(top: number) {
  const viewportHeight = window.innerHeight;
  return Math.max(
    DICTIONARY_PANEL_MIN_HEIGHT,
    viewportHeight - top - DICTIONARY_PANEL_SAFE_MARGIN,
  );
}

function resolveSentenceTranslationPanelWidth() {
  const viewportWidth = window.innerWidth;
  return Math.min(
    SENTENCE_TRANSLATION_PANEL_MAX_WIDTH,
    Math.max(
      SENTENCE_TRANSLATION_PANEL_MIN_WIDTH,
      Math.min(
        SENTENCE_TRANSLATION_PANEL_TARGET_WIDTH,
        viewportWidth - SENTENCE_TRANSLATION_PANEL_SAFE_MARGIN * 2,
      ),
    ),
  );
}

function resolveSentenceTranslationPanelLeft(rawLeft: number, width: number) {
  const viewportWidth = window.innerWidth;
  const safeMargin = SENTENCE_TRANSLATION_PANEL_SAFE_MARGIN;
  return Math.min(
    Math.max(safeMargin, rawLeft),
    Math.max(safeMargin, viewportWidth - width - safeMargin),
  );
}

function resolveSentenceTranslationPanelTop(rawTop: number) {
  const viewportHeight = window.innerHeight;
  const safeMargin = SENTENCE_TRANSLATION_PANEL_SAFE_MARGIN;
  return Math.min(
    Math.max(safeMargin, rawTop),
    Math.max(
      safeMargin,
      viewportHeight - SENTENCE_TRANSLATION_PANEL_MIN_HEIGHT - safeMargin,
    ),
  );
}

function resolveSentenceTranslationPanelMaxHeight(top: number) {
  const viewportHeight = window.innerHeight;
  return Math.max(
    SENTENCE_TRANSLATION_PANEL_MIN_HEIGHT,
    viewportHeight - top - SENTENCE_TRANSLATION_PANEL_SAFE_MARGIN,
  );
}

function resolveSentenceTranslationTriggerPosition(selectionRect: DOMRect) {
  const safeMargin = SENTENCE_TRANSLATION_PANEL_SAFE_MARGIN;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const preferredLeft =
    selectionRect.left +
    selectionRect.width / 2 -
    SENTENCE_TRANSLATION_TRIGGER_WIDTH / 2;
  const left = Math.min(
    Math.max(safeMargin, preferredLeft),
    Math.max(
      safeMargin,
      viewportWidth - SENTENCE_TRANSLATION_TRIGGER_WIDTH - safeMargin,
    ),
  );
  const spaceBelow = viewportHeight - selectionRect.bottom - safeMargin;
  const top =
    spaceBelow >= SENTENCE_TRANSLATION_TRIGGER_HEIGHT + SENTENCE_TRANSLATION_PANEL_GAP
      ? selectionRect.bottom + SENTENCE_TRANSLATION_PANEL_GAP
      : Math.max(
          safeMargin,
          selectionRect.top -
            SENTENCE_TRANSLATION_TRIGGER_HEIGHT -
            SENTENCE_TRANSLATION_PANEL_GAP,
        );
  return { left, top };
}

function resolveDictionaryPanelPosition(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  const viewportHeight = window.innerHeight;
  const safeMargin = DICTIONARY_PANEL_SAFE_MARGIN;
  const left = resolveDictionaryPanelLeft(
    rect.left + rect.width / 2 - DICTIONARY_PANEL_WIDTH / 2,
  );
  const spaceBelow = viewportHeight - rect.bottom - safeMargin;
  const spaceAbove = rect.top - safeMargin;
  const preferBelow =
    spaceBelow >= DICTIONARY_PANEL_MIN_HEIGHT || spaceBelow >= spaceAbove;
  const availableHeight = Math.max(
    DICTIONARY_PANEL_MIN_HEIGHT,
    Math.min(
      DICTIONARY_PANEL_DEFAULT_HEIGHT,
      Math.max(spaceBelow, spaceAbove),
    ),
  );
  const preferredTop = preferBelow
    ? rect.bottom + 10
    : rect.top - 10 - availableHeight;
  const top = resolveDictionaryPanelTop(preferredTop);
  return {
    left,
    top,
    maxHeight: Math.min(availableHeight, resolveDictionaryPanelMaxHeight(top)),
  };
}

function resolveSelectionRect(range: Range) {
  const rect = range.getBoundingClientRect();
  if (rect.width > 0 || rect.height > 0) {
    return rect;
  }
  const clientRect = range.getClientRects()[0];
  return clientRect ?? null;
}

function rectsOverlapVertically(
  top: number,
  height: number,
  selectionRect: DOMRect,
) {
  const bottom = top + height;
  return bottom > selectionRect.top && top < selectionRect.bottom;
}

function resolveSentenceTranslationPanelPosition(selectionRect: DOMRect) {
  const width = resolveSentenceTranslationPanelWidth();
  const safeMargin = SENTENCE_TRANSLATION_PANEL_SAFE_MARGIN;
  const spaceBelow = window.innerHeight - selectionRect.bottom - safeMargin;
  const spaceAbove = selectionRect.top - safeMargin;
  const availableHeight = Math.max(
    SENTENCE_TRANSLATION_PANEL_MIN_HEIGHT,
    Math.max(spaceBelow, spaceAbove),
  );
  const preferBelow =
    spaceBelow >= SENTENCE_TRANSLATION_PANEL_MIN_HEIGHT ||
    spaceBelow >= spaceAbove;
  let left = resolveSentenceTranslationPanelLeft(
    selectionRect.left + selectionRect.width / 2 - width / 2,
    width,
  );
  let top = resolveSentenceTranslationPanelTop(
    preferBelow
      ? selectionRect.bottom + SENTENCE_TRANSLATION_PANEL_GAP
      : selectionRect.top -
          SENTENCE_TRANSLATION_PANEL_GAP -
          availableHeight,
  );
  if (rectsOverlapVertically(top, availableHeight, selectionRect)) {
    const shiftedRight = resolveSentenceTranslationPanelLeft(
      selectionRect.right + SENTENCE_TRANSLATION_PANEL_GAP,
      width,
    );
    const shiftedLeft = resolveSentenceTranslationPanelLeft(
      selectionRect.left - width - SENTENCE_TRANSLATION_PANEL_GAP,
      width,
    );
    if (selectionRect.right + SENTENCE_TRANSLATION_PANEL_GAP + width <= window.innerWidth - safeMargin) {
      left = shiftedRight;
    } else if (
      selectionRect.left - SENTENCE_TRANSLATION_PANEL_GAP - width >=
      safeMargin
    ) {
      left = shiftedLeft;
    } else {
      const oppositeTop = resolveSentenceTranslationPanelTop(
        preferBelow
          ? selectionRect.top -
              SENTENCE_TRANSLATION_PANEL_GAP -
              availableHeight
          : selectionRect.bottom + SENTENCE_TRANSLATION_PANEL_GAP,
      );
      top = oppositeTop;
    }
  }
  return {
    left,
    top,
    width,
    maxHeight: Math.min(
      availableHeight,
      resolveSentenceTranslationPanelMaxHeight(top),
    ),
  };
}

function getDictionaryPartOfSpeechLabel(partOfSpeech: string) {
  if (partOfSpeech === "noun") return "n.";
  if (partOfSpeech === "verb") return "v.";
  if (partOfSpeech === "adjective") return "adj.";
  if (partOfSpeech === "adverb") return "adv.";
  return `${partOfSpeech}.`;
}

function canUseSpeechSynthesis() {
  return (
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    typeof SpeechSynthesisUtterance !== "undefined"
  );
}

function normalizeSentenceSelectionText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function extractSentenceSelection(
  container: HTMLElement | null,
): SentenceSelectionPayload | null {
  if (!container) return null;
  const selection = window.getSelection();
  if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) {
    return null;
  }
  const range = selection.getRangeAt(0);
  if (
    !container.contains(range.startContainer) ||
    !container.contains(range.endContainer)
  ) {
    return null;
  }
  const originalText = normalizeSentenceSelectionText(selection.toString());
  const tokens = originalText.match(LOOKUP_WORD_RE) ?? [];
  if (tokens.length < 2) {
    return null;
  }
  const rect = resolveSelectionRect(range);
  if (!rect) return null;
  return {
    cacheKey: originalText,
    originalText,
    rect,
  };
}

function hasActiveTextSelection() {
  const selection = window.getSelection();
  return Boolean(selection && !selection.isCollapsed && selection.toString().trim());
}

function ReadingLookupText({
  text,
  onLookupWord,
}: {
  text: string;
  onLookupWord: (
    word: string,
    event: ReactMouseEvent<HTMLElement>,
  ) => void;
}) {
  const parts = buildLookupTextParts(text);
  return (
    <>
      {parts.map((part, index) =>
        part.kind === "word" ? (
          <span
            key={`${part.value}-${index}`}
            role="button"
            tabIndex={0}
            data-reading-word="true"
            className="cursor-pointer rounded-md px-0.5 text-inherit transition-colors hover:bg-info/10 hover:text-info focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info/30"
            onClick={(event) => onLookupWord(part.value, event)}
          >
            {part.value}
          </span>
        ) : (
          <span key={`text-${index}`}>{part.value}</span>
        ),
      )}
    </>
  );
}

function AnnotationMark({
  text,
  annotation,
  onHover,
  onLookupWord,
}: {
  text: string;
  annotation: SpanAnnotation;
  onHover: (annotationId: string) => void;
  onLookupWord: (
    word: string,
    event: ReactMouseEvent<HTMLElement>,
  ) => void;
}) {
  const palette =
    annotation.kind === "green"
      ? "text-success bg-success/10 ring-success/20"
      : annotation.kind === "yellow"
        ? "text-warning bg-warning/10 ring-warning/20"
        : annotation.kind === "red"
          ? "text-destructive bg-destructive/10 ring-destructive/20"
          : "text-primary bg-primary/5 ring-primary/20";
  const resolvedLemma = annotation.resolvedLemma.trim();
  const showResolvedLemma =
    resolvedLemma.length > 0 &&
    resolvedLemma.toLowerCase() !==
      annotation.originalText.trim().toLowerCase();
  const resolutionSourceLabel =
    annotation.resolutionSource === "dictionary" ? "词典" : "AI";
  return (
    <span
      className={cn(
        "group relative inline rounded-md px-1 py-0.5 ring-1 ring-inset transition-colors",
        palette,
      )}
      onMouseEnter={() => onHover(annotation.id)}
    >
      <ReadingLookupText text={text} onLookupWord={onLookupWord} />
        <span className="invisible absolute bottom-[calc(100%+10px)] left-1/2 z-20 w-72 -translate-x-1/2 rounded-2xl border border-border bg-background/98 p-3 text-left text-xs text-muted-foreground opacity-0 shadow-popover transition-all group-hover:visible group-hover:opacity-100">
        <span className="block font-medium text-primary">
          {annotation.cefr}:{annotation.originalText || annotation.displayText}
        </span>
        <span className="mt-1 block">
          原始/最终：{annotation.originalCefr || annotation.cefr}/
          {annotation.finalCefr || annotation.cefr}
        </span>
        {showResolvedLemma ? (
          <span className="mt-1 block">还原：{resolvedLemma}</span>
        ) : null}
        <span className="mt-1 block">标记：{resolutionSourceLabel}</span>
        {annotation.rewriteDecision ? (
          <span className="mt-1 block">改写：{annotation.rewriteDecision}</span>
        ) : null}
      </span>
    </span>
  );
}

function SentenceLine({
  sentence,
  sentenceAnnotation,
  annotationMap,
  expanded,
  onHoverAnnotation,
  onLookupWord,
  onToggleExpanded,
}: {
  sentence: ReadingRenderSentence;
  sentenceAnnotation: SentenceAnnotation | undefined;
  annotationMap: Map<string, SpanAnnotation>;
  expanded: boolean;
  onHoverAnnotation: (annotationId: string) => void;
  onLookupWord: (
    word: string,
    event: ReactMouseEvent<HTMLElement>,
  ) => void;
  onToggleExpanded: () => void;
}) {
  const content = sentence.parts.map((part, index) => {
    if (part.spanAnnotationId) {
      const annotation = annotationMap.get(part.spanAnnotationId);
      if (annotation) {
        return (
          <AnnotationMark
            key={annotation.id}
            text={part.text}
            annotation={annotation}
            onHover={onHoverAnnotation}
            onLookupWord={onLookupWord}
          />
        );
      }
    }
    return (
      <span key={sentence.id + "-part-" + index}>
        <ReadingLookupText text={part.text} onLookupWord={onLookupWord} />
      </span>
    );
  });
  const isSimplified = sentenceAnnotation?.kind === "syntax_simplified";

  if (!isSimplified || !sentenceAnnotation) {
    return <span className="mr-1">{content}</span>;
  }

  return (
    <span className="mb-3 inline-block align-top">
      <span className="rounded-xl bg-destructive/5 px-2 py-1 text-left leading-9 text-destructive">
        {content}
      </span>
      <button
        type="button"
        className="ml-2 inline-flex items-center rounded-full border border-destructive/20 bg-white/90 px-3 py-1 text-xs font-medium text-destructive transition hover:bg-destructive/5"
        onClick={onToggleExpanded}
      >
        {expanded ? "收起原句" : "展开原句"}
      </button>
      {expanded ? (
        <span className="mt-2 block rounded-2xl border border-destructive/20 bg-white/95 p-4 text-sm leading-7 text-muted-foreground shadow-sm">
          <span className="block text-[11px] font-semibold uppercase tracking-[0.18em] text-destructive/70">
            原句骨架
          </span>
          <span className="mt-2 block text-[15px] text-primary">
            {sentenceAnnotation.originalText}
          </span>
          {sentenceAnnotation.skeletonHints.length > 0 ? (
            <span className="mt-3 flex flex-wrap gap-2">
              {sentenceAnnotation.skeletonHints.map((hint) => (
                <span
                  key={sentence.id + "-hint-" + hint}
                  className="rounded-full border border-border bg-muted px-3 py-1 text-xs text-muted-foreground"
                >
                  {hint}
                </span>
              ))}
            </span>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}

export default function EnglishReadingPage() {
  const { isActive } = useRouteResidency();
  const [searchParams, setSearchParams] = useSearchParams();
  const currentMaterialId = Number(searchParams.get("material") || "");
  const resolvedMaterialId =
    Number.isFinite(currentMaterialId) && currentMaterialId > 0
      ? currentMaterialId
      : null;

  const [profile, setProfile] = useState<ReadingProfile | null>(null);
  const [workspaceStats, setWorkspaceStats] =
    useState<ReadingWorkspaceStats | null>(null);
  const [recentMaterials, setRecentMaterials] = useState<ReadingMaterial[]>([]);
  const [material, setMaterial] = useState<ReadingMaterial | null>(null);
  const [version, setVersion] = useState<ReadingVersion | null>(null);
  const [textInput, setTextInput] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [sourceMode, setSourceMode] = useState<"text" | "file">("text");
  const [dropzoneActive, setDropzoneActive] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);
  const [versionLoading, setVersionLoading] = useState(false);
  const [profileSaving, setProfileSaving] = useState<CefrLevel | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generationStatus, setGenerationStatus] =
    useState<ReadingGenerateStreamStatusEvent | null>(null);
  const [completionPanelOpen, setCompletionPanelOpen] = useState(false);
  const [completionSubmitting, setCompletionSubmitting] = useState<
    ReadingSessionResult["feedback"] | null
  >(null);
  const [completionResponse, setCompletionResponse] =
    useState<ReadingCompletionResponse | null>(null);
  const [hoveredAnnotationIds, setHoveredAnnotationIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [expandedSentenceIds, setExpandedSentenceIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [dictionaryPanel, setDictionaryPanel] =
    useState<DictionaryPanelState | null>(null);
  const [sentenceTranslationTrigger, setSentenceTranslationTrigger] =
    useState<SentenceTranslationTriggerState | null>(null);
  const [sentenceTranslationPanel, setSentenceTranslationPanel] =
    useState<SentenceTranslationPanelState | null>(null);
  const [automationOpen, setAutomationOpen] = useState(false);
  const [automationConfig, setAutomationConfig] =
    useState<TimerAutomationConfig>(() => readTimerAutomationConfig());
  const [openingMaterialId, setOpeningMaterialId] = useState<number | null>(
    null,
  );
  const [renamingMaterialId, setRenamingMaterialId] = useState<number | null>(
    null,
  );
  const [deletingMaterialId, setDeletingMaterialId] = useState<number | null>(
    null,
  );
  const [regenerateDialogOpen, setRegenerateDialogOpen] = useState(false);
  const [regenerateDirection, setRegenerateDirection] =
    useState<ReadingDifficultyDirection>("same");
  const [regenerateDelta, setRegenerateDelta] =
    useState<ReadingDifficultyDelta>(0.5);
  const { promptForAiOptions, aiRunConfigDialog } = useAiRunConfigDialog();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dragDepthRef = useRef(0);
  const readingPanelRef = useRef<HTMLDivElement | null>(null);
  const readingContentRef = useRef<HTMLDivElement | null>(null);
  const hardUnloadRef = useRef(false);
  const dictionaryPanelRef = useRef<HTMLDivElement | null>(null);
  const sentenceTranslationTriggerRef = useRef<HTMLButtonElement | null>(null);
  const sentenceTranslationPanelRef = useRef<HTMLDivElement | null>(null);
  const dictionaryEntriesCacheRef = useRef<Map<string, ReadingDictionaryEntry>>(
    new Map(),
  );
  const sentenceTranslationCacheRef = useRef<
    Map<string, ReadingSentenceTranslationResponse>
  >(new Map());
  const dictionaryRequestTokenRef = useRef(0);
  const sentenceTranslationRequestTokenRef = useRef(0);
  const dictionaryAudioRef = useRef<HTMLAudioElement | null>(null);
  const dictionaryDragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originLeft: number;
    originTop: number;
  } | null>(null);
  const sentenceTranslationDragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originLeft: number;
    originTop: number;
  } | null>(null);
  const sentenceSelectionGestureRef = useRef<{
    pointerId: number | null;
    startX: number;
    startY: number;
    longPressReady: boolean;
    movedTooFar: boolean;
    timerId: number | null;
  } | null>(null);
  // 记录当前 version 所属的 material id，用于区分"切换 material"与"同 material
  // 下重新生成（initial/regenerate 导致 version.id 变化）"两种场景。前者需要清空
  // 阅读交互状态（hover/展开/词典等），后者不应清空，避免切走再回来时状态被重置。
  const versionResetMaterialIdRef = useRef<number | null>(null);

  const timer = useTimedSession({
    kind: "practice",
    title: material ? `英语阅读 · ${material.title}` : "英语阅读",
    palaceId: null,
    automationScene: "english_reading",
    sourceKind: "english_reading",
    persistKey: material ? `english-reading:${material.id}` : null,
  });
  const timerRef = useRef(timer);
  const activeReadingSessionKey =
    material && version && version.materialId === material.id
      ? `${material.id}:${version.id}`
      : null;

  const annotationMap = useMemo(
    () =>
      new Map((version?.spanAnnotations ?? []).map((item) => [item.id, item])),
    [version?.spanAnnotations],
  );
  const sentenceAnnotationMap = useMemo(
    () =>
      new Map(
        (version?.sentenceAnnotations ?? []).map((item) => [item.id, item]),
      ),
    [version?.sentenceAnnotations],
  );

  const loadWorkspace = useCallback(async () => {
    const nextWorkspace = await getEnglishReadingWorkspaceApi();
    setProfile(nextWorkspace.profile);
    setWorkspaceStats(nextWorkspace.stats);
    setRecentMaterials(nextWorkspace.recentMaterials);
  }, []);

  const loadMaterialAndVersion = useCallback(async (materialId: number) => {
    setVersionLoading(true);
    try {
      const nextMaterial = await getEnglishReadingMaterialApi(materialId);
      setMaterial(nextMaterial);
      try {
        const nextVersion = await getEnglishReadingVersionApi(materialId);
        setVersion(nextVersion);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "加载阅读版本失败。";
        if (!/还没有生成阅读版本/.test(message)) {
          toast.error(message);
        }
        setVersion(null);
      }
    } finally {
      setVersionLoading(false);
    }
  }, []);

  const scrollToReadingPanel = useCallback(() => {
    window.setTimeout(() => {
      if (typeof readingPanelRef.current?.scrollIntoView === "function") {
        readingPanelRef.current.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }
    }, 0);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        if (cancelled) return;
        await loadWorkspace();
        if (cancelled) return;
        if (resolvedMaterialId) {
          await loadMaterialAndVersion(resolvedMaterialId);
        }
      } catch (error) {
        if (!cancelled) {
          toast.error(
            error instanceof Error ? error.message : "英语阅读加载失败。",
          );
        }
      } finally {
        if (!cancelled) {
          setPageLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadMaterialAndVersion, loadWorkspace, resolvedMaterialId]);

  useEffect(() => {
    timer.setSceneActive?.(isActive, {
      source: isActive ? "route_active" : "route_inactive",
    });
  }, [isActive, timer]);

  useEffect(() => {
    timerRef.current = timer;
  }, [timer]);

  useEffect(() => {
    return () => {
      const gesture = sentenceSelectionGestureRef.current;
      if (gesture?.timerId != null) {
        window.clearTimeout(gesture.timerId);
      }
    };
  }, []);

  useEffect(() => {
    const markHardUnload = () => {
      hardUnloadRef.current = true;
    };

    window.addEventListener("beforeunload", markHardUnload);
    window.addEventListener("pagehide", markHardUnload);

    return () => {
      window.removeEventListener("beforeunload", markHardUnload);
      window.removeEventListener("pagehide", markHardUnload);
    };
  }, []);

  useEffect(() => {
    return () => {
      const currentTimer = timerRef.current;
      if (hardUnloadRef.current) return;
      if (currentTimer.startedAt && currentTimer.status !== "completed") {
        void currentTimer.leaveScene({
          source: "english_reading_leave",
        });
      }
    };
  }, [activeReadingSessionKey]);

  useEffect(() => {
    if (!version?.id) return;
    // 仅在 material 真正切换时清空阅读交互状态。
    // 同 material 下重新生成（initial/regenerate）不应清空，避免用户切走再回来
    // 时丢失 hover/展开/词典等已展开的交互。
    const currentMaterialId = material?.id ?? null;
    if (versionResetMaterialIdRef.current === currentMaterialId) {
      timer.reset();
      return;
    }
    versionResetMaterialIdRef.current = currentMaterialId;
    timer.reset();
    setHoveredAnnotationIds(new Set());
    setExpandedSentenceIds(new Set());
    setCompletionResponse(null);
    setCompletionPanelOpen(false);
    setDictionaryPanel(null);
    setSentenceTranslationTrigger(null);
    setSentenceTranslationPanel(null);
    dictionaryEntriesCacheRef.current.clear();
    sentenceTranslationCacheRef.current.clear();
  }, [timer.reset, version?.id, material?.id]);

  useEffect(() => {
    if (isActive) return;
    if (canUseSpeechSynthesis()) {
      window.speechSynthesis.cancel();
    }
    dictionaryAudioRef.current?.pause();
    dictionaryDragRef.current = null;
    sentenceTranslationDragRef.current = null;
    setDictionaryPanel((current) =>
      current ? { ...current, dragging: false } : current,
    );
    setSentenceTranslationPanel((current) =>
      current ? { ...current, dragging: false } : current,
    );
  }, [isActive]);

  useEffect(() => {
    if (!version?.id) return;
    if (!isActive) return;
    if (timer.status !== "idle") return;
    if (
      !shouldAutoStartOnPageEnter(
        readTimerAutomationConfig(),
        "english_reading",
      )
    )
      return;
    timer.start({ source: "english_reading_open" });
  }, [isActive, timer.start, timer.status, version?.id]);

  useEffect(() => {
    if (!isActive) return;
    if (!dictionaryPanel) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (dictionaryPanelRef.current?.contains(target)) return;
      if (
        target instanceof HTMLElement &&
        target.closest("[data-reading-word='true']")
      ) {
        return;
      }
      if (dictionaryPanel.pinned) return;
      setDictionaryPanel(null);
    };
    const handleViewportChange = () => {
      setDictionaryPanel((current) => {
        if (!current) return current;
        if (!current.pinned) return null;
        const nextTop = resolveDictionaryPanelTop(current.top);
        return {
          ...current,
          left: resolveDictionaryPanelLeft(current.left),
          top: nextTop,
          maxHeight: resolveDictionaryPanelMaxHeight(nextTop),
        };
      });
    };
    document.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("resize", handleViewportChange);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("resize", handleViewportChange);
    };
  }, [dictionaryPanel, isActive]);

  useEffect(() => {
    if (!isActive) return;
    if (!sentenceTranslationTrigger) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (sentenceTranslationTriggerRef.current?.contains(target)) return;
      if (sentenceTranslationPanelRef.current?.contains(target)) return;
      if (dictionaryPanelRef.current?.contains(target)) return;
      if (
        target instanceof HTMLElement &&
        target.closest("[data-reading-word='true']")
      ) {
        return;
      }
      setSentenceTranslationTrigger(null);
    };
    const handleViewportChange = () => {
      setSentenceTranslationTrigger(null);
    };
    document.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("resize", handleViewportChange);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("resize", handleViewportChange);
    };
  }, [isActive, sentenceTranslationTrigger]);

  useEffect(() => {
    if (!isActive) return;
    if (!sentenceTranslationPanel) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (sentenceTranslationPanelRef.current?.contains(target)) return;
      if (sentenceTranslationTriggerRef.current?.contains(target)) return;
      if (dictionaryPanelRef.current?.contains(target)) return;
      if (
        target instanceof HTMLElement &&
        target.closest("[data-reading-word='true']")
      ) {
        return;
      }
      if (sentenceTranslationPanel.pinned) return;
      setSentenceTranslationPanel(null);
    };
    const handleViewportChange = () => {
      setSentenceTranslationPanel((current) => {
        if (!current) return current;
        if (!current.pinned) return null;
        const nextTop = resolveSentenceTranslationPanelTop(current.top);
        return {
          ...current,
          width: resolveSentenceTranslationPanelWidth(),
          left: resolveSentenceTranslationPanelLeft(
            current.left,
            resolveSentenceTranslationPanelWidth(),
          ),
          top: nextTop,
          maxHeight: resolveSentenceTranslationPanelMaxHeight(nextTop),
        };
      });
    };
    document.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("resize", handleViewportChange);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("resize", handleViewportChange);
    };
  }, [isActive, sentenceTranslationPanel]);

  useEffect(() => {
    if (!isActive) return;
    if (!dictionaryPanel?.dragging) return;
    const updateDraggingPosition = (clientX: number, clientY: number) => {
      const dragState = dictionaryDragRef.current;
      if (
        !dragState ||
        !Number.isFinite(clientX) ||
        !Number.isFinite(clientY)
      ) {
        return;
      }
      const nextLeft = resolveDictionaryPanelLeft(
        dragState.originLeft + (clientX - dragState.startX),
      );
      const nextTop = resolveDictionaryPanelTop(
        dragState.originTop + (clientY - dragState.startY),
      );
      setDictionaryPanel((current) =>
        current
          ? {
              ...current,
              left: nextLeft,
              top: nextTop,
              maxHeight: resolveDictionaryPanelMaxHeight(nextTop),
            }
          : current,
      );
    };
    const handlePointerMove = (event: PointerEvent) => {
      const dragState = dictionaryDragRef.current;
      if (!dragState || event.pointerId !== dragState.pointerId) return;
      updateDraggingPosition(event.clientX, event.clientY);
    };
    const handleMouseMove = (event: MouseEvent) => {
      updateDraggingPosition(event.clientX, event.clientY);
    };
    const stopDragging = (event?: PointerEvent | MouseEvent) => {
      if (
        event &&
        dictionaryDragRef.current &&
        "pointerId" in event &&
        event.pointerId !== dictionaryDragRef.current.pointerId
      ) {
        return;
      }
      dictionaryDragRef.current = null;
      document.body.style.userSelect = "";
      setDictionaryPanel((current) =>
        current ? { ...current, dragging: false } : current,
      );
    };
    window.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("pointerup", stopDragging);
    document.addEventListener("pointerup", stopDragging);
    window.addEventListener("mouseup", stopDragging);
    document.addEventListener("mouseup", stopDragging);
    window.addEventListener("pointercancel", stopDragging);
    document.addEventListener("pointercancel", stopDragging);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("pointerup", stopDragging);
      document.removeEventListener("pointerup", stopDragging);
      window.removeEventListener("mouseup", stopDragging);
      document.removeEventListener("mouseup", stopDragging);
      window.removeEventListener("pointercancel", stopDragging);
      document.removeEventListener("pointercancel", stopDragging);
      document.body.style.userSelect = "";
      dictionaryDragRef.current = null;
    };
  }, [dictionaryPanel?.dragging, isActive]);

  useEffect(() => {
    if (!isActive) return;
    if (!sentenceTranslationPanel?.dragging) return;
    const updateDraggingPosition = (clientX: number, clientY: number) => {
      const dragState = sentenceTranslationDragRef.current;
      if (
        !dragState ||
        !Number.isFinite(clientX) ||
        !Number.isFinite(clientY)
      ) {
        return;
      }
      const nextLeft = resolveSentenceTranslationPanelLeft(
        dragState.originLeft + (clientX - dragState.startX),
        sentenceTranslationPanel.width,
      );
      const nextTop = resolveSentenceTranslationPanelTop(
        dragState.originTop + (clientY - dragState.startY),
      );
      setSentenceTranslationPanel((current) =>
        current
          ? {
              ...current,
              left: nextLeft,
              top: nextTop,
              maxHeight: resolveSentenceTranslationPanelMaxHeight(nextTop),
            }
          : current,
      );
    };
    const handlePointerMove = (event: PointerEvent) => {
      const dragState = sentenceTranslationDragRef.current;
      if (!dragState || event.pointerId !== dragState.pointerId) return;
      updateDraggingPosition(event.clientX, event.clientY);
    };
    const handleMouseMove = (event: MouseEvent) => {
      updateDraggingPosition(event.clientX, event.clientY);
    };
    const stopDragging = (event?: PointerEvent | MouseEvent) => {
      if (
        event &&
        sentenceTranslationDragRef.current &&
        "pointerId" in event &&
        event.pointerId !== sentenceTranslationDragRef.current.pointerId
      ) {
        return;
      }
      sentenceTranslationDragRef.current = null;
      document.body.style.userSelect = "";
      setSentenceTranslationPanel((current) =>
        current ? { ...current, dragging: false } : current,
      );
    };
    window.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("pointerup", stopDragging);
    document.addEventListener("pointerup", stopDragging);
    window.addEventListener("mouseup", stopDragging);
    document.addEventListener("mouseup", stopDragging);
    window.addEventListener("pointercancel", stopDragging);
    document.addEventListener("pointercancel", stopDragging);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("pointerup", stopDragging);
      document.removeEventListener("pointerup", stopDragging);
      window.removeEventListener("mouseup", stopDragging);
      document.removeEventListener("mouseup", stopDragging);
      window.removeEventListener("pointercancel", stopDragging);
      document.removeEventListener("pointercancel", stopDragging);
      document.body.style.userSelect = "";
      sentenceTranslationDragRef.current = null;
    };
  }, [isActive, sentenceTranslationPanel?.dragging, sentenceTranslationPanel?.width]);

  const handleSelectLevel = useCallback(async (level: CefrLevel) => {
    setProfileSaving(level);
    try {
      const nextProfile = await updateEnglishReadingProfileApi({
        declaredCefr: level,
      });
      setProfile(nextProfile);
      setCompletionResponse(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "更新 CEFR 失败。");
    } finally {
      setProfileSaving(null);
    }
  }, []);

  const handleUseSelectedFile = useCallback((file: File | null) => {
    if (!file) return;
    if (!isSupportedReadingFile(file)) {
      toast.error("目前只支持拖入或上传 txt / md / pdf 文件。");
      return;
    }
    setSelectedFile(file);
    setSourceMode("file");
  }, []);

  const handleTextInputChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      const nextValue = event.target.value;
      setTextInput(nextValue);
      if (nextValue.trim()) {
        setSourceMode("text");
      } else if (!selectedFile) {
        setSourceMode("text");
      }
    },
    [selectedFile],
  );

  const handleFileInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      handleUseSelectedFile(event.target.files?.[0] ?? null);
      event.target.value = "";
    },
    [handleUseSelectedFile],
  );

  const handleOpenFilePicker = useCallback(() => {
    if (generating) return;
    fileInputRef.current?.click();
  }, [generating]);

  const handleDropzoneKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      handleOpenFilePicker();
    },
    [handleOpenFilePicker],
  );

  const handleDropzoneDragEnter = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      if (generating) return;
      dragDepthRef.current += 1;
      setDropzoneActive(true);
    },
    [generating],
  );

  const handleDropzoneDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      if (generating) return;
      event.dataTransfer.dropEffect = "copy";
      setDropzoneActive(true);
    },
    [generating],
  );

  const handleDropzoneDragLeave = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      if (generating) return;
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) {
        setDropzoneActive(false);
      }
    },
    [generating],
  );

  const handleDropzoneDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      dragDepthRef.current = 0;
      setDropzoneActive(false);
      if (generating) return;
      handleUseSelectedFile(event.dataTransfer.files?.[0] ?? null);
    },
    [generating, handleUseSelectedFile],
  );

  const runGeneration = useCallback(
    async (request: GenerationRequest) => {
      setGenerating(true);
      const taskId = `english-reading-gen-${Date.now()}`;
      registerTask({
        id: taskId,
        section: "englishReading",
        title: "英语阅读 · 生成中",
        detail: "正在准备生成阅读稿……",
        navigateTarget: "/english-reading",
      });
      setGenerationStatus({
        stage: "queued",
        step: 1,
        totalSteps: 8,
        message: "正在准备生成阅读稿……",
      });
      try {
        const aiOptions = await promptForAiOptions({
          scenarioKey: "reading_sentence_rewrite",
          entrypointKey:
            request.kind === "initial"
              ? "english-reading-generate-initial"
              : "english-reading-generate-regenerate",
          title: request.kind === "initial" ? "英语阅读生成配置" : "英语阅读重新生成配置",
          syncScenarioKeys: ["reading_lexical_resolution"],
        });
        if (!aiOptions) {
          dismissTask(taskId);
          setGenerating(false);
          return;
        }
        const runtimeAiOptions = normalizeRuntimeAiOptions(aiOptions);
        let activeMaterial = material;
        if (request.kind === "initial") {
          const useFileInput = sourceMode === "file" && selectedFile;
          activeMaterial = await createEnglishReadingMaterialApi({
            text: useFileInput ? "" : textInput,
            file: useFileInput ? selectedFile : null,
          });
          setMaterial(activeMaterial);
          setSearchParams((current) => {
            const next = new URLSearchParams(current);
            next.set("material", String(activeMaterial.id));
            return next;
          });
        }
        if (!activeMaterial) {
          throw new Error("当前没有可生成的阅读材料。");
        }
        const generationPayload: ReadingGenerateRequest =
          request.kind === "initial"
            ? {
                mode: "initial",
                ...(runtimeAiOptions ? { ai_options: runtimeAiOptions } : {}),
              }
            : request.direction === "same"
              ? {
                  mode: "regenerate",
                  difficultyDirection: "same",
                  ...(runtimeAiOptions ? { ai_options: runtimeAiOptions } : {}),
                }
              : {
                  mode: "regenerate",
                  difficultyDirection: request.direction,
                  difficultyDelta: request.delta,
                  ...(runtimeAiOptions ? { ai_options: runtimeAiOptions } : {}),
                };
        const nextVersion = await generateEnglishReadingVersionStreamApi(
          activeMaterial.id,
          generationPayload,
            {
              onStatus: (event) => {
                setGenerationStatus(event);
                const total = event.totalSteps || 8;
                const progress = Math.min(
                  99,
                  Math.round(((event.step || 0) / total) * 100),
                );
                updateTask(taskId, {
                  progress,
                  detail: event.message || event.stage,
                });
              },
            },
        );
        const nextMaterial = await getEnglishReadingMaterialApi(
          activeMaterial.id,
        );
        setMaterial(nextMaterial);
        setVersion(nextVersion);
        setCompletionResponse(null);
        await loadWorkspace();
        if (request.kind === "regenerate") {
          setRegenerateDialogOpen(false);
        }
        toast.success(getGenerationSuccessMessage(request));
        completeTask(taskId, { detail: "阅读稿已生成" });
      } catch (error) {
        failTask(
          taskId,
          error instanceof Error ? error.message : "生成阅读材料失败。",
        );
        // 用户在配置弹窗取消时不应该留下失败记录。
        if (error === undefined || error === null) {
          dismissTask(taskId);
        }
        toast.error(
          error instanceof Error ? error.message : "生成阅读材料失败。",
        );
      } finally {
        setGenerationStatus(null);
        setGenerating(false);
      }
    },
    [
      loadWorkspace,
      material,
      promptForAiOptions,
      selectedFile,
      setSearchParams,
      sourceMode,
      textInput,
    ],
  );

  const handleCreateAndGenerate = useCallback(async () => {
    if (!textInput.trim() && !selectedFile) {
      toast.error("请先粘贴正文或选择 txt / md / pdf 文件。");
      return;
    }
    await runGeneration({ kind: "initial" });
  }, [runGeneration, selectedFile, textInput]);

  const handleOpenRegenerateDialog = useCallback(() => {
    if (!material) return;
    setRegenerateDirection("same");
    setRegenerateDelta(0.5);
    setRegenerateDialogOpen(true);
  }, [material]);

  const handleConfirmRegenerate = useCallback(async () => {
    if (!material) return;
    await runGeneration({
      kind: "regenerate",
      direction: regenerateDirection,
      delta: regenerateDelta,
    });
  }, [material, regenerateDelta, regenerateDirection, runGeneration]);

  const handleOpenRecentMaterial = useCallback(
    async (item: ReadingMaterial) => {
      if (openingMaterialId === item.id) return;
      setOpeningMaterialId(item.id);
      try {
        setSearchParams((current) => {
          const next = new URLSearchParams(current);
          next.set("material", String(item.id));
          return next;
        });
        await loadMaterialAndVersion(item.id);
        scrollToReadingPanel();
        if (!item.latestVersionId) {
          toast.success("这篇材料已打开，还没有阅读稿，你可以继续生成。");
        }
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "打开阅读材料失败。",
        );
      } finally {
        setOpeningMaterialId(null);
      }
    },
    [
      loadMaterialAndVersion,
      openingMaterialId,
      scrollToReadingPanel,
      setSearchParams,
    ],
  );

  const handleRenameRecentMaterial = useCallback(
    async (item: ReadingMaterial) => {
      if (renamingMaterialId || deletingMaterialId) return;
      const nextTitle = window.prompt("Edit title", item.title)?.trim();
      if (!nextTitle || nextTitle === item.title) return;
      setRenamingMaterialId(item.id);
      try {
        const updated = await updateEnglishReadingMaterialApi(item.id, {
          title: nextTitle,
        });
        setRecentMaterials((current) =>
          current.map((entry) => (entry.id === updated.id ? updated : entry)),
        );
        setMaterial((current) =>
          current?.id === updated.id ? updated : current,
        );
        toast.success("阅读材料标题已更新。");
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "重命名阅读材料失败。",
        );
      } finally {
        setRenamingMaterialId(null);
      }
    },
    [deletingMaterialId, renamingMaterialId],
  );

  const handleDeleteRecentMaterial = useCallback(
    async (item: ReadingMaterial) => {
      if (deletingMaterialId || renamingMaterialId) return;
      const confirmed = window.confirm(
        `Delete "${item.title}" from reading history?`,
      );
      if (!confirmed) return;
      setDeletingMaterialId(item.id);
      try {
        await deleteEnglishReadingMaterialApi(item.id);
        setRecentMaterials((current) =>
          current.filter((entry) => entry.id !== item.id),
        );
        setWorkspaceStats((current) =>
          current
            ? {
                ...current,
                totalMaterials: Math.max(0, current.totalMaterials - 1),
                generatedMaterials:
                  item.latestVersionId == null
                    ? current.generatedMaterials
                    : Math.max(0, current.generatedMaterials - 1),
              }
            : current,
        );
        if (material?.id === item.id) {
          setMaterial(null);
          setVersion(null);
          setCompletionResponse(null);
          setCompletionPanelOpen(false);
          setSearchParams((current) => {
            const next = new URLSearchParams(current);
            next.delete("material");
            return next;
          });
        }
        toast.success("阅读历史已删除。");
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "删除阅读历史失败。",
        );
      } finally {
        setDeletingMaterialId(null);
      }
    },
    [
      deletingMaterialId,
      material?.id,
      renamingMaterialId,
      setSearchParams,
      timer,
    ],
  );

  const handleAnnotationHover = useCallback(
    (annotationId: string) => {
      setHoveredAnnotationIds((current) => {
        if (current.has(annotationId)) return current;
        const next = new Set(current);
        next.add(annotationId);
        return next;
      });
      timer.registerActivity("practice_interaction", {
        source: "english_reading_hover",
      });
    },
    [timer],
  );

  const handleToggleExpandedSentence = useCallback(
    (sentenceId: string) => {
      setExpandedSentenceIds((current) => {
        const next = new Set(current);
        if (next.has(sentenceId)) {
          next.delete(sentenceId);
        } else {
          next.add(sentenceId);
        }
        return next;
      });
      timer.registerActivity("practice_interaction", {
        source: "english_reading_expand",
      });
    },
    [timer],
  );

  const speakDictionaryWord = useCallback((word: string) => {
    if (!canUseSpeechSynthesis()) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(word);
    utterance.lang = "en-US";
    window.speechSynthesis.speak(utterance);
  }, []);

  const playDictionaryPronunciation = useCallback(
    async (
      entry: ReadingDictionaryEntry,
      options: { allowTtsFallback: boolean },
    ) => {
      const { allowTtsFallback } = options;
      if (entry.audioUsUrl) {
        try {
          dictionaryAudioRef.current?.pause();
          const audio = new Audio(entry.audioUsUrl);
          dictionaryAudioRef.current = audio;
          await audio.play();
          return;
        } catch {
          if (!allowTtsFallback) return;
        }
      }
      if (allowTtsFallback) {
        speakDictionaryWord(entry.word || entry.lemma);
      }
    },
    [speakDictionaryWord],
  );

  const handleLookupWord = useCallback(
    async (
      word: string,
      event: ReactMouseEvent<HTMLElement>,
    ) => {
      event.preventDefault();
      event.stopPropagation();
      if (hasActiveTextSelection()) return;
      const normalizedWord = normalizeLookupWord(word);
      if (!normalizedWord) return;

      timer.registerActivity("practice_interaction", {
        source: "dictionary_lookup",
      });

      const nextPosition =
        dictionaryPanel?.pinned && dictionaryPanel
          ? {
              left: dictionaryPanel.left,
              top: dictionaryPanel.top,
              maxHeight: dictionaryPanel.maxHeight,
            }
          : resolveDictionaryPanelPosition(event.currentTarget);
      const cachedEntry =
        dictionaryEntriesCacheRef.current.get(normalizedWord) ?? null;
      if (cachedEntry) {
        setDictionaryPanel({
          ...nextPosition,
          pinned: dictionaryPanel?.pinned ?? false,
          dragging: false,
          queryWord: normalizedWord,
          entry: cachedEntry,
          error: null,
          loading: false,
        });
        void playDictionaryPronunciation(cachedEntry, {
          allowTtsFallback: false,
        });
        return;
      }

      const requestToken = dictionaryRequestTokenRef.current + 1;
      dictionaryRequestTokenRef.current = requestToken;
      setDictionaryPanel({
        ...nextPosition,
        pinned: dictionaryPanel?.pinned ?? false,
        dragging: false,
        queryWord: normalizedWord,
        entry: null,
        error: null,
        loading: true,
      });

      try {
        const entry = await getEnglishReadingDictionaryApi(normalizedWord);
        dictionaryEntriesCacheRef.current.set(normalizedWord, entry);
        if (dictionaryRequestTokenRef.current !== requestToken) return;
        setDictionaryPanel((current) => {
          const pinned = current?.pinned ?? dictionaryPanel?.pinned ?? false;
          const resolvedPosition =
            pinned && current
              ? {
                  left: current.left,
                  top: current.top,
                  maxHeight: current.maxHeight,
                }
              : nextPosition;
          return {
            ...resolvedPosition,
            pinned,
            dragging: false,
            queryWord: normalizedWord,
            entry,
            error: null,
            loading: false,
          };
        });
        void playDictionaryPronunciation(entry, {
          allowTtsFallback: false,
        });
      } catch (error) {
        if (dictionaryRequestTokenRef.current !== requestToken) return;
        setDictionaryPanel((current) => {
          const pinned = current?.pinned ?? dictionaryPanel?.pinned ?? false;
          const resolvedPosition =
            pinned && current
              ? {
                  left: current.left,
                  top: current.top,
                  maxHeight: current.maxHeight,
                }
              : nextPosition;
          return {
            ...resolvedPosition,
            pinned,
            dragging: false,
            queryWord: normalizedWord,
            entry: null,
            error:
              error instanceof Error ? error.message : "查词失败，请重试。",
            loading: false,
          };
        });
      }
    },
    [dictionaryPanel, playDictionaryPronunciation, timer],
  );

  const handleOpenSentenceTranslation = useCallback(
    async (payload: SentenceSelectionPayload) => {
      setSentenceTranslationTrigger(null);
      timer.registerActivity("practice_interaction", {
        source: "sentence_translation",
      });
      const nextPosition =
        sentenceTranslationPanel?.pinned && sentenceTranslationPanel
          ? {
              left: sentenceTranslationPanel.left,
              top: sentenceTranslationPanel.top,
              width: sentenceTranslationPanel.width,
              maxHeight: sentenceTranslationPanel.maxHeight,
            }
          : resolveSentenceTranslationPanelPosition(payload.rect);
      const cachedTranslation =
        sentenceTranslationCacheRef.current.get(payload.cacheKey) ?? null;
      if (cachedTranslation) {
        setSentenceTranslationPanel({
          ...nextPosition,
          pinned: sentenceTranslationPanel?.pinned ?? false,
          dragging: false,
          loading: false,
          error: null,
          cacheKey: payload.cacheKey,
          originalText: cachedTranslation.originalText,
          translatedText: cachedTranslation.translatedText,
          resolvedAi: cachedTranslation.resolved_ai,
        });
        return;
      }

      const requestToken = sentenceTranslationRequestTokenRef.current + 1;
      sentenceTranslationRequestTokenRef.current = requestToken;
      setSentenceTranslationPanel({
        ...nextPosition,
        pinned: sentenceTranslationPanel?.pinned ?? false,
        dragging: false,
        loading: true,
        error: null,
        cacheKey: payload.cacheKey,
        originalText: payload.originalText,
        translatedText: "",
        resolvedAi: null,
      });

      try {
        const aiOptions = await promptForAiOptions({
          scenarioKey: "translation_reading_sentence",
          entrypointKey: "english-reading-sentence-translation",
          title: "英语句子翻译配置",
        });
        if (!aiOptions) {
          if (sentenceTranslationRequestTokenRef.current !== requestToken) return;
          setSentenceTranslationPanel(null);
          return;
        }
        const runtimeAiOptions = normalizeRuntimeAiOptions(aiOptions);
        const response = runtimeAiOptions
          ? await translateEnglishReadingSentenceApi(
              payload.originalText,
              runtimeAiOptions,
            )
          : await translateEnglishReadingSentenceApi(payload.originalText);
        sentenceTranslationCacheRef.current.set(payload.cacheKey, response);
        if (sentenceTranslationRequestTokenRef.current !== requestToken) return;
        setSentenceTranslationPanel((current) => {
          const pinned =
            current?.pinned ?? sentenceTranslationPanel?.pinned ?? false;
          const resolvedPosition =
            pinned && current
              ? {
                  left: current.left,
                  top: current.top,
                  width: current.width,
                  maxHeight: current.maxHeight,
                }
              : nextPosition;
          return {
            ...resolvedPosition,
            pinned,
            dragging: false,
            loading: false,
            error: null,
            cacheKey: payload.cacheKey,
            originalText: response.originalText,
            translatedText: response.translatedText,
            resolvedAi: response.resolved_ai,
          };
        });
      } catch (error) {
        if (sentenceTranslationRequestTokenRef.current !== requestToken) return;
        setSentenceTranslationPanel((current) => {
          const pinned =
            current?.pinned ?? sentenceTranslationPanel?.pinned ?? false;
          const resolvedPosition =
            pinned && current
              ? {
                  left: current.left,
                  top: current.top,
                  width: current.width,
                  maxHeight: current.maxHeight,
                }
              : nextPosition;
          return {
            ...resolvedPosition,
            pinned,
            dragging: false,
            loading: false,
            error:
              error instanceof Error ? error.message : "句子翻译失败，请重试。",
            cacheKey: payload.cacheKey,
            originalText: payload.originalText,
            translatedText: "",
            resolvedAi: null,
          };
        });
      }
    },
    [sentenceTranslationPanel, timer],
  );

  const handleConfirmSentenceTranslation = useCallback(() => {
    const trigger = sentenceTranslationTrigger;
    if (!trigger) return;
    const selection = window.getSelection();
    selection?.removeAllRanges();
    void handleOpenSentenceTranslation(trigger.payload);
  }, [handleOpenSentenceTranslation, sentenceTranslationTrigger]);

  const handleToggleDictionaryPin = useCallback(() => {
    setDictionaryPanel((current) =>
      current
        ? {
            ...current,
            pinned: !current.pinned,
            dragging: false,
          }
        : current,
    );
  }, []);

  const beginDictionaryDragging = useCallback(
    (startX: number, startY: number, pointerId: number) => {
      if (!dictionaryPanel?.pinned) return;
      if (!Number.isFinite(startX) || !Number.isFinite(startY)) return;
      dictionaryDragRef.current = {
        pointerId,
        startX,
        startY,
        originLeft: dictionaryPanel.left,
        originTop: dictionaryPanel.top,
      };
      document.body.style.userSelect = "none";
      setDictionaryPanel((current) =>
        current ? { ...current, dragging: true } : current,
      );
    },
    [dictionaryPanel],
  );

  const handleDictionaryHeaderPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!dictionaryPanel?.pinned) return;
      if (
        event.target instanceof HTMLElement &&
        event.target.closest("button")
      ) {
        return;
      }
      event.preventDefault();
      beginDictionaryDragging(event.clientX, event.clientY, event.pointerId);
    },
    [beginDictionaryDragging, dictionaryPanel?.pinned],
  );

  const handleDictionaryHeaderMouseDown = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (!dictionaryPanel?.pinned) return;
      if (
        event.target instanceof HTMLElement &&
        event.target.closest("button")
      ) {
        return;
      }
      event.preventDefault();
      beginDictionaryDragging(event.clientX, event.clientY, -1);
    },
    [beginDictionaryDragging, dictionaryPanel?.pinned],
  );

  const handleReadingContentPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (typeof event.button === "number" && event.button > 0) return;
      setSentenceTranslationTrigger(null);
      const existingGesture = sentenceSelectionGestureRef.current;
      if (existingGesture?.timerId != null) {
        window.clearTimeout(existingGesture.timerId);
      }
      const pointerId =
        typeof event.pointerId === "number" && event.pointerId > 0
          ? event.pointerId
          : null;
      const nextGesture = {
        pointerId,
        startX: event.clientX,
        startY: event.clientY,
        longPressReady: false,
        movedTooFar: false,
        timerId: window.setTimeout(() => {
          if (!sentenceSelectionGestureRef.current) return;
          sentenceSelectionGestureRef.current.longPressReady = true;
        }, SENTENCE_TRANSLATION_LONG_PRESS_MS),
      };
      sentenceSelectionGestureRef.current = nextGesture;
    },
    [],
  );

  const handleToggleSentenceTranslationPin = useCallback(() => {
    setSentenceTranslationPanel((current) =>
      current
        ? {
            ...current,
            pinned: !current.pinned,
            dragging: false,
          }
        : current,
    );
  }, []);

  const beginSentenceTranslationDragging = useCallback(
    (startX: number, startY: number, pointerId: number) => {
      if (!sentenceTranslationPanel?.pinned) return;
      if (!Number.isFinite(startX) || !Number.isFinite(startY)) return;
      sentenceTranslationDragRef.current = {
        pointerId,
        startX,
        startY,
        originLeft: sentenceTranslationPanel.left,
        originTop: sentenceTranslationPanel.top,
      };
      document.body.style.userSelect = "none";
      setSentenceTranslationPanel((current) =>
        current ? { ...current, dragging: true } : current,
      );
    },
    [sentenceTranslationPanel],
  );

  const handleSentenceTranslationHeaderPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!sentenceTranslationPanel?.pinned) return;
      if (
        event.target instanceof HTMLElement &&
        event.target.closest("button")
      ) {
        return;
      }
      event.preventDefault();
      beginSentenceTranslationDragging(
        event.clientX,
        event.clientY,
        event.pointerId,
      );
    },
    [beginSentenceTranslationDragging, sentenceTranslationPanel?.pinned],
  );

  const handleSentenceTranslationHeaderMouseDown = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (!sentenceTranslationPanel?.pinned) return;
      if (
        event.target instanceof HTMLElement &&
        event.target.closest("button")
      ) {
        return;
      }
      event.preventDefault();
      beginSentenceTranslationDragging(event.clientX, event.clientY, -1);
    },
    [beginSentenceTranslationDragging, sentenceTranslationPanel?.pinned],
  );

  useEffect(() => {
    if (!isActive) return;
    const clearSentenceSelectionGesture = () => {
      const gesture = sentenceSelectionGestureRef.current;
      if (!gesture) return;
      if (gesture.timerId != null) {
        window.clearTimeout(gesture.timerId);
      }
      sentenceSelectionGestureRef.current = null;
    };
    const showSentenceTranslationTriggerFromSelection = () => {
      window.setTimeout(() => {
        const payload = extractSentenceSelection(readingContentRef.current);
        if (!payload) {
          setSentenceTranslationTrigger(null);
          return;
        }
        const nextPosition = resolveSentenceTranslationTriggerPosition(
          payload.rect,
        );
        setSentenceTranslationTrigger({
          ...nextPosition,
          payload,
        });
      }, 0);
    };
    const trackSentenceSelection = (event: PointerEvent) => {
      const gesture = sentenceSelectionGestureRef.current;
      const pointerId =
        typeof event.pointerId === "number" && event.pointerId > 0
          ? event.pointerId
          : null;
      if (!gesture) return;
      if (
        pointerId != null &&
        gesture.pointerId != null &&
        pointerId !== gesture.pointerId
      ) {
        return;
      }
      const distance = Math.hypot(
        event.clientX - gesture.startX,
        event.clientY - gesture.startY,
      );
      if (distance <= SENTENCE_TRANSLATION_LONG_PRESS_MOVE_TOLERANCE_PX) {
        return;
      }
      gesture.movedTooFar = true;
    };
    const finishSentenceSelection = (event: PointerEvent) => {
      const gesture = sentenceSelectionGestureRef.current;
      const pointerId =
        typeof event.pointerId === "number" && event.pointerId > 0
          ? event.pointerId
          : null;
      if (!gesture) return;
      if (
        pointerId != null &&
        gesture.pointerId != null &&
        pointerId !== gesture.pointerId
      ) {
        return;
      }
      clearSentenceSelectionGesture();
      showSentenceTranslationTriggerFromSelection();
    };
    const cancelSentenceSelection = (event: PointerEvent) => {
      const gesture = sentenceSelectionGestureRef.current;
      const pointerId =
        typeof event.pointerId === "number" && event.pointerId > 0
          ? event.pointerId
          : null;
      if (!gesture) return;
      if (
        pointerId != null &&
        gesture.pointerId != null &&
        pointerId !== gesture.pointerId
      ) {
        return;
      }
      clearSentenceSelectionGesture();
    };
    document.addEventListener("pointermove", trackSentenceSelection);
    document.addEventListener("pointerup", finishSentenceSelection);
    document.addEventListener("pointercancel", cancelSentenceSelection);
    return () => {
      document.removeEventListener("pointermove", trackSentenceSelection);
      document.removeEventListener("pointerup", finishSentenceSelection);
      document.removeEventListener("pointercancel", cancelSentenceSelection);
    };
  }, [isActive]);

  const handleCompleteReading = useCallback(
    async (feedback: ReadingSessionResult["feedback"]) => {
      if (!material || !version) return;
      setCompletionSubmitting(feedback);
      try {
        await timer.complete("manual_complete", {
          source: "english_reading_complete",
        });
        const response = await completeEnglishReadingMaterialApi(material.id, {
          versionId: version.id,
          feedback,
          durationSeconds: Math.max(1, timer.effectiveSeconds),
          hoverCount: hoveredAnnotationIds.size,
          expandCount: expandedSentenceIds.size,
        });
        setCompletionResponse(response);
        setProfile(response.profile);
        setMaterial(response.material);
        setCompletionPanelOpen(true);
        await loadWorkspace();
        toast.success("阅读反馈已保存。");
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "保存阅读反馈失败。",
        );
      } finally {
        setCompletionSubmitting(null);
      }
    },
    [
      expandedSentenceIds.size,
      hoveredAnnotationIds.size,
      loadWorkspace,
      material,
      timer,
      version,
    ],
  );

  if (pageLoading || !profile) {
    return <LoadingState text="正在加载英语阅读…" />;
  }

  const visibleStage = generationStatus?.message || "正在准备生成阅读稿……";
  const generationProgress =
    generationStatus && generationStatus.totalSteps > 0
      ? Math.min(
          100,
          Math.max(
            8,
            (generationStatus.step / generationStatus.totalSteps) * 100,
          ),
        )
      : 8;

  return (
    <div className="space-y-6">
      {aiRunConfigDialog}
      <PageIntro
        title="英语阅读"
        description="在你的舒适区外半步处，持续制造真正能读进去的 i+1 材料。"
      />

      <div className="grid gap-4 sm:grid-cols-[minmax(0,0.9fr)_minmax(320px,1.1fr)]">
        <Card className="border-border/70 bg-card/95">
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="h-4 w-4" />
              建立我的 i
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {CEFR_LEVELS.map((level) => {
                const active = profile.declaredCefr === level;
                return (
                  <button
                    key={level}
                    type="button"
                    className={cn(
                      "rounded-2xl border px-4 py-3 text-left transition-all",
                      active
                        ? "border-primary bg-primary text-primary-foreground shadow-card"
                        : "border-border/70 bg-background/75 hover:border-border hover:bg-background",
                    )}
                    onClick={() => void handleSelectLevel(level)}
                    disabled={profileSaving !== null}
                  >
                    <div className="text-[11px] uppercase tracking-[0.2em] opacity-70">
                      CEFR
                    </div>
                    <div className="mt-1.5 text-xl font-semibold">{level}</div>
                    {profileSaving === level ? (
                      <div className="mt-1.5 text-xs opacity-80">更新中...</div>
                    ) : null}
                  </button>
                );
              })}
            </div>

            <div className="rounded-3xl border border-border/70 bg-background/70 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">升级进度</div>
                  <div className="mt-1.5 text-xs text-muted-foreground">
                    当前等级 {profile.declaredCefr} · 距离下一等级{" "}
                    {Math.max(0, 100 - profile.levelProgress)} XP
                  </div>
                </div>
                <Badge variant="secondary">
                  置信度 {Math.round(profile.confidence * 100)}%
                </Badge>
              </div>
              <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full rounded-full bg-[linear-gradient(90deg,#1d4ed8,#0f766e,#16a34a)] transition-all"
                  style={{
                    width: `${Math.max(0, Math.min(100, profile.levelProgress))}%`,
                  }}
                />
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-border/70 bg-card px-4 py-3">
                  <div className="text-xs text-muted-foreground">
                    词汇舒适区
                  </div>
                  <div className="mt-1.5 text-lg font-semibold">
                    {formatWorkingBand(profile.workingLexicalI)}
                  </div>
                </div>
                <div className="rounded-2xl border border-border/70 bg-card px-4 py-3">
                  <div className="text-xs text-muted-foreground">
                    句法舒适区
                  </div>
                  <div className="mt-1.5 text-lg font-semibold">
                    {formatWorkingBand(profile.workingSyntacticI)}
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/70 bg-card/95">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Sparkles className="h-4 w-4" />
                定制我的 i+1 材料
              </CardTitle>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setAutomationOpen(true)}
              >
                <Settings2 className="mr-2 h-4 w-4" />
                自动化配置
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3.5">
            <Textarea
              value={textInput}
              onChange={handleTextInputChange}
              placeholder="直接粘贴英文文章全文，或者上传 txt / md / pdf 文件。"
              className="min-h-[170px] resize-y rounded-3xl bg-background/70 px-4 py-4 text-[15px] leading-6.5"
            />
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
              <div
                role="button"
                tabIndex={0}
                aria-label="拖动或选择阅读文件"
                data-testid="reading-file-dropzone"
                className={cn(
                  "rounded-[28px] border border-dashed px-5 py-4 text-left transition-all",
                  dropzoneActive
                    ? "border-info/50 bg-info/5 shadow-popover"
                    : "border-border/70 bg-background/65 hover:border-border hover:bg-background",
                  generating
                    ? "cursor-not-allowed opacity-70"
                    : "cursor-pointer",
                )}
                onClick={handleOpenFilePicker}
                onKeyDown={handleDropzoneKeyDown}
                onDragEnter={handleDropzoneDragEnter}
                onDragOver={handleDropzoneDragOver}
                onDragLeave={handleDropzoneDragLeave}
                onDrop={handleDropzoneDrop}
              >
                <Input
                  ref={fileInputRef}
                  type="file"
                  accept={READING_FILE_ACCEPT}
                  className="sr-only"
                  tabIndex={-1}
                  onChange={handleFileInputChange}
                />
                <div className="flex items-start gap-3">
                  <div
                    className={cn(
                      "flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border transition-colors",
                      dropzoneActive
                        ? "border-info/30 bg-info/10 text-info"
                        : "border-border/70 bg-card text-muted-foreground",
                    )}
                  >
                    <FileText className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-primary">
                      拖动 `txt / md / pdf` 到这里，或点击选择文件
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {sourceMode === "file" && selectedFile
                        ? "当前将按文件导入生成。继续编辑上方正文可切回粘贴导入。"
                        : "你也可以完全不上传文件，直接粘贴英文正文开始生成。"}
                    </div>
                    {selectedFile ? (
                      <div className="mt-3 inline-flex max-w-full items-center rounded-full border border-border/70 bg-card px-3 py-1 text-sm text-muted-foreground">
                        <span className="truncate">
                          已选择文件：{selectedFile.name}
                        </span>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
              <Button
                onClick={() => void handleCreateAndGenerate()}
                disabled={generating}
                className="h-11 rounded-2xl px-5"
              >
                {generating ? (
                  <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <BookOpenText className="mr-2 h-4 w-4" />
                )}
                开始定制我的 i+1 材料
              </Button>
            </div>
            {generating ? (
              <div className="rounded-3xl border border-info/20 bg-info/5 px-4 py-4">
                <div className="flex items-center gap-2 text-sm font-medium text-info">
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                  {visibleStage}
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-info/10">
                  <div
                    className="h-full rounded-full bg-[linear-gradient(90deg,#38bdf8,#2563eb)] transition-all"
                    style={{
                      width: `${generationProgress}%`,
                    }}
                  />
                </div>
              </div>
            ) : (
              <div className="rounded-3xl border border-dashed border-border/70 bg-background/60 px-4 py-4 text-sm text-muted-foreground">
                当前支持手动粘贴，以及点击或拖动上传 `txt / md /
                pdf`。生成时会优先使用本地 CEFR 词典，不认识的词形再交给 Qwen
                Flash 补洞。
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div>
        <Card className="border-border/70 bg-card/95">
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <CardTitle className="text-base">最近阅读材料</CardTitle>
            <div className="text-xs text-muted-foreground">
              点击一条会直接打开这篇材料的最近阅读版本
            </div>
          </CardHeader>
          <CardContent>
            {recentMaterials.length > 0 ? (
              <div className="space-y-3">
                {Children.toArray(
                  recentMaterials.map((item) => {
                    const active = material?.id === item.id;
                    const busy =
                      openingMaterialId === item.id ||
                      renamingMaterialId === item.id ||
                      deletingMaterialId === item.id;
                    return createElement(
                      "div",
                      {
                        key: item.id,
                        className: cn(
                          "rounded-2xl border transition-all",
                          active
                            ? "border-primary bg-primary text-primary-foreground shadow-soft"
                            : "border-border/70 bg-background/70",
                        ),
                      },
                      <>
                        <button
                          type="button"
                          className={cn(
                            "w-full rounded-t-2xl px-4 py-4 text-left transition-all",
                            active
                              ? "hover:bg-primary-foreground/10"
                              : "hover:border-border hover:bg-background",
                          )}
                          onClick={() => void handleOpenRecentMaterial(item)}
                          disabled={busy}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge
                                  variant={active ? "secondary" : "outline"}
                                >
                                  {item.sourceType.toUpperCase()}
                                </Badge>
                                {item.latestVersionId ? (
                                  <Badge
                                    variant={active ? "secondary" : "outline"}
                                  >
                                    已生成
                                  </Badge>
                                ) : (
                                  <Badge
                                    variant={active ? "secondary" : "outline"}
                                  >
                                    仅已导入
                                  </Badge>
                                )}
                                <span
                                  className={cn(
                                    "text-xs",
                                    active
                                      ? "text-primary-foreground"
                                      : "text-muted-foreground",
                                  )}
                                >
                                  {item.wordCount} 词
                                </span>
                              </div>
                              <div className="mt-2 text-sm font-medium">
                                {item.title}
                              </div>
                              <div
                                className={cn(
                                  "mt-2 text-xs",
                                  active
                                    ? "text-primary-foreground/70"
                                    : "text-muted-foreground",
                                )}
                              >
                                更新于{" "}
                                {item.updatedAt
                                  ? new Date(item.updatedAt).toLocaleString(
                                      "zh-CN",
                                    )
                                  : "刚刚"}
                              </div>
                            </div>
                            <span
                              className={cn(
                                "inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px]",
                                active
                                  ? "border-primary-foreground/20 text-primary-foreground"
                                  : "border-border/70 text-muted-foreground",
                              )}
                            >
                              {openingMaterialId === item.id ? (
                                <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <ExternalLink className="h-3.5 w-3.5" />
                              )}
                              打开
                            </span>
                          </div>
                        </button>
                        <div
                          className={cn(
                            "flex items-center justify-end gap-2 border-t px-3 py-2",
                            active
                              ? "border-slate-800/80 bg-slate-950/20"
                              : "border-border/60 bg-background/60",
                          )}
                        >
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className={cn(
                              active
                                ? "text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
                                : "",
                            )}
                            onClick={() =>
                              void handleRenameRecentMaterial(item)
                            }
                            disabled={busy}
                          >
                            {renamingMaterialId === item.id ? (
                              <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                              <PencilLine className="mr-2 h-4 w-4" />
                            )}
                            Edit
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className={cn(
                              active
                                ? "text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
                                : "",
                            )}
                            onClick={() =>
                              void handleDeleteRecentMaterial(item)
                            }
                            disabled={busy}
                          >
                            {deletingMaterialId === item.id ? (
                              <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="mr-2 h-4 w-4" />
                            )}
                            Delete
                          </Button>
                        </div>
                      </>,
                    );
                  }),
                )}
              </div>
            ) : (
              <div className="rounded-3xl border border-dashed border-border/70 py-12 text-center text-sm text-muted-foreground">
                还没有阅读历史。先导入一篇英文材料，生成后会自动出现在这里。
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {versionLoading ? (
        <div className="flex min-h-[25vh] items-center justify-center text-sm text-muted-foreground">
          正在加载阅读面板...
        </div>
      ) : null}

      {material && !version && !versionLoading ? (
        <Card className="border-border/70 bg-card/95">
          <div ref={readingPanelRef} />
          <CardHeader className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">
                {material.sourceType.toUpperCase()}
              </Badge>
              <Badge variant="outline">{material.wordCount} 词</Badge>
              <Badge variant="secondary">尚未生成阅读稿</Badge>
            </div>
            <CardTitle className="text-2xl">{material.title}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-3xl border border-dashed border-border/70 bg-background/60 px-5 py-6 text-sm text-muted-foreground">
              这篇材料已经进入阅读历史，但还没有生成可阅读版本。你可以直接继续生成，不需要重新上传。
            </div>
            <Button
              onClick={() =>
                void runGeneration({
                  kind: "regenerate",
                  direction: "same",
                  delta: 0.5,
                })
              }
              disabled={generating}
              className="h-11 rounded-2xl px-5"
            >
              {generating ? (
                <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="mr-2 h-4 w-4" />
              )}
              为这篇材料生成阅读稿
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {material && version ? (
        <Card className="overflow-hidden border-border/70 bg-card/95">
          <div ref={readingPanelRef} />
          <CardHeader className="space-y-4 border-b border-border/70 bg-card/90">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Badge variant="outline">
                    {material.sourceType.toUpperCase()}
                  </Badge>
                  <Badge variant="secondary">目标 {version.targetCefr}</Badge>
                  <Badge variant="outline">{material.wordCount} 词</Badge>
                  {version.summary._resolvedAi?.reading_sentence_rewrite?.model_label ? (
                    <Badge variant="outline">
                      改写：{version.summary._resolvedAi.reading_sentence_rewrite.model_label}
                    </Badge>
                  ) : null}
                  {version.summary._resolvedAi?.reading_lexical_resolution?.model_label ? (
                    <Badge variant="outline">
                      分级：{version.summary._resolvedAi.reading_lexical_resolution.model_label}
                    </Badge>
                  ) : null}
                </div>
                <CardTitle className="text-2xl">{material.title}</CardTitle>
                <div className="text-sm text-muted-foreground">
                  黑色是舒适区，绿色是原文 i+1，黄色是升级表达，红色是降阶救援。
                </div>
              </div>
              <Button
                variant="outline"
                onClick={handleOpenRegenerateDialog}
                disabled={generating}
              >
                <RefreshCcw className="mr-2 h-4 w-4" />
                重新生成内容
              </Button>
            </div>
            <SessionTimerBar
              effectiveSeconds={timer.effectiveSeconds}
              idleSeconds={timer.idleSeconds}
              automationScene="english_reading"
              pauseCount={timer.pauseCount}
              status={timer.status}
              onStart={() => timer.start({ source: "manual_start" })}
              onPause={() => timer.pause({ source: "manual_pause" })}
              onResume={() => timer.resume({ source: "manual_resume" })}
              onAdjustDuration={timer.adjustDuration}
              showCompleteAction={false}
              showRestartAction
              onRestart={() => timer.reset()}
              layout="compact"
            />
          </CardHeader>
          <CardContent className="space-y-6 p-4 sm:p-6">
            <div className="rounded-[32px] border border-border/70 bg-card/90 px-5 py-6 shadow-floating sm:px-8 sm:py-9">
              <div
                ref={readingContentRef}
                className="mx-auto max-w-4xl space-y-6 text-[1.05rem] leading-9 text-foreground selection:bg-info/10 selection:text-primary sm:text-[1.1rem]"
                onPointerDown={handleReadingContentPointerDown}
              >
                {version.renderBlocks.map((block) => (
                  <div key={block.id} className="space-y-3">
                    {block.sentences.map((sentence) => (
                      <SentenceLine
                        key={sentence.id}
                        sentence={sentence}
                        sentenceAnnotation={sentenceAnnotationMap.get(
                          sentence.sentenceAnnotationId,
                        )}
                        annotationMap={annotationMap}
                        expanded={expandedSentenceIds.has(sentence.id)}
                        onHoverAnnotation={handleAnnotationHover}
                        onLookupWord={handleLookupWord}
                        onToggleExpanded={() =>
                          handleToggleExpandedSentence(sentence.id)
                        }
                      />
                    ))}
                  </div>
                ))}
              </div>

              <div className="mx-auto mt-8 flex max-w-4xl flex-col gap-4 border-t border-border/80 pt-6 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
                  <span className="rounded-full bg-white/90 px-3 py-1 shadow-sm">
                    绿色 {version.summary.greenCount}
                  </span>
                  <span className="rounded-full bg-white/90 px-3 py-1 shadow-sm">
                    黄色 {version.summary.yellowCount}
                  </span>
                  <span className="rounded-full bg-white/90 px-3 py-1 shadow-sm">
                    红色 {version.summary.redCount}
                  </span>
                  <span className="rounded-full bg-white/90 px-3 py-1 shadow-sm">
                    句法重构 {version.summary.sentenceSimplifiedCount}
                  </span>
                </div>
                <Button
                  size="lg"
                  className="rounded-2xl px-7"
                  onClick={() => setCompletionPanelOpen((current) => !current)}
                >
                  我读完了
                </Button>
              </div>
            </div>

            {completionPanelOpen ? (
              <div className="grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(320px,1.05fr)]">
                <Card className="border-border/70 bg-background/85">
                  <CardHeader>
                    <CardTitle className="text-base">本次阅读反馈</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-2xl border border-border/70 bg-card px-4 py-4">
                        <div className="text-xs text-muted-foreground">
                          当前用时
                        </div>
                        <div className="mt-2 text-lg font-semibold">
                          {formatMinutes(timer.effectiveSeconds)}
                        </div>
                      </div>
                      <div className="rounded-2xl border border-border/70 bg-card px-4 py-4">
                        <div className="text-xs text-muted-foreground">
                          已接触增长内容
                        </div>
                        <div className="mt-2 text-lg font-semibold">
                          {version.summary.greenCount +
                            version.summary.yellowCount}
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        onClick={() => void handleCompleteReading("too_easy")}
                        disabled={completionSubmitting !== null}
                      >
                        {completionSubmitting === "too_easy" ? (
                          <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                        ) : null}
                        太简单
                      </Button>
                      <Button
                        onClick={() => void handleCompleteReading("just_right")}
                        disabled={completionSubmitting !== null}
                      >
                        {completionSubmitting === "just_right" ? (
                          <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                        ) : null}
                        刚刚好
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => void handleCompleteReading("too_hard")}
                        disabled={completionSubmitting !== null}
                      >
                        {completionSubmitting === "too_hard" ? (
                          <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                        ) : null}
                        有点难
                      </Button>
                    </div>
                    <div className="rounded-2xl border border-dashed border-border/70 px-4 py-4 text-sm text-muted-foreground">
                      系统会根据你的主观反馈、阅读速度、悬浮次数和句法展开次数，只校准下一篇材料的内部难度，不会突然把当前文章改掉。
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-border/70 bg-background/85">
                  <CardHeader>
                    <CardTitle className="text-base">努力的痕迹</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {completionResponse ? (
                      <div className="space-y-3 text-sm">
                        <div className="rounded-2xl border border-border/70 bg-card px-4 py-4">
                          本次阅读用时：
                          {formatMinutes(
                            completionResponse.session.durationSeconds,
                          )}
                        </div>
                        <div className="rounded-2xl border border-border/70 bg-card px-4 py-4">
                          阅读速度：{completionResponse.session.wordsPerMinute}{" "}
                          词/分钟
                        </div>
                        <div className="rounded-2xl border border-border/70 bg-card px-4 py-4">
                          你与{" "}
                          {version.summary.greenCount +
                            version.summary.yellowCount}{" "}
                          个 i+1 词汇进行了亲密接触，并无痛掠过了{" "}
                          {version.summary.redCount} 个超纲词。
                        </div>
                        <div className="rounded-2xl border border-success/20 bg-success/5 px-4 py-4 text-success">
                          本次反馈：
                          {summarizeFeedback(
                            completionResponse.session.feedback,
                          )}{" "}
                          · 获得 {completionResponse.session.xpAwarded} XP
                        </div>
                        <div className="rounded-2xl border border-border/70 bg-card px-4 py-4">
                          当前等级：{completionResponse.profile.declaredCefr} ·
                          升级进度 {completionResponse.profile.levelProgress}
                          /100
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-3xl border border-dashed border-border/70 py-12 text-center text-sm text-muted-foreground">
                        选择一个反馈后，这里会出现本次阅读的温和回顾。
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {!material && !versionLoading ? (
        <Card className="border-border/70 bg-card/95">
          <CardContent className="flex flex-col items-center justify-center gap-3 py-14 text-center">
            <FileText className="h-10 w-10 text-muted-foreground" />
            <div className="text-base font-medium">先导入一篇英文材料</div>
            <div className="max-w-xl text-sm text-muted-foreground">
              你可以先粘贴全文，或者上传 `txt / md / pdf`。系统会基于本地词典和
              Qwen Flash，把它改造成真正能读进去的 i+1 阅读稿。
            </div>
          </CardContent>
        </Card>
      ) : null}

      {sentenceTranslationTrigger ? (
        <button
          ref={sentenceTranslationTriggerRef}
          type="button"
          data-testid="sentence-translation-trigger"
          onClick={handleConfirmSentenceTranslation}
          style={{
            position: "fixed",
            top: sentenceTranslationTrigger.top,
            left: sentenceTranslationTrigger.left,
            width: SENTENCE_TRANSLATION_TRIGGER_WIDTH,
            height: SENTENCE_TRANSLATION_TRIGGER_HEIGHT,
          }}
          className="z-[144] inline-flex items-center justify-center rounded-full border border-info/20 bg-white/92 px-4 text-sm font-medium text-info shadow-soft backdrop-blur-sm transition hover:border-info/30 hover:bg-info/5 hover:text-primary"
        >
          翻译这句
        </button>
      ) : null}

      <Dialog
        open={dictionaryPanel !== null}
        onOpenChange={(open) => {
          if (!open) setDictionaryPanel(null);
        }}
        modal={false}
      >
        {dictionaryPanel ? (
          <DialogContent
            layout="unstyled"
            ref={dictionaryPanelRef}
            data-testid="dictionary-popup-panel"
            style={{
              position: "fixed",
              top: dictionaryPanel.top,
              left: dictionaryPanel.left,
              width: Math.min(DICTIONARY_PANEL_WIDTH, window.innerWidth - 32),
              maxHeight: dictionaryPanel.maxHeight,
            }}
            className="max-w-none overflow-hidden rounded-[18px] border border-border bg-background p-0 text-primary shadow-floating"
          >
            <div
              data-testid="dictionary-popup-header"
              onPointerDown={handleDictionaryHeaderPointerDown}
              onMouseDown={handleDictionaryHeaderMouseDown}
              className={cn(
                "flex items-center justify-between border-b border-border px-3 py-2.5",
                dictionaryPanel.pinned
                  ? dictionaryPanel.dragging
                    ? "cursor-grabbing"
                    : "cursor-grab"
                  : "",
              )}
            >
              <div className="min-w-0">
                <DialogTitle className="truncate text-[1.02rem] font-semibold text-primary">
                  {dictionaryPanel.entry?.word || dictionaryPanel.queryWord}
                </DialogTitle>
                {dictionaryPanel.entry?.lemma &&
                dictionaryPanel.entry.lemma !== dictionaryPanel.entry.word ? (
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    原形 {dictionaryPanel.entry.lemma}
                  </div>
                ) : null}
              </div>
              <div className="ml-3 flex items-center gap-1">
                <button
                  type="button"
                  aria-label={dictionaryPanel.pinned ? "取消固定词典面板" : "固定词典面板"}
                  onClick={handleToggleDictionaryPin}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition",
                    dictionaryPanel.pinned
                      ? "bg-primary text-primary-foreground hover:bg-primary/90"
                      : "text-muted-foreground hover:bg-muted hover:text-primary",
                  )}
                >
                  {dictionaryPanel.pinned ? (
                    <PinOff className="h-3.5 w-3.5" />
                  ) : (
                    <Pin className="h-3.5 w-3.5" />
                  )}
                  {dictionaryPanel.pinned ? "取消固定" : "固定"}
                </button>
                <button
                  type="button"
                  aria-label="关闭"
                  onClick={() => setDictionaryPanel(null)}
                  className="rounded-md p-2 text-muted-foreground transition hover:bg-muted hover:text-primary"
                >
                  <span className="text-sm leading-none">×</span>
                </button>
              </div>
            </div>

            <div
              data-testid="dictionary-popup-scroll"
              className="min-h-0 space-y-2.5 overflow-y-auto overscroll-contain px-3 py-2.5"
            >
              {dictionaryPanel.loading ? (
                <div className="flex items-center gap-2 rounded-lg border border-border bg-muted px-2.5 py-2.5 text-sm text-foreground">
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                  正在查询词典...
                </div>
              ) : null}

              {dictionaryPanel.error ? (
                <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-2.5 py-2.5 text-sm text-destructive">
                  {dictionaryPanel.error}
                </div>
              ) : null}

              {dictionaryPanel.entry ? (
                <>
                  <div className="space-y-1.5 border-b border-border pb-2">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted-foreground">
                      <span className="font-mono text-[15px] font-semibold tracking-[0.01em] text-foreground">
                        美 {dictionaryPanel.entry.phoneticUs || "/暂无音标/"}
                      </span>
                      <button
                        type="button"
                        aria-label="播放美式发音"
                        className="inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
                        onClick={() =>
                          void playDictionaryPronunciation(
                            dictionaryPanel.entry as ReadingDictionaryEntry,
                            {
                              allowTtsFallback: true,
                            },
                          )
                        }
                      >
                        <Volume2 className="h-3.5 w-3.5" />
                      </button>
                      <span className="text-[11px] text-muted-foreground">
                        {dictionaryPanel.entry.audioUsUrl
                          ? "已自动发音"
                          : canUseSpeechSynthesis()
                            ? "美式发音"
                            : "暂无发音"}
                      </span>
                    </div>
                    {dictionaryPanel.entry.summaryZh.length > 0 ? (
                      <div className="text-[12px] leading-5 text-muted-foreground">
                        {dictionaryPanel.entry.summaryZh.join("；")}
                      </div>
                    ) : null}
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-1.5 text-[13px]">
                      {dictionaryPanel.entry.partsOfSpeech.length > 0 ? (
                        dictionaryPanel.entry.partsOfSpeech.map((part) => (
                          <span
                            key={part}
                            className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.02em] text-muted-foreground"
                          >
                            {part}
                          </span>
                        ))
                      ) : (
                        <span className="text-[12px] text-muted-foreground">
                          暂无词性信息
                        </span>
                      )}
                    </div>

                    <div className="space-y-2">
                      {dictionaryPanel.entry.senses.length > 0 ? (
                        dictionaryPanel.entry.senses
                          .slice(0, 4)
                          .map((sense, index) => (
                            <div
                              key={`${sense.partOfSpeech}-${index}`}
                              className="text-[13px] leading-5.5 text-primary"
                            >
                              <div>
                                <span className="mr-1 font-semibold text-foreground">
                                  {getDictionaryPartOfSpeechLabel(
                                    sense.partOfSpeech,
                                  )}
                                </span>
                                <span>{sense.definitionZh || sense.definition}</span>
                              </div>
                              {sense.definition.trim() ? (
                                <div className="pl-5 text-[11px] leading-4.5 text-muted-foreground">
                                  {sense.definition}
                                </div>
                              ) : null}
                              {sense.exampleZh ? (
                                <div className="mt-0.5 pl-5 text-[11px] leading-4.5 text-muted-foreground">
                                  例：{sense.exampleZh}
                                </div>
                              ) : null}
                              {sense.example ? (
                                <div className="pl-5 text-[11px] italic leading-4.5 text-muted-foreground/70">
                                  e.g. {sense.example}
                                </div>
                              ) : null}
                            </div>
                          ))
                      ) : (
                        <div className="text-[12px] text-muted-foreground">
                          暂无义项内容
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-between border-t border-border pt-2 text-[11px] text-muted-foreground">
                    <span>来源 {dictionaryPanel.entry.source || "xxapi"}</span>
                    <span>
                      {dictionaryPanel.entry.senses.length > 4
                        ? `更多释义 ${dictionaryPanel.entry.senses.length - 4}+`
                        : dictionaryPanel.entry.cachedAt || "刚刚"}
                    </span>
                  </div>
                </>
              ) : null}
            </div>
          </DialogContent>
        ) : null}
      </Dialog>

      <Dialog
        open={sentenceTranslationPanel !== null}
        onOpenChange={(open) => {
          if (!open) setSentenceTranslationPanel(null);
        }}
        modal={false}
      >
        {sentenceTranslationPanel ? (
          <DialogContent
            layout="unstyled"
            ref={sentenceTranslationPanelRef}
            data-testid="sentence-translation-panel"
            style={{
              position: "fixed",
              top: sentenceTranslationPanel.top,
              left: sentenceTranslationPanel.left,
              width: sentenceTranslationPanel.width,
              maxHeight: sentenceTranslationPanel.maxHeight,
            }}
            className="z-[145] max-w-none overflow-hidden rounded-[20px] border border-border bg-background p-0 text-primary shadow-floating"
          >
            <div
              data-testid="sentence-translation-header"
              onPointerDown={handleSentenceTranslationHeaderPointerDown}
              onMouseDown={handleSentenceTranslationHeaderMouseDown}
              className={cn(
                "flex items-center justify-between border-b border-border px-3 py-2",
                sentenceTranslationPanel.pinned
                  ? sentenceTranslationPanel.dragging
                    ? "cursor-grabbing"
                    : "cursor-grab"
                  : "",
              )}
            >
              <DialogTitle className="truncate text-[1rem] font-semibold text-primary">
                句子翻译
              </DialogTitle>
              <div className="ml-3 flex items-center gap-1">
                <button
                  type="button"
                  aria-label={
                    sentenceTranslationPanel.pinned
                      ? "取消固定句子翻译面板"
                      : "固定句子翻译面板"
                  }
                  onClick={handleToggleSentenceTranslationPin}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition",
                    sentenceTranslationPanel.pinned
                      ? "bg-primary text-primary-foreground hover:bg-primary/90"
                      : "text-muted-foreground hover:bg-muted hover:text-primary",
                  )}
                >
                  {sentenceTranslationPanel.pinned ? (
                    <PinOff className="h-3.5 w-3.5" />
                  ) : (
                    <Pin className="h-3.5 w-3.5" />
                  )}
                  {sentenceTranslationPanel.pinned ? "取消固定" : "固定"}
                </button>
                <button
                  type="button"
                  aria-label="关闭句子翻译"
                  onClick={() => setSentenceTranslationPanel(null)}
                  className="rounded-md p-2 text-muted-foreground transition hover:bg-muted hover:text-primary"
                >
                  <span className="text-sm leading-none">×</span>
                </button>
              </div>
            </div>

            <div
              data-testid="sentence-translation-scroll"
              className="min-h-0 space-y-2.5 overflow-y-auto overscroll-contain px-3.5 py-3"
            >
              <div className="rounded-2xl border border-border bg-muted/50 px-3 py-2.5 text-[14px] leading-6 text-primary">
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  原文
                </div>
                <div data-testid="sentence-translation-original">
                  <ReadingLookupText
                    text={sentenceTranslationPanel.originalText}
                    onLookupWord={handleLookupWord}
                  />
                </div>
              </div>

              <div className="rounded-2xl border border-info/10 bg-info/5 px-3 py-2.5 text-[14px] leading-6 text-primary">
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-info/70">
                  翻译
                </div>
                {sentenceTranslationPanel.resolvedAi?.model_label ? (
                  <div className="mb-1 text-[10px] text-muted-foreground">
                    实际模型：{sentenceTranslationPanel.resolvedAi.model_label}
                  </div>
                ) : null}
                {sentenceTranslationPanel.loading ? (
                  <div className="flex items-center gap-2 text-sm text-foreground">
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                    正在翻译句子...
                  </div>
                ) : sentenceTranslationPanel.error ? (
                  <div className="text-sm text-destructive">
                    {sentenceTranslationPanel.error}
                  </div>
                ) : (
                  <div data-testid="sentence-translation-text">
                    {sentenceTranslationPanel.translatedText}
                  </div>
                )}
              </div>
            </div>
          </DialogContent>
        ) : null}
      </Dialog>

      <TimerAutomationDialog
        open={automationOpen}
        config={automationConfig}
        onOpenChange={setAutomationOpen}
        onSave={(nextConfig) => {
          const saved = saveTimerAutomationConfig(nextConfig);
          setAutomationConfig(saved);
        }}
        onReset={() => {
          const reset = resetTimerAutomationConfig();
          setAutomationConfig(reset);
        }}
      />

      <Dialog
        open={regenerateDialogOpen}
        onOpenChange={(open) => {
          if (generating) return;
          setRegenerateDialogOpen(open);
        }}
      >
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <div>
              <DialogTitle>重新生成内容</DialogTitle>
              <div className="mt-1 text-sm text-muted-foreground">
                本次会对当前整篇文章重新生成，不会只调整未读部分。
              </div>
            </div>
            <DialogClose onClick={() => setRegenerateDialogOpen(false)} />
          </DialogHeader>
          <div className="space-y-5 px-6 py-5">
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                {
                  value: "easier" as const,
                  title: "降低难度",
                  description: "把这篇文章调得更容易读进去。",
                },
                {
                  value: "same" as const,
                  title: "重新生成",
                  description: "保持当前难度，刷新一版新的阅读稿。",
                },
                {
                  value: "harder" as const,
                  title: "提升难度",
                  description: "把这篇文章调得更有挑战一些。",
                },
              ].map((option) => {
                const active = regenerateDirection === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    disabled={generating}
                    onClick={() => setRegenerateDirection(option.value)}
                    className={cn(
                      "rounded-2xl border px-4 py-4 text-left transition-all",
                      active
                        ? "border-primary bg-primary text-primary-foreground shadow-card"
                        : "border-border/70 bg-background/80 hover:border-border hover:bg-background",
                      generating && "cursor-not-allowed opacity-70",
                    )}
                  >
                    <div className="text-sm font-semibold">{option.title}</div>
                    <div
                      className={cn(
                        "mt-2 text-xs leading-5",
                        active ? "text-primary-foreground" : "text-muted-foreground",
                      )}
                    >
                      {option.description}
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="rounded-2xl border border-border/70 bg-background/75 px-4 py-4">
              <div className="flex items-center justify-between gap-3">
                <Label
                  htmlFor="reading-regenerate-delta"
                  className="text-sm font-medium"
                >
                  难度变化幅度
                </Label>
                <span className="text-sm font-semibold text-primary">
                  {formatDifficultyDelta(regenerateDelta)}
                </span>
              </div>
              <Input
                id="reading-regenerate-delta"
                type="range"
                min="0.5"
                max="2"
                step="0.5"
                value={regenerateDelta}
                disabled={generating}
                onChange={(event) =>
                  setRegenerateDelta(
                    Number(event.currentTarget.value) as ReadingDifficultyDelta,
                  )
                }
                className="mt-4"
              />
              <div className="mt-2 flex justify-between text-xs text-muted-foreground">
                {READING_DIFFICULTY_OPTIONS.map((option) => (
                  <span key={option}>{option}</span>
                ))}
              </div>
              <div className="mt-3 text-xs text-muted-foreground">
                选择“重新生成”时会忽略这个幅度，并按当前难度刷新内容。
              </div>
            </div>
          </div>
          <div className="flex items-center justify-end gap-3 border-t px-6 py-4">
            <Button
              variant="outline"
              onClick={() => setRegenerateDialogOpen(false)}
              disabled={generating}
            >
              取消
            </Button>
            <Button
              onClick={() => void handleConfirmRegenerate()}
              disabled={generating}
            >
              {generating ? (
                <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              确认生成
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
