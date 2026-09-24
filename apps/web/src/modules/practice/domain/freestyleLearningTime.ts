export type FreestyleLearningBucket = 'unit' | 'quiz' | 'lookup'

export interface FreestylePalaceLearningSeconds {
  unitSeconds: number
  quizSeconds: number
  lookupSeconds: number
}

export interface FreestyleRoundLearningTime {
  unitSeconds: number
  quizSeconds: number
  lookupSeconds: number
  backfilled: boolean
  byPalace: Record<string, FreestylePalaceLearningSeconds>
}

const QUIZ_TITLES = new Set(['做题', '关联题目'])
const LOOKUP_TITLE = '查看宫殿'

function nonneg(value: unknown) {
  const number = Math.round(Number(value))
  return Number.isFinite(number) && number > 0 ? number : 0
}

function palaceKey(value: unknown) {
  const number = Math.round(Number(value))
  return Number.isInteger(number) && number > 0 ? String(number) : ''
}

function emptyPalace(): FreestylePalaceLearningSeconds {
  return { unitSeconds: 0, quizSeconds: 0, lookupSeconds: 0 }
}

export function emptyFreestyleLearningTime(): FreestyleRoundLearningTime {
  return {
    unitSeconds: 0,
    quizSeconds: 0,
    lookupSeconds: 0,
    backfilled: false,
    byPalace: {},
  }
}

export function parseFreestyleLearningTime(raw: unknown): FreestyleRoundLearningTime {
  const source = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const byPalace: Record<string, FreestylePalaceLearningSeconds> = {}
  const rawPalaces = source.by_palace ?? source.byPalace
  if (rawPalaces && typeof rawPalaces === 'object') {
    for (const [key, value] of Object.entries(rawPalaces as Record<string, unknown>)) {
      const palaceId = palaceKey(key)
      if (!palaceId || !value || typeof value !== 'object') continue
      const palace = value as Record<string, unknown>
      const next = {
        unitSeconds: nonneg(palace.unit_seconds ?? palace.unitSeconds),
        quizSeconds: nonneg(palace.quiz_seconds ?? palace.quizSeconds),
        lookupSeconds: nonneg(palace.lookup_seconds ?? palace.lookupSeconds),
      }
      if (next.unitSeconds || next.quizSeconds || next.lookupSeconds) {
        byPalace[palaceId] = next
      }
    }
  }
  return {
    unitSeconds: nonneg(source.unit_seconds ?? source.unitSeconds),
    quizSeconds: nonneg(source.quiz_seconds ?? source.quizSeconds),
    lookupSeconds: nonneg(source.lookup_seconds ?? source.lookupSeconds),
    backfilled: Boolean(source.backfilled),
    byPalace,
  }
}

export function addFreestyleLearningSeconds(
  time: FreestyleRoundLearningTime,
  bucket: FreestyleLearningBucket,
  seconds: number,
  palaceId: number | null = null,
): FreestyleRoundLearningTime {
  const amount = nonneg(seconds)
  if (amount <= 0) return time
  const field = bucket === 'unit'
    ? 'unitSeconds'
    : bucket === 'quiz'
      ? 'quizSeconds'
      : 'lookupSeconds'
  const byPalace = { ...time.byPalace }
  const key = palaceKey(palaceId)
  if (key) {
    const current = byPalace[key] ?? emptyPalace()
    byPalace[key] = { ...current, [field]: current[field] + amount }
  }
  return {
    ...time,
    [field]: time[field] + amount,
    byPalace,
  }
}

export function mergeFreestyleLearningTime(
  ...parts: Array<FreestyleRoundLearningTime | null | undefined>
): FreestyleRoundLearningTime {
  const next = emptyFreestyleLearningTime()
  for (const part of parts) {
    if (!part) continue
    next.unitSeconds += nonneg(part.unitSeconds)
    next.quizSeconds += nonneg(part.quizSeconds)
    next.lookupSeconds += nonneg(part.lookupSeconds)
    next.backfilled = next.backfilled || part.backfilled
    for (const [palaceId, palace] of Object.entries(part.byPalace || {})) {
      const key = palaceKey(palaceId)
      if (!key) continue
      const current = next.byPalace[key] ?? emptyPalace()
      const merged = {
        unitSeconds: current.unitSeconds + nonneg(palace.unitSeconds),
        quizSeconds: current.quizSeconds + nonneg(palace.quizSeconds),
        lookupSeconds: current.lookupSeconds + nonneg(palace.lookupSeconds),
      }
      if (merged.unitSeconds || merged.quizSeconds || merged.lookupSeconds) {
        next.byPalace[key] = merged
      }
    }
  }
  return next
}

export function freestyleLearningAdds(time: FreestyleRoundLearningTime) {
  const adds: Array<{ bucket: FreestyleLearningBucket; seconds: number; palace_id?: number }> = []
  const assigned = { unit: 0, quiz: 0, lookup: 0 }
  for (const [palaceId, palace] of Object.entries(time.byPalace)) {
    const id = Number(palaceId)
    const slices: Array<[FreestyleLearningBucket, number]> = [
      ['unit', palace.unitSeconds],
      ['quiz', palace.quizSeconds],
      ['lookup', palace.lookupSeconds],
    ]
    for (const [bucket, seconds] of slices) {
      if (seconds <= 0) continue
      adds.push({ bucket, seconds, palace_id: id })
      assigned[bucket] += seconds
    }
  }
  const remainders: Array<[FreestyleLearningBucket, number]> = [
    ['unit', time.unitSeconds - assigned.unit],
    ['quiz', time.quizSeconds - assigned.quiz],
    ['lookup', time.lookupSeconds - assigned.lookup],
  ]
  for (const [bucket, seconds] of remainders) {
    if (seconds > 0) adds.push({ bucket, seconds })
  }
  return adds
}

export function subtractFreestyleLearningTime(
  current: FreestyleRoundLearningTime,
  sent: FreestyleRoundLearningTime,
): FreestyleRoundLearningTime {
  const next = emptyFreestyleLearningTime()
  next.backfilled = current.backfilled
  next.unitSeconds = Math.max(0, nonneg(current.unitSeconds) - nonneg(sent.unitSeconds))
  next.quizSeconds = Math.max(0, nonneg(current.quizSeconds) - nonneg(sent.quizSeconds))
  next.lookupSeconds = Math.max(0, nonneg(current.lookupSeconds) - nonneg(sent.lookupSeconds))
  const palaceIds = new Set([
    ...Object.keys(current.byPalace || {}),
    ...Object.keys(sent.byPalace || {}),
  ])
  for (const palaceId of palaceIds) {
    const key = palaceKey(palaceId)
    if (!key) continue
    const left = current.byPalace[key] ?? emptyPalace()
    const right = sent.byPalace[key] ?? emptyPalace()
    const palace = {
      unitSeconds: Math.max(0, left.unitSeconds - right.unitSeconds),
      quizSeconds: Math.max(0, left.quizSeconds - right.quizSeconds),
      lookupSeconds: Math.max(0, left.lookupSeconds - right.lookupSeconds),
    }
    if (palace.unitSeconds || palace.quizSeconds || palace.lookupSeconds) {
      next.byPalace[key] = palace
    }
  }
  return next
}

/** Prefix of a pending buffer. Live flushes stay under the server add cap. */
export function takeFreestyleLearningChunk(
  time: FreestyleRoundLearningTime,
  maxSeconds = 900,
): FreestyleRoundLearningTime {
  const limit = nonneg(maxSeconds)
  const total = nonneg(time.unitSeconds) + nonneg(time.quizSeconds) + nonneg(time.lookupSeconds)
  if (limit <= 0 || total <= 0) return emptyFreestyleLearningTime()
  if (total <= limit) return time
  let budget = limit
  let taken = emptyFreestyleLearningTime()
  const buckets: Array<[FreestyleLearningBucket, keyof FreestylePalaceLearningSeconds]> = [
    ['unit', 'unitSeconds'],
    ['quiz', 'quizSeconds'],
    ['lookup', 'lookupSeconds'],
  ]
  for (const [bucket, field] of buckets) {
    let palaceSum = 0
    for (const [palaceId, palace] of Object.entries(time.byPalace || {})) {
      const amountOnPalace = nonneg(palace[field])
      palaceSum += amountOnPalace
      if (budget <= 0 || amountOnPalace <= 0) continue
      const amount = Math.min(amountOnPalace, budget)
      taken = addFreestyleLearningSeconds(taken, bucket, amount, Number(palaceId))
      budget -= amount
    }
    const remainder = Math.max(0, nonneg(time[field]) - palaceSum)
    if (budget > 0 && remainder > 0) {
      const amount = Math.min(remainder, budget)
      taken = addFreestyleLearningSeconds(taken, bucket, amount, null)
      budget -= amount
    }
  }
  return taken
}

export function freestyleLearningTotals(time: FreestyleRoundLearningTime | null | undefined) {
  const source = time ?? emptyFreestyleLearningTime()
  return {
    totalSeconds: source.unitSeconds + source.quizSeconds + source.lookupSeconds,
    quizSeconds: source.quizSeconds,
  }
}

/**
 * Top surface on the freestyle page.
 * Quiz counts only while the quiz overlay is the top surface.
 * 查看宫殿 is round time, not quiz time. Flip stays in unit dwell.
 */
export function classifyFreestyleLearningSurface(input: {
  visible: boolean
  viewingCard: boolean
  scene: string | null
  title: string | null
}): FreestyleLearningBucket | null {
  if (!input.visible || !input.viewingCard) return null
  const title = input.title || ''
  const scene = input.scene || ''
  if (title === LOOKUP_TITLE) return 'lookup'
  if (scene === 'quiz' || QUIZ_TITLES.has(title)) return 'quiz'
  if (scene === 'freestyle' || scene === '') return 'unit'
  return null
}
