import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, type Location } from 'react-router-dom'
import { RouteResidencyProvider } from '@/shared/routing/RouteResidency'
import { AppRoutes } from '@/app/router/appRoutes'

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
      return {
        ...current,
        [activePathname]: location,
      }
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
  }, [activePathname, location])

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
