import type { MouseEvent as ReactMouseEvent } from "react";
import type {
  ReadingRenderSentence,
  SentenceAnnotation,
  SpanAnnotation,
} from "@/shared/api/contracts";
import { cn } from "@/shared/lib/utils";

const LOOKUP_WORD_RE = /[A-Za-z]+(?:[-'][A-Za-z]+)*/g;

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

export function ReadingLookupText({
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

export function SentenceLine({
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
      <span key={`${sentence.id}-part-${index}`}>
        <ReadingLookupText text={part.text} onLookupWord={onLookupWord} />
      </span>
    );
  });

  if (sentenceAnnotation?.kind !== "syntax_simplified") {
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
                  key={`${sentence.id}-hint-${hint}`}
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
