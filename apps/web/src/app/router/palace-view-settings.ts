export type PalaceShelfLayoutMode = 'single' | 'double' | 'grid'
export type PalaceShelfDensityMode = 'comfortable' | 'standard' | 'compact'
export type PalaceShelfDisplayMode = 'shelf' | 'expanded'
export type PalaceListLayoutMode = 'chapter-single' | 'chapter-double' | 'chapter-card-grid' | 'flow'
export type PalaceListDensityMode = 'comfortable' | 'standard' | 'compact'

export interface PalaceShelfViewSettings {
  displayMode: PalaceShelfDisplayMode
  layoutMode: PalaceShelfLayoutMode
  expandedLayoutMode: PalaceListLayoutMode
  densityMode: PalaceShelfDensityMode
}

export interface PalaceListViewSettings {
  layoutMode: PalaceListLayoutMode
  densityMode: PalaceListDensityMode
}

export const PALACE_SHELF_VIEW_SETTINGS_KEY = 'palace_shelf_view_settings'
export const PALACE_LIST_VIEW_SETTINGS_KEY = 'palace_list_view_settings'

export const DEFAULT_PALACE_SHELF_VIEW_SETTINGS: PalaceShelfViewSettings = {
  displayMode: 'shelf',
  layoutMode: 'double',
  expandedLayoutMode: 'chapter-double',
  densityMode: 'standard',
}

export const DEFAULT_PALACE_LIST_VIEW_SETTINGS: PalaceListViewSettings = {
  layoutMode: 'chapter-double',
  densityMode: 'standard',
}

const shelfLayoutModes: PalaceShelfLayoutMode[] = ['single', 'double', 'grid']
const shelfDensityModes: PalaceShelfDensityMode[] = ['comfortable', 'standard', 'compact']
const shelfDisplayModes: PalaceShelfDisplayMode[] = ['shelf', 'expanded']
const listLayoutModes: PalaceListLayoutMode[] = ['chapter-single', 'chapter-double', 'chapter-card-grid', 'flow']
const listDensityModes: PalaceListDensityMode[] = ['comfortable', 'standard', 'compact']

export function isPalaceShelfViewSettings(value: unknown): value is PalaceShelfViewSettings {
  if (!value || typeof value !== 'object') return false
  const candidate = value as PalaceShelfViewSettings
  return (
    shelfDisplayModes.includes(candidate.displayMode) &&
    shelfLayoutModes.includes(candidate.layoutMode) &&
    listLayoutModes.includes(candidate.expandedLayoutMode) &&
    shelfDensityModes.includes(candidate.densityMode)
  )
}

export function isPalaceListViewSettings(value: unknown): value is PalaceListViewSettings {
  if (!value || typeof value !== 'object') return false
  const candidate = value as PalaceListViewSettings
  return listLayoutModes.includes(candidate.layoutMode) && listDensityModes.includes(candidate.densityMode)
}
