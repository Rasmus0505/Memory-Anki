import type { ReactNode, RefObject } from 'react'
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ExternalLink,
  Pin,
  PinOff,
  Search,
  Volume2,
  X,
  Star,
} from 'lucide-react'
import type { EnglishLookupController, LookupResizeDirection } from './useEnglishLookup'
import {
  CAMBRIDGE_HALF_PX,
  VOCAB_HALF_PX,
  type DictCardHeight,
} from './types'
import { preferredAudioUrl } from './normalize'

function heightPx(height: DictCardHeight, halfPx: number): number | 'none' {
  if (height === 'COLLAPSE') return 0
  if (height === 'FULL') return 'none'
  return halfPx
}

function searchFromPanel(lookup: EnglishLookupController, query: string) {
  const panel = lookup.panel
  void lookup.runSearch(query, {
    left: panel.left,
    top: panel.top,
    maxHeight: panel.maxHeight,
  })
}

export function EnglishLookupPanel({
  lookup,
  onFavorite,
}: {
  lookup: EnglishLookupController
  onFavorite?: (query: string, summary: string) => void
}) {
  const { panel, panelRef } = lookup
  if (!panel.open) return null

  const audioUrl = preferredAudioUrl(panel.result?.audio)
  const summary =
    panel.result?.vocabulary.short ||
    (panel.result?.cambridge.entries[0]
      ? stripTags(panel.result.cambridge.entries[0].html).slice(0, 120)
      : '') ||
    '暂无释义'

  return (
    <div
      ref={panelRef as RefObject<HTMLDivElement>}
      data-testid="english-lookup-panel"
      className="fixed z-[55] flex flex-col overflow-hidden rounded-lg border border-border bg-background shadow-xl"
      style={{
        left: panel.left,
        top: panel.top,
        width: panel.width,
        height: panel.maxHeight,
      }}
    >
      <div
        data-testid="english-lookup-header"
        className="flex cursor-grab items-center gap-1 border-b border-border px-2 py-1.5 active:cursor-grabbing"
        onPointerDown={lookup.handleHeaderPointerDown}
      >
        <form
          className="flex min-w-0 flex-1 items-center gap-1"
          onSubmit={(event) => {
            event.preventDefault()
            lookup.handleSearchSubmit()
          }}
        >
          <input
            value={panel.searchInput}
            onChange={(event) => lookup.setSearchInput(event.target.value)}
            className="h-8 min-w-0 flex-1 rounded border border-border bg-background px-2 text-sm outline-none focus:ring-1 focus:ring-ring"
            aria-label="查词"
          />
          <button
            type="submit"
            className="inline-flex h-8 w-8 items-center justify-center rounded hover:bg-muted"
            title="搜索"
          >
            <Search className="h-4 w-4" />
          </button>
        </form>
        <IconBtn
          title="发音"
          disabled={!audioUrl}
          onClick={() => lookup.replayAudio()}
        >
          <Volume2 className="h-4 w-4" />
        </IconBtn>
        <IconBtn
          title="收藏"
          onClick={() => onFavorite?.(panel.query, summary)}
        >
          <Star className="h-4 w-4" />
        </IconBtn>
        <IconBtn
          title="上一个"
          disabled={!lookup.canHistoryBack}
          onClick={() => lookup.goHistory(-1)}
        >
          <ChevronLeft className="h-4 w-4" />
        </IconBtn>
        <IconBtn
          title="下一个"
          disabled={!lookup.canHistoryForward}
          onClick={() => lookup.goHistory(1)}
        >
          <ChevronRight className="h-4 w-4" />
        </IconBtn>
        <IconBtn title={panel.pinned ? '取消钉住' : '钉住'} onClick={lookup.togglePin}>
          {panel.pinned ? <Pin className="h-4 w-4" /> : <PinOff className="h-4 w-4" />}
        </IconBtn>
        <IconBtn title="关闭" onClick={lookup.closePanel}>
          <X className="h-4 w-4" />
        </IconBtn>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {panel.loading && !panel.result ? (
          <div className="p-3 text-sm text-muted-foreground">查询中…</div>
        ) : null}
        {panel.error && !panel.result ? (
          <div className="p-3 text-sm text-destructive">{panel.error}</div>
        ) : null}

        <DictCard
          title="Vocabulary.com"
          sourceUrl={panel.result?.vocabulary.sourceUrl ?? panel.result?.sourceUrls.vocabulary}
          height={panel.vocabularyHeight}
          halfPx={VOCAB_HALF_PX}
          statusLabel={statusLabel(panel.loading, panel.result?.vocabulary.status)}
          onToggleTitle={() => lookup.cycleCardHeight('vocabulary')}
          onExpandFull={() => lookup.setCardHeight('vocabulary', 'FULL')}
        >
          {panel.result?.vocabulary.status === 'ok' ? (
            <div className="space-y-2 p-3 text-sm leading-relaxed">
              <p className="font-medium">
                <ClickableLookupText text={panel.result.vocabulary.short ?? ''} onLookup={(word) => searchFromPanel(lookup, word)} />
              </p>
              <p className="text-muted-foreground">
                <ClickableLookupText text={panel.result.vocabulary.long ?? ''} onLookup={(word) => searchFromPanel(lookup, word)} />
              </p>
            </div>
          ) : panel.result?.vocabulary.error ? (
            <div className="p-3 text-sm text-muted-foreground">
              {panel.result.vocabulary.error}
            </div>
          ) : null}
        </DictCard>

        <DictCard
          title="Cambridge 英汉简"
          sourceUrl={panel.result?.cambridge.sourceUrl ?? panel.result?.sourceUrls.cambridge}
          height={panel.cambridgeHeight}
          halfPx={CAMBRIDGE_HALF_PX}
          statusLabel={statusLabel(panel.loading, panel.result?.cambridge.status)}
          onToggleTitle={() => lookup.cycleCardHeight('cambridge')}
          onExpandFull={() => lookup.setCardHeight('cambridge', 'FULL')}
        >
          {panel.result?.cambridge.status === 'ok' ? (
            <div
              className="cambridge-lookup-html space-y-3 p-3 text-sm"
              onClick={(event) => {
                const target = event.target
                if (!(target instanceof HTMLElement)) return
                const speaker = target.closest('.dict-speaker')
                if (speaker instanceof HTMLElement) {
                  const src = speaker.getAttribute('data-src-mp3')
                  if (src) {
                    event.preventDefault()
                    lookup.playSrc(src)
                  }
                  return
                }
                const link = target.closest('a')
                if (link instanceof HTMLAnchorElement) {
                  if (link.dataset.external === '1') return
                  if (link.dataset.internal === '1' || link.href.includes('dictionary.cambridge.org')) {
                    event.preventDefault()
                    const text = (link.textContent || '').trim()
                    if (text) searchFromPanel(lookup, text)
                  }
                  return
                }
                const clickedWord = englishWordAtPoint(event.clientX, event.clientY)
                if (clickedWord) {
                  event.preventDefault()
                  searchFromPanel(lookup, clickedWord)
                }
              }}
              // Cambridge HTML is sanitized server-side (no script/style/on*).
              dangerouslySetInnerHTML={{
                __html: panel.result.cambridge.entries.map((e) => e.html).join(''),
              }}
            />
          ) : panel.result?.cambridge.error ? (
            <div className="p-3 text-sm text-muted-foreground">
              {panel.result.cambridge.error}
            </div>
          ) : null}
        </DictCard>

        <DictCard
          title="谷歌翻译"
          sourceUrl={panel.result?.google.sourceUrl ?? panel.result?.sourceUrls.google}
          height={panel.googleHeight}
          halfPx={180}
          statusLabel={statusLabel(panel.loading, panel.result?.google.status)}
          onToggleTitle={() => lookup.cycleCardHeight('google')}
          onExpandFull={() => lookup.setCardHeight('google', 'FULL')}
        >
          {panel.result?.google.status === 'ok' ? (
            <div className="space-y-2 p-3 text-sm leading-relaxed">
              <p className="text-xs text-muted-foreground">
                {panel.result.google.detectedLanguage
                  ? `${panel.result.google.detectedLanguage} → 简体中文`
                  : '自动检测 → 简体中文'}
              </p>
              <p>
                <ClickableLookupText
                  text={panel.result.google.translation}
                  onLookup={(word) => searchFromPanel(lookup, word)}
                />
              </p>
            </div>
          ) : panel.result?.google.error ? (
            <div className="p-3 text-sm text-muted-foreground">{panel.result.google.error}</div>
          ) : null}
        </DictCard>
      </div>
      {RESIZE_HANDLES.map(({ direction, className, label }) => (
        <button
          key={direction}
          type="button"
          aria-label={label}
          title={label}
          className={`absolute z-20 border-0 bg-transparent p-0 ${className}`}
          onPointerDown={(event) => lookup.handleResizePointerDown(direction, event)}
        />
      ))}
    </div>
  )
}

function ClickableLookupText({ text, onLookup }: { text: string; onLookup: (word: string) => void }) {
  return text.split(/([A-Za-z]+(?:[-'][A-Za-z]+)*)/g).map((part, index) =>
    /^[A-Za-z]+(?:[-'][A-Za-z]+)*$/.test(part) ? (
      <button
        key={`${part}-${index}`}
        type="button"
        className="inline rounded-sm px-0.5 text-left hover:bg-primary/15 hover:text-primary"
        onClick={() => onLookup(part)}
      >
        {part}
      </button>
    ) : (
      part
    ),
  )
}

function englishWordAtPoint(clientX: number, clientY: number): string | null {
  const documentWithCaret = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null
  }
  const range = documentWithCaret.caretRangeFromPoint?.(clientX, clientY)
  const node = range?.startContainer
  if (!range || !node || node.nodeType !== Node.TEXT_NODE) return null
  const text = node.textContent ?? ''
  const offset = range.startOffset
  for (const match of text.matchAll(/[A-Za-z]+(?:[-'][A-Za-z]+)*/g)) {
    const start = match.index
    if (start <= offset && offset <= start + match[0].length) return match[0]
  }
  return null
}

const RESIZE_HANDLES: Array<{
  direction: LookupResizeDirection
  className: string
  label: string
}> = [
  { direction: 'n', className: 'left-4 right-4 top-0 h-2 cursor-ns-resize', label: '从上边调整大小' },
  { direction: 'e', className: 'bottom-4 right-0 top-4 w-2 cursor-ew-resize', label: '从右边调整大小' },
  { direction: 's', className: 'bottom-0 left-4 right-4 h-2 cursor-ns-resize', label: '从下边调整大小' },
  { direction: 'w', className: 'bottom-4 left-0 top-4 w-2 cursor-ew-resize', label: '从左边调整大小' },
  { direction: 'nw', className: 'left-0 top-0 h-4 w-4 cursor-nwse-resize', label: '从左上角调整大小' },
  { direction: 'ne', className: 'right-0 top-0 h-4 w-4 cursor-nesw-resize', label: '从右上角调整大小' },
  { direction: 'se', className: 'bottom-0 right-0 h-4 w-4 cursor-nwse-resize', label: '从右下角调整大小' },
  { direction: 'sw', className: 'bottom-0 left-0 h-4 w-4 cursor-nesw-resize', label: '从左下角调整大小' },
]

function DictCard({
  title,
  sourceUrl,
  height,
  halfPx,
  statusLabel: label,
  onToggleTitle,
  onExpandFull,
  children,
}: {
  title: string
  sourceUrl?: string | null
  height: DictCardHeight
  halfPx: number
  statusLabel: string
  onToggleTitle: () => void
  onExpandFull: () => void
  children: ReactNode
}) {
  const maxH = heightPx(height, halfPx)
  return (
    <section className="border-b border-border last:border-b-0">
      <div className="flex items-center gap-1 bg-muted/40 px-2 py-1.5">
        <button
          type="button"
          className="inline-flex flex-1 items-center gap-1 text-left text-sm font-medium"
          onClick={onToggleTitle}
        >
          {height === 'COLLAPSE' ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronUp className="h-3.5 w-3.5" />
          )}
          <span>{title}</span>
          <span className="text-xs font-normal text-muted-foreground">{label}</span>
        </button>
        {sourceUrl ? (
          <a
            href={sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-7 w-7 items-center justify-center rounded hover:bg-muted"
            title="打开原站"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        ) : null}
      </div>
      {height !== 'COLLAPSE' ? (
        <div
          className="relative overflow-hidden"
          style={{
            maxHeight: maxH === 'none' ? undefined : maxH,
          }}
        >
          {children}
          {height === 'HALF' ? (
            <button
              type="button"
              className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-background to-transparent text-xs text-muted-foreground"
              onClick={onExpandFull}
            >
              展开
            </button>
          ) : null}
        </div>
      ) : null}
      {/* halfPx kept for Saladict parity documentation */}
      <span className="sr-only">{halfPx}</span>
    </section>
  )
}

function IconBtn({
  title,
  disabled,
  onClick,
  children,
}: {
  title: string
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex h-8 w-8 items-center justify-center rounded hover:bg-muted disabled:opacity-40"
    >
      {children}
    </button>
  )
}

function statusLabel(loading: boolean, status?: string) {
  if (loading && (!status || status === 'idle' || status === 'searching')) return '…'
  if (status === 'ok') return ''
  if (status === 'empty') return '无结果'
  if (status === 'error') return '失败'
  return ''
}

function stripTags(html: string) {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}
