import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { Button } from '@/shared/components/ui/button'
import { useNavigationHistory } from '@/shared/page-history/useNavigationHistory'
import { cn } from '@/shared/lib/utils'

type GlobalBackButtonPlacement = 'sidebar' | 'mobile'

type GlobalBackButtonProps = {
  /** sidebar: 侧栏左上角内联；mobile: 小屏浮动（大屏隐藏，随侧栏壳层） */
  placement?: GlobalBackButtonPlacement
  /** 侧栏收起时纵向排列图标 */
  compact?: boolean
}

/** Immersive feed owns its own top chrome; floating back/forward would cover the card. */
function isImmersiveFeedPath(pathname: string) {
  return (
    pathname === '/freestyle' ||
    pathname.startsWith('/freestyle/') ||
    pathname === '/m' ||
    pathname.startsWith('/m/') ||
    pathname === '/mobile' ||
    pathname.startsWith('/mobile/')
  )
}

export function GlobalBackButton({
  placement = 'sidebar',
  compact = false,
}: GlobalBackButtonProps) {
  const { pathname } = useLocation()
  const { canGoBack, canGoForward, goBack, goForward } = useNavigationHistory()
  // Bound to shell sidebar / mobile chrome — never surface in system fullscreen
  // where the sidebar is gone (mind-map / flip-card fullscreen).
  const [isSystemFullscreen, setIsSystemFullscreen] = useState(
    () => Boolean(document.fullscreenElement),
  )

  useEffect(() => {
    const handleFullscreenChange = () =>
      setIsSystemFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange)
  }, [])

  if (isSystemFullscreen) return null
  // Mobile freestyle/PWA entry: card HUD already covers the top edge.
  if (placement === 'mobile' && isImmersiveFeedPath(pathname)) return null

  const controls = (
    <div
      className={cn(
        'pointer-events-auto flex rounded-xl border border-border/70 bg-background/85 p-0.5 shadow-sm backdrop-blur-xl',
        compact ? 'flex-col gap-0.5' : 'items-center gap-0.5',
      )}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={cn('size-8', !canGoBack && 'opacity-45')}
        aria-label="后退"
        title="本分区上一页"
        disabled={!canGoBack}
        onClick={goBack}
      >
        <ArrowLeft className="size-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={cn('size-8', !canGoForward && 'opacity-45')}
        aria-label="前进"
        title="本分区下一页"
        disabled={!canGoForward}
        onClick={goForward}
      >
        <ArrowRight className="size-4" />
      </Button>
    </div>
  )

  if (placement === 'mobile') {
    return (
      <div className="pointer-events-none fixed left-[max(env(safe-area-inset-left),0.5rem)] top-[max(env(safe-area-inset-top),0.5rem)] z-[100] lg:hidden">
        {controls}
      </div>
    )
  }

  return controls
}
