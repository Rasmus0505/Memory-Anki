import { describe, expect, it } from 'vitest'
import {
  isPendingLiveStudyApply,
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
