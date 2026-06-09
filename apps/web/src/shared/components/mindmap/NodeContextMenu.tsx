import { useEffect, useCallback, type ReactNode, type ComponentType } from 'react'
import { Plus, Pencil, Trash2 } from 'lucide-react'

export interface ContextMenuAction {
  label: string
  icon: ComponentType<{ className?: string }>
  onClick: () => void
  variant?: 'default' | 'danger'
  disabled?: boolean
}

interface NodeContextMenuProps {
  x: number
  y: number
  onClose: () => void
  actions: ContextMenuAction[]
  children?: ReactNode
}

export function NodeContextMenu({ x, y, onClose, actions, children }: NodeContextMenuProps) {
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

  return (
    <div
      className="fixed z-[140] min-w-[160px] rounded-lg border bg-popover p-1 shadow-md"
      style={{ left: x, top: y }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
      {actions.map((action, i) => (
        <button
          key={i}
          disabled={action.disabled}
          onClick={(e) => {
            e.stopPropagation()
            if (action.disabled) return
            action.onClick()
            onClose()
          }}
          className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs transition-colors
            ${action.variant === 'danger'
              ? 'text-destructive hover:bg-destructive/10'
              : 'hover:bg-secondary'
            } ${action.disabled ? 'cursor-not-allowed opacity-40 hover:bg-transparent' : ''}`}
        >
          <action.icon className="h-3.5 w-3.5" />
          {action.label}
        </button>
      ))}
    </div>
  )
}

export function useContextMenu() {
  // Simple hook — manage open/close state is handled by the page
  return { Pencil, Trash2, Plus }
}
