import type { KeyboardEvent, MouseEvent, PointerEvent, ReactNode } from 'react'
import { stripMindMapHtml } from '@/shared/lib/mindmapRichText'
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
function renderEnglishInteractiveLabel(label: string, onEnglishWordClick: EnglishWordClick, keyPrefix = '') {
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
function renderEnglishInteractiveRich(html: string, onEnglishWordClick: EnglishWordClick): ReactNode[] {
  if (typeof DOMParser === 'undefined') {
    return renderEnglishInteractiveLabel(stripMindMapHtml(html), onEnglishWordClick)
  }
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  const walk = (nodes: NodeListOf<ChildNode>, path: string): ReactNode[] =>
    Array.from(nodes).map((node, index) => {
      const key = `${path}${index}`
      if (node.nodeType === Node.TEXT_NODE) {
        return renderEnglishInteractiveLabel(node.textContent ?? '', onEnglishWordClick, `${key}-`)
      }
      if (!(node instanceof Element)) return null
      const tag = node.tagName.toLowerCase()
      if (tag === 'br') return <br key={key} />
      const children = walk(node.childNodes, `${key}.`)
      const emphasis = node.getAttribute('data-emphasis') ?? undefined
      if (tag === 'div') return <div key={key} data-emphasis={emphasis}>{children}</div>
      if (tag === 'u') return <u key={key}>{children}</u>
      if (tag === 'mark') return <mark key={key} data-emphasis={emphasis}>{children}</mark>
      return <span key={key} data-emphasis={emphasis}>{children}</span>
    })
  return walk(doc.body.childNodes, 'n')
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
  const showEnglishInteraction =
    englishInteractionActive && !concealed && typeof onEnglishWordClick === 'function'
  const nativeCopySurface = textSelectionModeActive && !showEnglishInteraction
  const plainLabel = label || (isRoot ? '未命名主题' : '未命名知识点')
  // Readonly cards (except english / text-select) let pane pan start on the label.
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
      onDoubleClick={nativeCopySurface || showEnglishInteraction ? undefined : onDoubleClick}
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
      ) : showEnglishInteraction ? (
        // Interactive words keep highlight markup; long-press drag can still select across spans.
        <span className="block w-full">
          {displayHtml
            ? renderEnglishInteractiveRich(displayHtml, onEnglishWordClick)
            : renderEnglishInteractiveLabel(plainLabel, onEnglishWordClick)}
        </span>
      ) : displayHtml ? (
        // div (not span): stored markup is often <div>…</div>; span>div is invalid
        // and browsers may reparent highlight nodes outside the double-click target.
        <div
          className="block w-full mindmap-rich-text"
          dangerouslySetInnerHTML={{ __html: displayHtml }}
        />
      ) : (
        plainLabel
      )}
      {!concealed && articleBody ? <RichDocument document={articleBody} className="mt-2 border-t border-current/10 pt-2 text-sm font-normal leading-relaxed" /> : null}
    </div>
  )
}
