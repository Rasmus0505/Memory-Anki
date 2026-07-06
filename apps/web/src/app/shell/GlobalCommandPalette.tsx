import { useEffect, useMemo, useState } from 'react'
import { BookOpen, Brain, LayoutDashboard, Plus, Search, Shuffle } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '@/shared/components/ui/command'

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

  const actions = useMemo(
    () => [
      {
        label: '开始复习',
        shortcut: 'Review',
        icon: Brain,
        run: () => navigate('/review'),
      },
      {
        label: '新建宫殿',
        shortcut: 'Ctrl+N',
        icon: Plus,
        run: () => navigate('/palaces/new'),
      },
      {
        label: '搜索宫殿',
        shortcut: '/',
        icon: Search,
        run: () => navigate('/palaces/list?focusSearch=true'),
      },
      {
        label: '记忆宫殿',
        shortcut: 'Palaces',
        icon: BookOpen,
        run: () => navigate('/palaces'),
      },
      {
        label: '随心模式',
        shortcut: 'Freestyle',
        icon: Shuffle,
        run: () => navigate('/freestyle'),
      },
      {
        label: '仪表盘',
        shortcut: 'Dashboard',
        icon: LayoutDashboard,
        run: () => navigate('/dashboard'),
      },
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

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="搜索操作或页面..." />
      <CommandList>
        <CommandEmpty>没有找到对应操作。</CommandEmpty>
        <CommandGroup heading="常用操作">
          {actions.map((action) => {
            const Icon = action.icon
            return (
              <CommandItem
                key={action.label}
                value={action.label}
                onSelect={() => {
                  action.run()
                  setOpen(false)
                }}
              >
                <Icon className="size-4" />
                <span>{action.label}</span>
                <CommandShortcut>{action.shortcut}</CommandShortcut>
              </CommandItem>
            )
          })}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
