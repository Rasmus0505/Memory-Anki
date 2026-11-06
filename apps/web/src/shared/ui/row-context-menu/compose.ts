import type { LucideIcon } from 'lucide-react'
import type { RowMenuEntry } from './RowContextMenu'

export type MenuSection = RowMenuEntry | RowMenuEntry[] | null | undefined | false

/**
 * Joins menu sections with a separator, dropping empty ones.
 *
 * Every list in the app describes its menu as ordered *sections* (verbs about
 * opening, then about filing, then destructive ones) instead of hand-placing
 * separators; that is what keeps the same actions in the same order whether the
 * menu was opened from the editor directory, the shelf, or a search result.
 */
export function composeMenu(...sections: MenuSection[]): RowMenuEntry[] {
  const out: RowMenuEntry[] = []
  for (const section of sections) {
    const entries = (Array.isArray(section) ? section : section ? [section] : [])
      .filter((entry): entry is RowMenuEntry => Boolean(entry) && entry.kind !== 'separator')
    if (entries.length === 0) continue
    if (out.length > 0) out.push({ kind: 'separator' })
    out.push(...entries)
  }
  return out
}

export function menuItem(
  label: string,
  icon: LucideIcon | undefined,
  onSelect: () => void,
  options: { danger?: boolean; disabled?: boolean; shortcut?: string } = {},
): RowMenuEntry {
  return { kind: 'item', label, icon, onSelect, ...options }
}

export function menuLabel(label: string): RowMenuEntry {
  return { kind: 'label', label }
}
