/**
 * Freestyle unit-card load failures must not dump English API 400s as a
 * blocking banner. Heal when we can; otherwise offer choices.
 */

export type FreestyleUnitLoadCopy = {
  title: string
  hint: string
}

export function freestyleUnitLoadFailureCopy(error: unknown): FreestyleUnitLoadCopy {
  const message = String((error as { message?: string })?.message || error || '').toLowerCase()
  if (message.includes('passed review unit cannot start another encounter')) {
    return {
      title: '这张已经评过',
      hint: '可以改评分、只看不评，或跳过。',
    }
  }
  if (message.includes('not due')) {
    return {
      title: '这张现在还没到期',
      hint: '可以跳过、重建本轮，或只看不评。',
    }
  }
  if (
    message.includes('active unit review session required')
    || message.includes('open review encounter required')
  ) {
    return {
      title: '复习会话还没准备好',
      hint: '先重试；不行再跳过或重建本轮。',
    }
  }
  if (message.includes('review unit changed') || message.includes('rebuild the queue')) {
    return {
      title: '这张内容刚被改过',
      hint: '先重试；不行再重建本轮。',
    }
  }
  return {
    title: '这张卡暂时打不开',
    hint: '可以重试、跳过、重建本轮，或只看不评。',
  }
}
