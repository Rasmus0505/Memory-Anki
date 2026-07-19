import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  RefObject,
} from "react";
import { LoaderCircle, Pin, PinOff, Volume2 } from "lucide-react";
import type {
  ReadingDictionaryEntry,
  ReadingDifficultyDelta,
  ReadingDifficultyDirection,
} from "@/shared/api/contracts";
import { ReadingLookupText } from "@/features/english-reading/components/EnglishReadingText";
import {
  DICTIONARY_PANEL_WIDTH,
  SENTENCE_TRANSLATION_TRIGGER_HEIGHT,
  SENTENCE_TRANSLATION_TRIGGER_WIDTH,
  type DictionaryPanelState,
  type SentenceTranslationPanelState,
  type SentenceTranslationTriggerState,
  getDictionaryPartOfSpeechLabel,
} from "@/features/english-reading/model/englishReadingInteractions";
import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { cn } from "@/shared/lib/utils";

export function EnglishReadingDialogs({
  sentenceTranslationTrigger,
  sentenceTranslationTriggerRef,
  onConfirmSentenceTranslation,
  dictionaryPanel,
  dictionaryPanelRef,
  onCloseDictionaryPanel,
  onDictionaryHeaderPointerDown,
  onDictionaryHeaderMouseDown,
  onToggleDictionaryPin,
  playDictionaryPronunciation,
  supportsSpeechSynthesis,
  onSaveVocabulary,
  savingVocabulary = false,
  onSaveToPattern,
  savingPattern = false,
  sentenceTranslationPanel,
  sentenceTranslationPanelRef,
  onCloseSentenceTranslationPanel,
  onSentenceTranslationHeaderPointerDown,
  onSentenceTranslationHeaderMouseDown,
  onToggleSentenceTranslationPin,
  onLookupWord,
  regenerateDialogOpen,
  generating,
  regenerateDirection,
  regenerateDelta,
  readingDifficultyOptions,
  onCloseRegenerateDialog,
  onSetRegenerateDirection,
  onSetRegenerateDelta,
  onConfirmRegenerate,
  formatDifficultyDelta,
}: {
  sentenceTranslationTrigger: SentenceTranslationTriggerState | null;
  sentenceTranslationTriggerRef: RefObject<HTMLButtonElement | null>;
  onConfirmSentenceTranslation: () => void;
  dictionaryPanel: DictionaryPanelState | null;
  dictionaryPanelRef: RefObject<HTMLDivElement | null>;
  onCloseDictionaryPanel: () => void;
  onDictionaryHeaderPointerDown: (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => void;
  onDictionaryHeaderMouseDown: (
    event: ReactMouseEvent<HTMLDivElement>,
  ) => void;
  onToggleDictionaryPin: () => void;
  playDictionaryPronunciation: (
    entry: ReadingDictionaryEntry,
    options: { allowTtsFallback: boolean },
  ) => Promise<void>;
  supportsSpeechSynthesis: boolean;
  onSaveVocabulary?: () => void;
  savingVocabulary?: boolean;
  onSaveToPattern?: () => void;
  savingPattern?: boolean;
  sentenceTranslationPanel: SentenceTranslationPanelState | null;
  sentenceTranslationPanelRef: RefObject<HTMLDivElement | null>;
  onCloseSentenceTranslationPanel: () => void;
  onSentenceTranslationHeaderPointerDown: (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => void;
  onSentenceTranslationHeaderMouseDown: (
    event: ReactMouseEvent<HTMLDivElement>,
  ) => void;
  onToggleSentenceTranslationPin: () => void;
  onLookupWord: (
    word: string,
    event: ReactMouseEvent<HTMLElement>,
  ) => void;
  regenerateDialogOpen: boolean;
  generating: boolean;
  regenerateDirection: ReadingDifficultyDirection;
  regenerateDelta: ReadingDifficultyDelta;
  readingDifficultyOptions: ReadonlyArray<ReadingDifficultyDelta>;
  onCloseRegenerateDialog: () => void;
  onSetRegenerateDirection: (direction: ReadingDifficultyDirection) => void;
  onSetRegenerateDelta: (delta: ReadingDifficultyDelta) => void;
  onConfirmRegenerate: () => void;
  formatDifficultyDelta: (value: ReadingDifficultyDelta) => string;
}) {
  return (
    <>
      {sentenceTranslationTrigger ? (
        <button
          ref={sentenceTranslationTriggerRef}
          type="button"
          data-testid="sentence-translation-trigger"
          onClick={onConfirmSentenceTranslation}
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

      <Dialog open={dictionaryPanel !== null} onOpenChange={(open) => !open && onCloseDictionaryPanel()} modal={false}>
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
              onPointerDown={onDictionaryHeaderPointerDown}
              onMouseDown={onDictionaryHeaderMouseDown}
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
                  onClick={onToggleDictionaryPin}
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
                  onClick={onCloseDictionaryPanel}
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
                  <LoaderCircle className="size-4 animate-spin" />
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
                          void playDictionaryPronunciation(dictionaryPanel.entry as ReadingDictionaryEntry, {
                            allowTtsFallback: true,
                          })
                        }
                      >
                        <Volume2 className="h-3.5 w-3.5" />
                      </button>
                      <span className="text-[11px] text-muted-foreground">
                        {dictionaryPanel.entry.audioUsUrl
                          ? "已自动发音"
                          : supportsSpeechSynthesis
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
                        dictionaryPanel.entry.senses.slice(0, 4).map((sense, index) => (
                          <div
                            key={`${sense.partOfSpeech}-${index}`}
                            className="text-[13px] leading-5.5 text-primary"
                          >
                            <div>
                              <span className="mr-1 font-semibold text-foreground">
                                {getDictionaryPartOfSpeechLabel(sense.partOfSpeech)}
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

                  {onSaveVocabulary ? (
                    <Button
                      type="button"
                      size="sm"
                      className="mt-1 w-full rounded-xl"
                      disabled={savingVocabulary}
                      onClick={onSaveVocabulary}
                      data-testid="dictionary-save-vocabulary"
                    >
                      {savingVocabulary ? (
                        <LoaderCircle className="mr-2 size-4 animate-spin" />
                      ) : null}
                      加入生词本
                    </Button>
                  ) : null}
                </>
              ) : null}
            </div>
          </DialogContent>
        ) : null}
      </Dialog>

      <Dialog open={sentenceTranslationPanel !== null} onOpenChange={(open) => !open && onCloseSentenceTranslationPanel()} modal={false}>
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
              onPointerDown={onSentenceTranslationHeaderPointerDown}
              onMouseDown={onSentenceTranslationHeaderMouseDown}
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
                  onClick={onToggleSentenceTranslationPin}
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
                  onClick={onCloseSentenceTranslationPanel}
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
              <div className="rounded-lg border border-border bg-muted/50 px-3 py-2.5 text-[14px] leading-6 text-primary">
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  原文
                </div>
                <div data-testid="sentence-translation-original">
                  <ReadingLookupText
                    text={sentenceTranslationPanel.originalText}
                    onLookupWord={onLookupWord}
                  />
                </div>
              </div>

              <div className="rounded-lg border border-info/10 bg-info/5 px-3 py-2.5 text-[14px] leading-6 text-primary">
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
                    <LoaderCircle className="size-4 animate-spin" />
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

              {onSaveToPattern &&
              sentenceTranslationPanel.originalText.trim() &&
              !sentenceTranslationPanel.loading ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="w-full rounded-xl"
                  disabled={savingPattern}
                  onClick={onSaveToPattern}
                  data-testid="sentence-save-pattern"
                >
                  {savingPattern ? (
                    <LoaderCircle className="mr-2 size-4 animate-spin" />
                  ) : null}
                  加入句模
                </Button>
              ) : null}
            </div>
          </DialogContent>
        ) : null}
      </Dialog>

      <Dialog open={regenerateDialogOpen} onOpenChange={(open) => !generating && !open && onCloseRegenerateDialog()}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <div>
              <DialogTitle>重新生成内容</DialogTitle>
              <div className="mt-1 text-sm text-muted-foreground">
                本次会对当前整篇文章重新生成，不会只调整未读部分。
              </div>
            </div>
            <DialogClose onClick={onCloseRegenerateDialog} />
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
                    onClick={() => onSetRegenerateDirection(option.value)}
                    className={cn(
                      "rounded-lg border px-4 py-4 text-left transition-all",
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

            <div className="rounded-lg border border-border/70 bg-background/75 px-4 py-4">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="reading-regenerate-delta" className="text-sm font-medium">
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
                  onSetRegenerateDelta(
                    Number(event.currentTarget.value) as ReadingDifficultyDelta,
                  )
                }
                className="mt-4"
              />
              <div className="mt-2 flex justify-between text-xs text-muted-foreground">
                {readingDifficultyOptions.map((option) => (
                  <span key={option}>{option}</span>
                ))}
              </div>
              <div className="mt-3 text-xs text-muted-foreground">
                选择“重新生成”时会忽略这个幅度，并按当前难度刷新内容。
              </div>
            </div>
          </div>
          <div className="flex items-center justify-end gap-3 border-t px-6 py-4">
            <Button variant="outline" onClick={onCloseRegenerateDialog} disabled={generating}>
              取消
            </Button>
            <Button onClick={onConfirmRegenerate} disabled={generating}>
              {generating ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : null}
              确认生成
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
