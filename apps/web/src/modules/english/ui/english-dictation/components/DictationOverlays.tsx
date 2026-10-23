import { useEffect, useRef } from 'react'
import { ArrowRight, Check, CircleAlert, Pause, RotateCcw, Sparkles } from 'lucide-react'
import type { EnglishCourseSentence } from '@/shared/api/contracts'
import { cn } from '@/shared/lib/utils'
import { formatStudyDuration } from '../dictationLayout'
import type { DictationRoundStats } from '../dictationControllerUtils'

interface DictationFilmstripProps {
  sentences: EnglishCourseSentence[]
  currentIndex: number
  completedIndexes: Set<number>
  onSelect: (index: number) => void
  className?: string
}

export function DictationFilmstrip({
  sentences,
  currentIndex,
  completedIndexes,
  onSelect,
  className,
}: DictationFilmstripProps) {
  const activeRef = useRef<HTMLButtonElement>(null)
  const railRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const rail = railRef.current
    const item = activeRef.current
    if (!rail || !item) return
    const railRect = rail.getBoundingClientRect()
    const itemRect = item.getBoundingClientRect()
    const target = Math.max(
      0,
      rail.scrollLeft + itemRect.left - railRect.left - (rail.clientWidth - itemRect.width) / 2,
    )
    const reducedMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (typeof rail.scrollTo === 'function') {
      rail.scrollTo({ left: target, behavior: reducedMotion ? 'auto' : 'smooth' })
    } else {
      rail.scrollLeft = target
    }
  }, [currentIndex])

  return (
    <div className={cn('ed-filmstrip', className)} data-testid="english-dictation-filmstrip">
      <div ref={railRef} className="ed-filmstrip__rail">
        {sentences.map((sentence, index) => {
          const done = completedIndexes.has(index)
          const active = index === currentIndex
          return (
            <button
              key={sentence.id}
              ref={active ? activeRef : undefined}
              type="button"
              className={cn(
                'ed-filmstrip__item',
                done && 'is-done',
                active && 'is-active',
              )}
              onClick={() => onSelect(index)}
              title={sentence.textEn}
              aria-label={`第 ${index + 1} 句${done ? '，已完成' : ''}`}
              aria-current={active ? 'step' : undefined}
            >
              <span className="ed-filmstrip__num">{String(index + 1).padStart(2, '0')}</span>
              <span className="ed-filmstrip__tick">{done ? <Check className="size-3" /> : null}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

interface DictationPauseOverlayProps {
  visible: boolean
  onResume: () => void
  resumeHint?: string
}

export function DictationPauseOverlay({ visible, onResume, resumeHint }: DictationPauseOverlayProps) {
  if (!visible) return null
  return (
    <div className="ed-overlay ed-overlay--pause" role="dialog" aria-label="已暂停">
      <div className="ed-overlay__card">
        <span className="ed-overlay__icon">
          <Pause className="size-6" />
        </span>
        <h2>已暂停</h2>
        <p>{resumeHint || '视频与听写都停在这一刻。按 Esc 或 Space 继续。'}</p>
        <div className="ed-overlay__actions">
          <button type="button" className="ed-cta ed-cta--primary" onClick={onResume}>
            继续 <kbd>Esc</kbd>
          </button>
        </div>
      </div>
    </div>
  )
}

interface DictationSummaryProps {
  visible: boolean
  title: string
  sentenceCount: number
  hasRound: boolean
  stats: DictationRoundStats
  onRestart: () => void
  onBack: () => void
}

export function DictationSummary({
  visible,
  title,
  sentenceCount,
  hasRound,
  stats,
  onRestart,
  onBack,
}: DictationSummaryProps) {
  if (!visible) return null
  return (
    <div className="ed-overlay ed-overlay--summary" role="dialog" aria-label="本课完成">
      <div className="ed-summary">
        <div className="ed-summary__burst" aria-hidden>
          <Sparkles className="size-8" />
        </div>
        <span className="ed-summary__eyebrow">CURTAIN CALL</span>
        <h2>{title}</h2>
        <p className="ed-summary__lead">
          {hasRound
            ? stats.completedThisRound >= sentenceCount
              ? `这一轮把 ${sentenceCount} 句全部拼完了。`
              : `这门课已经完成；这次新拼了 ${stats.completedThisRound} 句。`
            : `这门课已经完成。可以再练一轮，或回到片库挑选下一部。`}
        </p>

        {hasRound ? (
          <div className="ed-summary__stats">
            <div>
              <strong>{stats.firstTry}</strong>
              <span>一次通过</span>
            </div>
            <div>
              <strong>{stats.hinted}</strong>
              <span>用过提示</span>
            </div>
            <div>
              <strong>{stats.errors}</strong>
              <span>输错次数</span>
            </div>
            <div>
              <strong>{formatStudyDuration(stats.durationMs)}</strong>
              <span>本轮用时</span>
            </div>
          </div>
        ) : null}

        {hasRound && stats.tricky.length > 0 ? (
          <div className="ed-summary__tricky">
            <div className="ed-summary__tricky-title">值得再听一遍</div>
            <div className="ed-summary__tricky-list">
              {stats.tricky.slice(0, 5).map((item) => (
                <div key={item.index} className="ed-summary__tricky-row">
                  <span>{String(item.index + 1).padStart(2, '0')}</span>
                  <p>{item.sentence.textEn}</p>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div className="ed-overlay__actions">
          <button type="button" className="ed-cta ed-cta--primary" onClick={onRestart}>
            <RotateCcw className="size-4" /> 再练一遍 <kbd>Enter</kbd>
          </button>
          <button type="button" className="ed-cta" onClick={onBack}>
            返回片库 <kbd>Esc</kbd>
          </button>
        </div>
      </div>
    </div>
  )
}

interface DictationStartOverlayProps {
  visible: boolean
  onStart: () => void
}

export function DictationStartOverlay({ visible, onStart }: DictationStartOverlayProps) {
  if (!visible) return null
  return (
    <div className="ed-overlay ed-overlay--start">
      <button type="button" className="ed-start" onClick={onStart}>
        <span className="ed-start__ring">
          <ArrowRight className="size-6" />
        </span>
        <span className="ed-start__copy">
          <strong>开始本句</strong>
          <span>按 Space 播放，随后直接拼写</span>
        </span>
      </button>
    </div>
  )
}

export function DictationFlash({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <div className="ed-flash" role="status" aria-live="polite">
      {message}
    </div>
  )
}

export function DictationPageMessage({
  title,
  description,
  onBack,
}: {
  title: string
  description: string
  onBack: () => void
}) {
  return (
    <div className="ed-page ed-page--message">
      <div className="ed-empty">
        <CircleAlert className="size-7" />
        <h2>{title}</h2>
        <p>{description}</p>
        <button type="button" className="ed-cta ed-cta--primary" onClick={onBack}>
          返回片库
        </button>
      </div>
    </div>
  )
}
