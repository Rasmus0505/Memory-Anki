import { useEffect, useState } from 'react'

/**
 * 全应用唯一的「减少动态效果」判断。
 *
 * 这个偏好以前在 14 个文件里各写了一遍，其中 9 处只在挂载时读一次
 * `mediaQuery.matches`，之后再也不更新 —— 用户在系统设置里打开该选项时，
 * 只有少数动效会停，其余的必须手动刷新页面才生效。
 *
 * 规则：
 * - 需要在事件回调 / 非 React 代码里同步取值 → `prefersReducedMotion()`
 * - 需要在 React 组件里响应变化 → `usePrefersReducedMotion()`
 * 两者共用同一个媒体查询订阅，不要在业务文件里再写内联版本。
 */
const QUERY = '(prefers-reduced-motion: reduce)'

/** 当前是否要求减少动态效果。非浏览器环境下保守返回 false。 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia(QUERY).matches
}

type Listener = () => void

const listeners = new Set<Listener>()
let mediaQuery: MediaQueryList | null = null
let notify: (() => void) | null = null

function ensureAttached() {
  if (mediaQuery) return
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
  const query = window.matchMedia(QUERY)
  notify = () => listeners.forEach((listener) => listener())
  // Safari < 14 only has the deprecated addListener.
  if (typeof query.addEventListener === 'function') {
    query.addEventListener('change', notify)
  } else {
    query.addListener(notify)
  }
  mediaQuery = query
}

function detachIfUnused() {
  if (!mediaQuery || listeners.size > 0) return
  if (notify) {
    if (typeof mediaQuery.removeEventListener === 'function') {
      mediaQuery.removeEventListener('change', notify)
    } else {
      mediaQuery.removeListener(notify)
    }
  }
  mediaQuery = null
  notify = null
}

/** 订阅偏好变化。仅供 usePrefersReducedMotion 使用。 */
export function subscribeReducedMotion(listener: Listener): () => void {
  ensureAttached()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    detachIfUnused()
  }
}

/** 响应系统「减少动态效果」开关的 React 版本。 */
export function usePrefersReducedMotion(): boolean {
  const [reducedMotion, setReducedMotion] = useState(prefersReducedMotion)

  useEffect(() => {
    const sync = () => setReducedMotion(prefersReducedMotion())
    // Re-sync on mount: the value may have changed between render and effect.
    sync()
    return subscribeReducedMotion(sync)
  }, [])

  return reducedMotion
}
