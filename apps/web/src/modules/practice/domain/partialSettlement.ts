/**
 * A 小结算 recorded when 「结算已完成」 is confirmed.
 * The closing 大结算 reads these snapshots because compressed cards leave the feed.
 */

export interface FreestylePartialSettlementPalace {
  palaceId: number
  palaceTitle: string
  cardCount: number
  effectiveSeconds: number
}

export interface FreestylePartialSettlementSubject {
  subjectId: number | null
  subjectName: string
  palaceCount: number
  cardCount: number
  effectiveSeconds: number
  palaces: FreestylePartialSettlementPalace[]
}

export interface FreestylePartialSettlementSnapshot {
  id: string
  cardIds: string[]
  cardCount: number
  ratedCount: number
  passedCount: number
  retryCount: number
  quizCount: number
  totalEffectiveSeconds: number
  quizSeconds: number
  bySubject: FreestylePartialSettlementSubject[]
}

function asString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function asCount(value: unknown) {
  const number = Math.round(Number(value))
  return Number.isFinite(number) && number > 0 ? number : 0
}

function asId(value: unknown) {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : null
}

function asSubjects(value: unknown): FreestylePartialSettlementSubject[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return []
    const item = raw as Record<string, unknown>
    const subjectName = asString(item.subjectName) || asString(item.subject_name) || '未分类'
    const palaces = Array.isArray(item.palaces)
      ? item.palaces.flatMap((palace) => {
          if (!palace || typeof palace !== 'object') return []
          const row = palace as Record<string, unknown>
          const palaceId = asId(row.palaceId ?? row.palace_id) ?? 0
          return [{
            palaceId,
            palaceTitle: asString(row.palaceTitle) || asString(row.palace_title) || (palaceId ? `宫殿 ${palaceId}` : '未分类'),
            cardCount: asCount(row.cardCount ?? row.card_count),
            effectiveSeconds: asCount(row.effectiveSeconds ?? row.effective_seconds),
          }]
        })
      : []
    return [{
      subjectId: asId(item.subjectId ?? item.subject_id),
      subjectName,
      palaceCount: asCount(item.palaceCount ?? item.palace_count) || palaces.length,
      cardCount: asCount(item.cardCount ?? item.card_count),
      effectiveSeconds: asCount(item.effectiveSeconds ?? item.effective_seconds),
      palaces,
    }]
  })
}

export function parsePartialSettlement(value: unknown): FreestylePartialSettlementSnapshot | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const id = asString(raw.id)
  const cardIds = Array.isArray(raw.cardIds)
    ? raw.cardIds
    : Array.isArray(raw.card_ids)
      ? raw.card_ids
      : []
  const ids = [...new Set(cardIds.map((item) => asString(item)).filter(Boolean))]
  if (!id || !ids.length) return null
  return {
    id,
    cardIds: ids,
    cardCount: asCount(raw.cardCount ?? raw.card_count) || ids.length,
    ratedCount: asCount(raw.ratedCount ?? raw.rated_count),
    passedCount: asCount(raw.passedCount ?? raw.passed_count),
    retryCount: asCount(raw.retryCount ?? raw.retry_count),
    quizCount: asCount(raw.quizCount ?? raw.quiz_count),
    totalEffectiveSeconds: asCount(raw.totalEffectiveSeconds ?? raw.total_effective_seconds),
    quizSeconds: asCount(raw.quizSeconds ?? raw.quiz_seconds),
    bySubject: asSubjects(raw.bySubject ?? raw.by_subject),
  }
}

export function parsePartialSettlements(value: unknown): FreestylePartialSettlementSnapshot[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  return value.flatMap((item) => {
    const parsed = parsePartialSettlement(item)
    if (!parsed || seen.has(parsed.id)) return []
    seen.add(parsed.id)
    return [parsed]
  })
}

/** Union by id. A local confirm survives a hydrate that has not echoed it yet. */
export function mergePartialSettlementLists(
  local: readonly FreestylePartialSettlementSnapshot[] | undefined,
  incoming: unknown,
): FreestylePartialSettlementSnapshot[] {
  const merged = parsePartialSettlements(local)
  const seen = new Set(merged.map((item) => item.id))
  parsePartialSettlements(incoming).forEach((item) => {
    if (seen.has(item.id)) return
    seen.add(item.id)
    merged.push(item)
  })
  return merged
}

export function toServerPartialSettlement(snapshot: FreestylePartialSettlementSnapshot) {
  return {
    id: snapshot.id,
    card_ids: snapshot.cardIds,
    card_count: snapshot.cardCount,
    rated_count: snapshot.ratedCount,
    passed_count: snapshot.passedCount,
    retry_count: snapshot.retryCount,
    quiz_count: snapshot.quizCount,
    total_effective_seconds: snapshot.totalEffectiveSeconds,
    quiz_seconds: snapshot.quizSeconds,
    by_subject: snapshot.bySubject.map((subject) => ({
      subject_id: subject.subjectId,
      subject_name: subject.subjectName,
      palace_count: subject.palaceCount,
      card_count: subject.cardCount,
      effective_seconds: subject.effectiveSeconds,
      palaces: subject.palaces.map((palace) => ({
        palace_id: palace.palaceId,
        palace_title: palace.palaceTitle,
        card_count: palace.cardCount,
        effective_seconds: palace.effectiveSeconds,
      })),
    })),
  }
}
