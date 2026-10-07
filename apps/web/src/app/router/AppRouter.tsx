import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, type Location } from 'react-router-dom'
import { RouteResidencyProvider } from '@/shared/routing/RouteResidency'
import { AppRoutes } from '@/app/router/appRoutes'
import { usePageHistoryAdapter } from '@/shared/page-history/usePageHistoryAdapter'

const MAX_RESIDENT_ROUTE_COUNT = 4

/**
 * 随心工作区在整段会话里保持挂载。
 *
 * 切换工作区（随心 ↔ 随心 2）和切去别的模块再切回来，都必须回到离开时的那张卡，
 * 而不是把队列清空重建、让用户再看一次加载态。进度本身一直有持久化
 * （localStorage + 服务端 round cursor），这里要保住的是「不需要重新搬一遍」。
 *
 * 代价是这两个页面的队列常驻内存；页面内所有定时器/预取都已按 isActive 分流，
 * 非当前页不会持续消耗 CPU。
 */
const ALWAYS_RESIDENT_ROUTE_PATTERNS: readonly RegExp[] = [
  /^\/freestyle$/,
  /^\/freestyle-2$/,
]

export function isAlwaysResidentRoute(pathname: string) {
  return ALWAYS_RESIDENT_ROUTE_PATTERNS.some((pattern) => pattern.test(pathname))
}

interface ResidentRoute {
  location: Location
  becameActiveAt: number
  lastActiveOrder: number
}

export function withActiveResidentRoute(
  routes: Record<string, ResidentRoute>,
  location: Location,
  nextActiveOrder: number,
  now = Date.now(),
) {
  const existing = routes[location.pathname]
  if (existing?.location === location) return routes
  return {
    ...routes,
    [location.pathname]: {
      location,
      becameActiveAt: existing?.becameActiveAt ?? now,
      lastActiveOrder: existing?.lastActiveOrder ?? nextActiveOrder,
    },
  }
}

function ResidentRouteHistory({ location }: { location: Location }) {
  usePageHistoryAdapter({ location })
  return <AppRoutes location={location} />
}

function pruneResidentRoutes(
  routes: Record<string, ResidentRoute>,
  activePathname: string,
) {
  const entries = Object.entries(routes)
  // Pinned 随心 workspaces never count against the budget and are never evicted.
  const pinned = entries.filter(([pathname]) => isAlwaysResidentRoute(pathname))
  const evictable = entries.filter(([pathname]) => !isAlwaysResidentRoute(pathname))
  // The budget applies to evictable routes only, so pinned workspaces can never
  // push ordinary pages out on their own, nor be pushed out by them.
  const budget = Math.max(1, MAX_RESIDENT_ROUTE_COUNT - pinned.length)
  if (evictable.length <= budget) return routes
  const retained = new Set(
    evictable
      .filter(([pathname]) => pathname !== activePathname)
      .sort(([, left], [, right]) => right.lastActiveOrder - left.lastActiveOrder)
      .slice(0, budget - 1)
      .map(([pathname]) => pathname),
  )
  retained.add(activePathname)
  for (const [pathname] of pinned) retained.add(pathname)
  return Object.fromEntries(entries.filter(([pathname]) => retained.has(pathname)))
}

export function AppRouter() {
  const location = useLocation()
  const activePathname = location.pathname
  const previousPathnameRef = useRef(activePathname)
  const activationOrderRef = useRef(0)
  const [residentRoutes, setResidentRoutes] = useState<Record<string, ResidentRoute>>(() => ({
    [activePathname]: {
      location,
      becameActiveAt: Date.now(),
      lastActiveOrder: 0,
    },
  }))

  useEffect(() => {
    const pathnameChanged = previousPathnameRef.current !== activePathname
    const nextBecameActiveAt = pathnameChanged ? Date.now() : null
    const nextLastActiveOrder = pathnameChanged ? activationOrderRef.current + 1 : null
    if (nextLastActiveOrder != null) {
      activationOrderRef.current = nextLastActiveOrder
    }
    setResidentRoutes((current) => {
      const existing = current[activePathname]
      const activeRoute = {
        location,
        becameActiveAt: nextBecameActiveAt ?? existing?.becameActiveAt ?? Date.now(),
        lastActiveOrder: nextLastActiveOrder ?? existing?.lastActiveOrder ?? activationOrderRef.current,
      }
      const next = pruneResidentRoutes(
        {
          ...current,
          [activePathname]: activeRoute,
        },
        activePathname,
      )
      if (
        existing?.location === location &&
        existing.becameActiveAt === activeRoute.becameActiveAt &&
        existing.lastActiveOrder === activeRoute.lastActiveOrder &&
        Object.keys(next).length === Object.keys(current).length
      ) {
        return current
      }
      return next
    })
    if (pathnameChanged) {
      previousPathnameRef.current = activePathname
    }
  }, [activePathname, location])

  // `useEffect` below persists and prunes the route after commit. Include the
  // active route here as well so navigation never commits a frame with every
  // resident page hidden.
  const routesForRender = useMemo(
    () => withActiveResidentRoute(residentRoutes, location, activationOrderRef.current + 1),
    [location, residentRoutes],
  )
  const entries = useMemo(() => Object.entries(routesForRender), [routesForRender])

  return (
    <>
      {entries.map(([pathname, residentRoute]) => {
        const isActive = pathname === activePathname
        return (
          <div
            key={pathname}
            data-page-history-route={pathname}
            aria-hidden={!isActive}
            inert={!isActive}
            className="flex h-full min-h-0 flex-1 flex-col"
            style={{ display: isActive ? 'flex' : 'none' }}
          >
            <RouteResidencyProvider
              value={{
                isActive,
                pathname,
                fullPath: `${residentRoute.location.pathname}${residentRoute.location.search}${residentRoute.location.hash}`,
                becameActiveAt: residentRoute.becameActiveAt,
              }}
            >
              <ResidentRouteHistory location={residentRoute.location} />
            </RouteResidencyProvider>
          </div>
        )
      })}
    </>
  )
}
