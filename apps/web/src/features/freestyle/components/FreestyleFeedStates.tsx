import { Copy, LoaderCircle, RotateCcw, Shuffle, SlidersHorizontal } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { FreestyleConfig } from '@/features/freestyle/model/freestyle'
import type { FreestyleMode, TodayTrainingConfig } from '@/features/freestyle/model/today-training'
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
  config: FreestyleConfig
  todayConfig: TodayTrainingConfig
  onLoadFeed: (config: FreestyleConfig) => Promise<void>
  onLoadTodayFeed: (config: TodayTrainingConfig) => Promise<void>
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
                if (mode === 'today') {
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
}: {
  mode: FreestyleMode
  onSwitchMode: (mode: FreestyleMode) => void
  onReshuffle: () => void
  onOpenSettings: () => void
}) {
  return (
    <section className="flex h-full snap-start items-center justify-center px-4">
      <EmptyState
        title={mode === 'today' ? '今天暂时没有可训练内容' : '这组暂时刷空了'}
        description={
          mode === 'today'
            ? '到期复习、需练习和可补足题卡都暂时为空。'
            : '当前筛选没有可展示的随心卡，换个范围或重洗队列再来一轮。'
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
                  <Button type="button" variant="secondary" onClick={onReshuffle}>
                    <Shuffle className="size-4" />
                    重洗
                  </Button>
                  <Button type="button" onClick={onOpenSettings}>
                    <SlidersHorizontal className="size-4" />
                    设置
                  </Button>
                </>
              )}
              <Button asChild variant="outline">
                <Link to="/palaces/new">{mode === 'today' ? '新建宫殿' : '记忆宫殿'}</Link>
              </Button>
            </div>
            <p className="mt-3 text-xs text-zinc-600">
              提示：在设置中开启更多题型或扩大内容范围，可以让随心队列更丰富。
            </p>
          </div>
        }
        className="bg-zinc-900 text-zinc-50 [&_p]:text-zinc-100 [&_p+p]:text-zinc-400"
      />
    </section>
  )
}
