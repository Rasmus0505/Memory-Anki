import {
  BookOpen,
  FileText,
  FolderTree,
  History,
  Keyboard,
  ListChecks,
  MapPin,
  type LucideIcon,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import {
  getShortcutLabel,
  MEMORY_ANKI_SHORTCUT_ACTIONS,
  type MemoryAnkiShortcutMap,
} from '@/modules/settings/public'
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
import type { RecentVisit } from '@/app/shell/recentVisits'
import { COMMAND_PAGES } from '@/shared/routing/routeManifest'
import { translateAppMessage } from '@/shared/i18n/messages'

/**
 * 命令面板的重 UI（cmdk + Radix Dialog）。它被 GlobalCommandPalette 懒加载，
 * 因此 cmdk 只随本模块进入异步块，不进首屏静态依赖。
 */

export interface CommandPaletteAction {
  label: string
  shortcut: string
  icon: LucideIcon
  run: () => void
}

export interface CommandPaletteSurfaceProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  query: string
  onQueryChange: (value: string) => void
  results: GlobalSearchResponse | null
  recentVisits: RecentVisit[]
  shortcutMap: MemoryAnkiShortcutMap
  actions: CommandPaletteAction[]
}

export default function CommandPaletteSurface({
  open,
  onOpenChange,
  query,
  onQueryChange,
  results,
  recentVisits,
  shortcutMap,
  actions,
}: CommandPaletteSurfaceProps) {
  const navigate = useNavigate()

  const runAndClose = (run: () => void) => {
    run()
    onOpenChange(false)
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        value={query}
        onValueChange={onQueryChange}
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
              onSelect={() => runAndClose(() => navigate('/profile'))}
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
          {COMMAND_PAGES.map((page) => (
            <CommandItem
              key={page.path}
              value={`page ${page.label} ${page.path}`}
              onSelect={() => runAndClose(() => navigate(page.path))}
            >
              <FileText className="size-4" />
              <span>{page.label}</span>
              <span className="min-w-0 truncate text-xs text-muted-foreground">{page.path}</span>
            </CommandItem>
          ))}
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
