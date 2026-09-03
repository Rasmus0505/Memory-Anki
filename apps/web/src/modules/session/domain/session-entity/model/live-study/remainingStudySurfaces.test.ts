import { describe, expect, it } from 'vitest'
import {
  isFollowableStudyPath,
  liveStudySurfaceFromPath,
  shouldFollowLiveRoute,
} from './liveStudyModel'
import {
  isPendingLiveStudyApply,
  shouldPublishLiveStudyView,
} from '@/modules/session/ui/live-presence/shouldPublishLiveStudyView'
import {
  applyPalaceQuizLiveView,
  decodePalaceQuizLiveView,
  isPalaceQuizApplyReady,
  palaceQuizSameInteraction,
} from '@/modules/quiz/ui/palace-quiz/model/palaceQuizLiveView'
import {
  applyPalacePracticeLiveView,
  decodePalacePracticeLiveView,
  palacePracticeSameInteraction,
} from '@/modules/content/ui/palace-edit/model/palacePracticeLiveView'
import {
  applyEnglishCourseLiveView,
  decodeEnglishCourseLiveView,
  englishCourseSameInteraction,
  resolveEnglishCourseProgressAfterLoad,
} from '@/modules/english/ui/english/model/englishCourseLiveView'
import {
  applyEnglishReadingLiveView,
  decodeEnglishReadingLiveView,
  englishReadingSameInteraction,
  shouldClearEnglishReadingSelection,
} from '@/modules/english-reading/ui/english-reading/model/englishReadingLiveView'

describe('remaining live-study surfaces', () => {
  it('follows quiz, palace view, english course, and english reading but not settings or editor', () => {
    expect(isFollowableStudyPath('/palaces/7/quiz')).toBe(true)
    expect(isFollowableStudyPath('/palaces/7')).toBe(true)
    expect(isFollowableStudyPath('/english/listening/courses/3')).toBe(true)
    expect(isFollowableStudyPath('/english/reading/materials/9')).toBe(true)
    expect(isFollowableStudyPath('/palaces/7/edit')).toBe(false)
    expect(isFollowableStudyPath('/profile')).toBe(false)
    expect(isFollowableStudyPath('/profile/timer')).toBe(false)
    expect(liveStudySurfaceFromPath('/palaces/7/quiz')).toBe('palace_quiz')
    expect(liveStudySurfaceFromPath('/palaces/7')).toBe('mindmap_review')
    expect(liveStudySurfaceFromPath('/english/listening/courses/3')).toBe('english_course')
    expect(liveStudySurfaceFromPath('/english/reading/materials/9')).toBe('english_reading')
    expect(liveStudySurfaceFromPath('/palaces/7/edit')).toBeNull()
    expect(
      shouldFollowLiveRoute({
        localPath: '/freestyle',
        isController: false,
        surface: 'palace_quiz',
        route: '/palaces/7/quiz',
      }),
    ).toBe(true)
    expect(
      shouldFollowLiveRoute({
        localPath: '/palaces/4',
        isController: false,
        surface: 'mindmap_review',
        route: '/palaces/7',
      }),
    ).toBe(true)
    expect(
      shouldFollowLiveRoute({
        localPath: '/profile',
        isController: false,
        surface: 'english_course',
        route: '/english/listening/courses/3',
      }),
    ).toBe(false)
    expect(
      shouldFollowLiveRoute({
        localPath: '/freestyle',
        isController: false,
        surface: 'mindmap_review',
        route: '/palaces/7/edit',
      }),
    ).toBe(false)
  })

  it('applies palace-quiz current question and in-progress answer', () => {
    const remote = decodePalaceQuizLiveView({
      palaceId: 7,
      tab: 'practice',
      viewMode: 'single',
      questionId: 22,
      questionIndex: 0,
      questionState: { questionId: 22, state: { selectedOptionId: 'b', resolved: true, correct: true } },
    })
    expect(remote).not.toBeNull()
    const applied = applyPalaceQuizLiveView(
      {
        tab: 'manage',
        viewMode: 'list',
        questionIndex: 0,
        questionStates: {},
      },
      remote!,
      [11, 22, 33],
    )
    expect(applied.tab).toBe('practice')
    expect(applied.ready).toBe(true)
    expect(applied.questionIndex).toBe(1)
    expect(applied.questionStates[22]).toEqual({ selectedOptionId: 'b', resolved: true, correct: true })
    expect(palaceQuizSameInteraction(remote!, { ...remote!, questionIndex: 9 })).toBe(true)
    expect(isPalaceQuizApplyReady(remote!, [])).toBe(false)
    const pending = applyPalaceQuizLiveView(
      {
        tab: 'practice',
        viewMode: 'single',
        questionIndex: 0,
        questionStates: {},
      },
      remote!,
      [],
    )
    expect(pending.ready).toBe(false)
    expect(pending.questionIndex).toBe(0)
  })

  it('applies palace practice node, reveal, and rating marks', () => {
    const remote = decodePalacePracticeLiveView({
      palaceId: 7,
      editorMode: 'recall',
      currentNodeUid: 'node-3',
      revealMap: { root: 'revealed', 'node-3': 'placeholder' },
      redNodeIds: ['node-3'],
    })
    expect(remote).not.toBeNull()
    const applied = applyPalacePracticeLiveView(
      {
        palaceId: 7,
        editorMode: 'edit',
        currentNodeUid: null,
        revealMap: null,
        redNodeIds: [],
      },
      remote!,
    )
    expect(applied.editorMode).toBe('recall')
    expect(applied.currentNodeUid).toBe('node-3')
    expect(applied.revealMap).toEqual({ root: 'revealed', 'node-3': 'placeholder' })
    expect(applied.redNodeIds).toEqual(['node-3'])
    expect(palacePracticeSameInteraction(remote!, applied)).toBe(true)
  })

  it('applies english course sentence progress without requiring keystrokes', () => {
    const remote = decodeEnglishCourseLiveView({
      courseId: 3,
      typingSentenceIndex: 4,
      translationSentenceIndex: 3,
      sentencePhase: 'locally_completed',
    })
    expect(remote).not.toBeNull()
    const applied = applyEnglishCourseLiveView(
      {
        courseId: 3,
        typingSentenceIndex: 0,
        translationSentenceIndex: null,
        sentencePhase: 'listening_wait_input',
      },
      remote!,
    )
    expect(applied.typingSentenceIndex).toBe(4)
    expect(applied.sentencePhase).toBe('locally_completed')
    expect(englishCourseSameInteraction(remote!, applied)).toBe(true)
    expect(resolveEnglishCourseProgressAfterLoad(
      3,
      { typingSentenceIndex: 0, translationSentenceIndex: null, sentencePhase: 'listening_wait_input' },
      remote,
    )).toEqual({
      typingSentenceIndex: 4,
      translationSentenceIndex: 3,
      sentencePhase: 'locally_completed',
    })
  })

  it('applies english reading current article and selected targets', () => {
    const remote = decodeEnglishReadingLiveView({
      articleId: 9,
      selectedIds: [1, 4],
      targetId: 4,
      quote: 'nevertheless',
    })
    expect(remote).not.toBeNull()
    const applied = applyEnglishReadingLiveView(
      { articleId: null, selectedIds: [], targetId: null, quote: null },
      remote!,
    )
    expect(applied.articleId).toBe(9)
    expect(applied.selectedIds).toEqual([1, 4])
    expect(applied.targetId).toBe(4)
    expect(applied.quote).toBe('nevertheless')
    expect(englishReadingSameInteraction(remote!, applied)).toBe(true)
    expect(shouldClearEnglishReadingSelection(9, remote)).toBe(false)
    expect(shouldClearEnglishReadingSelection(9, null)).toBe(true)
    expect(shouldPublishLiveStudyView({
      isActive: false,
      publishWhen: true,
      serialized: '{"articleId":9}',
      lastSent: '',
      isFollower: false,
      interactionUnchanged: false,
    })).toBe(false)
    const preApply = '{"palaceId":7,"questionId":null,"questionIndex":0}'
    const appliedRemote = '{"palaceId":7,"questionId":22,"questionIndex":1}'
    expect(isPendingLiveStudyApply({
      applyCommitted: true,
      serialized: preApply,
      lastSent: appliedRemote,
      interactionUnchanged: false,
    })).toBe(true)
    expect(shouldPublishLiveStudyView({
      isActive: true,
      publishWhen: true,
      serialized: preApply,
      lastSent: appliedRemote,
      isFollower: true,
      interactionUnchanged: false,
      pendingApply: true,
    })).toBe(false)
  })
})
