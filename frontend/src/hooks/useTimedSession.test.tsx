import * as React from 'react'
import { render, act } from '@testing-library/react'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { useTimedSession } from '@/hooks/useTimedSession'
import type { TimeSessionRecord } from '@/lib/session-records'

function HookHarness(props: { onRender: (state: ReturnType<typeof useTimedSession>) => void }) {
  const state = useTimedSession({
    kind: 'review',
    title: '计时测试',
    palaceId: 1,
  })

  React.useEffect(() => {
    props.onRender(state)
  }, [props, state])

  return null
}

describe('useTimedSession', () => {
  let controller: ReturnType<typeof useTimedSession> | null = null

  beforeEach(() => {
    controller = null
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-08T08:00:00.000Z'))
    window.localStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('accumulates seconds while running, pauses cleanly, and resumes', () => {
    render(<HookHarness onRender={(state) => { controller = state }} />)
    expect(controller).not.toBeNull()

    act(() => {
      controller!.start({ source: 'manual' })
    })

    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(controller!.effectiveSeconds).toBe(3)

    act(() => {
      controller!.pause({ source: 'manual' })
      vi.advanceTimersByTime(3000)
    })
    expect(controller!.effectiveSeconds).toBe(3)

    act(() => {
      controller!.resume({ source: 'manual' })
      vi.advanceTimersByTime(2000)
    })
    expect(controller!.effectiveSeconds).toBe(5)
  })

  it('syncs the final elapsed second before completion', () => {
    render(<HookHarness onRender={(state) => { controller = state }} />)

    act(() => {
      controller!.start({ source: 'manual' })
      vi.advanceTimersByTime(1900)
    })

    let record: TimeSessionRecord | null = null
    act(() => {
      record = controller!.complete('manual_complete')
    })

    expect(controller!.effectiveSeconds).toBe(1)
    expect(record).not.toBeNull()
    expect(record!.effectiveSeconds).toBe(1)
  })
})
