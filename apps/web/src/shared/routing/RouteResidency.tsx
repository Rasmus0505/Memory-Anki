import { createContext, useContext, type ReactNode } from 'react'

export interface RouteResidencyValue {
  isActive: boolean
  pathname: string
  fullPath: string
  becameActiveAt: number
}

const RouteResidencyContext = createContext<RouteResidencyValue>({
  isActive: true,
  pathname: '/',
  fullPath: '/',
  becameActiveAt: 0,
})

export function RouteResidencyProvider({
  value,
  children,
}: {
  value: RouteResidencyValue
  children: ReactNode
}) {
  return <RouteResidencyContext.Provider value={value}>{children}</RouteResidencyContext.Provider>
}

export function useRouteResidency() {
  return useContext(RouteResidencyContext)
}
