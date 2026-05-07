import { createContext, useContext, type ReactNode } from 'react'

interface ShellContextValue {
  sidebarCollapsed: boolean
  setSidebarCollapsed: (collapsed: boolean) => void
}

const ShellContext = createContext<ShellContextValue | null>(null)

export function ShellProvider({
  value,
  children,
}: {
  value: ShellContextValue
  children: ReactNode
}) {
  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>
}

export function useShellContext() {
  return useContext(ShellContext)
}
