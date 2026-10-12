/**
 * 启动耗时打点。index.html 在最早的 head 脚本里落一个 mark，入口和外壳再各落一个，
 * 浏览器 Performance 面板据此显示各段耗时；dev 下还会把摘要打到控制台，
 * 让「首屏缩短了多少」有数可依。任何异常都不能影响启动，所以全部吞掉。
 */

const BOOT_PREFIX = 'memory-anki:'

export function markBoot(name: string) {
  if (typeof performance === 'undefined' || typeof performance.mark !== 'function') return
  try {
    performance.mark(`${BOOT_PREFIX}${name}`)
  } catch {
    // 埋点失败不能影响启动
  }
}

export function measureBoot(from: string, to: string): number | null {
  if (typeof performance === 'undefined' || typeof performance.measure !== 'function') return null
  try {
    return performance.measure(`${BOOT_PREFIX}${from}->${to}`, `${BOOT_PREFIX}${from}`, `${BOOT_PREFIX}${to}`)
      .duration
  } catch {
    return null
  }
}

/** 汇总各段耗时，供控制台手动查看（dev 构建下自动调用一次）。 */
export function summarizeBoot(): Record<string, number> {
  const pairs: Array<[string, string]> = [
    ['html', 'entry'],
    ['entry', 'render'],
    ['render', 'shell'],
    ['html', 'shell'],
  ]
  const summary: Record<string, number> = {}
  for (const [from, to] of pairs) {
    const duration = measureBoot(from, to)
    if (duration != null) summary[`${from}->${to}`] = Math.round(duration)
  }
  return summary
}
