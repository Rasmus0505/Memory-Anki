export function deviceLocalCursor(
  cardIds: readonly string[],
  localCardId: string | null | undefined,
  savedCardId: string | null | undefined,
): string | null {
  if (localCardId && cardIds.includes(localCardId)) return localCardId
  if (savedCardId && cardIds.includes(savedCardId)) return savedCardId
  return cardIds[0] ?? null
}
