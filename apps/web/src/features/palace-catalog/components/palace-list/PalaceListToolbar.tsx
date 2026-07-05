import { LayoutGrid, List, Rows3, Search, WrapText } from 'lucide-react'
import type {
  PalaceListDensityMode,
  PalaceListLayoutMode,
  PalaceListViewSettings,
} from '@/entities/preferences/model/palaceViewSettings'
import { DEFAULT_PALACE_LIST_VIEW_SETTINGS } from '@/entities/preferences/model/palaceViewSettings'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent } from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'

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
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[180px] flex-1">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="搜索标题..."
                value={search}
                onChange={(event) => onSearchChange(event.target.value)}
                className="pl-9"
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2" data-testid="list-view-toolbar">
            <div className="flex flex-wrap items-center gap-1 rounded-xl border border-border/70 bg-background/80 p-1">
              {listLayoutOptions.map((option) => {
                const Icon = option.icon
                return (
                  <Button
                    key={option.value}
                    type="button"
                    variant={viewSettings.layoutMode === option.value ? 'secondary' : 'ghost'}
                    size="sm"
                    className="h-8"
                    onClick={() =>
                      onViewSettingsChange((current) => ({ ...current, layoutMode: option.value }))
                    }
                  >
                    <Icon className="size-4" />
                    {option.label}
                  </Button>
                )
              })}
            </div>
            <div className="flex flex-wrap items-center gap-1 rounded-xl border border-border/70 bg-background/80 p-1">
              {listDensityOptions.map((option) => (
                <Button
                  key={option.value}
                  type="button"
                  variant={viewSettings.densityMode === option.value ? 'secondary' : 'ghost'}
                  size="sm"
                  className="h-8"
                  onClick={() =>
                    onViewSettingsChange((current) => ({ ...current, densityMode: option.value }))
                  }
                >
                  {option.label}
                </Button>
              ))}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onViewSettingsChange(() => DEFAULT_PALACE_LIST_VIEW_SETTINGS)}
            >
              恢复默认
            </Button>
          </div>
          {search ? (
            <Button variant="ghost" size="sm" onClick={onClearSearch}>
              清除搜索
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}
