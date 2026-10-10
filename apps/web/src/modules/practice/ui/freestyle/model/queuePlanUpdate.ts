import { reviewUnitIdFromCardId } from '@/modules/practice/domain/queueState'

const REVIEW_HINT_ID = 'review_hint:formal_review'

export interface QueuePlanUpdateCard {
  id: string
  type?: string
  palace_id?: number
  palace_title?: string
  unit_id?: string
  occurrence_kind?: string
  palace_context?: {
    id?: number
    title?: string
    resolved_title?: string
  } | null
}

export interface QueuePlanUpdateInput {
  before: readonly QueuePlanUpdateCard[]
  after: readonly QueuePlanUpdateCard[]
  completedIds: readonly string[]
  currentCardGone?: boolean
  queueEmpty?: boolean
}

const ALREADY_CURRENT = '已经是最新的'

export function isPalaceEditorPath(pathname: string | null | undefined): boolean {
  return /^\/palaces\/\d+\/edit\/?$/.test(String(pathname || '').split('?')[0] || '')
}

function palaceIdOf(card: QueuePlanUpdateCard): number | null {
  const direct = Number(card.palace_id)
  if (Number.isInteger(direct) && direct > 0) return direct
  const nested = Number(card.palace_context?.id)
  if (Number.isInteger(nested) && nested > 0) return nested
  return null
}

function palaceTitleOf(card: QueuePlanUpdateCard): string {
  const titled = String(card.palace_title || '').trim()
  if (titled) return titled
  const resolved = String(
    card.palace_context?.resolved_title || card.palace_context?.title || '',
  ).trim()
  if (resolved) return resolved
  const id = palaceIdOf(card)
  return id ? `宫殿 ${id}` : '未分类'
}

function isRetryCard(card: QueuePlanUpdateCard): boolean {
  return card.occurrence_kind === 'retry' || String(card.id || '').startsWith('retry:')
}

function isHintCard(card: QueuePlanUpdateCard): boolean {
  return card.type === 'review_hint' || card.id === REVIEW_HINT_ID
}

export function queueWorkIdentity(card: QueuePlanUpdateCard | null | undefined): string {
  if (!card || isHintCard(card) || isRetryCard(card)) return ''
  return String(card.unit_id || '').trim() || reviewUnitIdFromCardId(card.id) || card.id
}

function ratedIdentities(
  cards: readonly QueuePlanUpdateCard[],
  completedIds: readonly string[],
): Set<string> {
  const completed = new Set(completedIds.map((id) => String(id || '').trim()).filter(Boolean))
  const rated = new Set<string>()
  completed.forEach((id) => {
    const unit = reviewUnitIdFromCardId(id)
    if (unit) rated.add(unit)
  })
  cards.forEach((card) => {
    if (!completed.has(card.id)) return
    const identity = queueWorkIdentity(card) || card.id
    if (identity) rated.add(identity)
  })
  return rated
}

interface PalaceTally {
  title: string
  ids: Set<string>
}

function unratedByPalace(
  cards: readonly QueuePlanUpdateCard[],
  rated: Set<string>,
): Map<string, PalaceTally> {
  const palaces = new Map<string, PalaceTally>()
  cards.forEach((card) => {
    const identity = queueWorkIdentity(card)
    if (!identity || rated.has(identity) || rated.has(card.id)) return
    const palaceId = palaceIdOf(card)
    const key = palaceId != null ? `palace:${palaceId}` : `loose:${identity}`
    const current = palaces.get(key) ?? { title: palaceTitleOf(card), ids: new Set<string>() }
    if (!current.title || current.title.startsWith('宫殿 ')) {
      const title = palaceTitleOf(card)
      if (title && !title.startsWith('宫殿 ')) current.title = title
    }
    current.ids.add(identity)
    palaces.set(key, current)
  })
  return palaces
}

function ratedStillPresent(
  before: readonly QueuePlanUpdateCard[],
  after: readonly QueuePlanUpdateCard[],
  completedIds: readonly string[],
): boolean {
  const completed = new Set(completedIds.map((id) => String(id || '').trim()).filter(Boolean))
  const ratedCards = before.filter((card) => completed.has(card.id) && !isHintCard(card) && !isRetryCard(card))
  if (ratedCards.length === 0) return false
  const afterIds = new Set(after.map((card) => queueWorkIdentity(card) || card.id))
  return ratedCards.every((card) => afterIds.has(queueWorkIdentity(card) || card.id) || after.some((item) => item.id === card.id))
}

/**
 * One human sentence for「更新队列」.
 * Counts unrated work by unit, so a revision change is not "多了一张".
 */
export function describeQueuePlanUpdate(input: QueuePlanUpdateInput): string {
  const rated = ratedIdentities(input.before, input.completedIds)
  const beforePalaces = unratedByPalace(input.before, rated)
  const afterPalaces = unratedByPalace(input.after, rated)
  const keys: string[] = []
  beforePalaces.forEach((_value, key) => keys.push(key))
  afterPalaces.forEach((_value, key) => {
    if (!keys.includes(key)) keys.push(key)
  })
  const changes: string[] = []
  keys.forEach((key) => {
    const previous = beforePalaces.get(key)
    const next = afterPalaces.get(key)
    const added = [...(next?.ids ?? [])].filter((id) => !previous?.ids.has(id)).length
    const removed = [...(previous?.ids ?? [])].filter((id) => !next?.ids.has(id)).length
    if (added === 0 && removed === 0) return
    const title = next?.title || previous?.title || '未分类'
    const bits: string[] = []
    if (added > 0) bits.push(`多了 ${added} 张`)
    if (removed > 0) bits.push(`少了 ${removed} 张`)
    changes.push(`${title}${bits.join('，')}`)
  })
  const keptRated = ratedStillPresent(input.before, input.after, input.completedIds)
  const body = changes.length === 0
    ? ''
    : `${changes.join('，')}${keptRated ? '，已评的还在' : ''}`
  if (input.currentCardGone) {
    const lead = input.queueEmpty
      ? '这张不在了，这一轮没有剩下的牌'
      : '这张不在了，已换到下一张'
    return body ? `${lead}。${body}` : lead
  }
  return body || ALREADY_CURRENT
}
