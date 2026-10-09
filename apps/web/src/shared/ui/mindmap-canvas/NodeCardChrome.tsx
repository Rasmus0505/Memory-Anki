import type { KeyboardEvent, MouseEvent, PointerEvent, ReactNode } from 'react'
import { stripMindMapHtml } from '@/shared/lib/mindmapRichText'
import { scheduleEditableWordClick } from './cardEditGesture'
import type { MindMapCountBadge, MindMapNodeVisual } from './adapter'
import { statusChipClassName } from './NodeCardToolbar'
import { NodeCountBadgeCluster } from './NodeCountBadge'
import { RichDocument } from '@/shared/ui/rich-document/RichDocument'

function cornerCountBadges(visual: MindMapNodeVisual): MindMapCountBadge[] {
  if (visual.countBadges && visual.countBadges.length > 0) return visual.countBadges
  if (visual.countBadge) return [visual.countBadge]
  return []
}

export function NodeCardStatusChrome({
  visual,
  isRoot,
  nodeId,
  onCountBadgeClick,
}: {
  visual: MindMapNodeVisual
  isRoot: boolean
  nodeId: string
  onCountBadgeClick?: (nodeId: string, kind?: 'objective' | 'subjective') => void
}) {
  const countBadges = cornerCountBadges(visual)
  return (
    <>
      {visual.statusChips && visual.statusChips.length > 0 ? (
        <div
          className="pointer-events-none absolute left-1/2 z-30 flex max-w-full -translate-x-1/2 items-center justify-center gap-0.5"
          style={{ top: '-1.35rem' }}
          aria-hidden="true"
        >
          {visual.statusChips.map((chip, index) => (
            <span
              key={`${chip.text}-${chip.style}-${index}`}
              title={chip.text}
              className={[
                'max-w-[5.5rem] truncate rounded-full border px-1.5 py-0 text-[10px] font-medium leading-4 shadow-sm',
                statusChipClassName(chip.tone, chip.style),
              ].join(' ')}
            >
              {chip.text}
            </span>
          ))}
        </div>
      ) : visual.badge && !isRoot ? (
        <span
          className={`absolute -left-2 -top-2 z-20 size-3 rounded-full border-2 border-background ${
            visual.badge.tone === 'danger'
              ? 'bg-destructive'
              : visual.badge.tone === 'success'
                ? 'bg-success'
                : visual.badge.tone === 'warning'
                  ? 'bg-warning'
                  : 'bg-muted-foreground/40'
          }`}
          title={visual.badge.title}
        />
      ) : null}
      <NodeCountBadgeCluster
        countBadges={countBadges}
        onBadgeClick={(kind) => onCountBadgeClick?.(nodeId, kind)}
      />
    </>
  )
}

const ENGLISH_WORD_SPLIT = /(\b[A-Za-z][A-Za-z'-]*\b)/g

type EnglishWordClick = (word: string, event: MouseEvent<HTMLElement>) => void

// Word spans carry no padding/border: underline + inset glow only, so english
// mode never widens a line and never re-wraps the card (see mindmap-scene.css).
function renderEnglishInteractiveLabel(
  label: string,
  onEnglishWordClick: EnglishWordClick,
  keyPrefix = '',
  deferWordClick = false,
) {
  const parts = String(label || '').split(ENGLISH_WORD_SPLIT)
  return parts.map((part, index) => {
    if (!part) return null
    if (/^[A-Za-z][A-Za-z'-]*$/.test(part)) {
      return (
        <span
          key={`${keyPrefix}${part}-${index}`}
          role="button"
          tabIndex={0}
          data-reading-word="true"
          className="mindmap-reading-word"
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            if (event.detail > 1) return
            if (deferWordClick) {
              scheduleEditableWordClick(() => onEnglishWordClick(part, event))
              return
            }
            onEnglishWordClick(part, event)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              event.stopPropagation()
            }
          }}
        >
          {part}
        </span>
      )
    }
    return <span key={`${keyPrefix}t-${index}`}>{part}</span>
  })
}

/**
 * English mode over rich (highlighted) markup: keep the highlight structure,
 * split only text nodes into clickable words. Input is already sanitized; only
 * the emphasis attribute is carried over, inline styles are dropped for CSS.
 */
function renderSanitizedRichHtml(
  html: string,
  renderText: (text: string, key: string) => ReactNode,
): ReactNode[] {
  if (typeof DOMParser === 'undefined') return [renderText(stripMindMapHtml(html), 'plain')]
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  const walk = (nodes: NodeListOf<ChildNode>, path: string): ReactNode[] =>
    Array.from(nodes).map((node, index) => {
      const key = `${path}${index}`
      if (node.nodeType === Node.TEXT_NODE) return renderText(node.textContent ?? '', key)
      if (!(node instanceof Element)) return null
      const tag = node.tagName.toLowerCase()
      if (tag === 'br') return <br key={key} />
      const children = walk(node.childNodes, `${key}.`)
      const emphasis = node.getAttribute('data-emphasis') ?? undefined
      // nodrag stays on the emphasis node itself so a browser that reparents
      // invalid markup still cannot hand the press to React Flow drag.
      const emphasisClass = emphasis === 'highlight' ? 'nodrag' : undefined
      if (tag === 'div') {
        return <div key={key} className={emphasisClass} data-emphasis={emphasis}>{children}</div>
      }
      if (tag === 'u') return <u key={key}>{children}</u>
      if (tag === 'mark') {
        return <mark key={key} className="nodrag" data-emphasis={emphasis ?? 'highlight'}>{children}</mark>
      }
      return <span key={key} className={emphasisClass} data-emphasis={emphasis}>{children}</span>
    })
  return walk(doc.body.childNodes, 'n')
}

function renderEnglishInteractiveRich(
  html: string,
  onEnglishWordClick: EnglishWordClick,
  deferWordClick: boolean,
): ReactNode[] {
  return renderSanitizedRichHtml(html, (text, key) => (
    renderEnglishInteractiveLabel(text, onEnglishWordClick, `${key}-`, deferWordClick)
  ))
}

export function NodeCardTextFace({
  textCls,
  displayHtml,
  concealed,
  label,
  isRoot,
  onClick,
  onDoubleClick,
  onContextMenu,
  englishInteractionActive = false,
  onEnglishWordClick,
  textSelectionModeActive = false,
  readonly = false,
  articleBody,
}: {
  textCls: string
  displayHtml: string
  concealed: boolean
  label: string
  isRoot: boolean
  onClick: (event: MouseEvent<HTMLElement>) => void
  onDoubleClick: (event: MouseEvent<HTMLElement>) => void
  onContextMenu: (event: MouseEvent<HTMLElement>) => void
  englishInteractionActive?: boolean
  onEnglishWordClick?: (word: string, event: MouseEvent<HTMLElement>) => void
  textSelectionModeActive?: boolean
  readonly?: boolean
  articleBody?: unknown
}) {
  const englishWordClick = typeof onEnglishWordClick === 'function' ? onEnglishWordClick : undefined
  const showEnglishInteraction = englishInteractionActive && !concealed && Boolean(englishWordClick)
  const nativeCopySurface = textSelectionModeActive && !showEnglishInteraction
  const plainLabel = label || (isRoot ? '未命名主题' : '未命名知识点')
  // Readonly cards (except english / text-select) let a drag-pan start on the label.
  // Edit cards keep nopan so a drag starts on the shell. Wheel pan is recovered
  // separately — nopan must not make the wheel feel stuck.
  const blockPanePan = !readonly || englishInteractionActive || textSelectionModeActive

  const stopCardClick = (event: PointerEvent<HTMLDivElement> | MouseEvent<HTMLElement>) => {
    // Keep default so the browser can select / show Copy; only block RF node click.
    event.stopPropagation()
  }

  return (
    // Use role=button div (not <button>) so highlight markup can legally contain
    // block tags (div/br). Nested div inside <button> can break browser hit-testing
    // and prevent double-click from entering edit mode on yellow-emphasis cards.
    // Always nodrag on the text face: structure drag uses shell padding/chrome so
    // double-click on yellow spans is never stolen by React Flow drag.
    // Text-selection mode is a native copy surface: no role=button, no click/dblclick.
    <div
      role={nativeCopySurface ? undefined : 'button'}
      tabIndex={nativeCopySurface ? undefined : -1}
      onPointerDown={nativeCopySurface ? stopCardClick : undefined}
      onClick={nativeCopySurface ? undefined : onClick}
      onDoubleClick={nativeCopySurface ? undefined : onDoubleClick}
      onContextMenu={
        nativeCopySurface
          ? undefined
          : showEnglishInteraction
            ? (event) => event.preventDefault()
            : onContextMenu
      }
      onKeyDown={nativeCopySurface ? undefined : (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'Enter' || event.key === ' ') event.preventDefault()
      }}
      className={['mindmap-node-text nodrag', blockPanePan ? 'nopan' : '', textCls]
        .filter(Boolean)
        .join(' ')}
    >
      {concealed ? (
        // The real label stays in flow (invisible) so the card keeps its revealed
        // size; flipping it open never resizes the card or re-lays out the map.
        <>
          <span aria-hidden="true" className="mindmap-node-concealed-sizer block w-full">
            {displayHtml ? stripMindMapHtml(displayHtml) : plainLabel}
          </span>
          <span className="mindmap-node-concealed">待回忆</span>
        </>
      ) : showEnglishInteraction && englishWordClick ? (
        // Interactive words keep highlight markup; long-press drag can still select across spans.
        <span className="block w-full">
          {displayHtml
            ? renderEnglishInteractiveRich(displayHtml, englishWordClick, !readonly)
            : renderEnglishInteractiveLabel(plainLabel, englishWordClick, '', !readonly)}
        </span>
      ) : displayHtml ? (
        // React nodes, not innerHTML: a highlight span stays inside this nodrag
        // face. innerHTML of <div> inside a span used to be reparented, so the
        // yellow text no longer received the card's double-click.
        <div className="block w-full mindmap-rich-text nodrag">
          {renderSanitizedRichHtml(displayHtml, (text) => text)}
        </div>
      ) : (
        plainLabel
      )}
      {!concealed && articleBody ? <RichDocument document={articleBody} className="mt-2 border-t border-current/10 pt-2 text-sm font-normal leading-relaxed" /> : null}
    </div>
  )
}
