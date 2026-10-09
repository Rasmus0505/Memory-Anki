import { LoaderCircle, RotateCcw, TriangleAlert } from 'lucide-react'
import { flipProgressToneClass, type flipProgressTone } from '../model/flipProgressBadge'
import type { FreestyleReviewUnitCard } from '@/shared/api/contracts'
import { cn } from '@/shared/lib/utils'
import { FreestyleUnitMapSkeleton } from './FreestyleUnitMapSkeleton'
import { FX_ANCHORS } from '@/shared/fx'

type FlipTone = NonNullable<ReturnType<typeof flipProgressTone>>

/**
 * Identity row sits in flow above the map chrome. It used to be absolutely
 * positioned over the canvas toolbar, which on phone hid 英语/文字模式 entirely.
 * Right padding reserves the page-level HUD pill's band (timer + plan + ⋯).
 */
export function FreestyleUnitReviewIdentityRow({
  titleText,
  phase,
  flipTone,
  flipLabel,
  flipTitle,
  showUndo,
  undoDisabled,
  onUndo,
}: {
  titleText: string
  phase: FreestyleReviewUnitCard['phase']
  flipTone: FlipTone | null
  flipLabel: string | null
  flipTitle: string | null
  showUndo: boolean
  undoDisabled: boolean
  onUndo: () => void
}) {
  return (
    <div className="relative z-10 flex min-w-0 shrink-0 items-center gap-1.5 p-2 pr-[7rem] sm:p-2.5 sm:pr-2.5">
      <div className="flex min-w-0 items-center gap-1.5 rounded-full border border-paper-line bg-paper-card/95 px-2.5 py-1 shadow-soft">
        <span
          className="relative size-2 shrink-0 rounded-full bg-primary shadow-[0_0_0_3px_hsl(28_80%_51%/0.22)]"
          title="永久标记"
          aria-label="永久标记"
        />
        <h1 className="min-w-0 truncate text-[13px] font-semibold leading-tight tracking-tight text-paper-ink sm:text-sm">
          {titleText}
        </h1>
        {phase === 'fill' ? (
          <span
            data-testid="freestyle-fill-badge"
            title="补充练习：记得/轻松只记下，不改下次到期日"
            className="inline-flex h-5 shrink-0 items-center rounded-full border border-[hsl(190_60%_36%/0.3)] bg-[hsl(190_60%_36%/0.1)] px-1.5 text-[10px] font-semibold text-[hsl(190_60%_30%)] sm:h-6 sm:px-2 sm:text-[11px]"
          >
            补充
          </span>
        ) : null}
        {flipTone && flipLabel && flipTitle ? (
          <span
            role="status"
            aria-label={flipTitle}
            title={flipTitle}
            data-testid="flip-progress-badge"
            data-fx-anchor={FX_ANCHORS.flipBadge}
            data-tone={flipTone}
            className={cn(
              'inline-flex h-5 shrink-0 items-center rounded-full border px-1.5 font-mono text-[10px] font-semibold tabular-nums tracking-tight transition-colors duration-300 sm:h-6 sm:px-2 sm:text-[11px]',
              flipProgressToneClass(flipTone),
            )}
          >
            {flipLabel}
          </span>
        ) : null}
      </div>
      {showUndo ? (
        <button
          type="button"
          disabled={undoDisabled}
          data-testid="freestyle-transient-undo"
          className="ma-pressable fs-rise inline-flex h-7 shrink-0 items-center gap-1 rounded-full border border-paper-line bg-paper-card px-2.5 text-xs font-medium text-paper-ink-soft shadow-soft hover:border-primary/40 hover:text-primary-strong disabled:opacity-40"
          onClick={onUndo}
        >
          <RotateCcw className="size-3.5" />
          撤销
        </button>
      ) : null}
    </div>
  )
}

const PAPER_ACTION = 'ma-pressable rounded-xl border border-paper-line-strong bg-paper-card px-3 py-2 text-paper-ink shadow-soft hover:border-primary/40'

export function FreestyleUnitReviewPlaceholder({
  card,
  recapOnly,
  loadError,
  loadErrorTitle,
  loadErrorHint,
  staleRecovery,
  onRetry,
  onSkip,
  onRebuildRound,
  onRecapOnly,
}: {
  card: FreestyleReviewUnitCard
  recapOnly: boolean
  loadError: string | null
  loadErrorTitle: string | null
  loadErrorHint: string | null
  staleRecovery: boolean
  onRetry: () => void
  onSkip: () => void
  onRebuildRound?: () => void
  onRecapOnly: () => void
}) {
  if (!recapOnly && !loadError && !staleRecovery) return <FreestyleUnitMapSkeleton card={card} />
  return (
    <div className={cn(
      'flex h-full items-center justify-center px-5 text-center text-sm',
      recapOnly
        ? 'bg-paper text-paper-ink-soft'
        : loadError
        ? 'bg-[hsl(8_80%_97%)] text-paper-ink'
        : staleRecovery
          ? 'bg-primary-soft/60 text-primary-strong'
          : 'bg-paper text-paper-muted',
    )}>
      {recapOnly ? (
        <div className="fs-rise flex max-w-[min(22rem,100%)] flex-col items-center gap-3 text-paper-ink">
          <p>这张已经评过，当前只看不评</p>
          <p className="text-xs text-paper-muted">
            {card.palace_title || '记忆宫殿'}
            {card.context_path?.length
              ? ` · ${card.context_path.map((item) => item.text).filter(Boolean).join(' / ')}`
              : ''}
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <button type="button" className={PAPER_ACTION} onClick={onRetry}>
              改评分
            </button>
            <button type="button" className={PAPER_ACTION} onClick={onSkip}>
              跳过这张
            </button>
          </div>
        </div>
      ) : loadError ? (
        <div className="fs-rise flex max-w-[min(22rem,100%)] flex-col items-center gap-3">
          <span className="flex size-11 items-center justify-center rounded-2xl bg-[hsl(8_70%_52%/0.12)] text-[hsl(8_70%_48%)]" aria-hidden>
            <TriangleAlert className="size-5" />
          </span>
          <p className="font-medium">{loadErrorTitle || '这张卡暂时打不开'}</p>
          <p className="text-xs text-paper-muted">{loadErrorHint || '可以重试、跳过、重建本轮，或只看不评。'}</p>
          <div className="flex flex-wrap justify-center gap-2">
            <button type="button" className={cn(PAPER_ACTION, 'border-primary/50 bg-primary text-primary-foreground hover:bg-primary-strong')} onClick={onRetry}>
              重试
            </button>
            <button type="button" className={PAPER_ACTION} onClick={onSkip}>
              跳过这张
            </button>
            <button type="button" className={PAPER_ACTION} onClick={() => onRebuildRound?.()}>
              重建本轮
            </button>
            <button type="button" className={PAPER_ACTION} onClick={onRecapOnly}>
              只看不评
            </button>
          </div>
          <button
            type="button"
            className="text-xs text-paper-muted underline underline-offset-2 hover:text-paper-ink"
            onClick={() => void navigator.clipboard?.writeText(loadError)}
          >
            复制给助手
          </button>
        </div>
      ) : staleRecovery ? (
        <span className="inline-flex items-center"><LoaderCircle className="mr-2 size-4 animate-spin" />正在更新复习安排...</span>
      ) : null}
    </div>
  )
}
