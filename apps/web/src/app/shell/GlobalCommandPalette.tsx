import { Suspense, useDeferredValue, useEffect, useMemo, useState } from 'react'
import { Brain, Plus, Search } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import { globalSearchApi } from '@/modules/search/public'
import {
  readMemoryAnkiShortcuts,
  type MemoryAnkiShortcutMap,
} from '@/modules/settings/public'
import type { GlobalSearchResponse } from '@/shared/api/contracts'
import { navSections } from '@/app/shell/navSections'
import { readRecentVisits, recordRecentVisit, type RecentVisit } from '@/app/shell/recentVisits'
import { lazyWithRetry } from '@/shared/lib/lazyWithRetry'

export const preloadCommandPalette = () => import('@/app/shell/CommandPaletteSurface')

const CommandPaletteSurface = lazyWithRetry(preloadCommandPalette)

function isEditableTarget(target: EventTarget | null) {
  const element = target instanceof Element ? target : null
  if (!element) return false
  const tagName = element.tagName.toLowerCase()
  return (
    tagName === 'input' ||
    tagName === 'textarea' ||
    tagName === 'select' ||
    Boolean(element.closest('[contenteditable="true"]'))
  )
}

export function GlobalCommandPalette() {
  const navigate = useNavigate()
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const [recentVisits, setRecentVisits] = useState<RecentVisit[]>([])
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<GlobalSearchResponse | null>(null)
  const [shortcutMap, setShortcutMap] = useState<MemoryAnkiShortcutMap>(() => readMemoryAnkiShortcuts())
  const deferredQuery = useDeferredValue(query)

  useEffect(() => {
    const section = navSections.find((candidate) => candidate.matches(location.pathname))
    const label = section ? `${section.label} · ${location.pathname}` : location.pathname
    recordRecentVisit(`${location.pathname}${location.search}`, label)
  }, [location.pathname, location.search])

  const actions = useMemo(
    () => [
      { label: '开始随心复习', shortcut: '', icon: Brain, run: () => navigate('/freestyle') },
      { label: '新建宫殿', shortcut: 'Ctrl+N', icon: Plus, run: () => navigate('/palaces/new') },
      { label: '搜索宫殿', shortcut: '/', icon: Search, run: () => navigate('/palaces/list?focusSearch=true') },
    ],
    [navigate],
  )

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isEditableTarget(event.target)) return
      const key = event.key.toLowerCase()
      const commandKey = event.ctrlKey || event.metaKey
      if (commandKey && key === 'k') {
        event.preventDefault()
        setOpen((current) => !current)
        return
      }
      if (!event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && event.key === '?') {
        event.preventDefault()
        setQuery('')
        setOpen(true)
        return
      }
      if (event.ctrlKey && !event.metaKey && key === 'n') {
        event.preventDefault()
        navigate('/palaces/new')
        return
      }
      if (!event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && event.key === '/') {
        event.preventDefault()
        navigate('/palaces/list?focusSearch=true')
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [navigate])

  useEffect(() => {
    setOpen(false)
  }, [location.pathname, location.search])

  useEffect(() => {
    if (open) return
    setQuery('')
    setResults(null)
  }, [open])

  useEffect(() => {
    if (!open) return
    // 命令面板的重 UI 只在首次唤出时才需要，先把它的块请求出去。
    void preloadCommandPalette()
  }, [open])

  useEffect(() => {
    const trimmed = deferredQuery.trim()
    if (trimmed.length < 2) {
      setResults(null)
      return
    }
    let cancelled = false
    const timer = window.setTimeout(() => {
      globalSearchApi(trimmed)
        .then((data) => {
          if (!cancelled) setResults(data)
        })
        .catch(() => {
          if (!cancelled) setResults(null)
        })
    }, 200)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [deferredQuery])

  useEffect(() => {
    if (!open) return
    setRecentVisits(
      readRecentVisits().filter((item) => item.path !== `${location.pathname}${location.search}`),
    )
    setShortcutMap(readMemoryAnkiShortcuts())
  }, [open, location.pathname, location.search])

  if (!open) return null

  return (
    <Suspense fallback={null}>
      <CommandPaletteSurface
        open={open}
        onOpenChange={setOpen}
        query={query}
        onQueryChange={setQuery}
        results={results}
        recentVisits={recentVisits}
        shortcutMap={shortcutMap}
        actions={actions}
      />
    </Suspense>
  )
}
