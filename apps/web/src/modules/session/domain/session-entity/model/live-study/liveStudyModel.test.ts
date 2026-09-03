import { describe, expect, it } from 'vitest'
import {
  decodeLiveStudyEnvelope,
  encodeLiveStudyCommand,
  interpolateTimerSeconds,
  isFollowableStudyPath,
  shouldFollowLiveRoute,
} from './liveStudyModel'
import type { UnifiedTimerSnapshot } from '@/shared/components/session/desktopTimerBridge'

function timer(overrides: Partial<UnifiedTimerSnapshot>): UnifiedTimerSnapshot {
  return {
    mode: 'study',
    status: 'idle',
    title: '随心模式',
    scene: '学习计时',
    displaySeconds: 0,
    primaryText: '',
    secondaryText: '',
    availableActions: [],
    targetPath: '/freestyle',
    updatedAt: 1_000_000,
    effectiveSeconds: 0,
    ...overrides,
  }
}

describe('liveStudyModel', () => {
  it('decodes snake_case envelopes and ignores own follow when controller', () => {
    const envelope = decodeLiveStudyEnvelope({
      publisher_client_id: 'desktop',
      projection: {
        revision: 4,
        controller_client_id: 'desktop',
        route: '/freestyle',
        surface: 'freestyle',
        view: { currentCardId: 'card-1' },
        timer: timer({ status: 'running', effectiveSeconds: 9 }),
        updated_at: '2026-01-01T00:00:00Z',
      },
    })
    expect(envelope.publisherClientId).toBe('desktop')
    expect(envelope.projection.controllerClientId).toBe('desktop')
    expect(envelope.projection.view).toEqual({ currentCardId: 'card-1' })
    expect(
      shouldFollowLiveRoute({
        localPath: '/freestyle',
        isController: true,
        surface: 'freestyle',
        route: '/freestyle',
      }),
    ).toBe(false)
  })

  it('follows study routes from settings-idle pages only when already on a study path', () => {
    expect(isFollowableStudyPath('/settings')).toBe(false)
    expect(isFollowableStudyPath('/freestyle')).toBe(true)
    expect(
      shouldFollowLiveRoute({
        localPath: '/settings',
        isController: false,
        surface: 'freestyle',
        route: '/freestyle?palaceId=3',
      }),
    ).toBe(false)
    expect(
      shouldFollowLiveRoute({
        localPath: '/freestyle',
        isController: false,
        surface: 'freestyle',
        route: '/freestyle?palaceId=3',
      }),
    ).toBe(true)
  })

  it('interpolates running timer seconds from snapshot age', () => {
    const snapshot = timer({
      status: 'running',
      semanticState: 'running',
      effectiveSeconds: 10,
      updatedAt: 5_000,
    })
    expect(interpolateTimerSeconds(snapshot, 8_000)).toBe(13)
    expect(interpolateTimerSeconds({ ...snapshot, status: 'paused', semanticState: 'paused' }, 8_000)).toBe(10)
  })

  it('encodes commands without defaulting omitted view/timer fields', () => {
    expect(
      encodeLiveStudyCommand({
        clientId: 'pwa',
        operationId: 'op-1',
        takeControl: true,
        surface: 'freestyle',
      }),
    ).toEqual({
      type: 'publish',
      client_id: 'pwa',
      operation_id: 'op-1',
      take_control: true,
      surface: 'freestyle',
    })
  })
})
