import type { useImmersiveQueue } from '@/modules/practice/ui/freestyle/hooks/useImmersiveQueue'

/** The queue facade the feed navigator drives; kept type-only. */
export type ImmersiveQueue = ReturnType<typeof useImmersiveQueue>

/** Parse a feed slot key (`slot:3`) or fall back to the card id. */
export function slotIndexOfKey(key: string, cardIds: readonly string[]): number {
  if (key.startsWith('slot:')) return Number(key.slice(5))
  return cardIds.indexOf(key)
}
