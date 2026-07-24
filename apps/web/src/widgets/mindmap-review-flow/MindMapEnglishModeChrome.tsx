import { useMemo } from 'react'
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  RefObject,
} from 'react'
import { LoaderCircle, Pin, PinOff, Volume2 } from 'lucide-react'
import {
  DICTIONARY_PANEL_WIDTH,
  EnglishLookupText,
  getDictionaryPartOfSpeechLabel,
  SENTENCE_TRANSLATION_TRIGGER_HEIGHT,
  SENTENCE_TRANSLATION_TRIGGER_WIDTH,
  type DictionaryPanelState,
  type SentenceTranslationPanelState,
  type SentenceTranslationTriggerState,
} from '@/modules/english/public'
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { cn } from '@/shared/lib/utils'
import type { ReadingDictionaryEntry } from '@/shared/api/contracts'

/**
 * Floating chrome for mind-map English mode (dictionary + sentence translation).
 * Mirrors english-reading interactions without the regenerate/completion UI.
 */
export function MindMapEnglishModeChrome({
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
  sentenceTranslationPanel,
  sentenceTranslationPanelRef,
  onCloseSentenceTranslationPanel,
  onSentenceTranslationHeaderPointerDown,
  onSentenceTranslationHeaderMouseDown,
  onToggleSentenceTranslationPin,
  onLookupWord,
}: {
  sentenceTranslationTrigger: SentenceTranslationTriggerState | null
  sentenceTranslationTriggerRef: RefObject<HTMLDivElement | null>
  onConfirmSentenceTranslation: () => void
  dictionaryPanel: DictionaryPanelState | null
  dictionaryPanelRef: RefObject<HTMLDivElement | null>
  onCloseDictionaryPanel: () => void
  onDictionaryHeaderPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void
  onDictionaryHeaderMouseDown: (event: ReactMouseEvent<HTMLDivElement>) => void
  onToggleDictionaryPin: () => void
  playDictionaryPronunciation: (
    entry: ReadingDictionaryEntry,
    options: { allowTtsFallback: boolean },
  ) => Promise<void>
  supportsSpeechSynthesis: boolean
  sentenceTranslationPanel: SentenceTranslationPanelState | null
  sentenceTranslationPanelRef: RefObject<HTMLDivElement | null>
  onCloseSentenceTranslationPanel: () => void
  onSentenceTranslationHeaderPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void
  onSentenceTranslationHeaderMouseDown: (event: ReactMouseEvent<HTMLDivElement>) => void
  onToggleSentenceTranslationPin: () => void
  onLookupWord: (word: string, event: ReactMouseEvent<HTMLElement>) => void
}) {
  const dictionaryWidth = useMemo(
    () => Math.min(DICTIONARY_PANEL_WIDTH, typeof window !== 'undefined' ? window.innerWidth - 32 : DICTIONARY_PANEL_WIDTH),
    // Recompute on panel open so mobile rotation still fits.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- panel open is enough
    [dictionaryPanel?.queryWord],
  )

  return (
    <>
      {sentenceTranslationTrigger ? (
        <div
          ref={sentenceTranslationTriggerRef}
          data-testid="mindmap-sentence-action-bar"
          role="toolbar"
          aria-label="选中句子操作"
          style={{
            position: 'fixed',
            top: sentenceTranslationTrigger.top,
            left: sentenceTranslationTrigger.left,
            width: SENTENCE_TRANSLATION_TRIGGER_WIDTH,
            minHeight: SENTENCE_TRANSLATION_TRIGGER_HEIGHT,
          }}
          className="z-[144] inline-flex items-center justify-center gap-0.5 rounded-full border border-info/20 bg-white/95 p-1 text-sm font-medium text-info shadow-soft backdrop-blur-sm"
        >
          <button
            type="button"
            data-testid="mindmap-sentence-translation-trigger"
            onClick={onConfirmSentenceTranslation}
            className="inline-flex min-h-9 flex-1 items-center justify-center rounded-full px-2.5 text-xs font-medium transition hover:bg-info/10 hover:text-primary sm:text-sm"
          >
            翻译
          </button>
        </div>
      ) : null}

      <Dialog open={dictionaryPanel !== null} onOpenChange={(open) => !open && onCloseDictionaryPanel()} modal={false}>
        {dictionaryPanel ? (
          <DialogContent
            layout="unstyled"
            ref={dictionaryPanelRef}
            data-testid="mindmap-dictionary-popup-panel"
            style={{
              position: 'fixed',
              top: dictionaryPanel.top,
              left: dictionaryPanel.left,
              width: dictionaryWidth,
              maxHeight: dictionaryPanel.maxHeight,
            }}
            className="z-[145] max-w-none overflow-hidden rounded-[18px] border border-border bg-background p-0 text-primary shadow-floating"
          >
            <div
              data-testid="mindmap-dictionary-popup-header"
              onPointerDown={onDictionaryHeaderPointerDown}
              onMouseDown={onDictionaryHeaderMouseDown}
              className={cn(
                'flex items-center justify-between border-b border-border px-3 py-2.5',
                dictionaryPanel.pinned
                  ? dictionaryPanel.dragging
                    ? 'cursor-grabbing'
                    : 'cursor-grab'
                  : '',
              )}
            >
              <div className="min-w-0">
                <DialogTitle className="truncate text-[1.02rem] font-semibold text-primary">
                  {dictionaryPanel.entry?.word || dictionaryPanel.queryWord}
                </DialogTitle>
                {dictionaryPanel.entry?.phoneticUs ? (
                  <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                    {dictionaryPanel.entry.phoneticUs}
                  </div>
                ) : null}
              </div>
              <div className="ml-2 flex shrink-0 items-center gap-1">
                {supportsSpeechSynthesis || dictionaryPanel.entry?.audioUsUrl ? (
                  <button
                    type="button"
                    aria-label="美式发音"
                    className="rounded-md p-2 text-muted-foreground transition hover:bg-muted hover:text-primary"
                    onClick={() => {
                      if (dictionaryPanel.entry) {
                        void playDictionaryPronunciation(dictionaryPanel.entry, {
                          allowTtsFallback: true,
                        })
                      }
                    }}
                  >
                    <Volume2 className="size-4" />
                  </button>
                ) : null}
                <button
                  type="button"
                  aria-label={dictionaryPanel.pinned ? '取消固定词典面板' : '固定词典面板'}
                  onClick={onToggleDictionaryPin}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition',
                    dictionaryPanel.pinned
                      ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                      : 'text-muted-foreground hover:bg-muted hover:text-primary',
                  )}
                >
                  {dictionaryPanel.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                </button>
                <button
                  type="button"
                  aria-label="关闭词典"
                  onClick={onCloseDictionaryPanel}
                  className="rounded-md p-2 text-muted-foreground transition hover:bg-muted hover:text-primary"
                >
                  <span className="text-sm leading-none">×</span>
                </button>
              </div>
            </div>
            <div
              data-testid="mindmap-dictionary-popup-scroll"
              className="min-h-0 space-y-2.5 overflow-y-auto overscroll-contain px-3.5 py-3"
            >
              {dictionaryPanel.loading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <LoaderCircle className="size-4 animate-spin" />
                  查询中…
                </div>
              ) : null}
              {dictionaryPanel.error ? (
                <div className="text-sm text-destructive">{dictionaryPanel.error}</div>
              ) : null}
              {dictionaryPanel.entry ? (
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
                      </div>
                    ))
                  ) : (
                    <div className="text-[12px] text-muted-foreground">暂无义项内容</div>
                  )}
                </div>
              ) : null}
            </div>
          </DialogContent>
        ) : null}
      </Dialog>

      <Dialog
        open={sentenceTranslationPanel !== null}
        onOpenChange={(open) => !open && onCloseSentenceTranslationPanel()}
        modal={false}
      >
        {sentenceTranslationPanel ? (
          <DialogContent
            layout="unstyled"
            ref={sentenceTranslationPanelRef}
            data-testid="mindmap-sentence-translation-panel"
            style={{
              position: 'fixed',
              top: sentenceTranslationPanel.top,
              left: sentenceTranslationPanel.left,
              width: sentenceTranslationPanel.width,
              maxHeight: sentenceTranslationPanel.maxHeight,
            }}
            className="z-[145] max-w-none overflow-hidden rounded-[20px] border border-border bg-background p-0 text-primary shadow-floating"
          >
            <div
              data-testid="mindmap-sentence-translation-header"
              onPointerDown={onSentenceTranslationHeaderPointerDown}
              onMouseDown={onSentenceTranslationHeaderMouseDown}
              className={cn(
                'flex items-center justify-between border-b border-border px-3 py-2',
                sentenceTranslationPanel.pinned
                  ? sentenceTranslationPanel.dragging
                    ? 'cursor-grabbing'
                    : 'cursor-grab'
                  : '',
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
                      ? '取消固定句子翻译面板'
                      : '固定句子翻译面板'
                  }
                  onClick={onToggleSentenceTranslationPin}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition',
                    sentenceTranslationPanel.pinned
                      ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                      : 'text-muted-foreground hover:bg-muted hover:text-primary',
                  )}
                >
                  {sentenceTranslationPanel.pinned ? (
                    <PinOff className="h-3.5 w-3.5" />
                  ) : (
                    <Pin className="h-3.5 w-3.5" />
                  )}
                  {sentenceTranslationPanel.pinned ? '取消固定' : '固定'}
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
              data-testid="mindmap-sentence-translation-scroll"
              className="min-h-0 space-y-2.5 overflow-y-auto overscroll-contain px-3.5 py-3"
            >
              <div className="rounded-lg border border-border bg-muted/50 px-3 py-2.5 text-[14px] leading-6 text-primary">
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  原文
                </div>
                <div data-testid="mindmap-sentence-translation-original">
                  <EnglishLookupText
                    text={sentenceTranslationPanel.originalText}
                    onLookupWord={onLookupWord}
                  />
                </div>
              </div>
              {sentenceTranslationPanel.loading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <LoaderCircle className="size-4 animate-spin" />
                  翻译中…
                </div>
              ) : null}
              {sentenceTranslationPanel.error ? (
                <div className="text-sm text-destructive">{sentenceTranslationPanel.error}</div>
              ) : null}
              {sentenceTranslationPanel.translatedText ? (
                <div className="rounded-lg border border-border bg-card px-3 py-2.5 text-[14px] leading-6 text-primary">
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    译文
                  </div>
                  <div data-testid="mindmap-sentence-translation-result">
                    {sentenceTranslationPanel.translatedText}
                  </div>
                </div>
              ) : null}
            </div>
          </DialogContent>
        ) : null}
      </Dialog>
    </>
  )
}
