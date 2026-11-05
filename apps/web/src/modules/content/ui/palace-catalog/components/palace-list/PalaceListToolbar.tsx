import { LayoutGrid, List, RotateCcw, Rows3, Search, WrapText, X } from 'lucide-react'
import type {
  PalaceListDensityMode,
  PalaceListLayoutMode,
  PalaceListViewSettings,
} from '@/modules/settings/public'
import { useEffect, useRef } from 'react'
import { DEFAULT_PALACE_LIST_VIEW_SETTINGS } from '@/modules/settings/public'
import { Button } from '@/shared/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/shared/components/ui/toggle-group'
import { Input } from '@/shared/components/ui/input'
import { PalaceViewSheet } from './PalaceViewSheet'

const listLayoutOptions: Array<{
  value: PalaceListLayoutMode
  label: string
  icon: typeof List
}> = [
  { value: 'chapter-single', label: '单列章节流', icon: List },
  { value: 'chapter-double', label: '章节内双列', icon: Rows3 },
  { value: 'chapter-card-grid', label: '章节知识点双列', icon: LayoutGrid },
  { value: 'flow', label: '知识点流', icon: WrapText },
]

const listDensityOptions: Array<{ value: PalaceListDensityMode; label: string }> = [
  { value: 'comfortable', label: '舒展' },
  { value: 'standard', label: '标准' },
  { value: 'compact', label: '紧凑' },
]

interface PalaceListToolbarProps {
  search: string
  viewSettings: PalaceListViewSettings
  onSearchChange: (value: string) => void
  onClearSearch: () => void
  onViewSettingsChange: (updater: (current: PalaceListViewSettings) => PalaceListViewSettings) => void
}

export function PalaceListToolbar({
  search,
  viewSettings,
  onSearchChange,
  onClearSearch,
  onViewSettingsChange,
}: PalaceListToolbarProps) {
  const searchInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('focusSearch') !== 'true') return
    searchInputRef.current?.focus()
    searchInputRef.current?.select()
    params.delete('focusSearch')
    const nextSearch = params.toString()
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`,
    )
  }, [])

  const layoutMode = viewSettings.layoutMode
  const layoutLabel = listLayoutOptions.find((option) => option.value === layoutMode)?.label ?? ''
  const densityLabel = listDensityOptions.find((option) => option.value === viewSettings.densityMode)?.label ?? ''

  return (
    <div className="flex items-center gap-2">
      <div className="relative min-w-0 flex-1 sm:max-w-sm">
        <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={searchInputRef}
          placeholder="搜索标题..."
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          className="pl-9 pr-9"
        />
        {search ? (
          <button
            type="button"
            aria-label="清除搜索"
            title="清除搜索"
            onClick={onClearSearch}
            className="absolute right-1.5 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        ) : null}
      </div>
      {/* Phones fold the layout and density rows into the 视图 sheet. */}
      <PalaceViewSheet
        title="宫殿视图"
        summary={[layoutLabel, densityLabel].filter(Boolean).join(' · ')}
        triggerTestId="list-view-sheet-trigger"
        layout={{
          label: '布局',
          options: listLayoutOptions,
          value: viewSettings.layoutMode,
          onChange: (value) =>
            onViewSettingsChange((current) => ({ ...current, layoutMode: value as PalaceListLayoutMode })),
        }}
        density={{
          label: '密度',
          options: listDensityOptions,
          value: viewSettings.densityMode,
          onChange: (value) =>
            onViewSettingsChange((current) => ({ ...current, densityMode: value as PalaceListDensityMode })),
        }}
        onReset={() => onViewSettingsChange(() => DEFAULT_PALACE_LIST_VIEW_SETTINGS)}
      />
      {/* Desktop: icon segments for layout, text segments for density; layout names live in tooltips. */}
      <div className="ml-auto hidden items-center gap-2 sm:flex" data-testid="list-view-toolbar">
        <ToggleGroup
          type="single"
          value={viewSettings.layoutMode}
          onValueChange={(value) => {
            if (value) onViewSettingsChange((current) => ({ ...current, layoutMode: value as PalaceListLayoutMode }))
          }}
          aria-label="布局"
        >
          {listLayoutOptions.map((option) => {
            const Icon = option.icon
            return (
              <ToggleGroupItem
                key={option.value}
                value={option.value}
                aria-label={option.label}
                title={option.label}
                className="px-2"
              >
                <Icon className="size-4" />
              </ToggleGroupItem>
            )
          })}
        </ToggleGroup>
        <ToggleGroup
          type="single"
          value={viewSettings.densityMode}
          onValueChange={(value) => {
            if (value) onViewSettingsChange((current) => ({ ...current, densityMode: value as PalaceListDensityMode }))
          }}
          aria-label="密度"
        >
          {listDensityOptions.map((option) => (
            <ToggleGroupItem key={option.value} value={option.value} className="text-xs">
              {option.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="恢复默认"
          title="恢复默认视图"
          className="text-muted-foreground"
          onClick={() => onViewSettingsChange(() => DEFAULT_PALACE_LIST_VIEW_SETTINGS)}
        >
          <RotateCcw />
        </Button>
      </div>
    </div>
  )
}
