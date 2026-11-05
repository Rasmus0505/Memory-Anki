/** Pure model for the city horizon: today's island, one house per palace, one window per card. */

export interface CityTodayPalace {
  id: number
  title: string
  subject: { id: number; name: string; color: string } | null
  unit_count: number
  rating_count: number
  units: { id: string; rating: number }[]
}

export interface CityTodayDto {
  day: string
  palaces: CityTodayPalace[]
}

/** Window light levels: 0 unrated, then the latest rating 1..4. */
export interface HorizonHousePlan {
  id: number
  lights: number[]
  roofColor: string | null
  gold: boolean
  repair: boolean
}

/** Windows per house before cards share a window; keeps tall palaces under the strip height. */
export const MAX_WINDOWS = 24
const WINDOWS_PER_FLOOR = 4
/** Subjects that still carry the creation default get a roof color by subject instead. */
const DEFAULT_SUBJECT_COLOR = '#6366f1'
const ROOF_PALETTE = ['#d9634c', '#4f86a8', '#6c9a5a', '#e39b3d', '#8c6bb1', '#3f5f7a']

function roofColorOf(subject: CityTodayPalace['subject']): string | null {
  if (!subject) return null
  if (subject.color && subject.color.toLowerCase() !== DEFAULT_SUBJECT_COLOR) return subject.color
  return ROOF_PALETTE[Math.abs(subject.id) % ROOF_PALETTE.length]
}

export function focusPalaceIdFromPath(pathname: string): number | null {
  const match = /^\/palaces\/(\d+)(?:\/(?:edit|review))?$/.exec(pathname)
  return match ? Number(match[1]) : null
}

export function planHouse(palace: CityTodayPalace): HorizonHousePlan {
  const total = Math.max(palace.unit_count, palace.units.length, 1)
  const windows = Math.min(
    MAX_WINDOWS,
    Math.ceil(total / WINDOWS_PER_FLOOR) * WINDOWS_PER_FLOOR,
  )
  const lit = Math.min(windows, Math.ceil((palace.units.length / total) * windows))
  // Bottom windows light first; each lit window shows the rating of the cards it stands for.
  const lights = Array.from({ length: windows }, (_, i) => {
    if (i >= lit) return 0
    const unit = palace.units[Math.floor((i * palace.units.length) / lit)]
    return unit ? unit.rating : 0
  })
  return {
    id: palace.id,
    lights,
    roofColor: roofColorOf(palace.subject),
    gold: palace.unit_count > 0 && palace.units.length >= palace.unit_count,
    repair: palace.units.some((unit) => unit.rating === 1),
  }
}

/** The focus palace gets a bare foundation even before its first rating today. */
export function planIsland(today: CityTodayDto | null, focusId: number | null): HorizonHousePlan[] {
  const plans = (today?.palaces ?? []).map(planHouse)
  if (focusId != null && !plans.some((plan) => plan.id === focusId)) {
    plans.push({ id: focusId, lights: [0, 0, 0, 0], roofColor: null, gold: false, repair: false })
  }
  return plans
}

export function palaceOfUnit(today: CityTodayDto | null, unitId: string): number | undefined {
  return today?.palaces.find((palace) => palace.units.some((unit) => unit.id === unitId))?.id
}
