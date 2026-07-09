import {
  BookOpen,
  BookOpenCheck,
  ChevronDown,
  ChevronUp,
  History,
  Lightbulb,
  RotateCcw,
  Shuffle,
  SlidersHorizontal,
} from 'lucide-react'
import { IconButton } from '@/features/freestyle/components/FreestyleIconButton'
import type { FreestyleMode } from '@/features/freestyle/model/today-training'
import { cn } from '@/shared/lib/utils'

export function FreestyleActionRail({
  mode,
  currentIndex,
  queueLength,
  currentPalaceId,
  hasQuizCard,
  onGoToIndex,
  onReshuffle,
  onOpenMemoryLookup,
  onOpenExplainSheet,
  onOpenHistory,
  onOpenWrongQuestions,
  onOpenSettings,
  onClearLocalProgress,
}: {
  mode: FreestyleMode
  currentIndex: number
  queueLength: number
  currentPalaceId: number | null
  hasQuizCard: boolean
  onGoToIndex: (index: number) => void
  onReshuffle: () => void
  onOpenMemoryLookup: () => void
  onOpenExplainSheet: () => void
  onOpenHistory: () => void
  onOpenWrongQuestions: () => void
  onOpenSettings: () => void
  onClearLocalProgress: () => void
}) {
  return (
    <div
      className={cn(
        'absolute z-30',
        'bottom-[max(1rem,env(safe-area-inset-bottom,0px))] left-0 right-0 flex items-center justify-between gap-3 px-3 sm:bottom-auto sm:left-auto sm:right-5 sm:top-1/2 sm:w-auto sm:-translate-y-1/2 sm:flex-col sm:justify-start sm:px-0',
      )}
      data-testid="freestyle-mobile-actions"
    >
      <div className="flex items-center gap-1.5 rounded-full border border-white/10 bg-zinc-950/84 p-1 shadow-xl backdrop-blur sm:contents">
        <IconButton label="上一题" onClick={() => onGoToIndex(currentIndex - 1)} disabled={currentIndex <= 0}>
          <ChevronUp className="size-5" />
        </IconButton>
        <IconButton
          label="下一题"
          onClick={() => onGoToIndex(currentIndex + 1)}
          disabled={mode === 'today' ? currentIndex >= queueLength : currentIndex >= queueLength - 1}
        >
          <ChevronDown className="size-5" />
        </IconButton>
        <IconButton label="重洗队列" onClick={onReshuffle} disabled={queueLength <= 1}>
          <Shuffle className="size-5" />
        </IconButton>
      </div>
      <div className="flex items-center gap-1.5 rounded-full border border-white/10 bg-zinc-950/84 p-1 shadow-xl backdrop-blur sm:contents">
        <IconButton
          label="查看宫殿"
          onClick={onOpenMemoryLookup}
          disabled={!currentPalaceId}
        >
          <BookOpen className="size-5" />
        </IconButton>
        <IconButton
          label="AI 讲解"
          onClick={onOpenExplainSheet}
          disabled={!hasQuizCard}
        >
          <Lightbulb className="size-5" />
        </IconButton>
        <IconButton label="历史记录" onClick={onOpenHistory}>
          <History className="size-5" />
        </IconButton>
        <IconButton label="错题本" onClick={onOpenWrongQuestions}>
          <BookOpenCheck className="size-5" />
        </IconButton>
        <IconButton label="设置" onClick={onOpenSettings}>
          <SlidersHorizontal className="size-5" />
        </IconButton>
        <span className="hidden sm:contents">
          <IconButton
            label="清空本地进度"
            onClick={onClearLocalProgress}
          >
            <RotateCcw className="size-5" />
          </IconButton>
        </span>
      </div>
    </div>
  )
}

export function FreestyleStatsPill({
  freshCount,
  resolvedCount,
  actionTotal,
}: {
  freshCount: number
  resolvedCount: number
  actionTotal: number
}) {
  return (
    <div className="pointer-events-none absolute bottom-4 left-4 z-20 hidden items-center gap-1.5 rounded-full border border-white/10 bg-zinc-900/80 px-3 py-2 text-xs text-zinc-300 shadow-lg backdrop-blur sm:flex">
      <span className="text-emerald-300">未做 {freshCount}</span>
      <span className="text-zinc-700">·</span>
      <span className="text-zinc-400">已做 {resolvedCount}</span>
      <span className="text-zinc-700">·</span>
      <span className="text-amber-300/80">跳转 {actionTotal}</span>
    </div>
  )
}
