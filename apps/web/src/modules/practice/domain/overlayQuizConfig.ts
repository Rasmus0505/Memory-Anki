import type {
  FreestyleOverlayQuestionKind,
  FreestyleOverlayRatingInherit,
  FreestyleOverlayTypeOrder,
  FreestyleOverlayTypePalaceNesting,
} from '@/shared/api/contracts'

export const FREESTYLE_OVERLAY_QUESTION_KINDS: FreestyleOverlayQuestionKind[] = [
  'objective',
  'subjective',
]

export const DEFAULT_OVERLAY_QUESTION_KINDS: FreestyleOverlayQuestionKind[] = [
  'objective',
  'subjective',
]

export const FREESTYLE_OVERLAY_TYPE_ORDERS: FreestyleOverlayTypeOrder[] = [
  'interleave',
  'objective_then_subjective',
  'subjective_then_objective',
]

export function asOverlayQuestionKinds(value: unknown): FreestyleOverlayQuestionKind[] {
  if (!Array.isArray(value)) return [...DEFAULT_OVERLAY_QUESTION_KINDS]
  const seen = new Set<FreestyleOverlayQuestionKind>()
  for (const item of value) {
    if (item === 'objective' || item === 'subjective') seen.add(item)
  }
  if (seen.size === 0) return [...DEFAULT_OVERLAY_QUESTION_KINDS]
  return FREESTYLE_OVERLAY_QUESTION_KINDS.filter((kind) => seen.has(kind))
}

export function asOverlayTypeOrder(value: unknown): FreestyleOverlayTypeOrder {
  return FREESTYLE_OVERLAY_TYPE_ORDERS.includes(value as FreestyleOverlayTypeOrder)
    ? (value as FreestyleOverlayTypeOrder)
    : 'interleave'
}

export function asOverlayTypePalaceNesting(value: unknown): FreestyleOverlayTypePalaceNesting {
  return value === 'type_then_palace' ? 'type_then_palace' : 'palace_then_type'
}

export function asOverlayRatingInherit(value: unknown): FreestyleOverlayRatingInherit {
  return value === 'blank' ? 'blank' : 'lowest_reviewed'
}
