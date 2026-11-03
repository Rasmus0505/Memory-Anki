export const SOUND_VOICE_IDS = ['mixed', 'crystal', 'wood', 'celesta'] as const

export type SoundVoiceId = (typeof SOUND_VOICE_IDS)[number]
export type ConcreteSoundVoice = Exclude<SoundVoiceId, 'mixed'>
export type SoundVoiceSelection = readonly ConcreteSoundVoice[]

export const CONCRETE_SOUND_VOICES: readonly ConcreteSoundVoice[] = ['crystal', 'wood', 'celesta']

export const SOUND_VOICE_OPTIONS: ReadonlyArray<{
  id: ConcreteSoundVoice
  title: string
  description: string
  character: string
}> = [
  {
    id: 'crystal',
    title: '晶莹微风',
    description: '调频玻璃，尾音清亮，适合需要清晰确认的反馈。',
    character: '清亮 · 轻盈',
  },
  {
    id: 'wood',
    title: '禅境温木',
    description: '短促木击，收音利落，适合连续操作。',
    character: '温暖 · 利落',
  },
  {
    id: 'celesta',
    title: '灵音八音盒',
    description: '带延迟颤音，尾音最长，适合想要更明显的回应。',
    character: '柔和 · 绵长',
  },
]

export function sanitizeSoundVoice(value: unknown): SoundVoiceId {
  return SOUND_VOICE_IDS.includes(value as SoundVoiceId) ? (value as SoundVoiceId) : 'mixed'
}

export function sanitizeSoundVoiceSelection(value: unknown): ConcreteSoundVoice[] {
  if (value === 'mixed' || value == null) return [...CONCRETE_SOUND_VOICES]
  if (typeof value === 'string' && CONCRETE_SOUND_VOICES.includes(value as ConcreteSoundVoice)) {
    return [value as ConcreteSoundVoice]
  }
  if (!Array.isArray(value)) return [...CONCRETE_SOUND_VOICES]

  const selected = CONCRETE_SOUND_VOICES.filter((voice) => value.includes(voice))
  return selected.length > 0 ? selected : [...CONCRETE_SOUND_VOICES]
}

/** One draw per phrase. A mixed phrase never changes timbre mid-cascade. */
export function pickConcreteVoice(
  choice: SoundVoiceId | SoundVoiceSelection,
  random: () => number = Math.random,
): ConcreteSoundVoice {
  if (Array.isArray(choice)) {
    const selected = sanitizeSoundVoiceSelection(choice)
    if (selected.length === 1) return selected[0] ?? 'crystal'
    const sample = random()
    const index = Number.isFinite(sample) ? Math.floor(sample * selected.length) : 0
    return selected[Math.min(selected.length - 1, Math.max(0, index))] ?? 'crystal'
  }
  if (choice === 'crystal' || choice === 'wood' || choice === 'celesta') return choice
  const sample = random()
  const index = Number.isFinite(sample) ? Math.floor(sample * CONCRETE_SOUND_VOICES.length) : 0
  return CONCRETE_SOUND_VOICES[Math.min(CONCRETE_SOUND_VOICES.length - 1, Math.max(0, index))] ?? 'crystal'
}
