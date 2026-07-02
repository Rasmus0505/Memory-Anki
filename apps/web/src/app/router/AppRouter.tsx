import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, type Location } from 'react-router-dom'
import { RouteResidencyProvider } from '@/shared/routing/RouteResidency'
import { AppRoutes } from '@/app/router/appRoutes'

const MAX_RESIDENT_ROUTE_COUNT = 4

interface ResidentRoute {
  location: Location
  becameActiveAt: number
  lastActiveOrder: number
}

function pruneResidentRoutes(
  routes: Record<string, ResidentRoute>,
  activePathname: string,
) {
  const entries = Object.entries(routes)
  if (entries.length <= MAX_RESIDENT_ROUTE_COUNT) return routes
  const retained = new Set(
    entries
      .filter(([pathname]) => pathname !== activePathname)
      .sort(([, left], [, right]) => right.lastActiveOrder - left.lastActiveOrder)
      .slice(0, MAX_RESIDENT_ROUTE_COUNT - 1)
      .map(([pathname]) => pathname),
  )
  retained.add(activePathname)
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

  const entries = useMemo(() => Object.entries(residentRoutes), [residentRoutes])

  return (
    <>
      {entries.map(([pathname, residentRoute]) => {
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
                becameActiveAt: residentRoute.becameActiveAt,
              }}
            >
              <AppRoutes location={residentRoute.location} />
            </RouteResidencyProvider>
          </div>
        )
      })}
    </>
  )
}
