import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  RefObject,
} from 'react'
import { LoaderCircle, Pin, PinOff, Volume2 } from 'lucide-react'
import type { ReadingDictionaryEntry } from '@/shared/api/contracts'
import {
  DICTIONARY_PANEL_WIDTH,
  getDictionaryPartOfSpeechLabel,
  type DictionaryPanelState,
} from '@/modules/english-reading/public'
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { cn } from '@/shared/lib/utils'

export function EnglishDictionaryFloat({
  dictionaryPanel,
  dictionaryPanelRef,
  onClose,
  onHeaderPointerDown,
  onHeaderMouseDown,
  onTogglePin,
  playDictionaryPronunciation,
  onSaveVocabulary,
  savingVocabulary = false,
}: {
  dictionaryPanel: DictionaryPanelState | null
  dictionaryPanelRef: RefObject<HTMLDivElement | null>
  onClose: () => void
  onHeaderPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void
  onHeaderMouseDown: (event: ReactMouseEvent<HTMLDivElement>) => void
  onTogglePin: () => void
  playDictionaryPronunciation: (
    entry: ReadingDictionaryEntry,
    options: { allowTtsFallback: boolean },
  ) => Promise<void>
  onSaveVocabulary?: () => void
  savingVocabulary?: boolean
}) {
  return (
    <Dialog open={dictionaryPanel !== null} onOpenChange={(open) => !open && onClose()} modal={false}>
      {dictionaryPanel ? (
        <DialogContent
          layout="unstyled"
          ref={dictionaryPanelRef}
          data-testid="dictionary-popup-panel"
          style={{
            position: 'fixed',
            top: dictionaryPanel.top,
            left: dictionaryPanel.left,
            width: Math.min(DICTIONARY_PANEL_WIDTH, window.innerWidth - 32),
            maxHeight: dictionaryPanel.maxHeight,
          }}
          className="max-w-none overflow-hidden rounded-[18px] border border-border bg-background p-0 text-primary shadow-floating"
        >
          <div
            data-testid="dictionary-popup-header"
            onPointerDown={onHeaderPointerDown}
            onMouseDown={onHeaderMouseDown}
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
                aria-label={dictionaryPanel.pinned ? '取消固定词典面板' : '固定词典面板'}
                onClick={onTogglePin}
                className={cn(
                  'inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition',
                  dictionaryPanel.pinned
                    ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                    : 'text-muted-foreground hover:bg-muted hover:text-primary',
                )}
              >
                {dictionaryPanel.pinned ? (
                  <PinOff className="h-3.5 w-3.5" />
                ) : (
                  <Pin className="h-3.5 w-3.5" />
                )}
                {dictionaryPanel.pinned ? '取消固定' : '固定'}
              </button>
              <button
                type="button"
                aria-label="关闭"
                onClick={onClose}
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
                      美 {dictionaryPanel.entry.phoneticUs || '/暂无音标/'}
                    </span>
                    <button
                      type="button"
                      aria-label="播放美式发音"
                      className="inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
                      onClick={() =>
                        void playDictionaryPronunciation(
                          dictionaryPanel.entry as ReadingDictionaryEntry,
                          { allowTtsFallback: true },
                        )
                      }
                    >
                      <Volume2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  {dictionaryPanel.entry.summaryZh.length > 0 ? (
                    <div className="text-sm leading-6 text-foreground">
                      {dictionaryPanel.entry.summaryZh.join('；')}
                    </div>
                  ) : null}
                </div>

                {dictionaryPanel.entry.senses.slice(0, 6).map((sense, index) => (
                  <div
                    key={`${sense.partOfSpeech}-${index}`}
                    className="rounded-lg border border-border/70 bg-muted/30 px-2.5 py-2 text-sm"
                  >
                    <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      {getDictionaryPartOfSpeechLabel(sense.partOfSpeech)}
                    </div>
                    <div className="mt-1 leading-6 text-foreground">
                      {sense.definitionZh || sense.definition}
                    </div>
                  </div>
                ))}

                {onSaveVocabulary ? (
                  <button
                    type="button"
                    className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm font-medium transition hover:bg-muted"
                    disabled={savingVocabulary}
                    onClick={onSaveVocabulary}
                    data-testid="dictionary-save-vocabulary"
                  >
                    {savingVocabulary ? '加入中…' : '加入生词本'}
                  </button>
                ) : null}
              </>
            ) : null}
          </div>
        </DialogContent>
      ) : null}
    </Dialog>
  )
}
