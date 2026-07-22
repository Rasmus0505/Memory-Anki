import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { Button } from '@/shared/components/ui/button'
import { useNavigationHistory } from '@/shared/page-history/useNavigationHistory'
import { cn } from '@/shared/lib/utils'

export function GlobalBackButton() {
  const { canGoBack, canGoForward, goBack, goForward } = useNavigationHistory()
  const [fullscreenElement, setFullscreenElement] = useState<Element | null>(
    () => document.fullscreenElement,
  )

  useEffect(() => {
    const handleFullscreenChange = () => setFullscreenElement(document.fullscreenElement)
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange)
  }, [])

  const button = (
    <div className="pointer-events-none fixed left-[max(env(safe-area-inset-left),0.5rem)] top-[max(env(safe-area-inset-top),0.5rem)] z-[100] lg:left-auto lg:right-6 lg:top-6">
      <div className="pointer-events-auto flex items-center gap-1 rounded-xl border border-border/70 bg-background/85 p-1 shadow-lg backdrop-blur-xl">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn('gap-1.5 px-2.5', !canGoBack && 'opacity-45')}
          aria-label="后退"
          title="后退到上一页"
          disabled={!canGoBack}
          onClick={goBack}
        >
          <ArrowLeft className="size-4" />
          <span className="hidden sm:inline">后退</span>
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn('gap-1.5 px-2.5', !canGoForward && 'opacity-45')}
          aria-label="前进"
          title="前进到下一页"
          disabled={!canGoForward}
          onClick={goForward}
        >
          <span className="hidden sm:inline">前进</span>
          <ArrowRight className="size-4" />
        </Button>
      </div>
    </div>
  )

  return fullscreenElement ? createPortal(button, fullscreenElement) : button
}
