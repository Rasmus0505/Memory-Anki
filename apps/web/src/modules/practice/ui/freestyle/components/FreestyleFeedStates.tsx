import { Copy, LoaderCircle, RotateCcw, Shuffle, SlidersHorizontal } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { FreestyleConfig } from '@/modules/practice/ui/freestyle/model/freestyle'
import type { FreestyleMode, TodayTrainingConfig } from '@/modules/practice/ui/freestyle/model/today-training'
import type { FreestyleFeedConfig } from '@/shared/api/contracts'
import { Button } from '@/shared/components/ui/button'
import { EmptyState } from '@/shared/components/state-placeholders'

function FreestyleFeedErrorDescription({ error }: { error: string }) {
  return (
    <span className="block max-w-[min(78vw,34rem)] whitespace-pre-wrap text-left">
      {error}
    </span>
  )
}

export function FreestyleLoadingState() {
  return (
    <section className="flex h-full snap-start items-center justify-center">
      <div className="flex items-center gap-2 text-sm text-zinc-300">
        <LoaderCircle className="size-4 animate-spin" />
        正在加载随心队列...
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
      <EmptyState
        title="队列加载失败"
        description={<FreestyleFeedErrorDescription error={feedError} />}
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button
              type="button"
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
            <Button type="button" variant="secondary" onClick={() => void onCopyDiagnostics()}>
              <Copy className="size-4" />
              复制诊断
            </Button>
            <Button type="button" variant="outline" asChild>
              <a href="/pwa-reset.html">
                <RotateCcw className="size-4" />
                清理 PWA 缓存
              </a>
            </Button>
          </div>
        }
        className="bg-zinc-900 text-zinc-50 [&_p]:text-zinc-100 [&_p+p]:text-zinc-400"
      />
    </section>
  )
}

export function FreestyleEmptyState({
  mode,
  onSwitchMode,
  onReshuffle,
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
    ? `${facts.join(' · ')}。再来一轮会按今天仍到期的重新抽。`
    : '当前范围里没有到期导图或题目。'
  return (
    <section className="flex h-full snap-start items-center justify-center px-4">
      <EmptyState
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
                <Button type="button" variant="secondary" onClick={() => onSwitchMode('free')}>
                  切到自由随心
                </Button>
              ) : (
                <>
                  <Button type="button" onClick={onReshuffle}>
                    <Shuffle className="size-4" />
                    再来一轮
                  </Button>
                  <Button type="button" variant="secondary" onClick={onOpenSettings}>
                    <SlidersHorizontal className="size-4" />
                    设置
                  </Button>
                </>
              )}
              <Button asChild variant="outline">
                <Link to={mode === 'today' ? '/palaces/new' : '/freestyle'}>
                  {mode === 'today' ? '新建宫殿' : '随心复习'}
                </Link>
              </Button>
            </div>
            <p className="mt-3 text-xs text-zinc-600">
              再来一轮会清空本轮完成/隐藏，按今天仍到期的重抽。
            </p>
          </div>
        }
        className="bg-zinc-900 text-zinc-50 [&_p]:text-zinc-100 [&_p+p]:text-zinc-400"
      />
    </section>
  )
}
