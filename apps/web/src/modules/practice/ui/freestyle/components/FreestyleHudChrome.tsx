import { History, ListChecks, MoreHorizontal, RefreshCw } from 'lucide-react'
import { Link } from 'react-router-dom'
import {
  FREESTYLE_WORKSPACE_PRIMARY,
  FREESTYLE_WORKSPACE_SECONDARY,
  freestyleWorkspaceLabel,
  freestyleWorkspacePath,
  peerFreestyleWorkspace,
  type FreestyleWorkspaceId,
} from '@/modules/practice/public'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu'
import { cn } from '@/shared/lib/utils'

const FREESTYLE_SECTION_LINKS = [
  { to: '/palaces', label: '知识' },
  { to: '/english', label: '英语' },
  { to: '/palaces/new', label: '创建' },
  { to: '/dashboard', label: '洞察' },
] as const

const hudActionClass =
  'ma-pressable inline-flex size-10 shrink-0 items-center justify-center rounded-full text-stage-ink hover:bg-stage-line hover:text-stage-glow active:bg-stage-line-strong sm:size-9'

/** Stable subtree: the page memoizes it so Radix composeRefs never loops. */
export function FreestyleHudOverflow({
  summaryLabel,
  slot,
  onOpenPlan,
  onRefresh,
  onOpenHistory,
}: {
  summaryLabel: string
  slot: FreestyleWorkspaceId
  onOpenPlan: () => void
  onRefresh: () => void
  onOpenHistory: () => void
}) {
  return (
    <>
      <button
        type="button"
        className={cn(hudActionClass, 'text-stage-muted')}
        title="本轮安排"
        aria-label="本轮安排"
        onClick={onOpenPlan}
      >
        <ListChecks className="size-4" />
      </button>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <button type="button" className={hudActionClass} title="更多" aria-label="更多">
            <MoreHorizontal className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-44">
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
            {summaryLabel}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => onRefresh()}>
            <RefreshCw className="mr-2 size-4" />
            刷新队列
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onOpenHistory()}>
            <History className="mr-2 size-4" />
            历史
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-xs text-muted-foreground">切换模块</DropdownMenuLabel>
          <DropdownMenuItem asChild>
            <Link to={freestyleWorkspacePath(peerFreestyleWorkspace(slot))}>
              {freestyleWorkspaceLabel(peerFreestyleWorkspace(slot))}
            </Link>
          </DropdownMenuItem>
          {FREESTYLE_SECTION_LINKS.map((item) => (
            <DropdownMenuItem key={item.to} asChild>
              <Link to={item.to}>{item.label}</Link>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
}

export function FreestyleWorkspaceSwitcher({ slot }: { slot: FreestyleWorkspaceId }) {
  return (
    <div
      data-testid="freestyle-workspace-switcher"
      className="pointer-events-auto mr-1 inline-flex items-center rounded-full border border-stage-line bg-stage-overlay p-0.5 text-[11px] font-medium"
    >
      {[FREESTYLE_WORKSPACE_PRIMARY, FREESTYLE_WORKSPACE_SECONDARY].map((id) => (
        <Link
          key={id}
          to={freestyleWorkspacePath(id)}
          className={cn(
            'rounded-full px-2 py-0.5 transition-colors',
            slot === id
              ? 'bg-stage-raised text-stage-glow shadow-sm'
              : 'text-stage-muted hover:text-stage-ink',
          )}
          aria-current={slot === id ? 'page' : undefined}
        >
          {freestyleWorkspaceLabel(id)}
        </Link>
      ))}
    </div>
  )
}

const noticeEnter = 'animate-in fade-in-0 slide-in-from-top-2'

export function FreestyleTopNotices({
  showYesterday,
  onDismissYesterday,
  channelAppliedHint,
  onDismissChannelApplied,
  saveError,
  onDismissSaveError,
}: {
  showYesterday: boolean
  onDismissYesterday: () => void
  channelAppliedHint: string
  onDismissChannelApplied: () => void
  saveError: string
  onDismissSaveError: () => void
}) {
  if (!showYesterday && !channelAppliedHint && !saveError) return null
  return (
    <div className="pointer-events-none absolute left-1/2 top-[4.25rem] z-30 flex max-w-[min(24rem,calc(100%-1.5rem))] -translate-x-1/2 flex-col items-center gap-2">
      {showYesterday ? (
        <button
          type="button"
          data-testid="freestyle-yesterday-hint"
          className={cn(noticeEnter, 'freestyle-stage-glass pointer-events-auto rounded-2xl border border-stage-glow/35 px-3 py-2 text-xs text-stage-ink')}
          onClick={onDismissYesterday}
        >
          这是昨天未完成的一轮
        </button>
      ) : null}
      {channelAppliedHint ? (
        <button
          type="button"
          data-testid="freestyle-channel-applied"
          className={cn(noticeEnter, 'freestyle-stage-glass pointer-events-auto rounded-2xl border border-stage-line-strong px-3 py-2 text-xs text-stage-ink')}
          onClick={onDismissChannelApplied}
        >
          {channelAppliedHint}
        </button>
      ) : null}
      {saveError ? (
        <button
          type="button"
          className={cn(noticeEnter, 'pointer-events-auto rounded-2xl border border-rate-again/40 bg-stage-raised px-4 py-2.5 text-sm text-stage-ink shadow-lg')}
          onClick={onDismissSaveError}
        >
          {saveError}
        </button>
      ) : null}
    </div>
  )
}

const recoveryButtonClass =
  'ma-pressable rounded-xl border border-stage-line-strong px-3 py-1.5 text-xs font-medium hover:bg-stage-line'

export function FreestyleStaleRecoveryPanel({
  onSkip,
  onRebuild,
  onOpenConfig,
}: {
  onSkip: () => void
  onRebuild: () => void
  onOpenConfig: () => void
}) {
  return (
    <div
      data-testid="freestyle-stale-recovery"
      role="region"
      aria-label="队列恢复"
      className="pointer-events-none absolute inset-x-0 top-16 bottom-24 z-[19] flex items-center justify-center px-4 pr-16"
    >
      <div className="freestyle-stage-glass animate-in fade-in-0 zoom-in-95 pointer-events-auto flex max-w-[min(22rem,100%)] flex-col gap-3 rounded-2xl border border-stage-glow/30 px-4 py-3.5 text-sm text-stage-ink">
        <p>多张卡片已在其他设备复习，或内容刚被改过</p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={cn(recoveryButtonClass, 'border-stage-glow/40 bg-stage-glow/15 text-stage-glow hover:bg-stage-glow/25')}
            onClick={onSkip}
          >
            跳过这张
          </button>
          <button type="button" className={recoveryButtonClass} onClick={onRebuild}>
            重建队列
          </button>
          <button type="button" className={recoveryButtonClass} onClick={onOpenConfig}>
            打开配置
          </button>
        </div>
      </div>
    </div>
  )
}
