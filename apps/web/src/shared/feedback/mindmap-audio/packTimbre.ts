import type { ToneSpec } from './toneProfiles'
import type { PackTimbre } from '@/shared/theme/packs/types'
import { activeThemePack } from '@/shared/theme/themePacks'

/**
 * How a theme pack colors every procedural tone. Pitch and envelope only —
 * no samples. Warm worlds stay warm: wood sits low, lacquer and celesta sit high.
 */
export interface TimbreVoice {
  type: OscillatorType
  pitch: number
  duration: number
  attack: number
  gain: number
}

export const PACK_TIMBRE_VOICES: Record<PackTimbre, TimbreVoice> = {
  'paper-wood': { type: 'triangle', pitch: 0.9, duration: 0.82, attack: 1.6, gain: 0.9 },
  'bell-lacquer': { type: 'sine', pitch: 1.18, duration: 1.35, attack: 0.35, gain: 0.85 },
  'celesta-chime': { type: 'sine', pitch: 1.42, duration: 1.1, attack: 0.22, gain: 0.78 },
  'marimba-water': { type: 'triangle', pitch: 0.78, duration: 1.05, attack: 0.7, gain: 1 },
}

export function activePackTimbre(): PackTimbre {
  return activeThemePack().timbre
}

export function colorTone(tone: ToneSpec, timbre: PackTimbre = activePackTimbre()): ToneSpec {
  const voice = PACK_TIMBRE_VOICES[timbre]
  const attackMs = Math.max(2, Math.round((tone.attackMs ?? 4) * voice.attack))
  return {
    ...tone,
    type: voice.type,
    frequency: tone.frequency * voice.pitch,
    endFrequency: typeof tone.endFrequency === 'number' ? tone.endFrequency * voice.pitch : undefined,
    durationMs: Math.max(18, Math.round(tone.durationMs * voice.duration)),
    attackMs,
    gain: tone.gain * voice.gain,
  }
}
