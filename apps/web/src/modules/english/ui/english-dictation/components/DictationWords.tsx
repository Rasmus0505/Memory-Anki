import { cn } from '@/shared/lib/utils'
import {
  getLetterState,
  getWordVisualStatus,
  type DictationSentenceSession,
} from '@/modules/english/domain/english-dictation/model'

interface DictationWordsProps {
  session: DictationSentenceSession
  active: boolean
  compact?: boolean
}

export function DictationWords({ session, active, compact = false }: DictationWordsProps) {
  return (
    <div
      data-testid="english-dictation-sentence"
      data-complete={session.completed ? 'true' : 'false'}
      className={cn(
        'ed-sentence',
        compact && 'ed-sentence--compact',
        session.completed && 'ed-sentence--done',
      )}
    >
      {session.words.map((word, wordIndex) => {
        const status = getWordVisualStatus(word, wordIndex, session)
        const isActive = active && !session.completed && wordIndex === session.activeWordIndex
        return (
          <span
            key={`${wordIndex}-${word.answer}`}
            data-testid={`english-word-${wordIndex}`}
            data-status={status}
            data-active-word={isActive ? 'true' : 'false'}
            className={cn('ed-word', `ed-word--${status}`, isActive && 'ed-word--active')}
          >
            {word.lead ? <span className="ed-word__punct">{word.lead}</span> : null}
            <span className="ed-word__letters">
              {Array.from(word.answer).map((answerChar, letterIndex) => {
                const state = getLetterState(word, letterIndex, isActive)
                const typed = word.chars[letterIndex]
                return (
                  <span
                    key={`${letterIndex}-${answerChar}`}
                    className={cn('ed-letter', `ed-letter--${state}`)}
                    data-letter-state={state}
                  >
                    {typed ? (
                      <span className="ed-letter__ink">{typed.char}</span>
                    ) : state === 'caret' ? (
                      <span className="ed-letter__caret" data-caret="true" />
                    ) : (
                      <span className="ed-letter__ghost" aria-hidden>
                        ·
                      </span>
                    )}
                  </span>
                )
              })}
            </span>
            {word.trail ? <span className="ed-word__punct">{word.trail}</span> : null}
          </span>
        )
      })}
    </div>
  )
}
