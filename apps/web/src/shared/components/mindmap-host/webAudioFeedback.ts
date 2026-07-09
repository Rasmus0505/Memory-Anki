import { REVIEW_FEEDBACK_EFFECTIVE_VOLUME_MAX } from '@/shared/feedback/reviewFeedbackSettings'
import type { MindMapFeedbackEvent, MindMapFeedbackOrigin } from '@/shared/components/mindmap-host/hostBridgeUtils'
import {
  getComboMilestoneTone,
  getFireworkAccentTones,
  getToneSpec,
  type ToneSpec,
} from './toneProfiles'

let sharedAudioContext: AudioContext | null = null

function resolveAudioContextConstructor() {
  if (typeof window === 'undefined') return null
  return window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ?? null
}

function unlockAudioContextForIosSafariGesture() {
  let context = sharedAudioContext
  if (!context) {
    const AudioContextCtor = resolveAudioContextConstructor()
    if (AudioContextCtor) {
      context = new AudioContextCtor()
      sharedAudioContext = context
    }
  }
  if (context && context.state !== 'running') {
    void context.resume().catch(() => undefined)
  }
}

if (typeof document !== 'undefined') {
  // iOS Safari PWA only allows AudioContext.resume() from a user gesture stack.
  const unlockEvents = ['touchstart', 'pointerdown', 'click'] as const
  for (const eventName of unlockEvents) {
    document.addEventListener(eventName, unlockAudioContextForIosSafariGesture, {
      passive: true,
      capture: true,
    })
  }

  document.addEventListener('visibilitychange', () => {
    // Returning from background can suspend Web Audio again in iOS Safari.
    if (document.visibilityState === 'visible' && sharedAudioContext) {
      void sharedAudioContext.resume().catch(() => undefined)
    }
  })
}

function getSharedAudioContext() {
  const AudioContextCtor = resolveAudioContextConstructor()
  if (!AudioContextCtor) return null
  if (!sharedAudioContext) {
    sharedAudioContext = new AudioContextCtor()
  }
  return sharedAudioContext
}

function clampFeedbackVolume(value: number) {
  if (!Number.isFinite(value)) return 1
  return Math.max(0, Math.min(REVIEW_FEEDBACK_EFFECTIVE_VOLUME_MAX, value))
}

export function tuneToneSpec(
  event: MindMapFeedbackEvent,
  tone: ToneSpec,
  origin?: MindMapFeedbackOrigin,
  audioScope?: 'local' | 'global',
): ToneSpec {
  const isMicro = event === 'pointer_click' || event === 'pointer_down' || event === 'key_press'
  let durationMs = tone.durationMs
  let gain = tone.gain * (isMicro ? 0.72 : 1)
  let pan = tone.pan ?? 0

  if (audioScope === 'local') {
    durationMs = Math.round(durationMs * 0.9)
    gain *= 0.94
    pan *= 0.72
  } else if (audioScope === 'global') {
    durationMs = Math.round(durationMs * 1.12)
    gain *= 1.08
    pan *= 1.28
  }

  if (origin === 'review') {
    gain *= 1.06
    pan *= 0.72
  } else if (origin === 'system') {
    gain *= 1.04
  }

  return {
    ...tone,
    durationMs: Math.max(18, durationMs),
    gain,
    pan: Math.max(-1, Math.min(1, pan)),
  }
}

function scheduleTonePlayback(context: AudioContext, tone: ToneSpec, volume: number) {
  const oscillator = context.createOscillator()
  const gainNode = context.createGain()
  const startAt = context.currentTime + tone.offsetMs / 1000
  const attackSeconds = Math.max(0.002, (tone.attackMs ?? 4) / 1000)
  const durationSeconds = Math.max(0.018, tone.durationMs / 1000)
  const releaseSeconds = Math.min(0.08, Math.max(0.012, durationSeconds * 0.32))
  const endAt = startAt + durationSeconds
  const stopAt = endAt + releaseSeconds + 0.02

  oscillator.type = tone.type
  oscillator.frequency.setValueAtTime(tone.frequency, startAt)
  if (typeof tone.endFrequency === 'number' && Number.isFinite(tone.endFrequency)) {
    oscillator.frequency.linearRampToValueAtTime(tone.endFrequency, endAt)
  }

  const peakGain = Math.max(0, tone.gain * volume)
  gainNode.gain.setValueAtTime(0.0001, startAt)
  gainNode.gain.linearRampToValueAtTime(peakGain, startAt + attackSeconds)
  gainNode.gain.exponentialRampToValueAtTime(
    Math.max(0.0001, peakGain * 0.85),
    startAt + Math.max(attackSeconds, durationSeconds * 0.45),
  )
  gainNode.gain.exponentialRampToValueAtTime(0.0001, endAt + releaseSeconds)

  const stereoFactory = (context as AudioContext & { createStereoPanner?: () => StereoPannerNode }).createStereoPanner
  if (typeof stereoFactory === 'function') {
    const panner = stereoFactory.call(context)
    panner.pan.setValueAtTime(tone.pan ?? 0, startAt)
    oscillator.connect(gainNode)
    gainNode.connect(panner)
    panner.connect(context.destination)
  } else {
    oscillator.connect(gainNode)
    gainNode.connect(context.destination)
  }

  oscillator.start(startAt)
  oscillator.stop(stopAt)
}

function playToneSequence(tones: ToneSpec[], volume: number) {
  const context = getSharedAudioContext()
  if (!context) return

  if (context.state === 'suspended') {
    void context.resume().catch(() => undefined)
  }

  for (const tone of tones) {
    scheduleTonePlayback(context, tone, volume)
  }
}

export function playWebAudioFeedbackEvent(args: {
  event: MindMapFeedbackEvent
  surprise?: boolean
  origin?: MindMapFeedbackOrigin
  audioScope?: 'local' | 'global'
  volume?: number
}) {
  const { event, surprise = false, origin, audioScope, volume = 1 } = args
  const feedbackVolume = clampFeedbackVolume(volume)
  if (feedbackVolume <= 0) return
  const tones = getToneSpec(event, surprise).map((tone) =>
    tuneToneSpec(event, tone, origin, audioScope),
  )
  playToneSequence(tones, feedbackVolume)
}

export function playWebAudioComboMilestone(args: {
  milestoneStep: number
  volume?: number
}) {
  const { milestoneStep, volume = 1 } = args
  const feedbackVolume = clampFeedbackVolume(volume)
  if (feedbackVolume <= 0) return
  playToneSequence(getComboMilestoneTone(milestoneStep), feedbackVolume)
}

export function playWebAudioFireworkAccent(args: {
  kind: 'milestone' | 'branch_clear' | 'all_clear_ready' | 'session_complete'
  milestoneStep?: number | null
  volume?: number
}) {
  const { kind, milestoneStep = 0, volume = 1 } = args
  const feedbackVolume = clampFeedbackVolume(volume)
  if (feedbackVolume <= 0) return
  playToneSequence(getFireworkAccentTones(kind, milestoneStep ?? 0), feedbackVolume)
}

export function __resetWebAudioContextForTests() {
  sharedAudioContext = null
}
