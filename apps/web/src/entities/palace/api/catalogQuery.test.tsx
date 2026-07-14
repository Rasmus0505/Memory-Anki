import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { emitAppEvent } from '@/shared/events/appEvents'
import {
  buildPalaceCatalogGroupedQueryKey,
  PALACE_CATALOG_INVALIDATED_EVENT,
  PalaceCatalogQueryInvalidationBridge,
} from './catalogQuery'

describe('PalaceCatalogQueryInvalidationBridge', () => {
  it('invalidates cached catalog data while catalog pages are unmounted', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
    })
    const queryKey = buildPalaceCatalogGroupedQueryKey({ subject_id: '1' })
    queryClient.setQueryData(queryKey, { groups: [], ungrouped: [], subjects: [] })

    render(
      <QueryClientProvider client={queryClient}>
        <PalaceCatalogQueryInvalidationBridge />
      </QueryClientProvider>,
    )

    expect(queryClient.getQueryState(queryKey)?.isInvalidated).toBe(false)
    emitAppEvent(PALACE_CATALOG_INVALIDATED_EVENT)

    await waitFor(() => {
      expect(queryClient.getQueryState(queryKey)?.isInvalidated).toBe(true)
    })
  })
})
