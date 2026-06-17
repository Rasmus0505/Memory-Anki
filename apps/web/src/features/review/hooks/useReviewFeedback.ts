import * as React from 'react'
import {
  createInitialReviewRewardSnapshot,
  deriveReviewFeedbackTransition,
  getReviewComboMilestones,
  getReviewMilestoneLabel,
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
  type ReviewCelebrationEventSettings,
  type ReviewMilestoneCelebrationSettings,
  type ReviewFeedbackSettings,
} from '@/shared/feedback/reviewFeedbackSettings'
import { emitReviewConfetti } from '@/shared/components/celebration'
import type { MindMapReviewFxPayload } from '@/shared/components/mindmap-host/hostBridgeUtils'
import type {
  RevealFlowMode,
  ReviewMindMapNode,
} from '@/entities/review/model/review-flow-tree'
import type { RevealState } from '@/entities/session/model'
import { useMindMapFeedbackAudio } from '@/shared/components/mindmap-host/useMindMapFeedback'

const FLASH_RESET_MS = 680
const CELEBRATION_EVENT_KEYS = ['milestone', 'branch_clear', 'all_clear_ready', 'session_complete'] as const

type CelebrationEventKey = (typeof CELEBRATION_EVENT_KEYS)[number]
type CooldownCelebrationConfig = ReviewMilestoneCelebrationSettings | ReviewCelebrationEventSettings

interface CelebrationDecision {
  allowed: boolean
  soundEnabled: boolean
  animationEnabled: boolean
}

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
  event?: ReviewFeedbackEvent
  revealFxIntensity: ReviewFeedbackSettings['revealFxIntensity']
  criticalFxIntensity: ReviewFeedbackSettings['criticalFxIntensity']
}): MindMapReviewFxPayload['intensity'] {
  if (args.reducedMotion) return 'none'
  if (args.mode === 'quiet' || !args.animationEnabled) return 'soft'
  if (
    args.event === 'branch_clear' ||
    args.event === 'all_clear_ready' ||
    args.event === 'session_complete'
  ) {
    return args.criticalFxIntensity === 'cinematic' ? 'full' : 'soft'
  }
  if (args.event === 'card_reveal') {
    return args.revealFxIntensity === 'full' ? 'full' : 'soft'
  }
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
  const milestoneSteps = settings.celebration.milestone.steps
  const [nextMilestone, setNextMilestone] = React.useState<number | null>(
    getReviewComboMilestones(milestoneSteps)[0] ?? null,
  )
  const [milestoneLabel, setMilestoneLabel] = React.useState<string | null>(
    getReviewMilestoneLabel(milestoneSteps, getReviewComboMilestones(milestoneSteps)[0] ?? null),
  )
  const [allClearReady, setAllClearReady] = React.useState(false)
  const [feedbackFlashState, setFeedbackFlashState] =
    React.useState<ReviewFeedbackFlashState>('idle')
  const [surpriseText, setSurpriseText] = React.useState<string | null>(null)
  const [completionCeremonyActive, setCompletionCeremonyActive] = React.useState(false)
  const [reviewFxSignal, setReviewFxSignal] = React.useState<MindMapReviewFxPayload | null>(null)
  const [milestoneCelebration, setMilestoneCelebration] = React.useState<{
    comboCount: number
    milestoneStep: number
    nonce: number
  } | null>(null)

  const reducedMotion = usePrefersReducedMotion()
  const audio = useMindMapFeedbackAudio(
    settings.soundEnabled && settings.mode === 'immersive',
    settings.volume,
  )
  const rewardSnapshotRef = React.useRef(createInitialReviewRewardSnapshot(milestoneSteps))
  const previousRevealMapRef = React.useRef<Record<string, RevealState>>(revealMap)
  const previousComboCountRef = React.useRef(0)
  const lastSurpriseAtMsRef = React.useRef<number | null>(null)
  const lastCelebrationAtMsRef = React.useRef<number | null>(null)
  const lastCelebrationByKindRef = React.useRef<Record<CelebrationEventKey, number | null>>({
    milestone: null,
    branch_clear: null,
    all_clear_ready: null,
    session_complete: null,
  })
  const completionTimerRef = React.useRef<number | null>(null)
  const flashTimerRef = React.useRef<number | null>(null)
  const reviewFxNonceRef = React.useRef(0)
  const milestoneCelebrationNonceRef = React.useRef(0)

  const getCelebrationDecision = React.useCallback(
    (
      kind: CelebrationEventKey,
      nowMs: number,
      options?: {
        ignoreCooldown?: boolean
      },
    ): CelebrationDecision => {
      const ignoreCooldown = options?.ignoreCooldown ?? false
      if (settings.mode !== 'immersive') {
        return { allowed: false, soundEnabled: false, animationEnabled: false }
      }

      const eventConfig =
        kind === 'milestone'
          ? settings.celebration.milestone
          : kind === 'branch_clear'
            ? settings.celebration.branchClear
            : kind === 'all_clear_ready'
              ? settings.celebration.allClearReady
              : settings.celebration.sessionComplete
      if (!eventConfig.enabled) {
        return { allowed: false, soundEnabled: false, animationEnabled: false }
      }

      const lastGlobalAtMs = lastCelebrationAtMsRef.current
      const lastEventAtMs = lastCelebrationByKindRef.current[kind]
      const globalReady =
        ignoreCooldown ||
        lastGlobalAtMs == null ||
        nowMs - lastGlobalAtMs >= settings.celebration.globalCooldownMs
      const eventCooldownMs =
        kind === 'session_complete'
          ? 0
          : (eventConfig as CooldownCelebrationConfig).cooldownMs
      const eventReady =
        ignoreCooldown ||
        lastEventAtMs == null ||
        nowMs - lastEventAtMs >= eventCooldownMs

      if (!globalReady || !eventReady) {
        return { allowed: false, soundEnabled: false, animationEnabled: false }
      }

      lastCelebrationAtMsRef.current = nowMs
      lastCelebrationByKindRef.current[kind] = nowMs
      return {
        allowed: true,
        soundEnabled: eventConfig.soundEnabled && settings.soundEnabled,
        animationEnabled: eventConfig.animationEnabled && settings.animationEnabled && !reducedMotion,
      }
    },
    [
      reducedMotion,
      settings.animationEnabled,
      settings.celebration.allClearReady,
      settings.celebration.branchClear,
      settings.celebration.globalCooldownMs,
      settings.celebration.milestone,
      settings.celebration.sessionComplete,
      settings.mode,
      settings.soundEnabled,
    ],
  )

  React.useEffect(() => {
    rewardSnapshotRef.current = createInitialReviewRewardSnapshot(milestoneSteps)
    previousComboCountRef.current = 0
    setComboCount(0)
    setMaxComboCount(0)
    setNextMilestone(getReviewComboMilestones(milestoneSteps)[0] ?? null)
    setMilestoneLabel(
      getReviewMilestoneLabel(milestoneSteps, getReviewComboMilestones(milestoneSteps)[0] ?? null),
    )
    setAllClearReady(false)
    setSurpriseText(null)
    setMilestoneCelebration(null)
    lastSurpriseAtMsRef.current = null
    lastCelebrationAtMsRef.current = null
    lastCelebrationByKindRef.current = {
      milestone: null,
      branch_clear: null,
      all_clear_ready: null,
      session_complete: null,
    }
  }, [milestoneSteps])

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
      milestoneSteps,
    })
    rewardSnapshotRef.current = nextRewardSnapshot
    const prevCombo = previousComboCountRef.current
    previousComboCountRef.current = nextRewardSnapshot.comboCount
    setComboCount(nextRewardSnapshot.comboCount)
    setMaxComboCount(nextRewardSnapshot.maxComboCount)
    setNextMilestone(nextRewardSnapshot.nextMilestone)
    setMilestoneLabel(getReviewMilestoneLabel(milestoneSteps, nextRewardSnapshot.nextMilestone))
    setAllClearReady(nextRewardSnapshot.allClearReady)

    // 连击里程碑音效：combo 恰好达到里程碑值时播放升调音
    const newCombo = nextRewardSnapshot.comboCount
    const milestoneIndex = getReviewComboMilestones(milestoneSteps).indexOf(newCombo)
    const nowMs = Date.now()
    const milestoneCelebrationDecision =
      milestoneIndex !== -1 && newCombo > prevCombo
        ? getCelebrationDecision('milestone', nowMs)
        : { allowed: false, soundEnabled: false, animationEnabled: false }
    if (milestoneIndex !== -1 && newCombo > prevCombo && milestoneCelebrationDecision.soundEnabled) {
      audio.playComboMilestone(milestoneIndex)
    }
    if (milestoneIndex !== -1 && newCombo > prevCombo && milestoneCelebrationDecision.animationEnabled) {
      milestoneCelebrationNonceRef.current += 1
      setMilestoneCelebration({
        comboCount: newCombo,
        milestoneStep: milestoneIndex,
        nonce: milestoneCelebrationNonceRef.current,
      })
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

    const surpriseEnabled =
      settings.mode === 'immersive' && settings.surpriseEnabled && !reducedMotion
    const surprise = shouldEmitSurprise({
      comboCount: nextRewardSnapshot.comboCount,
      surpriseEnabled,
      nowMs,
      lastSurpriseAtMs: lastSurpriseAtMsRef.current,
      milestoneSteps,
    })
    if (surprise) {
      lastSurpriseAtMsRef.current = nowMs
      setSurpriseText(getReviewSurpriseCopy(nextRewardSnapshot.comboCount, milestoneSteps))
    } else if (transition.events.includes('all_clear_ready')) {
      setSurpriseText('整张宫殿已经亮起来了。')
    }

    for (const event of transition.events) {
      if (
        event === 'branch_clear' &&
        !settings.celebration.branchClear.soundEnabled
      ) {
        continue
      }
      if (
        event === 'all_clear_ready' &&
        !settings.celebration.allClearReady.soundEnabled
      ) {
        continue
      }
      audio.playEvent(event, { surprise })
    }

    if (settings.mode === 'immersive' && settings.animationEnabled && !reducedMotion) {
      if (milestoneIndex !== -1 && newCombo > prevCombo) {
        // 里程碑彩带由 ComboMilestoneBurst 组件负责，避免重复喷发。
      } else if (transition.events.includes('branch_clear')) {
        const celebrationDecision = getCelebrationDecision('branch_clear', nowMs)
        if (!celebrationDecision.allowed) {
          // noop
        } else {
        emitReviewConfetti({
          kind: 'branch_clear',
          reducedMotion,
          criticalFxIntensity: settings.criticalFxIntensity,
          soundEnabled: celebrationDecision.soundEnabled,
          volume: settings.volume,
          confettiAmount: settings.celebration.branchClear.confettiAmount,
        })
        }
      } else if (transition.events.includes('all_clear_ready')) {
        const celebrationDecision = getCelebrationDecision('all_clear_ready', nowMs)
        if (!celebrationDecision.allowed) {
          // noop
        } else {
        emitReviewConfetti({
          kind: 'all_clear_ready',
          reducedMotion,
          criticalFxIntensity: settings.criticalFxIntensity,
          soundEnabled: celebrationDecision.soundEnabled,
          volume: settings.volume,
          confettiAmount: settings.celebration.allClearReady.confettiAmount,
        })
        }
      }
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
          event: fxEvent,
          revealFxIntensity: settings.revealFxIntensity,
          criticalFxIntensity: settings.criticalFxIntensity,
        }),
        milestoneStep: milestoneIndex !== -1 && newCombo > prevCombo ? milestoneIndex : null,
        anchor: transition.fxAnchor,
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
  }, [
    audio,
    reducedMotion,
    revealMap,
    revealMode,
    root,
    settings.animationEnabled,
    settings.celebration.allClearReady,
    settings.celebration.branchClear,
    settings.celebration.milestone,
    settings.celebration.sessionComplete,
    settings.criticalFxIntensity,
    settings.mode,
    settings.revealFxIntensity,
    settings.surpriseEnabled,
    settings.soundEnabled,
    settings.volume,
    milestoneSteps,
    getCelebrationDecision,
  ])

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
        rewardSnapshotRef.current = resetReviewRewardState(milestoneSteps)
        previousComboCountRef.current = 0
        setComboCount(0)
        setMaxComboCount(0)
        setNextMilestone(getReviewComboMilestones(milestoneSteps)[0] ?? null)
        setMilestoneLabel(
          getReviewMilestoneLabel(
            milestoneSteps,
            getReviewComboMilestones(milestoneSteps)[0] ?? null,
          ),
        )
        setAllClearReady(false)
        setSurpriseText(null)
        setMilestoneCelebration(null)
      }
      if (
        event === 'session_complete' &&
        settings.animationEnabled &&
        settings.celebration.sessionComplete.enabled &&
        settings.celebration.sessionComplete.animationEnabled &&
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
      if (
        event === 'session_reset' ||
        (
          event === 'session_complete' &&
          settings.celebration.sessionComplete.enabled &&
          settings.celebration.sessionComplete.animationEnabled
        )
      ) {
        reviewFxNonceRef.current += 1
        setReviewFxSignal({
          type: event,
          nodeUid: null,
          relatedNodeUids: [],
          intensity: deriveFxIntensity({
            mode: settings.mode,
            animationEnabled: settings.animationEnabled,
            reducedMotion,
            event,
            revealFxIntensity: settings.revealFxIntensity,
            criticalFxIntensity: settings.criticalFxIntensity,
          }),
          milestoneStep: null,
          anchor: event === 'session_complete' ? { x: 0.5, y: 0.24 } : null,
          nonce: reviewFxNonceRef.current,
        })
      }
      if (
        event !== 'session_complete' ||
        (
          settings.celebration.sessionComplete.enabled &&
          settings.celebration.sessionComplete.soundEnabled
        )
      ) {
        audio.playEvent(event)
      }
    },
    [
      audio,
      milestoneSteps,
      reducedMotion,
      settings.animationEnabled,
      settings.celebration.sessionComplete.animationEnabled,
      settings.celebration.sessionComplete.enabled,
      settings.celebration.sessionComplete.soundEnabled,
      settings.criticalFxIntensity,
      settings.mode,
      settings.revealFxIntensity,
    ],
  )

  const runCompletionCeremony = React.useCallback(async () => {
    const nowMs = Date.now()
    const celebrationDecision = getCelebrationDecision('session_complete', nowMs, {
      ignoreCooldown: true,
    })
    emitManualEvent('session_complete')
    if (celebrationDecision.animationEnabled) {
      setCompletionCeremonyActive(true)
    }
    if (completionTimerRef.current != null) {
      window.clearTimeout(completionTimerRef.current)
    }
    await new Promise<void>((resolve) => {
      completionTimerRef.current = window.setTimeout(() => {
        completionTimerRef.current = null
        setCompletionCeremonyActive(false)
        resolve()
      }, reducedMotion || !celebrationDecision.animationEnabled ? 120 : 820)
    })
  }, [emitManualEvent, getCelebrationDecision, reducedMotion])

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
    milestoneLabel,
    allClearReady,
    feedbackFlashState,
    progressPercent,
    progressTone,
    surpriseText,
    completionCeremonyActive,
    animationEnabled,
    soundEnabled: settings.mode === 'immersive' && settings.soundEnabled,
    milestoneCelebration,
    reviewFxSignal,
    emitManualEvent,
    runCompletionCeremony,
  }
}
