export type SelectionToolbarActionVariant =
  | 'default'
  | 'destructive'
  | 'outline'
  | 'secondary'
  | 'ghost'

export interface SelectionToolbarAction {
  id: string
  label: string
  variant?: SelectionToolbarActionVariant
  disabled?: boolean
  onClick: () => void
}

export type SelectionToolbarPreferPosition = 'top' | 'bottom' | 'auto'
