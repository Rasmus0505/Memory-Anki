/** Settlement only clears completed-state display, never learning history or schedules. */
export function settlementQuizClearCopy(palaceCount: number): string {
  const count = Math.max(0, Math.round(palaceCount))
  const scope = count <= 1 ? '本轮涉及的这个宫殿' : `本轮涉及的全部 ${count} 个宫殿`
  return `是否保留${scope}的做题已完成状态？清除后可重新做题；学习历史、作答统计和复习安排不会删除。未完成的学习仍保留在本轮。`
}
