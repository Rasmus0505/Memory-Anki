import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/shared/components/ui/button'

interface CompactPagerProps {
  page: number
  totalPages: number
  onPageChange: (page: number) => void
  'aria-label': string
}

export function CompactPager({ page, totalPages, onPageChange, 'aria-label': ariaLabel }: CompactPagerProps) {
  return (
    <nav aria-label={ariaLabel} className="flex items-center gap-1">
      <Button type="button" variant="ghost" size="icon" className="size-7" aria-label="上一页" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
        <ChevronLeft className="size-4" />
      </Button>
      <span className="min-w-10 text-center text-xs tabular-nums text-muted-foreground">
        {page}/{totalPages}
      </span>
      <Button type="button" variant="ghost" size="icon" className="size-7" aria-label="下一页" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
        <ChevronRight className="size-4" />
      </Button>
    </nav>
  )
}
