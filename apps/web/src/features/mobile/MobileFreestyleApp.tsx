import { useEffect, useRef } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import FreestylePage from '@/features/freestyle/FreestylePage'
import { RouteResidencyProvider } from '@/shared/routing/RouteResidency'

function MobileFreestyleRoute() {
  const location = useLocation()
  const becameActiveAtRef = useRef(Date.now())

  return (
    <RouteResidencyProvider
      value={{
        isActive: true,
        pathname: location.pathname,
        becameActiveAt: becameActiveAtRef.current,
      }}
    >
      <FreestylePage />
    </RouteResidencyProvider>
  )
}

export default function MobileFreestyleApp() {
  useEffect(() => {
    document.documentElement.classList.add('memory-anki-mobile-pwa')
    document.body.classList.add('memory-anki-mobile-pwa')
    return () => {
      document.documentElement.classList.remove('memory-anki-mobile-pwa')
      document.body.classList.remove('memory-anki-mobile-pwa')
    }
  }, [])

  return (
    <Routes>
      <Route path="/m" element={<MobileFreestyleRoute />} />
      <Route path="/mobile" element={<MobileFreestyleRoute />} />
      <Route path="*" element={<Navigate to="/m" replace />} />
    </Routes>
  )
}
