import { ChevronLeft, ChevronRight, MoreHorizontal } from 'lucide-react'
import { Button } from '@/shared/components/ui/button'
import { cn } from '@/shared/lib/utils'

type PaginationItem = number | 'ellipsis'

export function buildPaginationItems(
  page: number,
  totalPages: number,
): PaginationItem[] {
  const safeTotal = Math.max(1, totalPages)
  const safePage = Math.min(Math.max(1, page), safeTotal)
  if (safeTotal <= 7) {
    return Array.from({ length: safeTotal }, (_, index) => index + 1)
  }

  const pages = new Set([1, safeTotal, safePage - 1, safePage, safePage + 1])
  const visiblePages = Array.from(pages)
    .filter((value) => value >= 1 && value <= safeTotal)
    .sort((left, right) => left - right)
  const items: PaginationItem[] = []
  for (const current of visiblePages) {
    const previous = items.at(-1)
    if (typeof previous === 'number' && current - previous > 1) {
      items.push('ellipsis')
    }
    items.push(current)
  }
  return items
}

interface PaginationProps {
  page: number
  totalPages: number
  onPageChange: (page: number) => void
  disabled?: boolean
  className?: string
  'aria-label'?: string
}

export function Pagination({
  page,
  totalPages,
  onPageChange,
  disabled = false,
  className,
  'aria-label': ariaLabel = '分页',
}: PaginationProps) {
  const items = buildPaginationItems(page, totalPages)
  return (
    <nav
      aria-label={ariaLabel}
      className={cn('flex flex-wrap items-center justify-center gap-1', className)}
    >
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label="上一页"
        disabled={disabled || page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        <ChevronLeft />
      </Button>
      {items.map((item, index) =>
        item === 'ellipsis' ? (
          <span
            key={`ellipsis-${index}`}
            className="flex size-9 items-center justify-center text-muted-foreground"
            aria-hidden="true"
          >
            <MoreHorizontal className="size-4" />
          </span>
        ) : (
          <Button
            key={item}
            type="button"
            variant={item === page ? 'default' : 'outline'}
            size="icon"
            aria-label={`第 ${item} 页`}
            aria-current={item === page ? 'page' : undefined}
            disabled={disabled}
            onClick={() => onPageChange(item)}
          >
            {item}
          </Button>
        ),
      )}
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label="下一页"
        disabled={disabled || page >= totalPages}
        onClick={() => onPageChange(page + 1)}
      >
        <ChevronRight />
      </Button>
    </nav>
  )
}
