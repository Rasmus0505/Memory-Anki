import type { ProgressionStarmap, StarmapPalace } from '@/shared/api/contracts'

/**
 * Deterministic constellation layout in world units: subjects sit on a ring,
 * chapters spiral around their subject, palaces orbit their chapter. Positions
 * derive from ids only, so the sky looks the same on every device and visit.
 */

export type StarKind = 'subject' | 'chapter' | 'palace'

export interface Star {
  key: string
  kind: StarKind
  id: number
  label: string
  x: number
  y: number
  /** 0..1, mastery-weighted. */
  brightness: number
  /** Visual radius in world units. */
  size: number
  twinkle: boolean
  hue: number
  stars: 1 | 2 | 3
  due: number
  mastery: number
  subjectId: number | null
  parentKey: string | null
}

export interface StarLink {
  from: string
  to: string
  strength: number
}

export interface Sky {
  stars: Star[]
  links: StarLink[]
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
}

/** Warm night only: amber, gold, rose, coral, plum. Never a cold blue. */
const WARM_HUES = [36, 44, 18, 350, 320, 28, 8, 300]
const UNFILED_SUBJECT = -1

function hash(value: string) {
  let h = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) / 4294967295
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value))

/** Faint but never invisible: a star you have not learned yet is still on the map. */
export function brightnessFor(mastery: number, learnedRatio: number) {
  return clamp01(0.14 + mastery * 0.7 + learnedRatio * 0.16)
}

function aggregate(palaces: StarmapPalace[]) {
  const units = palaces.reduce((sum, palace) => sum + palace.unit_count, 0)
  if (units === 0) return { mastery: 0, learned: 0, due: palaces.reduce((sum, p) => sum + p.due_count, 0) }
  const weigh = (pick: (palace: StarmapPalace) => number) =>
    palaces.reduce((sum, palace) => sum + pick(palace) * palace.unit_count, 0) / units
  return {
    mastery: weigh((palace) => palace.mastery_ratio),
    learned: palaces.reduce((sum, palace) => sum + palace.learned_count, 0) / units,
    due: palaces.reduce((sum, palace) => sum + palace.due_count, 0),
  }
}

function maxStars(palaces: StarmapPalace[], chapterStars: number | null | undefined): 1 | 2 | 3 {
  const best = Math.max(chapterStars ?? 1, ...palaces.map((palace) => palace.stars))
  return (best >= 3 ? 3 : best >= 2 ? 2 : 1)
}

export function layoutSky(map: ProgressionStarmap): Sky {
  const stars: Star[] = []
  const links: StarLink[] = []
  const chapterById = new Map(map.chapters.map((chapter) => [chapter.id, chapter]))
  const palacesByChapter = new Map<number, StarmapPalace[]>()
  const loosePalaces = new Map<number, StarmapPalace[]>()
  for (const palace of map.palaces) {
    const chapter = palace.chapter_id != null ? chapterById.get(palace.chapter_id) : undefined
    if (chapter) {
      palacesByChapter.set(chapter.id, [...(palacesByChapter.get(chapter.id) ?? []), palace])
    } else {
      const subject = palace.subject_id ?? UNFILED_SUBJECT
      loosePalaces.set(subject, [...(loosePalaces.get(subject) ?? []), palace])
    }
  }

  const subjectIds = [
    ...map.subjects.map((subject) => subject.id),
    ...(loosePalaces.has(UNFILED_SUBJECT) ? [UNFILED_SUBJECT] : []),
  ]
  const ringRadius = subjectIds.length <= 1 ? 0 : 520 + subjectIds.length * 60

  subjectIds.forEach((subjectId, subjectIndex) => {
    const subject = map.subjects.find((item) => item.id === subjectId)
    const angle = (subjectIndex / Math.max(1, subjectIds.length)) * Math.PI * 2 - Math.PI / 2
    const cx = Math.cos(angle) * ringRadius
    const cy = Math.sin(angle) * ringRadius * 0.72
    const hue = WARM_HUES[subjectIndex % WARM_HUES.length]
    const chapters = map.chapters
      .filter((chapter) => chapter.subject_id === subjectId && (palacesByChapter.get(chapter.id)?.length ?? 0) > 0)
      .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)
    const subjectPalaces = [...chapters.flatMap((chapter) => palacesByChapter.get(chapter.id) ?? []), ...(loosePalaces.get(subjectId) ?? [])]
    if (subjectPalaces.length === 0) return
    const subjectAgg = aggregate(subjectPalaces)
    const subjectKey = `s:${subjectId}`
    stars.push({
      key: subjectKey,
      kind: 'subject',
      id: subjectId,
      label: subject?.name ?? '未归档',
      x: cx,
      y: cy,
      brightness: brightnessFor(subjectAgg.mastery, subjectAgg.learned),
      size: 5,
      twinkle: false,
      hue,
      stars: maxStars(subjectPalaces, null),
      due: subjectAgg.due,
      mastery: subjectAgg.mastery,
      subjectId,
      parentKey: null,
    })

    let previousKey: string | null = null
    chapters.forEach((chapter, chapterIndex) => {
      const palaces = palacesByChapter.get(chapter.id) ?? []
      const agg = aggregate(palaces)
      // Golden-angle spiral keeps chapters evenly spread however many there are.
      const theta = chapterIndex * 2.39996 + hash(`c${chapter.id}`) * 0.4
      const r = 90 + Math.sqrt(chapterIndex + 1) * 78
      const key = `c:${chapter.id}`
      const level = maxStars(palaces, chapter.exam_stars)
      stars.push({
        key,
        kind: 'chapter',
        id: chapter.id,
        label: chapter.name,
        x: cx + Math.cos(theta) * r,
        y: cy + Math.sin(theta) * r,
        brightness: brightnessFor(agg.mastery, agg.learned),
        size: 6 + level * 3 + Math.min(6, Math.sqrt(palaces.length) * 1.5),
        twinkle: agg.due > 0,
        hue,
        stars: level,
        due: agg.due,
        mastery: agg.mastery,
        subjectId,
        parentKey: subjectKey,
      })
      links.push({ from: previousKey ?? subjectKey, to: key, strength: 0.5 + agg.mastery * 0.5 })
      previousKey = key
      addPalaces(palaces, key, cx + Math.cos(theta) * r, cy + Math.sin(theta) * r, hue, subjectId)
    })
    addPalaces(loosePalaces.get(subjectId) ?? [], subjectKey, cx, cy, hue, subjectId, 70)
  })

  function addPalaces(palaces: StarmapPalace[], parentKey: string, px: number, py: number, hue: number, subjectId: number, base = 26) {
    palaces.forEach((palace, index) => {
      const theta = hash(`p${palace.id}`) * Math.PI * 2 + index * 1.1
      const r = base + 12 + (index % 4) * 11 + hash(`r${palace.id}`) * 10
      const learned = palace.unit_count ? palace.learned_count / palace.unit_count : 0
      const key = `p:${palace.id}`
      stars.push({
        key,
        kind: 'palace',
        id: palace.id,
        label: palace.title,
        x: px + Math.cos(theta) * r,
        y: py + Math.sin(theta) * r,
        brightness: brightnessFor(palace.mastery_ratio, learned),
        size: 2.2 + palace.stars * 1.3,
        twinkle: palace.due_count > 0,
        hue,
        stars: palace.stars,
        due: palace.due_count,
        mastery: palace.mastery_ratio,
        subjectId,
        parentKey,
      })
      links.push({ from: parentKey, to: key, strength: 0.18 + palace.mastery_ratio * 0.3 })
    })
  }

  const xs = stars.map((star) => star.x)
  const ys = stars.map((star) => star.y)
  const pad = 80
  return {
    stars,
    links,
    bounds: stars.length
      ? { minX: Math.min(...xs) - pad, minY: Math.min(...ys) - pad, maxX: Math.max(...xs) + pad, maxY: Math.max(...ys) + pad }
      : { minX: -200, minY: -200, maxX: 200, maxY: 200 },
  }
}

/** Nearest star within `radius` world units of a point, preferring bigger stars on ties. */
export function hitStar(sky: Sky, x: number, y: number, radius: number) {
  let best: Star | null = null
  let bestScore = Infinity
  for (const star of sky.stars) {
    const distance = Math.hypot(star.x - x, star.y - y)
    if (distance > radius + star.size) continue
    const score = distance - star.size * 0.5
    if (score < bestScore) {
      bestScore = score
      best = star
    }
  }
  return best
}
