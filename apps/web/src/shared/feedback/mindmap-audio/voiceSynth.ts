import type { ConcreteSoundVoice } from './soundVoices'
import type { ToneSpec } from './toneProfiles'

/** Playback loudness. Semantic gains stay small; the speaker does not. */
export const SOUND_PRESENCE = 4.8
/** A whole phrase speaks at least this loud at volume 1, then follows the slider. */
export const SEQUENCE_FLOOR = 0.36
export const PEAK_CAP = 0.9

export function sequencePeaks(gains: number[], volume: number): number[] {
  if (!(volume > 0)) return gains.map(() => 0)
  const raw = gains.map((gain) => Math.max(0, gain) * SOUND_PRESENCE * volume)
  const max = raw.reduce((peak, value) => Math.max(peak, value), 0)
  if (max <= 0) return raw
  const scale = Math.max(1, (SEQUENCE_FLOOR * volume) / max)
  return raw.map((value) => Math.min(PEAK_CAP, value * scale))
}

function registerOf(voice: ConcreteSoundVoice) {
  if (voice === 'wood') return 0.42
  if (voice === 'celesta') return 0.8
  return 1
}

function decayOf(voice: ConcreteSoundVoice, durationMs: number) {
  const seconds = Math.max(0.04, durationMs / 1000)
  if (voice === 'wood') return Math.min(0.12, seconds)
  if (voice === 'celesta') return Math.min(0.72, seconds * 1.15)
  return Math.min(0.5, seconds)
}

function canModulate(param: AudioParam) {
  return typeof param.exponentialRampToValueAtTime === 'function'
    && typeof param.cancelScheduledValues === 'function'
}

function releaseNodes(nodes: AudioNode[]) {
  for (const node of nodes) {
    try { node.disconnect() } catch { /* already disconnected */ }
  }
}

function shapedGain(
  context: AudioContext,
  destination: AudioNode,
  start: number,
  peak: number,
  attack: number,
  decay: number,
) {
  const gain = context.createGain()
  const attackAt = start + attack
  const releaseAt = attackAt + decay
  gain.gain.setValueAtTime(0.0001, start)
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), attackAt)
  gain.gain.exponentialRampToValueAtTime(0.0001, releaseAt)
  gain.connect(destination)
  return { gain, releaseAt }
}

function startOscillator(
  context: AudioContext,
  destination: AudioNode,
  start: number,
  type: OscillatorType,
  frequency: number,
  peak: number,
  attack: number,
  decay: number,
) {
  const oscillator = context.createOscillator()
  oscillator.type = type
  oscillator.frequency.setValueAtTime(Math.max(40, frequency), start)
  const { gain, releaseAt } = shapedGain(context, destination, start, peak, attack, decay)
  oscillator.connect(gain)
  oscillator.onended = () => releaseNodes([oscillator, gain])
  oscillator.start(start)
  oscillator.stop(releaseAt + 0.03)
  return oscillator
}

function playCrystal(
  context: AudioContext,
  destination: AudioNode,
  start: number,
  frequency: number,
  peak: number,
  attack: number,
  decay: number,
  color: number,
) {
  const carrier = context.createOscillator()
  carrier.type = 'sine'
  carrier.frequency.setValueAtTime(frequency, start)
  const { gain, releaseAt } = shapedGain(context, destination, start, peak, attack, decay)
  const owned: AudioNode[] = [carrier, gain]
  if (canModulate(carrier.frequency)) {
    const modulator = context.createOscillator()
    const amount = context.createGain()
    modulator.type = 'sine'
    modulator.frequency.setValueAtTime(frequency * (color % 2 === 0 ? 2.02 : 3.01), start)
    amount.gain.setValueAtTime(frequency * 2.4, start)
    amount.gain.exponentialRampToValueAtTime(frequency * 0.08, start + Math.min(0.08, decay))
    modulator.connect(amount)
    amount.connect(carrier.frequency)
    modulator.start(start)
    modulator.stop(releaseAt + 0.03)
    owned.push(modulator, amount)
  }
  carrier.connect(gain)
  carrier.onended = () => releaseNodes(owned)
  carrier.start(start)
  carrier.stop(releaseAt + 0.03)
}

function playWood(
  context: AudioContext,
  destination: AudioNode,
  start: number,
  frequency: number,
  peak: number,
  decay: number,
) {
  const body = Math.min(decay, 0.12)
  let output: AudioNode = destination
  let filter: BiquadFilterNode | null = null
  if (typeof context.createBiquadFilter === 'function') {
    filter = context.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.setValueAtTime(980, start)
    filter.connect(destination)
    output = filter
  }
  startOscillator(context, output, start, 'triangle', frequency, peak, 0.002, body)
  startOscillator(context, output, start, 'sine', frequency * 3.9, peak * 0.22, 0.002, Math.min(0.04, body))
  if (typeof context.createBuffer === 'function' && typeof context.createBufferSource === 'function') {
    const length = Math.max(1, Math.floor(context.sampleRate * 0.03))
    const buffer = context.createBuffer(1, length, context.sampleRate || 44100)
    const data = buffer.getChannelData(0)
    for (let index = 0; index < length; index += 1) data[index] = Math.random() * 2 - 1
    const source = context.createBufferSource()
    source.buffer = buffer
    const { gain, releaseAt } = shapedGain(context, output, start, peak * 0.45, 0.002, 0.02)
    source.connect(gain)
    source.onended = () => releaseNodes([source, gain])
    source.start(start)
    source.stop(releaseAt + 0.02)
  }
  if (filter) {
    const hold = context.createGain()
    hold.gain.value = 1
    hold.connect(destination)
    filter.disconnect()
    filter.connect(hold)
    const releaseAt = start + body + 0.04
    hold.gain.setValueAtTime(1, start)
    hold.gain.setValueAtTime(0.0001, releaseAt)
  }
}

function playCelesta(
  context: AudioContext,
  destination: AudioNode,
  start: number,
  frequency: number,
  peak: number,
  attack: number,
  decay: number,
) {
  const lead = startOscillator(context, destination, start, 'sine', frequency, peak, attack, decay)
  startOscillator(context, destination, start, 'sine', frequency * 1.006, peak * 0.42, attack, decay * 0.85)
  startOscillator(context, destination, start, 'sine', frequency * 2.76, peak * 0.2, 0.002, Math.min(0.08, decay))
  if (decay > 0.12 && canModulate(lead.frequency)) {
    const lfo = context.createOscillator()
    const amount = context.createGain()
    lfo.frequency.setValueAtTime(5.2, start + 0.08)
    amount.gain.setValueAtTime(0.0001, start)
    amount.gain.setValueAtTime(frequency * 0.008, start + 0.1)
    lfo.connect(amount)
    amount.connect(lead.frequency)
    lfo.start(start)
    lfo.stop(start + attack + decay + 0.03)
  }
}

export function renderVoicedTone(
  context: AudioContext,
  destination: AudioNode,
  voice: ConcreteSoundVoice,
  tone: ToneSpec,
  peak: number,
  color: number,
  startAt: number,
) {
  if (!(peak > 0) || !Number.isFinite(startAt) || !Number.isFinite(tone.frequency)) return
  try {
    const cents = ((color % 4) - 1) * 5
    const frequency = Math.max(48, tone.frequency * registerOf(voice) * 2 ** (cents / 1200))
    const decay = decayOf(voice, tone.durationMs)
    const attack = Math.max(0.002, Math.min(0.01, (tone.attackMs ?? 4) / 1000))
    if (voice === 'wood') playWood(context, destination, startAt, frequency, peak, decay)
    else if (voice === 'celesta') playCelesta(context, destination, startAt, frequency, peak, attack, decay)
    else playCrystal(context, destination, startAt, frequency, peak, attack, decay, color)
  } catch {
    // One failed note must not abort the rest of the phrase.
  }
}
