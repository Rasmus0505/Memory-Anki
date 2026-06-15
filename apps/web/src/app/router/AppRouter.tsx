import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, type Location } from 'react-router-dom'
import { RouteResidencyProvider } from '@/app/router/RouteResidency'
import { AppRoutes } from '@/app/router/appRoutes'

export const MAX_CACHED_ENTRIES = 12

/**
 * 计算加入新条目后、超过上限时需要驱逐的缓存 key 列表（LRU）。
 * 纯函数，便于单元测试；当前活动条目永不驱逐。
 *
 * @param keys 当前缓存中的全部 key
 * @param activeKey 当前活动 key（不可被驱逐）
 * @param activationTimes 每个 key 最近一次激活的时间戳
 * @param maxEntries 缓存上限
 * @returns 应被驱逐的 key 数组
 */
export function computeLruEvictions(
  keys: string[],
  activeKey: string,
  activationTimes: Record<string, number>,
  maxEntries: number,
): string[] {
  if (keys.length <= maxEntries) return []
  const evictCount = keys.length - maxEntries
  const candidates = keys
    .filter((key) => key !== activeKey)
    .sort((a, b) => (activationTimes[a] ?? 0) - (activationTimes[b] ?? 0))
  return candidates.slice(0, evictCount)
}

export function AppRouter() {
  const location = useLocation()
  const activePathname = location.pathname
  const previousPathnameRef = useRef(activePathname)
  const [cachedLocations, setCachedLocations] = useState<Record<string, Location>>(() => ({
    [activePathname]: location,
  }))
  const [activationTimes, setActivationTimes] = useState<Record<string, number>>(() => ({
    [activePathname]: Date.now(),
  }))

  useEffect(() => {
    setCachedLocations((current) => {
      if (current[activePathname] === location) {
        return current
      }
      const next: Record<string, Location> = {
        ...current,
        [activePathname]: location,
      }
      // LRU 上限保护：超过 MAX_CACHED_ENTRIES 时驱逐最久未激活的条目。
      const evictions = computeLruEvictions(
        Object.keys(next),
        activePathname,
        activationTimes,
        MAX_CACHED_ENTRIES,
      )
      for (const key of evictions) {
        delete next[key]
      }
      return next
    })

    if (previousPathnameRef.current !== activePathname) {
      previousPathnameRef.current = activePathname
      setActivationTimes((current) => ({
        ...current,
        [activePathname]: Date.now(),
      }))
      return
    }

    setActivationTimes((current) => {
      if (current[activePathname]) return current
      return {
        ...current,
        [activePathname]: Date.now(),
      }
    })
  }, [activePathname, location, activationTimes])

  const entries = useMemo(
    () => Object.entries(cachedLocations),
    [cachedLocations],
  )

  return (
    <>
      {entries.map(([pathname, cachedLocation]) => {
        const isActive = pathname === activePathname
        return (
          <div
            key={pathname}
            aria-hidden={!isActive}
            style={{ display: isActive ? 'block' : 'none' }}
          >
            <RouteResidencyProvider
              value={{
                isActive,
                pathname,
                becameActiveAt: activationTimes[pathname] ?? 0,
              }}
            >
              <AppRoutes location={cachedLocation} />
            </RouteResidencyProvider>
          </div>
        )
      })}
    </>
  )
}
