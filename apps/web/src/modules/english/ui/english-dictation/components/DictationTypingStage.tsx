import { Languages } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import type { EnglishCourseSentence } from '@/shared/api/contracts'
import type { DictationSentenceSession } from '@/modules/english/domain/english-dictation/model'
import { DictationWords } from './DictationWords'
import { isTouchPrimaryInput } from '../dictationLayout'

interface DictationTranslationProps {
  sentence: EnglishCourseSentence | null
  completed: boolean
  visible: boolean
  onToggle: () => void
}

export function DictationTranslation({
  sentence,
  completed,
  visible,
  onToggle,
}: DictationTranslationProps) {
  const hasTranslation = Boolean(sentence?.textZh?.trim())
  return (
    <button
      type="button"
      className={cn(
        'ed-translation',
        completed && 'ed-translation--ready',
        completed && !visible && 'ed-translation--hidden',
      )}
      onClick={onToggle}
      data-testid="english-course-inline-translation"
      title={completed ? '显示或隐藏本句译文' : '完成本句后显示译文'}
    >
      <span className="ed-translation__badge">
        <Languages className="size-3.5" />
        译
      </span>
      <span className="ed-translation__body">
        {!completed
          ? '本句完成后显示中文译文'
          : !visible
            ? '译文已隐藏 · Enter 显示'
            : hasTranslation
              ? sentence?.textZh
              : '本句没有中文译文'}
      </span>
    </button>
  )
}

interface DictationTypingStageProps {
  sentence: EnglishCourseSentence | null
  session: DictationSentenceSession
  sentenceNumber: number
  translationVisible: boolean
  onToggleTranslation: () => void
  onActivateInput?: () => void
  completedHint?: string
  compact?: boolean
  className?: string
}

export function DictationTypingStage({
  sentence,
  session,
  sentenceNumber,
  translationVisible,
  onToggleTranslation,
  onActivateInput,
  completedHint,
  compact = false,
  className,
}: DictationTypingStageProps) {
  const touchMode = isTouchPrimaryInput()
  const statusCopy = session.completed
    ? completedHint || '本句完成'
    : session.usedHint
      ? '正在使用提示 · 输完整个单词才会判定'
      : touchMode
        ? '轻触句子区域唤起键盘 · 整词判定'
        : '逐词拼写 · 整词输错会自动清空重来'

  return (
    <section
      className={cn('ed-typing', compact && 'ed-typing--compact', className)}
      data-testid="english-course-spelling-panel"
      aria-label={`第 ${sentenceNumber} 句拼写`}
    >
      <div className="ed-typing__head">
        <span className="ed-typing__index">SENTENCE {String(sentenceNumber).padStart(2, '0')}</span>
        <span className={cn('ed-typing__status', session.completed && 'is-done')}>{statusCopy}</span>
      </div>

      <div className="ed-typing__canvas" onPointerDown={onActivateInput}>
        <DictationWords session={session} active compact={compact} />
      </div>

      <DictationTranslation
        sentence={sentence}
        completed={session.completed}
        visible={translationVisible}
        onToggle={onToggleTranslation}
      />
    </section>
  )
}
