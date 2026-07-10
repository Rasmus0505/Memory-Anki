import { useEffect, type PropsWithChildren } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { readLastPageHistoryWorkspacePath } from './pageHistoryStore'
import {
  getPageHistoryWorkspaceId,
  startPageHistoryWorkspaceHeartbeat,
} from './pageHistoryWorkspace'

const LAUNCH_RESTORED_KEY = 'memory-anki.page-history.launch-restored'

function isStandalonePwa() {
  const standaloneNavigator = navigator as Navigator & { standalone?: boolean }
  return standaloneNavigator.standalone === true ||
    window.matchMedia?.('(display-mode: standalone)').matches === true
}

export function PageHistoryCoordinator({ children }: PropsWithChildren) {
  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => startPageHistoryWorkspaceHeartbeat(getPageHistoryWorkspaceId()), [])

  useEffect(() => {
    try {
      if (window.sessionStorage.getItem(LAUNCH_RESTORED_KEY)) return
      window.sessionStorage.setItem(LAUNCH_RESTORED_KEY, '1')
    } catch {
      return
    }
    const canRestoreLaunch = location.pathname === '/' ||
      (location.pathname === '/freestyle' && isStandalonePwa())
    if (!canRestoreLaunch) return
    const target = readLastPageHistoryWorkspacePath()
    const current = `${location.pathname}${location.search}${location.hash}`
    if (target && target !== current) navigate(target, { replace: true })
  }, [location.hash, location.pathname, location.search, navigate])

  return children
}
