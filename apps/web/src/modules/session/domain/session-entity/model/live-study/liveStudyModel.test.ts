import { describe, expect, it } from 'vitest'
import {
  decodeLiveStudyEnvelope,
  emptyLiveStudyProjection,
  encodeLiveStudyCommand,
  interpolateTimerSeconds,
  isFollowableStudyPath,
  preferNewerLiveStudyProjection,
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
    expect(envelope.projection.controllerCardId).toBeNull()
    expect(envelope.projection.controllerHeartbeatAt).toBeNull()
    expect(envelope.projection.controllerLeaseExpiresAt).toBeNull()
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

  it('decodes controller lease fields from snake_case and camelCase', () => {
    const snake = decodeLiveStudyEnvelope({
      publisher_client_id: 'pwa',
      projection: {
        revision: 2,
        controller_client_id: 'pwa',
        controller_card_id: 'card-9',
        controller_heartbeat_at: '2026-01-01T00:00:01Z',
        controller_lease_expires_at: '2026-01-01T00:00:09Z',
        route: '/freestyle',
        surface: 'freestyle',
        view: { currentCardId: 'card-9' },
        timer: null,
        updated_at: '2026-01-01T00:00:01Z',
      },
    }).projection
    expect(snake.controllerClientId).toBe('pwa')
    expect(snake.controllerCardId).toBe('card-9')
    expect(snake.controllerHeartbeatAt).toBe('2026-01-01T00:00:01Z')
    expect(snake.controllerLeaseExpiresAt).toBe('2026-01-01T00:00:09Z')

    const camel = decodeLiveStudyEnvelope({
      publisherClientId: 'desktop',
      projection: {
        revision: 3,
        controllerClientId: 'desktop',
        controllerCardId: 'card-2',
        controllerHeartbeatAt: 't1',
        controllerLeaseExpiresAt: 't2',
        route: '/freestyle',
        surface: 'freestyle',
        view: null,
        timer: null,
        updatedAt: 't1',
      },
    }).projection
    expect(camel.controllerClientId).toBe('desktop')
    expect(camel.controllerCardId).toBe('card-2')
    expect(camel.controllerHeartbeatAt).toBe('t1')
    expect(camel.controllerLeaseExpiresAt).toBe('t2')
  })

  it('encodes take_control, heartbeat, and card_id', () => {
    expect(
      encodeLiveStudyCommand({
        type: 'heartbeat',
        clientId: 'pwa',
        operationId: 'op-hb',
        cardId: 'card-7',
      }),
    ).toEqual({
      type: 'heartbeat',
      client_id: 'pwa',
      operation_id: 'op-hb',
      card_id: 'card-7',
    })
    expect(
      encodeLiveStudyCommand({
        type: 'take_control',
        clientId: 'desktop',
        operationId: 'op-tc',
        takeControl: true,
        cardId: 'card-3',
      }),
    ).toEqual({
      type: 'take_control',
      client_id: 'desktop',
      operation_id: 'op-tc',
      take_control: true,
      card_id: 'card-3',
    })
  })

  it('encodes hello without mutating omitted fields', () => {
    expect(
      encodeLiveStudyCommand({
        type: 'hello',
        clientId: 'pwa',
        operationId: 'op-hello',
      }),
    ).toEqual({
      type: 'hello',
      client_id: 'pwa',
      operation_id: 'op-hello',
    })
  })

  it('keeps a newer live projection and ignores an older revision', () => {
    const current = {
      ...emptyLiveStudyProjection(),
      revision: 4,
      updatedAt: 't4',
    }
    const incoming = {
      ...emptyLiveStudyProjection(),
      revision: 5,
      updatedAt: 't5',
      view: { currentCardId: 'card-2' },
    }
    expect(preferNewerLiveStudyProjection(current, incoming).revision).toBe(5)
    expect(preferNewerLiveStudyProjection(incoming, current).revision).toBe(5)
  })
})
