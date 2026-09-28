import { getSharedAudioContext } from '@/shared/feedback/mindmap-audio/webAudioFeedback'

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
  gain.connect(context.destination)
  return gain
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

function tone(context: AudioContext, start: number, frequency: number, peak: number, decay: number, type: OscillatorType = 'sine') {
  const oscillator = context.createOscillator()
  oscillator.type = type
  oscillator.frequency.setValueAtTime(frequency, start)
  oscillator.connect(envelope(context, start, peak, 0.004, decay))
  oscillator.start(start)
  oscillator.stop(start + decay + 0.05)
}

/** Wood knock = resonant body tone + a short filtered transient. */
function wood(context: AudioContext, start: number, pitch: number, peak: number) {
  tone(context, start, pitch, peak * 0.9, 0.07, 'triangle')
  tone(context, start, pitch * 2.76, peak * 0.22, 0.035)
  noiseBurst(context, start, { type: 'bandpass', from: pitch * 3.2, q: 6, peak: peak * 0.8, attack: 0.002, decay: 0.028 })
}

export function synthUiSound(sound: UiSound, volume: number) {
  if (volume <= 0) return
  const context = getSharedAudioContext()
  if (!context || typeof context.createBufferSource !== 'function') return
  if (context.state === 'suspended') void context.resume().catch(() => undefined)
  const now = context.currentTime + 0.004
  const v = Math.min(1.6, volume)
  const jitter = 1 + (Math.random() - 0.5) * 0.06
  switch (sound) {
    case 'wood':
      wood(context, now, 520 * jitter, 0.16 * v)
      break
    case 'wood-soft':
      wood(context, now, 680 * jitter, 0.09 * v)
      break
    case 'toggle-on':
      wood(context, now, 620, 0.12 * v)
      wood(context, now + 0.045, 930, 0.1 * v)
      break
    case 'toggle-off':
      wood(context, now, 780, 0.1 * v)
      wood(context, now + 0.045, 520, 0.1 * v)
      break
    case 'paper':
      noiseBurst(context, now, { type: 'bandpass', from: 1800 * jitter, to: 4200, q: 0.9, peak: 0.12 * v, attack: 0.03, decay: 0.16 })
      noiseBurst(context, now + 0.05, { type: 'highpass', from: 3800, q: 0.5, peak: 0.05 * v, attack: 0.02, decay: 0.09 })
      break
    case 'swish':
      noiseBurst(context, now, { type: 'bandpass', from: 700, to: 2600, q: 1.4, peak: 0.08 * v, attack: 0.06, decay: 0.18 })
      break
    case 'thud':
      tone(context, now, 150, 0.14 * v, 0.12, 'sine')
      noiseBurst(context, now, { type: 'lowpass', from: 900, q: 0.7, peak: 0.1 * v, attack: 0.003, decay: 0.06 })
      break
    case 'chime':
      // Short wind-chime: two bell partials, the second slightly late.
      tone(context, now, 1318.5, 0.07 * v, 0.9)
      tone(context, now, 1318.5 * 2.4, 0.018 * v, 0.5)
      tone(context, now + 0.07, 1760, 0.055 * v, 1.1)
      tone(context, now + 0.07, 1760 * 2.4, 0.014 * v, 0.6)
      break
  }
}
