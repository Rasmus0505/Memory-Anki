import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { BookOpen, Brain, FolderTree, History, Keyboard, ListChecks, MapPin, Plus, Search } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import { globalSearchApi } from '@/entities/search/api'
import {
  getShortcutLabel,
  MEMORY_ANKI_SHORTCUT_ACTIONS,
  readMemoryAnkiShortcuts,
  type MemoryAnkiShortcutMap,
} from '@/entities/preferences/model/memoryAnkiShortcuts'
import type { GlobalSearchResponse } from '@/shared/api/contracts'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '@/shared/components/ui/command'
import { navSections } from '@/app/shell/navSections'
import { readRecentVisits, recordRecentVisit, type RecentVisit } from '@/app/shell/recentVisits'
import { translateAppMessage } from '@/shared/i18n/messages'

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
      { label: '开始今日复习', shortcut: '', icon: Brain, run: () => navigate('/review') },
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

  const runAndClose = (run: () => void) => {
    run()
    setOpen(false)
  }

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder={translateAppMessage('command.searchPlaceholder')}
      />
      <CommandList>
        <CommandEmpty>{translateAppMessage('command.noResults')}</CommandEmpty>

        {recentVisits.length > 0 ? (
          <CommandGroup heading={translateAppMessage('command.group.recent')}>
            {recentVisits.map((visit) => (
              <CommandItem
                key={visit.path}
                value={`recent ${visit.label}`}
                onSelect={() => runAndClose(() => navigate(visit.path))}
              >
                <History className="size-4" />
                <span className="truncate">{visit.label}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        <CommandGroup heading={translateAppMessage('command.group.actions')}>
          {actions.map((action) => {
            const Icon = action.icon
            return (
              <CommandItem
                key={action.label}
                value={action.label}
                onSelect={() => runAndClose(action.run)}
              >
                <Icon className="size-4" />
                <span>{action.label}</span>
                {action.shortcut ? <CommandShortcut>{action.shortcut}</CommandShortcut> : null}
              </CommandItem>
            )
          })}
        </CommandGroup>

        <CommandGroup heading={translateAppMessage('command.group.shortcuts')}>
          {MEMORY_ANKI_SHORTCUT_ACTIONS.map((action) => (
            <CommandItem
              key={action.id}
              value={`shortcut 快捷键 ${action.label} ${action.description}`}
              onSelect={() => runAndClose(() => navigate('/profile/settings'))}
            >
              <Keyboard className="size-4" />
              <span className="truncate">{action.label}</span>
              <span className="min-w-0 truncate text-xs text-muted-foreground">{action.description}</span>
              <CommandShortcut>{getShortcutLabel(shortcutMap[action.id])}</CommandShortcut>
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandGroup heading={translateAppMessage('command.group.pages')}>
          {navSections.map((section) => {
            const Icon = section.icon
            return (
              <CommandItem
                key={section.key}
                value={`page ${section.label}`}
                onSelect={() => runAndClose(() => navigate(section.to))}
              >
                <Icon className="size-4" />
                <span>{section.label}</span>
              </CommandItem>
            )
          })}
        </CommandGroup>

        {results && results.palaces.length > 0 ? (
          <CommandGroup heading="宫殿">
            {results.palaces.map((hit) => (
              <CommandItem
                key={`palace-${hit.id}`}
                value={`palace-${hit.id}-${query}`}
                onSelect={() => runAndClose(() => navigate(`/palaces/${hit.id}`))}
              >
                <BookOpen className="size-4" />
                <span className="truncate">{hit.title}</span>
                {hit.snippet ? (
                  <span className="min-w-0 truncate text-xs text-muted-foreground">
                    {hit.snippet}
                  </span>
                ) : null}
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        {results && results.pegs.length > 0 ? (
          <CommandGroup heading="记忆桩">
            {results.pegs.map((hit) => (
              <CommandItem
                key={`peg-${hit.id}`}
                value={`peg-${hit.id}-${query}`}
                onSelect={() => runAndClose(() => navigate(`/palaces/${hit.palace_id}/edit`))}
              >
                <MapPin className="size-4" />
                <span className="truncate">{hit.name}</span>
                <span className="min-w-0 truncate text-xs text-muted-foreground">
                  {hit.snippet || hit.palace_title}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        {results && results.questions.length > 0 ? (
          <CommandGroup heading="题目">
            {results.questions.map((hit) => (
              <CommandItem
                key={`question-${hit.id}`}
                value={`question-${hit.id}-${query}`}
                onSelect={() =>
                  runAndClose(() => navigate(hit.palace_id ? `/palaces/${hit.palace_id}/quiz` : '/knowledge'))
                }
              >
                <ListChecks className="size-4" />
                <span className="min-w-0 truncate">{hit.snippet}</span>
                {hit.palace_title ? (
                  <span className="truncate text-xs text-muted-foreground">{hit.palace_title}</span>
                ) : null}
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        {results && results.chapters.length > 0 ? (
          <CommandGroup heading="章节">
            {results.chapters.map((hit) => (
              <CommandItem
                key={`chapter-${hit.id}`}
                value={`chapter-${hit.id}-${query}`}
                onSelect={() => runAndClose(() => navigate('/knowledge'))}
              >
                <FolderTree className="size-4" />
                <span className="truncate">{hit.name}</span>
                {hit.subject_name ? (
                  <span className="truncate text-xs text-muted-foreground">{hit.subject_name}</span>
                ) : null}
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
      </CommandList>
    </CommandDialog>
  )
}
