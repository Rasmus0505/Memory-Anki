import * as React from 'react'
import {
  REVIEW_COMBO_MILESTONES,
  createInitialReviewRewardSnapshot,
  deriveReviewFeedbackTransition,
  getReviewProgressPercent,
  getReviewProgressTone,
  getReviewSurpriseCopy,
  progressReviewRewardState,
  resetReviewRewardState,
  shouldEmitSurprise,
  type ReviewFeedbackEvent,
  type ReviewFeedbackFlashState,
} from '@/features/review/model/review-feedback'
import {
  REVIEW_FEEDBACK_SETTINGS_UPDATED_EVENT,
  readReviewFeedbackSettings,
  writeReviewFeedbackSettings,
  type ReviewFeedbackSettings,
} from '@/features/review/reviewFeedbackSettings'
import type { MindMapReviewFxPayload } from '@/shared/components/mindmap-host/hostBridgeUtils'
import type {
  RevealFlowMode,
  ReviewMindMapNode,
} from '@/entities/review/model/review-flow-tree'
import type { RevealState } from '@/entities/session/model'
import { useMindMapFeedbackAudio } from '@/shared/components/mindmap-host/useMindMapFeedback'

const FLASH_RESET_MS = 680

interface UseReviewFeedbackOptions {
  root: ReviewMindMapNode
  revealMap: Record<string, RevealState>
  revealedNonRootCount: number
  totalNodeCount: number
  revealMode?: RevealFlowMode
}

function deriveFxIntensity(args: {
  mode: ReviewFeedbackSettings['mode']
  animationEnabled: boolean
  reducedMotion: boolean
}): MindMapReviewFxPayload['intensity'] {
  if (args.reducedMotion) return 'none'
  if (args.mode === 'quiet' || !args.animationEnabled) return 'soft'
  return 'full'
}

export function usePrefersReducedMotion() {
  const [reducedMotion, setReducedMotion] = React.useState(false)

  React.useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setReducedMotion(mediaQuery.matches)
    sync()
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', sync)
      return () => mediaQuery.removeEventListener('change', sync)
    }
    mediaQuery.addListener(sync)
    return () => mediaQuery.removeListener(sync)
  }, [])

  return reducedMotion
}

export function useReviewFeedback({
  root,
  revealMap,
  revealedNonRootCount,
  totalNodeCount,
  revealMode = 'standard',
}: UseReviewFeedbackOptions) {
  const [settings, setSettings] = React.useState<ReviewFeedbackSettings>(() =>
    readReviewFeedbackSettings(),
  )
  const [comboCount, setComboCount] = React.useState(0)
  const [maxComboCount, setMaxComboCount] = React.useState(0)
  const [nextMilestone, setNextMilestone] = React.useState<number | null>(3)
  const [allClearReady, setAllClearReady] = React.useState(false)
  const [feedbackFlashState, setFeedbackFlashState] =
    React.useState<ReviewFeedbackFlashState>('idle')
  const [surpriseText, setSurpriseText] = React.useState<string | null>(null)
  const [completionCeremonyActive, setCompletionCeremonyActive] = React.useState(false)
  const [reviewFxSignal, setReviewFxSignal] = React.useState<MindMapReviewFxPayload | null>(null)

  const reducedMotion = usePrefersReducedMotion()
  const audio = useMindMapFeedbackAudio(
    settings.soundEnabled && settings.mode === 'immersive',
    settings.volume,
  )
  const rewardSnapshotRef = React.useRef(createInitialReviewRewardSnapshot())
  const previousRevealMapRef = React.useRef<Record<string, RevealState>>(revealMap)
  const previousComboCountRef = React.useRef(0)
  const lastSurpriseAtMsRef = React.useRef<number | null>(null)
  const completionTimerRef = React.useRef<number | null>(null)
  const flashTimerRef = React.useRef<number | null>(null)
  const reviewFxNonceRef = React.useRef(0)

  React.useEffect(() => {
    const sync = () => setSettings(readReviewFeedbackSettings())
    window.addEventListener(REVIEW_FEEDBACK_SETTINGS_UPDATED_EVENT, sync)
    return () => window.removeEventListener(REVIEW_FEEDBACK_SETTINGS_UPDATED_EVENT, sync)
  }, [])

  React.useEffect(() => {
    return () => {
      if (flashTimerRef.current != null) {
        window.clearTimeout(flashTimerRef.current)
      }
      if (completionTimerRef.current != null) {
        window.clearTimeout(completionTimerRef.current)
      }
    }
  }, [])

  React.useEffect(() => {
    const previousRevealMap = previousRevealMapRef.current
    previousRevealMapRef.current = revealMap

    const transition = deriveReviewFeedbackTransition({
      previousRevealMap,
      nextRevealMap: revealMap,
      root,
      revealMode,
    })
    if (transition.events.length === 0) {
      setAllClearReady(transition.allClearReady)
      rewardSnapshotRef.current = {
        ...rewardSnapshotRef.current,
        allClearReady: transition.allClearReady,
      }
      return
    }

    const nextRewardSnapshot = progressReviewRewardState({
      current: rewardSnapshotRef.current,
      transition,
    })
    rewardSnapshotRef.current = nextRewardSnapshot
    const prevCombo = previousComboCountRef.current
    previousComboCountRef.current = nextRewardSnapshot.comboCount
    setComboCount(nextRewardSnapshot.comboCount)
    setMaxComboCount(nextRewardSnapshot.maxComboCount)
    setNextMilestone(nextRewardSnapshot.nextMilestone)
    setAllClearReady(nextRewardSnapshot.allClearReady)

    // 连击里程碑音效：combo 恰好达到里程碑值时播放升调音
    const newCombo = nextRewardSnapshot.comboCount
    const milestoneIndex = REVIEW_COMBO_MILESTONES.indexOf(newCombo)
    if (milestoneIndex !== -1 && newCombo > prevCombo) {
      audio.playComboMilestone(milestoneIndex)
    }

    const nextFlashState =
      settings.animationEnabled && !reducedMotion
        ? nextRewardSnapshot.feedbackFlashState
        : 'idle'
    setFeedbackFlashState(nextFlashState)
    if (flashTimerRef.current != null) {
      window.clearTimeout(flashTimerRef.current)
    }
    if (nextFlashState !== 'idle') {
      flashTimerRef.current = window.setTimeout(() => {
        flashTimerRef.current = null
        setFeedbackFlashState('idle')
      }, FLASH_RESET_MS)
    }

    const nowMs = Date.now()
    const surpriseEnabled =
      settings.mode === 'immersive' && settings.surpriseEnabled && !reducedMotion
    const surprise = shouldEmitSurprise({
      comboCount: nextRewardSnapshot.comboCount,
      surpriseEnabled,
      nowMs,
      lastSurpriseAtMs: lastSurpriseAtMsRef.current,
    })
    if (surprise) {
      lastSurpriseAtMsRef.current = nowMs
      setSurpriseText(getReviewSurpriseCopy(nextRewardSnapshot.comboCount))
    } else if (transition.events.includes('all_clear_ready')) {
      setSurpriseText('整张宫殿已经亮起来了。')
    }

    for (const event of transition.events) {
      audio.playEvent(event, { surprise })
    }

    const fxEvent = transition.events.find((event) =>
      event === 'category_expand' ||
      event === 'next_level_expand' ||
      event === 'card_reveal' ||
      event === 'branch_clear' ||
      event === 'all_clear_ready',
    )
    if (fxEvent) {
      reviewFxNonceRef.current += 1
      setReviewFxSignal({
        type: fxEvent,
        nodeUid: transition.primaryNodeId,
        relatedNodeUids:
          fxEvent === 'branch_clear'
            ? transition.branchClearNodeIds
            : fxEvent === 'category_expand' || fxEvent === 'next_level_expand'
              ? transition.expandedNodeIds
            : fxEvent === 'all_clear_ready'
              ? transition.revealedNodeIds
              : transition.revealedNodeIds.slice(-1),
        intensity: deriveFxIntensity({
          mode: settings.mode,
          animationEnabled: settings.animationEnabled,
          reducedMotion,
        }),
        lineMode:
          fxEvent === 'category_expand' || fxEvent === 'next_level_expand'
            ? 'spawn'
            : fxEvent === 'card_reveal'
              ? 'confirm'
              : fxEvent === 'branch_clear'
                ? 'clear'
                : 'trace',
        depthHint: transition.depthHint,
        targetRole:
          fxEvent === 'card_reveal'
            ? 'placeholder'
            : fxEvent === 'branch_clear'
              ? 'revealed'
              : 'parent',
        isBranchCompletion: fxEvent === 'branch_clear',
        nonce: reviewFxNonceRef.current,
      })
    }
  }, [audio, reducedMotion, revealMap, revealMode, root, settings.animationEnabled, settings.mode, settings.surpriseEnabled])

  const updateSettings = React.useCallback(
    (
      nextSettings:
        | ReviewFeedbackSettings
        | ((current: ReviewFeedbackSettings) => ReviewFeedbackSettings),
    ) => {
      setSettings((current) => {
        const candidate =
          typeof nextSettings === 'function' ? nextSettings(current) : nextSettings
        return writeReviewFeedbackSettings(candidate)
      })
    },
    [],
  )

  const toggleMode = React.useCallback(() => {
    updateSettings((current) => ({
      ...current,
      mode: current.mode === 'immersive' ? 'quiet' : 'immersive',
    }))
  }, [updateSettings])

  const emitManualEvent = React.useCallback(
    (event: ReviewFeedbackEvent) => {
      if (event === 'session_reset') {
        rewardSnapshotRef.current = resetReviewRewardState()
        previousComboCountRef.current = 0
        setComboCount(0)
        setMaxComboCount(0)
        setNextMilestone(3)
        setAllClearReady(false)
        setSurpriseText(null)
      }
      if (
        event === 'session_complete' &&
        settings.animationEnabled &&
        !reducedMotion
      ) {
        setFeedbackFlashState('session_complete')
      } else if (
        event === 'session_reset' &&
        settings.animationEnabled &&
        !reducedMotion
      ) {
        setFeedbackFlashState('session_reset')
      }
      if (event === 'session_complete' || event === 'session_reset') {
        reviewFxNonceRef.current += 1
        setReviewFxSignal({
          type: event,
          nodeUid: null,
          relatedNodeUids: [],
          intensity: deriveFxIntensity({
            mode: settings.mode,
            animationEnabled: settings.animationEnabled,
            reducedMotion,
          }),
          nonce: reviewFxNonceRef.current,
        })
      }
      audio.playEvent(event)
    },
    [audio, reducedMotion, settings.animationEnabled, settings.mode],
  )

  const runCompletionCeremony = React.useCallback(async () => {
    emitManualEvent('session_complete')
    setCompletionCeremonyActive(true)
    if (completionTimerRef.current != null) {
      window.clearTimeout(completionTimerRef.current)
    }
    await new Promise<void>((resolve) => {
      completionTimerRef.current = window.setTimeout(() => {
        completionTimerRef.current = null
        setCompletionCeremonyActive(false)
        resolve()
      }, reducedMotion ? 120 : 820)
    })
  }, [emitManualEvent, reducedMotion])

  const progressPercent = getReviewProgressPercent(
    allClearReady,
    revealedNonRootCount,
    Math.max(totalNodeCount - 1, 0),
  )
  const progressTone = getReviewProgressTone(progressPercent)
  const animationEnabled =
    settings.mode === 'immersive' && settings.animationEnabled && !reducedMotion

  return {
    settings,
    updateSettings,
    toggleMode,
    comboCount,
    maxComboCount,
    nextMilestone,
    allClearReady,
    feedbackFlashState,
    progressPercent,
    progressTone,
    surpriseText,
    completionCeremonyActive,
    animationEnabled,
    soundEnabled: settings.mode === 'immersive' && settings.soundEnabled,
    reviewFxSignal,
    emitManualEvent,
    runCompletionCeremony,
  }
}
