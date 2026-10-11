import type { FreestyleSegmentTone } from '@/modules/practice/ui/freestyle/model/freestyleProgressSegments'

/** Warm accents readable on the warm-dark stage (~8 slots, one muted cool for contrast). */
const PALACE_ACCENT_KEYS = [
  'honey',
  'terracotta',
  'sage',
  'teal',
  'plum',
  'clay',
  'moss',
  'dusk',
] as const

export type PalaceAccentKey = (typeof PALACE_ACCENT_KEYS)[number] | 'neutral'

type AccentToneClass = Record<FreestyleSegmentTone, string>

/**
 * pending: faint unfilled (~25%) · current: bright playhead · done: solid filled
 * retry: palace + rate-hard amber mix. /70 vs /90 is not readable on a 6px tick.
 * Literal strings so Tailwind can see every class.
 */
const PALACE_ACCENT_TONE_CLASS: Record<(typeof PALACE_ACCENT_KEYS)[number], AccentToneClass> = {
  honey: {
    pending: 'bg-[hsl(38_90%_58%)]/25',
    current: 'bg-[hsl(40_96%_72%)]',
    done: 'bg-[hsl(38_90%_58%)]',
    retry: 'bg-[color-mix(in_srgb,hsl(38_90%_58%)_55%,var(--color-rate-hard)_45%)]',
  },
  terracotta: {
    pending: 'bg-[hsl(12_70%_60%)]/25',
    current: 'bg-[hsl(14_80%_74%)]',
    done: 'bg-[hsl(12_70%_60%)]',
    retry: 'bg-[color-mix(in_srgb,hsl(12_70%_60%)_55%,var(--color-rate-hard)_45%)]',
  },
  sage: {
    pending: 'bg-[hsl(96_30%_56%)]/25',
    current: 'bg-[hsl(96_40%_72%)]',
    done: 'bg-[hsl(96_30%_56%)]',
    retry: 'bg-[color-mix(in_srgb,hsl(96_30%_56%)_55%,var(--color-rate-hard)_45%)]',
  },
  teal: {
    pending: 'bg-[hsl(176_42%_48%)]/25',
    current: 'bg-[hsl(176_50%_66%)]',
    done: 'bg-[hsl(176_42%_48%)]',
    retry: 'bg-[color-mix(in_srgb,hsl(176_42%_48%)_55%,var(--color-rate-hard)_45%)]',
  },
  plum: {
    pending: 'bg-[hsl(322_36%_62%)]/25',
    current: 'bg-[hsl(322_46%_76%)]',
    done: 'bg-[hsl(322_36%_62%)]',
    retry: 'bg-[color-mix(in_srgb,hsl(322_36%_62%)_55%,var(--color-rate-hard)_45%)]',
  },
  clay: {
    pending: 'bg-[hsl(352_62%_68%)]/25',
    current: 'bg-[hsl(352_72%_80%)]',
    done: 'bg-[hsl(352_62%_68%)]',
    retry: 'bg-[color-mix(in_srgb,hsl(352_62%_68%)_55%,var(--color-rate-hard)_45%)]',
  },
  moss: {
    pending: 'bg-[hsl(70_44%_48%)]/25',
    current: 'bg-[hsl(70_52%_66%)]',
    done: 'bg-[hsl(70_44%_48%)]',
    retry: 'bg-[color-mix(in_srgb,hsl(70_44%_48%)_55%,var(--color-rate-hard)_45%)]',
  },
  dusk: {
    pending: 'bg-[hsl(208_40%_60%)]/25',
    current: 'bg-[hsl(208_52%_76%)]',
    done: 'bg-[hsl(208_40%_60%)]',
    retry: 'bg-[color-mix(in_srgb,hsl(208_40%_60%)_55%,var(--color-rate-hard)_45%)]',
  },
}

const NEUTRAL_ACCENT_TONE_CLASS: AccentToneClass = {
  pending: 'bg-stage-ink/20',
  current: 'bg-stage-ink',
  done: 'bg-stage-muted',
  retry: 'bg-rate-hard/90',
}

/**
 * Stable palaceId → fixed palette slot. null → neutral fallback.
 * Same id always maps to the same accent; different ids prefer different slots.
 */
export function palaceAccent(palaceId: number | null): PalaceAccentKey {
  if (palaceId == null) return 'neutral'
  const slot = ((palaceId % PALACE_ACCENT_KEYS.length) + PALACE_ACCENT_KEYS.length) % PALACE_ACCENT_KEYS.length
  return PALACE_ACCENT_KEYS[slot]
}

const PALACE_AMBIENT_HSL: Record<(typeof PALACE_ACCENT_KEYS)[number], string> = {
  honey: '38 90% 58%',
  terracotta: '12 70% 60%',
  sage: '96 30% 56%',
  teal: '176 42% 48%',
  plum: '322 36% 62%',
  clay: '352 62% 68%',
  moss: '70 44% 48%',
  dusk: '208 40% 60%',
}

/** Raw `H S% L%` of the palace accent, for the feed's per-card ambient glow. Neutral = lamp amber. */
export function palaceAmbientHsl(palaceId: number | null): string {
  const accent = palaceAccent(palaceId)
  return accent === 'neutral' ? '32 94% 60%' : PALACE_AMBIENT_HSL[accent]
}

/** Ambient glow for any feed card; cards without a palace fall back to the lamp amber. */
export function cardAmbientHsl(card: object): string {
  const value = (card as { palace_id?: unknown }).palace_id
  return palaceAmbientHsl(typeof value === 'number' ? value : null)
}

/** Tailwind fill for a segment: palace accent modulated by tone. */
export function palaceAccentToneClass(
  palaceId: number | null,
  tone: FreestyleSegmentTone,
): string {
  const accent = palaceAccent(palaceId)
  if (accent === 'neutral') return NEUTRAL_ACCENT_TONE_CLASS[tone]
  return PALACE_ACCENT_TONE_CLASS[accent][tone]
}
