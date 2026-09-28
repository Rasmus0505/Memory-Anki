import type { CSSProperties, ReactNode } from 'react'
import { Copy, Moon, RotateCcw, SlidersHorizontal, Sparkles, TriangleAlert } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { FreestyleConfig } from '@/modules/practice/ui/freestyle/model/freestyle'
import type { FreestyleMode, TodayTrainingConfig } from '@/modules/practice/ui/freestyle/model/today-training'
import type { FreestyleFeedConfig } from '@/shared/api/contracts'
import { Button } from '@/shared/components/ui/button'
import { cn } from '@/shared/lib/utils'

function FreestyleFeedErrorDescription({ error }: { error: string }) {
  return (
    <span className="block max-w-[min(78vw,34rem)] whitespace-pre-wrap text-left">
      {error}
    </span>
  )
}

function StagePanel({
  icon,
  tone,
  title,
  description,
  action,
}: {
  icon: ReactNode
  tone: 'warm' | 'alert'
  title: string
  description: ReactNode
  action: ReactNode
}) {
  return (
    <div className="fs-rise w-full max-w-md rounded-[1.75rem] border border-stage-line-strong bg-stage-raised/90 px-6 py-8 text-center text-stage-ink shadow-[0_24px_70px_-18px_rgb(0_0_0/0.7)]">
      <div className="relative mx-auto mb-5 size-20" aria-hidden>
        <div
          className={cn(
            'fs-halo absolute inset-[-30%] rounded-full',
            tone === 'alert' && '[background:radial-gradient(circle,hsl(8_76%_60%/0.3),transparent_68%)]',
          )}
        />
        <div
          className={cn(
            'relative flex size-full items-center justify-center rounded-[1.4rem] border shadow-lift',
            tone === 'warm'
              ? 'border-primary/30 bg-gradient-to-br from-primary/25 to-stage-raised text-stage-glow'
              : 'border-rate-again/30 bg-gradient-to-br from-rate-again/20 to-stage-raised text-rate-again',
          )}
        >
          {icon}
        </div>
        {tone === 'warm'
          ? [0, 1, 2].map((spark) => (
            <Sparkles key={spark} className={cn('fs-sparkle absolute size-3.5 text-stage-glow', `fs-sparkle-${spark}`)} />
          ))
          : null}
      </div>
      <p className="text-lg font-semibold leading-snug text-stage-ink">{title}</p>
      <div className="mx-auto mt-2 max-w-sm text-sm leading-6 text-stage-muted">{description}</div>
      <div className="mt-6">{action}</div>
    </div>
  )
}

function SkeletonLine({ className, index }: { className: string; index: number }) {
  return (
    <div
      className={cn('ma-skeleton fs-rise h-3 rounded-full', className)}
      style={{ '--fs-i': index } as CSSProperties}
    />
  )
}

export function FreestyleLoadingState() {
  return (
    <section className="flex h-full snap-start items-center justify-center px-4" aria-busy="true">
      <div className="w-full max-w-xl">
        <div className="fs-paper-card fs-rise rounded-[1.5rem] p-6 [--color-muted:var(--color-paper-line)]">
          <div className="flex items-center gap-3">
            <div className="ma-skeleton size-9 rounded-xl" />
            <div className="flex-1 space-y-2">
              <SkeletonLine className="w-2/5" index={1} />
              <SkeletonLine className="h-2.5 w-1/4" index={2} />
            </div>
          </div>
          <div className="mt-6 space-y-3">
            <SkeletonLine className="h-4 w-11/12" index={3} />
            <SkeletonLine className="h-4 w-4/5" index={4} />
            <SkeletonLine className="h-4 w-3/5" index={5} />
          </div>
          <div className="mt-7 grid grid-cols-3 gap-2">
            {[6, 7, 8].map((index) => (
              <div key={index} className="ma-skeleton fs-rise h-16 rounded-2xl" style={{ '--fs-i': index } as CSSProperties} />
            ))}
          </div>
        </div>
        <p className="mt-4 text-center text-sm text-stage-muted">正在加载随心队列...</p>
      </div>
    </section>
  )
}

export function FreestyleFeedErrorState({
  feedError,
  mode,
  config,
  todayConfig,
  onLoadFeed,
  onLoadTodayFeed,
  onCopyDiagnostics,
}: {
  feedError: string
  mode: FreestyleMode
  config: FreestyleConfig | FreestyleFeedConfig
  todayConfig?: TodayTrainingConfig
  onLoadFeed: (config: FreestyleConfig | FreestyleFeedConfig) => Promise<void>
  onLoadTodayFeed?: (config: TodayTrainingConfig) => Promise<void>
  onCopyDiagnostics: () => Promise<void>
}) {
  return (
    <section className="flex h-full snap-start items-center justify-center px-4">
      <StagePanel
        tone="alert"
        icon={<TriangleAlert className="size-9" strokeWidth={1.8} />}
        title="队列加载失败"
        description={<FreestyleFeedErrorDescription error={feedError} />}
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button
              type="button"
              className="ma-pressable"
              onClick={() => {
                if (mode === 'today' && todayConfig && onLoadTodayFeed) {
                  void onLoadTodayFeed(todayConfig)
                } else {
                  void onLoadFeed(config)
                }
              }}
            >
              重试
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="ma-pressable border border-stage-line bg-stage/60 text-stage-ink hover:bg-stage"
              onClick={() => void onCopyDiagnostics()}
            >
              <Copy className="size-4" />
              复制诊断
            </Button>
            <Button
              type="button"
              variant="outline"
              className="ma-pressable border-stage-line-strong bg-transparent text-stage-ink hover:bg-stage-ink/8 hover:text-stage-ink"
              asChild
            >
              <a href="/pwa-reset.html">
                <RotateCcw className="size-4" />
                清理 PWA 缓存
              </a>
            </Button>
          </div>
        }
      />
    </section>
  )
}

export function FreestyleEmptyState({
  mode,
  onSwitchMode,
  onReshuffle: _onReshuffle,
  onOpenSettings,
  completedCount = 0,
  mutedCount = 0,
  hiddenCount = 0,
}: {
  mode: FreestyleMode
  onSwitchMode: (mode: FreestyleMode) => void
  onReshuffle: () => void
  onOpenSettings: () => void
  /** Local round filters — explain why Insights can still show due palaces. */
  completedCount?: number
  mutedCount?: number
  hiddenCount?: number
}) {
  const filteredRound = completedCount > 0 || mutedCount > 0 || hiddenCount > 0
  const freeTitle = filteredRound ? '本轮暂时没有可刷的卡' : '这组暂时刷空了'
  const facts = [
    completedCount > 0 ? `本轮已完成 ${completedCount}` : null,
    hiddenCount > 0 ? `已隐藏 ${hiddenCount}` : null,
    mutedCount > 0 ? `少看 ${mutedCount} 座宫殿` : null,
  ].filter(Boolean)
  const freeDescription = filteredRound
    ? `${facts.join(' · ')}。可以改范围或等新的到期。`
    : '今天没有到期。点顶上进度可以改配置。'
  return (
    <section className="flex h-full snap-start items-center justify-center px-4">
      <StagePanel
        tone="warm"
        icon={<Moon className="size-9" strokeWidth={1.8} />}
        title={mode === 'today' ? '今天暂时没有可训练内容' : freeTitle}
        description={
          mode === 'today'
            ? '到期复习、需练习和可补足题卡都暂时为空。'
            : freeDescription
        }
        action={
          <div>
            <div className="flex flex-wrap justify-center gap-2">
              {mode === 'today' ? (
                <Button type="button" className="ma-pressable" onClick={() => onSwitchMode('free')}>
                  切到自由随心
                </Button>
              ) : (
                <Button type="button" className="ma-pressable" onClick={onOpenSettings}>
                  <SlidersHorizontal className="size-4" />
                  去改配置
                </Button>
              )}
              <Button
                asChild
                variant="outline"
                className="ma-pressable border-stage-line-strong bg-transparent text-stage-ink hover:bg-stage-ink/8 hover:text-stage-ink"
              >
                <Link to={mode === 'today' ? '/palaces/new' : '/freestyle'}>
                  {mode === 'today' ? '新建宫殿' : '随心复习'}
                </Link>
              </Button>
            </div>
            <p className="mt-4 text-xs text-stage-faint">
              今天没有到期时，改学科或宫殿范围后再刷。
            </p>
          </div>
        }
      />
    </section>
  )
}
