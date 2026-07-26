import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { useIntervalPreviews } from './useIntervalPreviews'

const previewMock = vi.fn()

vi.mock('@/modules/practice/ui/review/api/scheduleInsightApi', () => ({
  previewReviewIntervalsApi: (...args: unknown[]) => previewMock(...args),
}))

function previewItem(nodeUid: string, display: string) {
  return {
    palace_id: 3,
    node_uid: nodeUid,
    previews: [1, 2, 3, 4].map((rating) => ({
      rating,
      interval_seconds: rating * 600,
      due_at: '2026-07-27T00:00:00Z',
      display: `${display}-${rating}`,
      resulting_state: 2,
    })),
  }
}

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

describe('useIntervalPreviews', () => {
  beforeEach(() => {
    previewMock.mockReset()
  })

  it('batch-fetches current + upcoming cards and exposes display text per rating', async () => {
    previewMock.mockResolvedValue({
      items: [previewItem('a', '当前'), previewItem('b', '预取')],
    })
    const { result } = renderHook(
      () =>
        useIntervalPreviews({
          palaceId: 3,
          nodeUid: 'a',
          upcomingNodeUids: ['b'],
        }),
      { wrapper: createWrapper() },
    )

    await waitFor(() => {
      expect(result.current.previews).not.toBeNull()
    })
    expect(previewMock).toHaveBeenCalledTimes(1)
    expect(previewMock).toHaveBeenCalledWith([
      { palace_id: 3, node_uid: 'a' },
      { palace_id: 3, node_uid: 'b' },
    ])
    expect(result.current.getPreviewDisplay('a', 3)).toBe('当前-3')
    // 预取的下一张卡从缓存读取，不再发请求
    expect(result.current.getPreviewDisplay('b', 1)).toBe('预取-1')
  })

  it('never blocks rating when the preview request fails', async () => {
    previewMock.mockRejectedValue(new Error('offline'))
    const { result } = renderHook(
      () => useIntervalPreviews({ palaceId: 3, nodeUid: 'a' }),
      { wrapper: createWrapper() },
    )

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })
    expect(result.current.previews).toBeNull()
    expect(result.current.getPreviewDisplay('a', 3)).toBeNull()
  })
})
