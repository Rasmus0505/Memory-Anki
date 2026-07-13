import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Button } from '@/shared/components/ui/button'
import { resolveGlobalBackPolicy } from './globalBackPolicy'

export function GlobalBackButton() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const [fullscreenElement, setFullscreenElement] = useState<Element | null>(() => document.fullscreenElement)
  const policy = resolveGlobalBackPolicy(pathname)

  useEffect(() => {
    const handleFullscreenChange = () => setFullscreenElement(document.fullscreenElement)
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange)
  }, [])

  if (!policy) return null

  const button = (
    <div className="pointer-events-none fixed left-[max(env(safe-area-inset-left),0.5rem)] top-[max(env(safe-area-inset-top),0.5rem)] z-[100] lg:left-auto lg:right-6 lg:top-6">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="pointer-events-auto gap-1.5 border-border/70 bg-background/85 shadow-lg backdrop-blur-xl"
        aria-label={policy.label}
        title={policy.label}
        onClick={() => navigate(policy.fallbackTo, { replace: true })}
      >
        <ArrowLeft className="size-4" />
        <span>{policy.label}</span>
      </Button>
    </div>
  )

  return fullscreenElement ? createPortal(button, fullscreenElement) : button
}
