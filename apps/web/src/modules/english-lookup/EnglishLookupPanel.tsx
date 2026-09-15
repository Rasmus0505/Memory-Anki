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
  BING_HALF_PX,
  COLLINS_HALF_PX,
  OXFORD_HALF_PX,
  type DictCardHeight,
  type HtmlDictResult,
  type LookupDictId,
} from './types'
import './lookup-dict.css'
import { lookupVoiceUrl, preferredAudioUrl } from './normalize'

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

  const audioUrl = preferredAudioUrl(panel.result?.audio) || (panel.query ? lookupVoiceUrl(panel.query) : null)
  const summary =
    firstHtmlSummary(panel.result?.oxford, panel.result?.bing, panel.result?.collins) ||
    '暂无释义'

  return (
    <div
      ref={panelRef as RefObject<HTMLDivElement>}
      data-testid="english-lookup-panel"
      className="fixed z-[55] flex flex-col overflow-hidden rounded-lg border border-border bg-background text-foreground shadow-xl"
      style={{
        left: panel.left,
        top: panel.top,
        width: panel.width,
        height: panel.maxHeight,
      }}
    >
      <div
        data-testid="english-lookup-header"
        className="cursor-grab border-b border-border px-2 py-1.5 active:cursor-grabbing"
        onPointerDown={lookup.handleHeaderPointerDown}
      >
        <form
          className="flex min-w-0 items-center gap-1"
          onSubmit={(event) => {
            event.preventDefault()
            lookup.handleSearchSubmit()
          }}
        >
          <input
            value={panel.searchInput}
            onChange={(event) => lookup.setSearchInput(event.target.value)}
            className="h-8 min-w-0 flex-1 rounded border border-border bg-background px-2 text-base text-foreground outline-none focus:ring-1 focus:ring-ring"
            aria-label="查词"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          <button
            type="submit"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded hover:bg-muted"
            title="搜索"
          >
            <Search className="h-4 w-4" />
          </button>
          <IconBtn title={panel.pinned ? '取消钉住' : '钉住'} onClick={lookup.togglePin}>
            {panel.pinned ? <Pin className="h-4 w-4" /> : <PinOff className="h-4 w-4" />}
          </IconBtn>
          <IconBtn title="关闭" onClick={lookup.closePanel}>
            <X className="h-4 w-4" />
          </IconBtn>
        </form>
        <div className="mt-1 flex items-center justify-end gap-0.5">
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
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {panel.loading && !panel.result ? (
          <div className="p-3 text-sm text-muted-foreground">查询中…</div>
        ) : null}
        {panel.error && !panel.result ? (
          <div className="p-3 text-sm text-destructive">{panel.error}</div>
        ) : null}

        <HtmlDictCard
          title="牛津高阶词典"
          dict="oxford"
          result={panel.result?.oxford}
          sourceUrl={panel.result?.oxford.sourceUrl ?? panel.result?.sourceUrls.oxford}
          height={panel.oxfordHeight}
          halfPx={OXFORD_HALF_PX}
          loading={panel.loading}
          lookup={lookup}
        />
        <HtmlDictCard
          title="必应词典"
          dict="bing"
          result={panel.result?.bing}
          sourceUrl={panel.result?.bing.sourceUrl ?? panel.result?.sourceUrls.bing}
          height={panel.bingHeight}
          halfPx={BING_HALF_PX}
          loading={panel.loading}
          lookup={lookup}
        />
        <HtmlDictCard
          title="柯林斯高阶"
          dict="collins"
          result={panel.result?.collins}
          sourceUrl={panel.result?.collins.sourceUrl ?? panel.result?.sourceUrls.collins}
          height={panel.collinsHeight}
          halfPx={COLLINS_HALF_PX}
          loading={panel.loading}
          lookup={lookup}
        />
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

function HtmlDictCard({
  title,
  dict,
  result,
  sourceUrl,
  height,
  halfPx,
  loading,
  lookup,
}: {
  title: string
  dict: LookupDictId
  result?: HtmlDictResult
  sourceUrl?: string | null
  height: DictCardHeight
  halfPx: number
  loading: boolean
  lookup: EnglishLookupController
}) {
  return (
    <DictCard
      title={title}
      sourceUrl={sourceUrl}
      height={height}
      halfPx={halfPx}
      statusLabel={statusLabel(loading, result?.status)}
      onToggleTitle={() => lookup.cycleCardHeight(dict)}
      onExpandFull={() => lookup.setCardHeight(dict, 'FULL')}
    >
      {result?.status === 'ok' ? (
        <div
          className="lookup-html space-y-3 p-3 text-sm"
          onClick={(event) => {
            const target = event.target
            if (!(target instanceof HTMLElement)) return
            const speaker = target.closest('.dict-speaker, .saladict-Speaker')
            if (speaker instanceof HTMLElement) {
              const src =
                speaker.getAttribute('data-src-mp3') ||
                (speaker instanceof HTMLAnchorElement ? speaker.getAttribute('href') : null)
              if (src) {
                event.preventDefault()
                lookup.playSrc(src)
              }
              return
            }
            const link = target.closest('a')
            if (link instanceof HTMLAnchorElement) {
              if (link.dataset.external === '1') return
              if (link.dataset.internal === '1') {
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
          dangerouslySetInnerHTML={{
            __html: (result.entries ?? []).map((entry) => entry.html).join(''),
          }}
        />
      ) : result?.error ? (
        <div className="p-3 text-sm text-muted-foreground">{result.error}</div>
      ) : null}
    </DictCard>
  )
}

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

function firstHtmlSummary(...results: Array<HtmlDictResult | undefined>) {
  for (const result of results) {
    const html = result?.entries[0]?.html
    if (!html) continue
    const text = stripTags(html).slice(0, 120)
    if (text) return text
  }
  return ''
}

function stripTags(html: string) {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}
