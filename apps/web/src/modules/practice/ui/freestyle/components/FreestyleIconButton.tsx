import { type ReactNode } from 'react'
import { Button } from '@/shared/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/shared/components/ui/tooltip'

export function IconButton({
  label,
  children,
  onClick,
  disabled,
}: {
  label: string
  children: ReactNode
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="secondary"
          className="freestyle-stage-glass ma-pressable size-10 rounded-full border border-stage-line-strong text-stage-ink hover:bg-stage-raised hover:text-stage-glow sm:size-11"
          aria-label={label}
          title={label}
          disabled={disabled}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
