import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { APP_EVENT_NAMES, onAppEvent } from '@/shared/events/appEvents'

export const PALACE_CATALOG_INVALIDATED_EVENT = APP_EVENT_NAMES.palaceCatalogInvalidated
export const PALACE_CATALOG_GROUPED_QUERY_KEY = ['palace-catalog', 'grouped'] as const

export function buildPalaceCatalogGroupedQueryKey(params: Record<string, string>) {
  return [...PALACE_CATALOG_GROUPED_QUERY_KEY, params] as const
}

export function PalaceCatalogQueryInvalidationBridge() {
  const queryClient = useQueryClient()

  useEffect(() => {
    return onAppEvent(PALACE_CATALOG_INVALIDATED_EVENT, () => {
      void queryClient.invalidateQueries({ queryKey: PALACE_CATALOG_GROUPED_QUERY_KEY })
    })
  }, [queryClient])

  return null
}
