import { readReviewFeedbackSettings } from '@/shared/feedback/reviewFeedbackSettings'
import { pickConcreteVoice } from '@/shared/feedback/mindmap-audio/soundVoices'
import { renderVoicedTone, sequencePeaks } from '@/shared/feedback/mindmap-audio/voiceSynth'
import {
  runWithSharedAudioContext,
  sharedAudioOutput,
  sharedAudioStartTime,
} from '@/shared/feedback/mindmap-audio/webAudioFeedback'
import type { ToneSpec } from '@/shared/feedback/mindmap-audio/toneProfiles'

export type UiSound = 'wood' | 'wood-soft' | 'toggle-on' | 'toggle-off' | 'paper' | 'swish' | 'chime' | 'thud'

let noiseBuffer: AudioBuffer | null = null

function noise(context: AudioContext) {
  if (noiseBuffer && noiseBuffer.sampleRate === context.sampleRate) return noiseBuffer
  const length = Math.round(context.sampleRate * 0.6)
  noiseBuffer = context.createBuffer(1, length, context.sampleRate)
  const data = noiseBuffer.getChannelData(0)
  // Pink-ish noise reads as paper fibre rather than hiss.
  let b0 = 0, b1 = 0, b2 = 0
  for (let i = 0; i < length; i += 1) {
    const white = Math.random() * 2 - 1
    b0 = 0.99765 * b0 + white * 0.099046
    b1 = 0.963 * b1 + white * 0.2965164
    b2 = 0.57 * b2 + white * 1.0526913
    data[i] = (b0 + b1 + b2 + white * 0.1848) * 0.18
  }
  return noiseBuffer
}

function envelope(context: AudioContext, start: number, peak: number, attack: number, decay: number) {
  const gain = context.createGain()
  gain.gain.setValueAtTime(0.0001, start)
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), start + attack)
  gain.gain.exponentialRampToValueAtTime(0.0001, start + attack + decay)
  gain.connect(sharedAudioOutput(context))
  return gain
}

function phrase(notes: Array<Pick<ToneSpec, 'frequency' | 'durationMs' | 'gain' | 'offsetMs'>>): ToneSpec[] {
  return notes.map((note) => ({ ...note, type: 'sine' as const, attackMs: 3 }))
}

function noiseBurst(context: AudioContext, start: number, args: {
  type: BiquadFilterType
  from: number
  to?: number
  q: number
  peak: number
  attack: number
  decay: number
}) {
  const source = context.createBufferSource()
  source.buffer = noise(context)
  const filter = context.createBiquadFilter()
  filter.type = args.type
  filter.Q.value = args.q
  filter.frequency.setValueAtTime(args.from, start)
  if (args.to) filter.frequency.exponentialRampToValueAtTime(args.to, start + args.attack + args.decay)
  source.connect(filter)
  filter.connect(envelope(context, start, args.peak, args.attack, args.decay))
  source.start(start, Math.random() * 0.3)
  source.stop(start + args.attack + args.decay + 0.05)
}

function playPhrase(context: AudioContext, start: number, volume: number, notes: ToneSpec[]) {
  const voice = pickConcreteVoice(readReviewFeedbackSettings().soundVoice)
  const peaks = sequencePeaks(notes.map((note) => note.gain), volume)
  const destination = sharedAudioOutput(context)
  notes.forEach((note, index) => {
    renderVoicedTone(
      context,
      destination,
      voice,
      note,
      peaks[index] ?? 0,
      index,
      start + note.offsetMs / 1000,
    )
  })
}

export function synthUiSound(sound: UiSound, volume: number) {
  if (volume <= 0) return
  runWithSharedAudioContext((context) => {
    const now = sharedAudioStartTime(context)
    const v = Math.min(2, volume)
    switch (sound) {
      case 'wood':
        playPhrase(context, now, v, phrase([{ frequency: 620, durationMs: 90, gain: 0.16, offsetMs: 0 }]))
        break
      case 'wood-soft':
        playPhrase(context, now, v, phrase([{ frequency: 740, durationMs: 70, gain: 0.12, offsetMs: 0 }]))
        break
      case 'toggle-on':
        playPhrase(context, now, v, phrase([
          { frequency: 620, durationMs: 80, gain: 0.14, offsetMs: 0 },
          { frequency: 930, durationMs: 90, gain: 0.14, offsetMs: 45 },
        ]))
        break
      case 'toggle-off':
        playPhrase(context, now, v, phrase([
          { frequency: 780, durationMs: 80, gain: 0.14, offsetMs: 0 },
          { frequency: 520, durationMs: 90, gain: 0.14, offsetMs: 45 },
        ]))
        break
      case 'paper':
        if (typeof context.createBufferSource !== 'function') break
        noiseBurst(context, now, { type: 'bandpass', from: 1400, to: 3200, q: 0.8, peak: 0.32 * v, attack: 0.02, decay: 0.14 })
        break
      case 'swish':
        if (typeof context.createBufferSource !== 'function') break
        noiseBurst(context, now, { type: 'bandpass', from: 700, to: 2400, q: 1.1, peak: 0.26 * v, attack: 0.03, decay: 0.16 })
        break
      case 'thud':
        playPhrase(context, now, v, phrase([{ frequency: 140, durationMs: 110, gain: 0.2, offsetMs: 0 }]))
        if (typeof context.createBufferSource === 'function') {
          noiseBurst(context, now, { type: 'lowpass', from: 700, q: 0.7, peak: 0.22 * v, attack: 0.003, decay: 0.06 })
        }
        break
      case 'chime':
        playPhrase(context, now, v, phrase([
          { frequency: 1318.5, durationMs: 280, gain: 0.16, offsetMs: 0 },
          { frequency: 1760, durationMs: 320, gain: 0.14, offsetMs: 70 },
        ]))
        break
    }
  })
}
