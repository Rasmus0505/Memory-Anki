import { cn } from '@/shared/lib/utils'
import { parseApiDateTime } from '@/shared/lib/dateTime'
import type {
  PalaceListDensityMode,
  PalaceListLayoutMode,
} from '@/modules/settings/public'


export function getListSectionWrapperClass(layoutMode: PalaceListLayoutMode) {
  // Every grid below pins `grid-cols-1` (minmax(0,1fr)) on phones. Without it the implicit
  // `auto` track grows to a card's min-content width (nowrap titles + action buttons) and the
  // whole list overflows the viewport on narrow screens.
  if (layoutMode === 'chapter-card-grid') return 'grid grid-cols-1 gap-4 xl:grid-cols-2'
  return 'space-y-4'
}

export function getChapterPalaceGridClass(layoutMode: PalaceListLayoutMode) {
  if (layoutMode === 'chapter-double') return 'grid grid-cols-1 gap-3 xl:grid-cols-2'
  if (layoutMode === 'flow') return 'grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3'
  return 'space-y-3'
}

export function getUngroupedPalaceGridClass(layoutMode: PalaceListLayoutMode) {
  if (layoutMode === 'chapter-double' || layoutMode === 'chapter-card-grid') return 'grid grid-cols-1 gap-3 xl:grid-cols-2'
  if (layoutMode === 'flow') return 'grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3'
  return 'space-y-3'
}

export function getChapterCardClass(
  layoutMode: PalaceListLayoutMode,
  densityMode: PalaceListDensityMode,
) {
  const densityClass =
    densityMode === 'comfortable'
      ? 'rounded-3xl p-5'
      : densityMode === 'compact'
        ? 'rounded-2xl p-3'
        : 'rounded-3xl p-4'

  if (layoutMode === 'chapter-card-grid') {
    return cn('border border-border/70 bg-card/90 shadow-sm', densityClass)
  }
  if (layoutMode === 'flow') {
    return cn('border border-dashed border-border/60 bg-transparent', densityClass)
  }
  return 'mb-3'
}

export function getPalaceCardClass(densityMode: PalaceListDensityMode) {
  const lift = 'shadow-soft transition-[box-shadow,border-color,translate] duration-200 hover:-translate-y-px hover:border-foreground/15 hover:shadow-lift'
  return densityMode === 'compact' ? cn(lift, 'rounded-lg') : lift
}

export function getPalaceCardContentClass(densityMode: PalaceListDensityMode) {
  if (densityMode === 'comfortable') return 'px-5 py-4'
  if (densityMode === 'compact') return 'px-3 py-2'
  return 'px-4 py-3'
}

export function formatCreatedAt(value: string | null): string {
  if (!value) return '未知'
  const date = parseApiDateTime(value)
  if (Number.isNaN(date.getTime())) return '未知'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(date)
    .replace(/\//g, '-')
}
