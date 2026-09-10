import { describe, expect, it } from 'vitest'
import {
  isPassiveLiveStudyFollower,
  isPendingLiveStudyApply,
  isWeakerRevealMap,
  resolveFreestyleLiveFollowAction,
  shouldApplyLiveStudyView,
  shouldPublishLiveStudyView,
} from './shouldPublishLiveStudyView'

describe('shouldPublishLiveStudyView', () => {
  const base = {
    isActive: true,
    publishWhen: true,
    serialized: '{"questionId":22}',
    lastSent: '{"questionId":11}',
    isFollower: false,
    interactionUnchanged: false,
    pendingApply: false,
  }

  it('does not publish from a hidden keep-alive study page', () => {
    expect(shouldPublishLiveStudyView({ ...base, isActive: false })).toBe(false)
  })

  it('does not publish before the live room snapshot has arrived', () => {
    expect(shouldPublishLiveStudyView({ ...base, hydrated: false })).toBe(false)
  })

  it('does not overwrite a richer remote reveal map with a root-only local map', () => {
    expect(isWeakerRevealMap(
      { root: 'revealed', child: 'hidden' },
      { root: 'revealed', child: 'revealed' },
    )).toBe(true)
    expect(shouldPublishLiveStudyView({
      ...base,
      hydrated: true,
      weakerThanRemote: true,
    })).toBe(false)
  })

  it('does not let a follower echo load/apply take control', () => {
    expect(shouldPublishLiveStudyView({
      ...base,
      isFollower: true,
      lastSent: '',
    })).toBe(false)
    expect(shouldPublishLiveStudyView({
      ...base,
      isFollower: true,
      lastSent: '{"questionId":22}',
      serialized: '{"questionId":22,"tab":"practice"}',
      interactionUnchanged: true,
    })).toBe(false)
  })

  it('publishes a follower only after a real local interaction', () => {
    expect(shouldPublishLiveStudyView({
      ...base,
      isFollower: true,
      lastSent: '{"questionId":11}',
      serialized: '{"questionId":22}',
      interactionUnchanged: false,
    })).toBe(true)
  })

  it('skips the same-flush echo after apply writes lastSent but serialized is still empty/index-0', () => {
    const preApply = '{"palaceId":7,"tab":"practice","questionId":null,"questionIndex":0}'
    const applied = '{"palaceId":7,"tab":"practice","questionId":22,"questionIndex":1}'
    expect(isPendingLiveStudyApply({
      applyCommitted: true,
      serialized: preApply,
      lastSent: applied,
      interactionUnchanged: false,
    })).toBe(true)
    expect(shouldPublishLiveStudyView({
      isActive: true,
      publishWhen: true,
      serialized: preApply,
      lastSent: applied,
      isFollower: true,
      interactionUnchanged: false,
      pendingApply: true,
    })).toBe(false)
    expect(isPendingLiveStudyApply({
      applyCommitted: true,
      serialized: applied,
      lastSent: applied,
      interactionUnchanged: true,
    })).toBe(false)
  })

  it('consumes timer-only revision bumps without re-applying the same view', () => {
    expect(shouldApplyLiveStudyView({
      revision: 4,
      lastAppliedRevision: 4,
      viewJson: '{"currentCardId":"a"}',
      lastAppliedViewJson: '{"currentCardId":"a"}',
    })).toBe('skip')
    expect(shouldApplyLiveStudyView({
      revision: 5,
      lastAppliedRevision: 4,
      viewJson: '{"currentCardId":"a"}',
      lastAppliedViewJson: '{"currentCardId":"a"}',
    })).toBe('consume-revision')
    expect(shouldApplyLiveStudyView({
      revision: 5,
      lastAppliedRevision: 4,
      viewJson: '{"currentCardId":"b"}',
      lastAppliedViewJson: '{"currentCardId":"a"}',
    })).toBe('apply')
  })
})

describe('live follow retry and passive follower', () => {
  it('waits when the remote card is not in an empty queue', () => {
    expect(resolveFreestyleLiveFollowAction({
      applyDecision: 'apply',
      remoteCardId: 'card-2',
      localCardId: null,
      queueCardIds: [],
    })).toBe('wait-queue')
  })

  it('seeks once the queue contains the remote card', () => {
    expect(resolveFreestyleLiveFollowAction({
      applyDecision: 'apply',
      remoteCardId: 'card-2',
      localCardId: 'card-1',
      queueCardIds: ['card-1', 'card-2'],
    })).toBe('seek')
  })

  it('applies after the local card matches the remote card', () => {
    expect(resolveFreestyleLiveFollowAction({
      applyDecision: 'apply',
      remoteCardId: 'card-2',
      localCardId: 'card-2',
      queueCardIds: ['card-1', 'card-2'],
    })).toBe('apply')
  })

  it('abandons only after the hydrated queue truly lacks the card', () => {
    expect(resolveFreestyleLiveFollowAction({
      applyDecision: 'apply',
      remoteCardId: 'missing',
      localCardId: 'card-1',
      queueCardIds: ['card-1', 'card-2'],
    })).toBe('abandon')
  })

  it('follows a remote freestyle surface even when nobody is controller', () => {
    expect(isPassiveLiveStudyFollower({
      isController: false,
      controllerClientId: null,
      remoteSurface: 'freestyle',
      localSurface: 'freestyle',
    })).toBe(true)
    expect(isPassiveLiveStudyFollower({
      isController: false,
      controllerClientId: null,
      remoteSurface: 'idle',
      localSurface: 'freestyle',
    })).toBe(false)
  })
})
