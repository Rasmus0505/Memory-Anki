export const SOUND_VOICE_IDS = ['mixed', 'crystal', 'wood', 'celesta'] as const

export type SoundVoiceId = (typeof SOUND_VOICE_IDS)[number]
export type ConcreteSoundVoice = Exclude<SoundVoiceId, 'mixed'>

export const CONCRETE_SOUND_VOICES: readonly ConcreteSoundVoice[] = ['crystal', 'wood', 'celesta']

export const SOUND_VOICE_OPTIONS: ReadonlyArray<{
  id: SoundVoiceId
  title: string
  description: string
}> = [
  {
    id: 'mixed',
    title: '混合随机',
    description: '默认。每次发声抽一套，同一次连弹不中途换。',
  },
  {
    id: 'crystal',
    title: '晶莹微风',
    description: '调频玻璃。尾音清亮，停得比八音盒早。',
  },
  {
    id: 'wood',
    title: '禅境温木',
    description: '短促木击。尾音在一瞬间收掉。',
  },
  {
    id: 'celesta',
    title: '灵音八音盒',
    description: '延迟颤音。尾音最长。',
  },
]

export function sanitizeSoundVoice(value: unknown): SoundVoiceId {
  return SOUND_VOICE_IDS.includes(value as SoundVoiceId) ? (value as SoundVoiceId) : 'mixed'
}

/** One draw per phrase. Mixed must not re-roll inside a cascade. */
export function pickConcreteVoice(
  choice: SoundVoiceId,
  random: () => number = Math.random,
): ConcreteSoundVoice {
  if (choice === 'crystal' || choice === 'wood' || choice === 'celesta') return choice
  const sample = random()
  const index = Number.isFinite(sample) ? Math.floor(sample * CONCRETE_SOUND_VOICES.length) : 0
  return CONCRETE_SOUND_VOICES[Math.min(CONCRETE_SOUND_VOICES.length - 1, Math.max(0, index))] ?? 'crystal'
}
