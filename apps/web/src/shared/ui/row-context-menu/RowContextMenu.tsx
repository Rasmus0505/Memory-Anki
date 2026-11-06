import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/shared/components/ui/context-menu'

/**
 * One entry of a right-click menu. A list builds these per row and the shared
 * `RowContextMenu` renders them, so every list in the app speaks the same menu
 * language (same order, same icons, same destructive styling).
 */
export type RowMenuEntry =
  | {
    kind: 'item'
    label: string
    icon?: LucideIcon
    onSelect: () => void
    /** Red label + red hover, for delete and other irreversible items. */
    danger?: boolean
    disabled?: boolean
    /** Right-aligned hint, e.g. `Ctrl+N`. */
    shortcut?: string
  }
  | { kind: 'separator' }
  | { kind: 'label'; label: string }
  | {
    kind: 'sub'
    label: string
    icon?: LucideIcon
    disabled?: boolean
    items: RowMenuEntry[]
  }

function renderEntries(entries: RowMenuEntry[]): ReactNode {
  return entries.map((entry, index) => {
    const key = `${entry.kind}:${entry.kind === 'separator' ? index : entry.label}:${index}`
    if (entry.kind === 'separator') return <ContextMenuSeparator key={key} />
    if (entry.kind === 'label') return <ContextMenuLabel key={key}>{entry.label}</ContextMenuLabel>
    if (entry.kind === 'sub') {
      const Icon = entry.icon
      return (
        <ContextMenuSub key={key}>
          <ContextMenuSubTrigger disabled={entry.disabled || entry.items.length === 0}>
            {Icon ? <Icon className="size-4 shrink-0 opacity-70" aria-hidden /> : null}
            <span className="truncate">{entry.label}</span>
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>{renderEntries(entry.items)}</ContextMenuSubContent>
        </ContextMenuSub>
      )
    }
    const Icon = entry.icon
    return (
      <ContextMenuItem
        key={key}
        disabled={entry.disabled}
        variant={entry.danger ? 'destructive' : 'default'}
        // Radix closes on select by default; a pending action is fired from the
        // row's handler so a dialog opened here never fights the menu teardown.
        onSelect={() => entry.onSelect()}
      >
        {Icon ? <Icon className="size-4 shrink-0 opacity-70" aria-hidden /> : null}
        <span className="truncate">{entry.label}</span>
        {entry.shortcut ? <ContextMenuShortcut>{entry.shortcut}</ContextMenuShortcut> : null}
      </ContextMenuItem>
    )
  })
}

export interface RowContextMenuProps {
  /** Null / empty means "this row has nothing to offer": children render bare. */
  items: RowMenuEntry[] | null | undefined
  /**
   * Portal host for the menu. Inside a modal dialog the app disables pointer
   * events outside the dialog, so the menu must render into the dialog itself;
   * top-level lists can leave this undefined (fullscreen-aware body default).
   */
  container?: Element | null
  children: ReactNode
}

/**
 * Wraps a single row (any element, via Radix `asChild`) with a right-click and
 * touch-long-press menu. The row itself keeps its own `onClick`, drag handlers
 * and classes; the trigger only adds menu behaviour and a `data-state="open"`
 * hook so the row can highlight while its menu is up.
 */
export function RowContextMenu({ items, container, children }: RowContextMenuProps) {
  const visible = (items ?? []).filter((entry) => entry.kind !== 'separator')
  if (visible.length === 0) return <>{children}</>
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent
        container={container}
        // The chosen verb may mount its own focus target (an inline rename
        // input, a dialog). Radix's default "return focus to the trigger" would
        // steal that focus the moment the menu closes.
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        {renderEntries(items ?? [])}
      </ContextMenuContent>
    </ContextMenu>
  )
}

export function rowMenuHasItems(items: RowMenuEntry[] | null | undefined) {
  return (items ?? []).some((entry) => entry.kind !== 'separator')
}
