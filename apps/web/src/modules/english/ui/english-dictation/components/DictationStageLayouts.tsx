import type { EnglishCourseDetail, EnglishCourseSentence } from '@/shared/api/contracts'
import type { DictationSentenceSession } from '@/modules/english/domain/english-dictation/model'
import { getShortcutLabel, type EnglishPracticeSettings } from '@/modules/settings/public'
import { DictationVideo, type DictationVideoProps } from './DictationVideo'
import { DictationTypingStage } from './DictationTypingStage'
import { DictationFilmstrip } from './DictationOverlays'
import { DictationHintBar } from './DictationChrome'

interface Props {
  course: EnglishCourseDetail
  sentence: EnglishCourseSentence | null
  activeSession: DictationSentenceSession
  sentenceNumber: number
  currentIndex: number
  completedIndexes: Set<number>
  translationVisible: boolean
  settings: EnglishPracticeSettings
  videoProps: Omit<DictationVideoProps, 'layout' | 'sentenceLabel' | 'className'>
  onToggleTranslation: () => void
  onOpenShortcuts: () => void
  onGoToSentence: (index: number) => void
  onActivateInput: () => void
}

export function DictationStageLayouts({
  course,
  sentence,
  activeSession,
  sentenceNumber,
  currentIndex,
  completedIndexes,
  translationVisible,
  settings,
  videoProps,
  onToggleTranslation,
  onOpenShortcuts,
  onGoToSentence,
  onActivateInput,
}: Props) {
  const layout = settings.stage.layout
  const showFilmstrip = settings.stage.showFilmstrip
  const completedActions = [
    settings.shortcuts.replay_sentence
      ? `${getShortcutLabel(settings.shortcuts.replay_sentence)} 重播`
      : '',
    settings.shortcuts.reset_sentence
      ? `${getShortcutLabel(settings.shortcuts.reset_sentence)} 清空重输`
      : '',
    settings.shortcuts.next_sentence
      ? `${getShortcutLabel(settings.shortcuts.next_sentence)} 下一句`
      : '',
  ].filter(Boolean)
  const completedHint =
    completedActions.length > 0 ? `本句完成 · ${completedActions.join(' / ')}` : '本句完成'
  const sentenceLabel = `第 ${sentenceNumber} 句 / 共 ${course.sentences.length} 句`
  const filmstrip = showFilmstrip ? (
    <DictationFilmstrip
      sentences={course.sentences}
      currentIndex={currentIndex}
      completedIndexes={completedIndexes}
      onSelect={onGoToSentence}
    />
  ) : null
  const typing = sentence ? (
    <DictationTypingStage
      sentence={sentence}
      session={activeSession}
      sentenceNumber={sentenceNumber}
      translationVisible={translationVisible}
      onToggleTranslation={onToggleTranslation}
      onActivateInput={onActivateInput}
      completedHint={completedHint}
    />
  ) : null

  if (layout === 'theater') {
    return (
      <div className="ed-theater">
        <DictationVideo {...videoProps} layout={layout} sentenceLabel={sentenceLabel} className="ed-theater__video" />
        <div className="ed-theater__scrim" aria-hidden />
        <div className="ed-theater__bottom">
          {sentence ? (
            <DictationTypingStage
              sentence={sentence}
              session={activeSession}
              sentenceNumber={sentenceNumber}
              translationVisible={translationVisible}
              onToggleTranslation={onToggleTranslation}
              onActivateInput={onActivateInput}
              completedHint={completedHint}
              className="ed-theater__typing"
            />
          ) : null}
          {showFilmstrip ? (
            <DictationFilmstrip
              sentences={course.sentences}
              currentIndex={currentIndex}
              completedIndexes={completedIndexes}
              onSelect={onGoToSentence}
              className="ed-theater__filmstrip"
            />
          ) : null}
          <DictationHintBar
            settings={settings}
            onOpenShortcuts={onOpenShortcuts}
            className="ed-theater__hints"
          />
        </div>
      </div>
    )
  }

  if (layout === 'classic') {
    return (
      <div className="ed-classic">
        <div className="ed-classic__media">
          <DictationVideo {...videoProps} layout={layout} sentenceLabel={sentenceLabel} className="ed-classic__video" />
          {filmstrip}
        </div>
        <div className="ed-classic__panel">
          {typing}
          <DictationHintBar settings={settings} onOpenShortcuts={onOpenShortcuts} />
        </div>
      </div>
    )
  }

  return (
    <div className="ed-immersive">
      <DictationVideo {...videoProps} layout={layout} sentenceLabel={sentenceLabel} className="ed-immersive__video" />
      {typing ? <div className="ed-immersive__typing">{typing}</div> : null}
      {filmstrip}
      <DictationHintBar settings={settings} onOpenShortcuts={onOpenShortcuts} />
    </div>
  )
}
