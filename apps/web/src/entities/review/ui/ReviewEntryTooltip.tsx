import type { ReactNode } from 'react'
import type { ReviewBranchSummary } from '@/shared/api/contracts'
import { formatReviewIntervalFromNow } from '@/entities/review/model/reviewScheduleFormat'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/shared/components/ui/tooltip'

function formatBranchReviewLine(branch: ReviewBranchSummary): string {
  if (branch.branch_uid === '__more__') return branch.title
  if (branch.due_node_count > 0) {
    const status =
      branch.status === 'due_now'
        ? '已到期'
        : branch.status === 'later_today'
          ? '今日稍后'
          : '未到期'
    return `${branch.title} · ${status} ${branch.due_node_count}`
  }
  if (branch.next_review_at) {
    return `${branch.title} · ${formatReviewIntervalFromNow(branch.next_review_at)}`
  }
  return branch.title
}

export function ReviewEntryTooltip({
  children,
  branches,
  nextReviewAt = null,
  dueNodeCount = 0,
  entryMode = null,
  disabled = false,
}: {
  children: ReactNode
  branches?: ReviewBranchSummary[] | null
  nextReviewAt?: string | null
  dueNodeCount?: number
  entryMode?: 'none' | 'node' | 'palace' | null
  disabled?: boolean
}) {
  const items = Array.isArray(branches) ? branches.filter(Boolean) : []
  if (disabled || items.length === 0) {
    return <>{children}</>
  }

  const headline =
    dueNodeCount > 0
      ? entryMode === 'node'
        ? `节点复习 · 已到期 ${dueNodeCount}`
        : `宫殿复习 · 已到期 ${dueNodeCount}`
      : nextReviewAt
        ? `下次 ${formatReviewIntervalFromNow(nextReviewAt)}`
        : '复习安排'

  return (
    <TooltipProvider delayDuration={250}>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent
          side="bottom"
          align="start"
          className="max-w-xs space-y-1.5 px-3 py-2 text-left text-popover-foreground"
        >
          <div className="text-xs font-medium text-popover-foreground">{headline}</div>
          <ul className="space-y-1 border-t border-border/40 pt-1.5 text-[11px] leading-snug text-popover-foreground/90">
            {items.map((branch) => (
              <li key={branch.branch_uid}>{formatBranchReviewLine(branch)}</li>
            ))}
          </ul>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
