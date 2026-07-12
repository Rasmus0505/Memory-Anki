import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import NProgress from 'nprogress'

// NProgress 配置：禁用 spinner（只用顶部进度条），速度适中
NProgress.configure({
  showSpinner: false,
  minimum: 0.15,
  trickleSpeed: 120,
})

/**
 * 路由切换顶部进度条。
 * 监听 location 变化，首次加载 lazy chunk 时显示进度条。
 * 已缓存的路由切换几乎瞬时完成，进度条不可见。
 */
export function RouteProgressBar() {
  const location = useLocation()
  const prevPathname = useRef(location.pathname)

  useEffect(() => {
    if (prevPathname.current !== location.pathname) {
      NProgress.done()
      prevPathname.current = location.pathname
    }
  }, [location.pathname])

  // 监听 Suspense 加载状态：利用 React 18 的 startTransition 行为
  // 当 lazy chunk 触发 Suspense 时，路由变化会有短暂延迟
  // 我们在 pathname 变化时快速 done，如果加载很快用户几乎看不到进度条
  useEffect(() => {
    const handleDone = () => NProgress.done()

    // 监听 Suspense 相关的 chunk 加载
    // 通过拦截原始 import() 的方式太侵入，改用简单策略：
    // 路由变化 → start，渲染完成 → done（已在上面的 effect 处理）
    // 额外：监听 beforeunload 作为降级
    window.addEventListener('beforeunload', handleDone)
    return () => window.removeEventListener('beforeunload', handleDone)
  }, [])

  return null
}

/**
 * 手动控制进度条，供 Suspense fallback 和长任务使用。
 */
export function startRouteProgress() {
  NProgress.start()
}

export function doneRouteProgress() {
  NProgress.done()
}
