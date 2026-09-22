/** Settlement copy: one choice for every palace this 随心配置 round scheduled. */
export function settlementQuizClearCopy(palaceCount: number): string {
  const count = Math.max(0, Math.round(palaceCount))
  if (count <= 1) {
    return '本轮队列已完成。是否清除本次随心配置中这个宫殿的做题进度？清除后本轮做题里的已答记录不再保留，保留则之后仍可查看。'
  }
  return `本轮队列已完成。是否清除本次随心配置中全部 ${count} 个宫殿的做题进度？清除后这些宫殿在本轮做题里的已答记录不再保留，保留则之后仍可查看。`
}
