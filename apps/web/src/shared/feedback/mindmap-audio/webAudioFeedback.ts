import { REVIEW_FEEDBACK_EFFECTIVE_VOLUME_MAX } from '@/shared/feedback/reviewFeedbackSettings'
import type { MindMapFeedbackEvent, MindMapFeedbackOrigin } from '@/shared/feedback/feedbackEvents'
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

const noiseBuffers = new WeakMap<AudioContext, AudioBuffer>()

function getNoiseBuffer(context: AudioContext) {
  const cached = noiseBuffers.get(context)
  if (cached) return cached
  const length = Math.floor(context.sampleRate * 0.25)
  const buffer = context.createBuffer(1, length, context.sampleRate)
  const data = buffer.getChannelData(0)
  for (let index = 0; index < length; index += 1) data[index] = Math.random() * 2 - 1
  noiseBuffers.set(context, buffer)
  return buffer
}

function scheduleNoiseSwipe(
  context: AudioContext,
  args: { startAt: number; durationS: number; fromHz: number; toHz: number; q: number; gain: number },
) {
  const source = context.createBufferSource()
  source.buffer = getNoiseBuffer(context)
  source.playbackRate.value = 0.9 + Math.random() * 0.2
  const band = context.createBiquadFilter()
  band.type = 'bandpass'
  band.Q.value = args.q
  band.frequency.setValueAtTime(args.fromHz, args.startAt)
  band.frequency.exponentialRampToValueAtTime(args.toHz, args.startAt + args.durationS)
  const envelope = context.createGain()
  envelope.gain.setValueAtTime(0.0001, args.startAt)
  envelope.gain.linearRampToValueAtTime(args.gain, args.startAt + Math.min(0.012, args.durationS * 0.2))
  envelope.gain.exponentialRampToValueAtTime(0.0001, args.startAt + args.durationS)
  source.connect(band)
  band.connect(envelope)
  envelope.connect(context.destination)
  source.start(args.startAt, Math.random() * 0.1)
  source.stop(args.startAt + args.durationS + 0.02)
}

/** Soft paper swipe for feed page turns; synthesized, no assets. */
export function playWebAudioPageTurn(args: { volume?: number; direction?: 'forward' | 'backward' }) {
  const feedbackVolume = clampFeedbackVolume(args.volume ?? 1)
  if (feedbackVolume <= 0) return
  const context = getSharedAudioContext()
  if (!context || typeof context.createBufferSource !== 'function') return
  if (context.state === 'suspended') void context.resume().catch(() => undefined)
  const now = context.currentTime + 0.004
  const jitter = 0.92 + Math.random() * 0.16
  const [fromHz, toHz] = args.direction === 'backward' ? [1400, 3600] : [3800, 1300]
  scheduleNoiseSwipe(context, {
    startAt: now,
    durationS: 0.11 * jitter,
    fromHz: fromHz * jitter,
    toHz: toHz * jitter,
    q: 0.9,
    gain: 0.05 * feedbackVolume,
  })
  // Edge flick: a very short high tick at the end of the swipe.
  scheduleNoiseSwipe(context, {
    startAt: now + 0.075 * jitter,
    durationS: 0.03,
    fromHz: 6200,
    toHz: 4800,
    q: 2.4,
    gain: 0.022 * feedbackVolume,
  })
}

export function __resetWebAudioContextForTests() {
  sharedAudioContext = null
}
