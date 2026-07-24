import type { KeyboardEvent, MouseEvent } from 'react'
import type { MindMapNodeVisual } from './adapter'
import { statusChipClassName } from './NodeCardToolbar'
import { NodeCountBadge } from './NodeCountBadge'

export function NodeCardStatusChrome({
  visual,
  isRoot,
  nodeId,
  onCountBadgeClick,
}: {
  visual: MindMapNodeVisual
  isRoot: boolean
  nodeId: string
  onCountBadgeClick?: (nodeId: string) => void
}) {
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
      {visual.countBadge && !isRoot ? (
        <NodeCountBadge
          countBadge={visual.countBadge}
          onClick={() => onCountBadgeClick?.(nodeId)}
        />
      ) : null}
    </>
  )
}

const ENGLISH_WORD_SPLIT = /(\b[A-Za-z][A-Za-z'-]*\b)/g

function renderEnglishInteractiveLabel(
  label: string,
  onEnglishWordClick: (word: string, event: MouseEvent<HTMLElement>) => void,
) {
  const parts = String(label || '').split(ENGLISH_WORD_SPLIT)
  return parts.map((part, index) => {
    if (!part) return null
    if (/^[A-Za-z][A-Za-z'-]*$/.test(part)) {
      return (
        <span
          key={`${part}-${index}`}
          role="button"
          tabIndex={0}
          data-reading-word="true"
          className="cursor-pointer rounded-sm px-0.5 text-inherit underline decoration-dotted decoration-zinc-400/70 underline-offset-2 transition hover:bg-sky-500/10 hover:decoration-sky-400"
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
    return <span key={`t-${index}`}>{part}</span>
  })
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
}) {
  const showEnglishInteraction =
    englishInteractionActive && !concealed && typeof onEnglishWordClick === 'function'
  const plainLabel = label || (isRoot ? '未命名主题' : '未命名知识点')

  return (
    // Use role=button div (not <button>) so highlight markup can legally contain
    // block tags (div/br). Nested div inside <button> can break browser hit-testing
    // and prevent double-click from entering edit mode on yellow-emphasis cards.
    // Always nodrag on the text face: structure drag uses shell padding/chrome so
    // double-click on yellow spans is never stolen by React Flow drag.
    <div
      role="button"
      tabIndex={-1}
      onClick={onClick}
      onDoubleClick={showEnglishInteraction ? undefined : onDoubleClick}
      onContextMenu={showEnglishInteraction ? (event) => event.preventDefault() : onContextMenu}
      onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'Enter' || event.key === ' ') event.preventDefault()
      }}
      className={[
        'mindmap-node-text nopan nodrag',
        textCls,
        displayHtml && !showEnglishInteraction
          ? '[&_[data-emphasis=highlight]]:rounded-sm [&_[data-emphasis=highlight]]:bg-[#fef08c]'
          : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {concealed ? (
        '待回忆'
      ) : showEnglishInteraction ? (
        // Plain interactive words: long-press drag can select across spans for AI translate.
        <span className="block w-full">{renderEnglishInteractiveLabel(plainLabel, onEnglishWordClick)}</span>
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
    </div>
  )
}
