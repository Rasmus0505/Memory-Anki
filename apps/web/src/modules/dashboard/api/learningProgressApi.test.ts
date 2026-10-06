import { describe, expect, expectTypeOf, it } from 'vitest'
import type { components } from '@/shared/api/generated/learningProgress'
import type { LearningProgressResponse } from '@/shared/api/contracts/learningProgress'
import { decodeLearningProgress } from './learningProgressApi'

const metrics = { memory_total: 2, memory_reviewed: 1, memory_due: 0, quiz_total: 3, quiz_answered: 1 }
const leaf = { id: 'n:1', name: '记忆点', kind: 'memory_point', palace_id: 1, children: [], metrics }
const snapshot = { roots: [leaf], metrics, generated_at: '2026-10-01T12:00:00', notes: [] }

describe('learning progress API boundary', () => {
  it('matches the generated backend response contract', () => {
    expectTypeOf<LearningProgressResponse>().toEqualTypeOf<components['schemas']['LearningProgressResponse']>()
  })
  it('accepts the current read contract without inventing counts', () => {
    expect(decodeLearningProgress(snapshot)).toBe(snapshot)
    expect(decodeLearningProgress({ ...snapshot, roots: [] }).roots).toEqual([])
  })
  it.each([null, {}, { ...snapshot, roots: 'bad' }, { ...snapshot, notes: [42] }, { ...snapshot, metrics: { ...metrics, quiz_answered: 4 } }, { ...snapshot, roots: [leaf, leaf] }, { ...snapshot, roots: [{ ...leaf, metrics: {} }] }])('rejects malformed snapshots: %j', (value) => {
    expect(() => decodeLearningProgress(value)).toThrow('数据格式不兼容')
  })
})
