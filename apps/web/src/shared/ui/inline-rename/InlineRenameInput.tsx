import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { cn } from '@/shared/lib/utils'

export interface InlineRenameInputProps {
  defaultValue: string
  /** Called once, with the trimmed value. Empty or unchanged values are dropped. */
  onCommit: (value: string) => void
  onCancel: () => void
  /** Placeholder for accessibility only; the input always starts filled. */
  ariaLabel?: string
  className?: string
}

/**
 * The row *becomes* an input (Obsidian's rename), instead of a dialog covering
 * the list: the eye stays on the row that is being renamed, and the siblings
 * stay visible for context.
 *
 * Enter and blur save, Escape cancels. Keyboard events stop here so app-level
 * shortcuts (space to flip, W/A/S/D panning) never fire while typing a name.
 */
export function InlineRenameInput({
  defaultValue,
  onCommit,
  onCancel,
  ariaLabel = '重命名',
  className,
}: InlineRenameInputProps) {
  const [value, setValue] = useState(defaultValue)
  const inputRef = useRef<HTMLInputElement>(null)
  const settledRef = useRef(false)

  useEffect(() => {
    const input = inputRef.current
    if (!input) return
    input.focus()
    input.select()
  }, [])

  const settle = (action: 'commit' | 'cancel') => {
    if (settledRef.current) return
    settledRef.current = true
    const next = value.trim()
    if (action === 'cancel' || !next || next === defaultValue.trim()) {
      onCancel()
      return
    }
    onCommit(next)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation()
    if (event.key === 'Enter') {
      event.preventDefault()
      settle('commit')
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      settle('cancel')
    }
  }

  return (
    <input
      ref={inputRef}
      value={value}
      aria-label={ariaLabel}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={handleKeyDown}
      onBlur={() => settle('commit')}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      className={cn(
        'min-w-0 flex-1 rounded-[5px] border border-primary/60 bg-background px-1.5 py-0.5 text-inherit outline-none',
        'ring-2 ring-primary/25',
        className,
      )}
    />
  )
}
