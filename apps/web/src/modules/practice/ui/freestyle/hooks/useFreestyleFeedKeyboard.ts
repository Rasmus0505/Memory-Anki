import { useEffect } from 'react'
import {
  resolveFlipCardPageDirection,
  useMemoryAnkiShortcutMap,
} from '@/modules/settings/public'
import {
  isFreestyleOverlayOpen,
  isFreestyleShortcutBlocked,
} from '@/modules/practice/ui/freestyle/model/freestyleKeyboard'
import { useRouteResidency } from '@/shared/routing/RouteResidency'

/**
 * Page the 随心 feed from the keyboard even when focus is not inside the snap
 * scroller. The keys are the shared 翻卡设置 → 快捷键 上一张/下一张 bindings
 * (←/→ stay fixed aliases). Keys a dialog or text field owns are left alone.
 * Returns the live map so the scroller's own handler resolves the same keys.
 */
export function useFreestyleFeedKeyboard({
  navigateNext,
  navigatePrevious,
}: {
  navigateNext: () => void
  navigatePrevious: () => void
}) {
  const shortcuts = useMemoryAnkiShortcutMap()
  // A resident feed must not page while the learner is on another route.
  const { isActive } = useRouteResidency()

  useEffect(() => {
    if (!isActive) return undefined
    const handlePageNavigation = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented
        || event.isComposing
        || isFreestyleShortcutBlocked(event.target)
        // A modal owns the screen even when focus has not landed inside it yet.
        || isFreestyleOverlayOpen()
      ) return
      const direction = resolveFlipCardPageDirection(event, shortcuts)
      if (!direction) return
      event.preventDefault()
      if (direction === 'previous') {
        navigatePrevious()
        return
      }
      navigateNext()
    }
    window.addEventListener('keydown', handlePageNavigation, true)
    return () => window.removeEventListener('keydown', handlePageNavigation, true)
  }, [isActive, navigateNext, navigatePrevious, shortcuts])

  return shortcuts
}
