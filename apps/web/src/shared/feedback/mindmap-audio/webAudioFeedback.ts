import {
  REVIEW_FEEDBACK_EFFECTIVE_VOLUME_MAX,
  getReviewFeedbackEffectiveVolume,
  readReviewFeedbackSettings,
} from '@/shared/feedback/reviewFeedbackSettings'
import type { MindMapFeedbackEvent, MindMapFeedbackOrigin } from '@/shared/feedback/feedbackEvents'
import { buildLayeredPops, type PopRole } from './layeredPops'
import { pickConcreteVoice, type SoundVoiceId } from './soundVoices'
import { renderVoicedTone, sequencePeaks } from './voiceSynth'
import {
  getComboMilestoneTone,
  getLandingChimeTone,
  getFireworkAccentTones,
  getToneSpec,
  type ToneSpec,
} from './toneProfiles'

let sharedAudioContext: AudioContext | null = null

/** A sound queued before the context is running is dropped after this. */
const PENDING_SOUND_MAX_AGE_MS = 450
/** Keep short tones off a currentTime that WebKit has already consumed. */
const AUDIO_SCHEDULE_LEAD_S = 0.03

type PendingSound = {
  at: number
  play: (context: AudioContext) => void
}

let pendingSound: PendingSound | null = null
let stateListenerContext: AudioContext | null = null

function resolveAudioContextConstructor() {
  if (typeof window === 'undefined') return null
  return window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ?? null
}

function isAudible(context: AudioContext) {
  return context.state === 'running'
}

function flushPendingSound(context: AudioContext) {
  const pending = pendingSound
  if (!pending || !isAudible(context)) return
  pendingSound = null
  if (Date.now() - pending.at > PENDING_SOUND_MAX_AGE_MS) return
  try {
    pending.play(context)
  } catch {
    // Audio must never break the interaction that triggered it.
  }
}

function attachStateListener(context: AudioContext) {
  if (stateListenerContext === context || typeof context.addEventListener !== 'function') return
  stateListenerContext = context
  context.addEventListener('statechange', () => {
    flushPendingSound(context)
  })
}

function armResume(context: AudioContext) {
  attachStateListener(context)
  if (isAudible(context)) {
    flushPendingSound(context)
    return
  }
  // Call every time. An earlier resume() promise must not swallow the gesture
  // that iOS will actually honor, including recovery from `interrupted`.
  try {
    void Promise.resolve(context.resume()).then(
      () => {
        flushPendingSound(context)
      },
      () => undefined,
    )
  } catch {
    // Audio must never break the interaction that triggered it.
  }
}

function primeSilentBuffer(context: AudioContext) {
  if (typeof context.createBuffer !== 'function' || typeof context.createBufferSource !== 'function') return
  try {
    const sampleRate = context.sampleRate > 0 ? context.sampleRate : 22050
    const buffer = context.createBuffer(1, 1, sampleRate)
    const source = context.createBufferSource()
    source.buffer = buffer
    const gainFactory = (context as AudioContext & { createGain?: () => GainNode }).createGain
    if (typeof gainFactory === 'function') {
      const gain = gainFactory.call(context)
      gain.gain.value = 0
      source.connect(gain)
      gain.connect(context.destination)
    } else {
      source.connect(context.destination)
    }
    source.start(0)
  } catch {
    // Unlock priming is best-effort.
  }
}

function unlockAudioContextForIosSafariGesture() {
  const context = getSharedAudioContext()
  if (!context) return
  // A one-sample silent buffer started inside the gesture is what actually
  // connects WebKit's output. resume() alone can report success and stay mute.
  primeSilentBuffer(context)
  armResume(context)
}

if (typeof document !== 'undefined') {
  // iOS Safari PWA only allows AudioContext.resume() from a user gesture stack.
  // touchstart/pointerdown stay passive so they do not delay feed scrolling.
  const passiveUnlockEvents = ['touchstart', 'pointerdown'] as const
  for (const eventName of passiveUnlockEvents) {
    document.addEventListener(eventName, unlockAudioContextForIosSafariGesture, {
      passive: true,
      capture: true,
    })
  }
  // The gesture-end events can be non-passive: they are the reliable user-activation
  // point, and they are not what the browser waits on before scrolling.
  const gestureUnlockEvents = ['touchend', 'pointerup', 'click'] as const
  for (const eventName of gestureUnlockEvents) {
    document.addEventListener(eventName, unlockAudioContextForIosSafariGesture, {
      passive: false,
      capture: true,
    })
  }

  document.addEventListener('visibilitychange', () => {
    // Returning from background suspends or interrupts Web Audio on iOS Safari.
    // This call is outside a gesture, so it often fails; the next touchend retries.
    if (document.visibilityState === 'visible' && sharedAudioContext && !isAudible(sharedAudioContext)) {
      armResume(sharedAudioContext)
    }
  })
}

export function getSharedAudioContext() {
  const AudioContextCtor = resolveAudioContextConstructor()
  if (!AudioContextCtor) return null
  if (sharedAudioContext && sharedAudioContext.state === 'closed') {
    sharedAudioContext = null
    stateListenerContext = null
    pendingSound = null
  }
  if (!sharedAudioContext) {
    sharedAudioContext = new AudioContextCtor()
  }
  return sharedAudioContext
}

/** Schedule slightly ahead of currentTime so WebKit does not clip the attack. */
export function sharedAudioStartTime(context: AudioContext, offsetMs = 0) {
  const latency = typeof context.baseLatency === 'number' && Number.isFinite(context.baseLatency)
    ? Math.min(0.05, Math.max(0, context.baseLatency))
    : 0
  return context.currentTime + Math.max(AUDIO_SCHEDULE_LEAD_S, latency) + Math.max(0, offsetMs) / 1000
}

/**
 * Play only once the shared context is actually running.
 * Scheduling into a suspended or interrupted context drops the sound on some
 * WebKit builds, or plays it later with a different clock — the "missing" and
 * "wrong timbre" failures on mobile.
 */
export function runWithSharedAudioContext(play: (context: AudioContext) => void) {
  const context = getSharedAudioContext()
  if (!context) return
  if (isAudible(context)) {
    try {
      play(context)
    } catch {
      // Audio must never break the interaction that triggered it.
    }
    return
  }
  // Keep only the newest sound. Replaying a backlog when audio finally
  // unlocks sounds like a different effect than the one the user just did.
  pendingSound = { at: Date.now(), play }
  armResume(context)
  if (isAudible(context)) flushPendingSound(context)
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
  // Glass cues already encode their semantic gain and decay in the shared voice.
  if (tone.envelope === 'glass') return tone
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

const outputBuses = new WeakMap<AudioContext, AudioNode>()

/** Shared limiter so a loud phrase stays loud without turning into a clip. */
export function sharedAudioOutput(context: AudioContext) {
  const existing = outputBuses.get(context)
  if (existing) return existing
  const factory = (context as AudioContext & { createDynamicsCompressor?: () => DynamicsCompressorNode }).createDynamicsCompressor
  if (typeof factory !== 'function') {
    outputBuses.set(context, context.destination)
    return context.destination
  }
  try {
    const compressor = factory.call(context)
    compressor.threshold.value = -8
    compressor.knee.value = 8
    compressor.ratio.value = 3
    compressor.attack.value = 0.003
    compressor.release.value = 0.08
    compressor.connect(context.destination)
    outputBuses.set(context, compressor)
    return compressor
  } catch {
    outputBuses.set(context, context.destination)
    return context.destination
  }
}

function playToneSequence(tones: ToneSpec[], volume: number, voice?: SoundVoiceId) {
  if (tones.length === 0 || volume <= 0) return
  const concrete = pickConcreteVoice(voice ?? readReviewFeedbackSettings().soundVoice)
  const peaks = sequencePeaks(tones.map((tone) => tone.gain), volume)
  runWithSharedAudioContext((context) => {
    const destination = sharedAudioOutput(context)
    tones.forEach((tone, index) => {
      renderVoicedTone(
        context,
        destination,
        concrete,
        tone,
        peaks[index] ?? 0,
        index,
        sharedAudioStartTime(context, tone.offsetMs),
      )
    })
  })
}

export function playWebAudioFeedbackEvent(args: {
  event: MindMapFeedbackEvent
  surprise?: boolean
  origin?: MindMapFeedbackOrigin
  audioScope?: 'local' | 'global'
  volume?: number
  voice?: SoundVoiceId
}) {
  const { event, surprise = false, origin, audioScope, volume = 1, voice } = args
  const feedbackVolume = clampFeedbackVolume(volume)
  if (feedbackVolume <= 0) return
  const tones = getToneSpec(event, surprise).map((tone) =>
    tuneToneSpec(event, tone, origin, audioScope),
  )
  playToneSequence(tones, feedbackVolume, voice)
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
  if (cached && cached.sampleRate === context.sampleRate) return cached
  const sampleRate = context.sampleRate > 0 ? context.sampleRate : 22050
  const length = Math.floor(sampleRate * 0.25)
  const buffer = context.createBuffer(1, length, sampleRate)
  const data = buffer.getChannelData(0)
  for (let index = 0; index < length; index += 1) data[index] = Math.random() * 2 - 1
  noiseBuffers.set(context, buffer)
  return buffer
}

function scheduleNoiseSwipe(
  context: AudioContext,
  args: { startAt: number; durationS: number; fromHz: number; toHz: number; q: number; gain: number },
) {
  try {
    const source = context.createBufferSource()
    source.buffer = getNoiseBuffer(context)
    // Wide playback-rate jitter pushed the swipe in and out of phone speakers.
    source.playbackRate.value = 0.98 + Math.random() * 0.04
    const band = context.createBiquadFilter()
    band.type = 'bandpass'
    band.Q.value = args.q
    const fromHz = Math.max(40, args.fromHz)
    const toHz = Math.max(40, args.toHz)
    const attackAt = args.startAt + Math.min(0.012, Math.max(0.004, args.durationS * 0.2))
    const releaseAt = Math.max(args.startAt + args.durationS, attackAt + 0.008)
    band.frequency.setValueAtTime(fromHz, args.startAt)
    band.frequency.exponentialRampToValueAtTime(toHz, releaseAt)
    const envelope = context.createGain()
    envelope.gain.setValueAtTime(0.0001, args.startAt)
    envelope.gain.linearRampToValueAtTime(Math.max(0.0001, args.gain), attackAt)
    envelope.gain.exponentialRampToValueAtTime(0.0001, releaseAt)
    source.connect(band)
    band.connect(envelope)
    envelope.connect(sharedAudioOutput(context))
    source.onended = () => {
      try { source.disconnect() } catch { /* already disconnected */ }
      try { band.disconnect() } catch { /* already disconnected */ }
      try { envelope.disconnect() } catch { /* already disconnected */ }
    }
    source.start(args.startAt, Math.random() * 0.04)
    source.stop(releaseAt + 0.02)
  } catch {
    // A failed swipe must not surface as a broken page turn.
  }
}

/** Soft paper swipe for feed page turns; synthesized, no assets. */
export function playWebAudioPageTurn(args: { volume?: number; direction?: 'forward' | 'backward' }) {
  const feedbackVolume = clampFeedbackVolume(args.volume ?? 1)
  if (feedbackVolume <= 0) return
  const voice = pickConcreteVoice(readReviewFeedbackSettings().soundVoice)
  const band = voice === 'wood' ? [720, 280] : voice === 'celesta' ? [1600, 640] : [3200, 1400]
  runWithSharedAudioContext((context) => {
    const now = sharedAudioStartTime(context)
    renderVoicedTone(
      context,
      sharedAudioOutput(context),
      voice,
      { frequency: voice === 'wood' ? 220 : voice === 'celesta' ? 880 : 1568, durationMs: 90, gain: 0.08, type: 'sine', offsetMs: 0 },
      sequencePeaks([0.08], feedbackVolume)[0] ?? 0,
      0,
      now,
    )
    if (typeof context.createBufferSource !== 'function') return
    // Phone speakers drop a wide random pitch, so each swipe sounded different
    // or vanished. Keep a little movement without leaving the audible band.
    const jitter = 0.985 + Math.random() * 0.03
    const [fromHz, toHz] = args.direction === 'backward' ? [band[1], band[0]] : band
    scheduleNoiseSwipe(context, {
      startAt: now,
      durationS: 0.11 * jitter,
      fromHz: fromHz * jitter,
      toHz: toHz * jitter,
      q: 0.9,
      gain: 0.28 * feedbackVolume,
    })
    // Edge flick stays inside a phone speaker's band. 6 kHz was often silent,
    // which made some swipes sound like a different effect than others.
    scheduleNoiseSwipe(context, {
      startAt: now + 0.075 * jitter,
      durationS: 0.03,
      fromHz: band[0] * 1.15,
      toHz: Math.max(180, band[1]),
      q: 2.4,
      gain: 0.14 * feedbackVolume,
    })
  })
}

export function playWebAudioLandingChime(args: { combo: number; volume?: number }) {
  const feedbackVolume = clampFeedbackVolume(args.volume ?? 1)
  if (feedbackVolume <= 0) return
  playToneSequence(getLandingChimeTone(args.combo), feedbackVolume)
}

/**
 * Layered short bells: one action, N objects, N countable pops.
 *
 * Review scenes reach this through the `audio.pops` cue so the scene gate
 * (learningSounds / review.enabled / review.soundEnabled) still decides.
 */
export function playWebAudioLayeredPops(args: {
  role: PopRole
  count?: number
  grade?: 1 | 2 | 3 | 4
  step?: number
  volume?: number
}) {
  const { role, count, grade, step, volume = 1 } = args
  const feedbackVolume = clampFeedbackVolume(volume)
  if (feedbackVolume <= 0) return
  const tones = buildLayeredPops({ role, count, grade, step })
  if (tones.length === 0) return
  playToneSequence(tones, feedbackVolume)
}

/**
 * Edit-mode actions (card delete / lift / unlink) sit outside the learning
 * scenes. They follow the same switch the edit-side `dispatchGlobalFeedback`
 * always followed — the master sound switch only — so turning off learning
 * sounds does not silence editing.
 */
export function playEditLayeredPops(args: {
  role: PopRole
  count?: number
  grade?: 1 | 2 | 3 | 4
  step?: number
}) {
  const settings = readReviewFeedbackSettings()
  if (!settings.soundEnabled) return
  playWebAudioLayeredPops({ ...args, volume: getReviewFeedbackEffectiveVolume(settings) })
}

export function __resetWebAudioContextForTests() {
  sharedAudioContext = null
  pendingSound = null
  stateListenerContext = null
}
