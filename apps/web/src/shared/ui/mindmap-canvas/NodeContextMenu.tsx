import {
  useEffect,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type ComponentType,
} from 'react'
import { Plus, Pencil, Trash2 } from 'lucide-react'

export interface ContextMenuActionTrailing {
  ariaLabel: string
  onClick: () => void
  /** Optional swatch color shown as a small square. */
  swatchColor?: string | null
  /** Conic palette glyph when no swatch. */
  showPalette?: boolean
}

export interface ContextMenuAction {
  label: string
  icon: ComponentType<{ className?: string }>
  onClick: () => void
  variant?: 'default' | 'danger'
  disabled?: boolean
  separatorBefore?: boolean
  /** Keep the menu open after main click (rare). */
  keepOpen?: boolean
  /** Right-side control (e.g. open color palette without applying last color). */
  trailing?: ContextMenuActionTrailing
}

interface NodeContextMenuProps {
  x: number
  y: number
  onClose: () => void
  actions: ContextMenuAction[]
  children?: ReactNode
}

export function NodeContextMenu({ x, y, onClose, actions, children }: NodeContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ x, y })
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    },
    [onClose],
  )

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('click', onClose)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('click', onClose)
    }
  }, [handleKeyDown, onClose])

  useLayoutEffect(() => {
    const menu = menuRef.current
    if (!menu) return
    const margin = 8
    const rect = menu.getBoundingClientRect()
    setPosition({
      x: Math.max(margin, Math.min(x, window.innerWidth - rect.width - margin)),
      y: Math.max(margin, Math.min(y, window.innerHeight - rect.height - margin)),
    })
  }, [actions.length, x, y])

  return (
    <div
      ref={menuRef}
      className="fixed z-[140] min-w-[210px] rounded-xl border bg-popover p-1.5 shadow-xl"
      style={{ left: position.x, top: position.y }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
      {actions.map((action, i) => (
        <div key={`${action.label}-${i}`}>
          {action.separatorBefore ? <div className="my-1 h-px bg-border" /> : null}
          <div
            className={`flex w-full items-center gap-0.5 rounded-lg text-xs transition-colors
              ${action.variant === 'danger'
                ? 'text-destructive'
                : ''
              } ${action.disabled ? 'opacity-40' : ''}`}
          >
            <button
              type="button"
              disabled={action.disabled}
              onClick={(e) => {
                e.stopPropagation()
                if (action.disabled) return
                action.onClick()
                if (!action.keepOpen) onClose()
              }}
              className={`flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5 py-2 transition-colors
                ${action.variant === 'danger'
                  ? 'hover:bg-destructive/10'
                  : 'hover:bg-secondary'
                } ${action.disabled ? 'cursor-not-allowed opacity-40 hover:bg-transparent' : ''}`}
            >
              <action.icon className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{action.label}</span>
            </button>
            {action.trailing ? (
              <button
                type="button"
                aria-label={action.trailing.ariaLabel}
                disabled={action.disabled}
                onClick={(e) => {
                  e.stopPropagation()
                  if (action.disabled) return
                  action.trailing?.onClick()
                  // Trailing opens a secondary panel; close the main menu.
                  onClose()
                }}
                className="mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-40"
              >
                {action.trailing.showPalette !== false ? (
                  <span
                    className="h-3.5 w-3.5 rounded border border-black/15"
                    style={{
                      background: action.trailing.swatchColor
                        ? action.trailing.swatchColor
                        : 'conic-gradient(#f87171, #fbbf24, #4ade80, #38bdf8, #a78bfa, #f472b6, #f87171)',
                    }}
                  />
                ) : action.trailing.swatchColor ? (
                  <span
                    className="h-3.5 w-3.5 rounded border border-black/15"
                    style={{ backgroundColor: action.trailing.swatchColor }}
                  />
                ) : (
                  <span className="h-3.5 w-3.5 rounded border border-dashed border-muted-foreground/40" />
                )}
              </button>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  )
}

export function useContextMenu() {
  // Simple hook — manage open/close state is handled by the page
  return { Pencil, Trash2, Plus }
}
