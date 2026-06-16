import type {
  ReadingDictionaryEntry,
  ReadingSentenceTranslationResponse,
} from "@/shared/api/contracts";

export const LOOKUP_WORD_RE = /[A-Za-z]+(?:[-'][A-Za-z]+)*/g;
export const DICTIONARY_PANEL_WIDTH = 312;
const DICTIONARY_PANEL_SAFE_MARGIN = 16;
const DICTIONARY_PANEL_MIN_HEIGHT = 220;
const DICTIONARY_PANEL_DEFAULT_HEIGHT = 320;
export const SENTENCE_TRANSLATION_LONG_PRESS_MS = 320;
export const SENTENCE_TRANSLATION_LONG_PRESS_MOVE_TOLERANCE_PX = 10;
const SENTENCE_TRANSLATION_PANEL_TARGET_WIDTH = 460;
const SENTENCE_TRANSLATION_PANEL_MIN_WIDTH = 320;
const SENTENCE_TRANSLATION_PANEL_MAX_WIDTH = 540;
const SENTENCE_TRANSLATION_PANEL_MIN_HEIGHT = 170;
const SENTENCE_TRANSLATION_PANEL_SAFE_MARGIN = 16;
const SENTENCE_TRANSLATION_PANEL_GAP = 12;
export const SENTENCE_TRANSLATION_TRIGGER_WIDTH = 132;
export const SENTENCE_TRANSLATION_TRIGGER_HEIGHT = 40;

export type DictionaryPanelState = {
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

export type SentenceSelectionPayload = {
  cacheKey: string;
  originalText: string;
  rect: DOMRect;
};

export type SentenceTranslationPanelState = {
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

export type SentenceTranslationTriggerState = {
  left: number;
  top: number;
  payload: SentenceSelectionPayload;
};

export function normalizeLookupWord(value: string) {
  const normalized = value.trim().toLowerCase();
  return /^[a-z]+(?:[-'][a-z]+)*$/.test(normalized) ? normalized : "";
}

export function resolveDictionaryPanelLeft(rawLeft: number) {
  const viewportWidth = window.innerWidth;
  const panelWidth = Math.min(
    DICTIONARY_PANEL_WIDTH,
    Math.max(240, viewportWidth - DICTIONARY_PANEL_SAFE_MARGIN * 2),
  );
  return Math.min(
    Math.max(DICTIONARY_PANEL_SAFE_MARGIN, rawLeft),
    Math.max(
      DICTIONARY_PANEL_SAFE_MARGIN,
      viewportWidth - panelWidth - DICTIONARY_PANEL_SAFE_MARGIN,
    ),
  );
}

export function resolveDictionaryPanelTop(rawTop: number) {
  const viewportHeight = window.innerHeight;
  return Math.min(
    Math.max(DICTIONARY_PANEL_SAFE_MARGIN, rawTop),
    Math.max(
      DICTIONARY_PANEL_SAFE_MARGIN,
      viewportHeight - DICTIONARY_PANEL_MIN_HEIGHT - DICTIONARY_PANEL_SAFE_MARGIN,
    ),
  );
}

export function resolveDictionaryPanelMaxHeight(top: number) {
  return Math.max(
    DICTIONARY_PANEL_MIN_HEIGHT,
    window.innerHeight - top - DICTIONARY_PANEL_SAFE_MARGIN,
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

export function resolveSentenceTranslationPanelLeft(
  rawLeft: number,
  width: number,
) {
  const viewportWidth = window.innerWidth;
  return Math.min(
    Math.max(SENTENCE_TRANSLATION_PANEL_SAFE_MARGIN, rawLeft),
    Math.max(
      SENTENCE_TRANSLATION_PANEL_SAFE_MARGIN,
      viewportWidth - width - SENTENCE_TRANSLATION_PANEL_SAFE_MARGIN,
    ),
  );
}

export function resolveSentenceTranslationPanelTop(rawTop: number) {
  return Math.min(
    Math.max(SENTENCE_TRANSLATION_PANEL_SAFE_MARGIN, rawTop),
    Math.max(
      SENTENCE_TRANSLATION_PANEL_SAFE_MARGIN,
      window.innerHeight -
        SENTENCE_TRANSLATION_PANEL_MIN_HEIGHT -
        SENTENCE_TRANSLATION_PANEL_SAFE_MARGIN,
    ),
  );
}

export function resolveSentenceTranslationPanelMaxHeight(top: number) {
  return Math.max(
    SENTENCE_TRANSLATION_PANEL_MIN_HEIGHT,
    window.innerHeight - top - SENTENCE_TRANSLATION_PANEL_SAFE_MARGIN,
  );
}

export function resolveSentenceTranslationTriggerPosition(
  selectionRect: DOMRect,
) {
  const preferredLeft =
    selectionRect.left +
    selectionRect.width / 2 -
    SENTENCE_TRANSLATION_TRIGGER_WIDTH / 2;
  const left = Math.min(
    Math.max(SENTENCE_TRANSLATION_PANEL_SAFE_MARGIN, preferredLeft),
    Math.max(
      SENTENCE_TRANSLATION_PANEL_SAFE_MARGIN,
      window.innerWidth -
        SENTENCE_TRANSLATION_TRIGGER_WIDTH -
        SENTENCE_TRANSLATION_PANEL_SAFE_MARGIN,
    ),
  );
  const spaceBelow =
    window.innerHeight -
    selectionRect.bottom -
    SENTENCE_TRANSLATION_PANEL_SAFE_MARGIN;
  const top =
    spaceBelow >=
    SENTENCE_TRANSLATION_TRIGGER_HEIGHT + SENTENCE_TRANSLATION_PANEL_GAP
      ? selectionRect.bottom + SENTENCE_TRANSLATION_PANEL_GAP
      : Math.max(
          SENTENCE_TRANSLATION_PANEL_SAFE_MARGIN,
          selectionRect.top -
            SENTENCE_TRANSLATION_TRIGGER_HEIGHT -
            SENTENCE_TRANSLATION_PANEL_GAP,
        );
  return { left, top };
}

export function resolveDictionaryPanelPosition(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  const spaceBelow =
    window.innerHeight - rect.bottom - DICTIONARY_PANEL_SAFE_MARGIN;
  const spaceAbove = rect.top - DICTIONARY_PANEL_SAFE_MARGIN;
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
    left: resolveDictionaryPanelLeft(
      rect.left + rect.width / 2 - DICTIONARY_PANEL_WIDTH / 2,
    ),
    top,
    maxHeight: Math.min(availableHeight, resolveDictionaryPanelMaxHeight(top)),
  };
}

function resolveSelectionRect(range: Range) {
  const rect = range.getBoundingClientRect();
  if (rect.width > 0 || rect.height > 0) {
    return rect;
  }
  return range.getClientRects()[0] ?? null;
}

function rectsOverlapVertically(top: number, height: number, rect: DOMRect) {
  const bottom = top + height;
  return bottom > rect.top && top < rect.bottom;
}

export function resolveSentenceTranslationPanelPosition(
  selectionRect: DOMRect,
) {
  const width = resolveSentenceTranslationPanelWidth();
  const spaceBelow =
    window.innerHeight -
    selectionRect.bottom -
    SENTENCE_TRANSLATION_PANEL_SAFE_MARGIN;
  const spaceAbove =
    selectionRect.top - SENTENCE_TRANSLATION_PANEL_SAFE_MARGIN;
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
    const canShiftRight =
      selectionRect.right + SENTENCE_TRANSLATION_PANEL_GAP + width <=
      window.innerWidth - SENTENCE_TRANSLATION_PANEL_SAFE_MARGIN;
    const canShiftLeft =
      selectionRect.left - SENTENCE_TRANSLATION_PANEL_GAP - width >=
      SENTENCE_TRANSLATION_PANEL_SAFE_MARGIN;
    if (canShiftRight) {
      left = resolveSentenceTranslationPanelLeft(
        selectionRect.right + SENTENCE_TRANSLATION_PANEL_GAP,
        width,
      );
    } else if (canShiftLeft) {
      left = resolveSentenceTranslationPanelLeft(
        selectionRect.left - width - SENTENCE_TRANSLATION_PANEL_GAP,
        width,
      );
    } else {
      top = resolveSentenceTranslationPanelTop(
        preferBelow
          ? selectionRect.top -
              SENTENCE_TRANSLATION_PANEL_GAP -
              availableHeight
          : selectionRect.bottom + SENTENCE_TRANSLATION_PANEL_GAP,
      );
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

export function canUseSpeechSynthesis() {
  return (
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    typeof SpeechSynthesisUtterance !== "undefined"
  );
}

function normalizeSentenceSelectionText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function extractSentenceSelection(
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
  if (tokens.length < 2) return null;
  const rect = resolveSelectionRect(range);
  if (!rect) return null;
  return {
    cacheKey: originalText,
    originalText,
    rect,
  };
}

export function hasActiveTextSelection() {
  const selection = window.getSelection();
  return Boolean(selection && !selection.isCollapsed && selection.toString().trim());
}

export function getDictionaryPartOfSpeechLabel(partOfSpeech: string) {
  if (partOfSpeech === "noun") return "n.";
  if (partOfSpeech === "verb") return "v.";
  if (partOfSpeech === "adjective") return "adj.";
  if (partOfSpeech === "adverb") return "adv.";
  return `${partOfSpeech}.`;
}
