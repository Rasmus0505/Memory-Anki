import { QueryClient } from '@tanstack/react-query'

export function createAppQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 10 * 60_000,
        refetchOnWindowFocus: false,
        retry: (failureCount) => failureCount < 2,
        retryDelay: (attemptIndex) => Math.min(1_000 * 2 ** attemptIndex, 8_000),
      },
    },
  })
}
