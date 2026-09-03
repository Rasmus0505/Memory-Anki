export interface EnglishReadingLiveView {
  articleId: number | null
  selectedIds: number[]
  targetId: number | null
  quote: string | null
}

export function decodeEnglishReadingLiveView(raw: unknown): EnglishReadingLiveView | null {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  return {
    articleId: typeof record.articleId === 'number' ? record.articleId : null,
    selectedIds: Array.isArray(record.selectedIds)
      ? record.selectedIds.filter((id): id is number => typeof id === 'number')
      : [],
    targetId: typeof record.targetId === 'number' ? record.targetId : null,
    quote: typeof record.quote === 'string' ? record.quote : null,
  }
}

export function applyEnglishReadingLiveView(
  current: EnglishReadingLiveView,
  remote: EnglishReadingLiveView,
): EnglishReadingLiveView {
  return {
    articleId: remote.articleId,
    selectedIds: remote.selectedIds,
    targetId: remote.targetId,
    quote: remote.quote,
  }
}

export function shouldClearEnglishReadingSelection(
  nextArticleId: number | null,
  live: EnglishReadingLiveView | null,
) {
  if (live && live.articleId != null && live.articleId === nextArticleId) return false
  return true
}

export function englishReadingSameInteraction(previous: EnglishReadingLiveView, next: EnglishReadingLiveView) {
  return previous.articleId === next.articleId
    && previous.targetId === next.targetId
    && previous.quote === next.quote
    && JSON.stringify(previous.selectedIds) === JSON.stringify(next.selectedIds)
}
