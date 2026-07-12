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

export interface ContextMenuAction {
  label: string
  icon: ComponentType<{ className?: string }>
  onClick: () => void
  variant?: 'default' | 'danger'
  disabled?: boolean
  separatorBefore?: boolean
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
    [onClose]
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
          <button
            type="button"
            disabled={action.disabled}
            onClick={(e) => {
              e.stopPropagation()
              if (action.disabled) return
              action.onClick()
              onClose()
            }}
            className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs transition-colors
              ${action.variant === 'danger'
                ? 'text-destructive hover:bg-destructive/10'
                : 'hover:bg-secondary'
              } ${action.disabled ? 'cursor-not-allowed opacity-40 hover:bg-transparent' : ''}`}
          >
            <action.icon className="h-3.5 w-3.5" />
            {action.label}
          </button>
        </div>
      ))}
    </div>
  )
}

export function useContextMenu() {
  // Simple hook — manage open/close state is handled by the page
  return { Pencil, Trash2, Plus }
}
