import { describe, expect, it } from 'vitest'
import {
  createCustomTimeRecordTag,
  listTimeRecordTagOptions,
  normalizeCustomTimeRecordTags,
  tagIdToSessionKind,
  validateCustomTagName,
} from '@/features/profile/model/time-record-tags'

describe('time-record-tags', () => {
  it('lists builtin tags before custom tags', () => {
    const options = listTimeRecordTagOptions([
      { id: 'tag_paper', name: '论文', createdAt: '2026-07-21T00:00:00.000Z' },
    ])
    expect(options.map((item) => item.id)).toEqual([
      'review',
      'practice',
      'quiz',
      'palace_edit',
      'tag_paper',
    ])
  })

  it('rejects empty or builtin-colliding custom names', () => {
    expect(validateCustomTagName('')).toEqual({ error: '标签名不能为空。' })
    expect(validateCustomTagName('练习')).toEqual({ error: '标签已存在。' })
  })

  it('creates custom tags and maps them to custom session kind', () => {
    const created = createCustomTimeRecordTag('论文', [])
    expect('tag' in created).toBe(true)
    if (!('tag' in created)) return
    expect(created.tag.name).toBe('论文')
    expect(tagIdToSessionKind(created.tag.id)).toBe('custom')
    expect(tagIdToSessionKind('review')).toBe('review')
  })

  it('normalizes preference payload and drops invalid entries', () => {
    expect(
      normalizeCustomTimeRecordTags([
        { id: 'tag_a', name: '读书' },
        { id: 'review', name: '伪造内置' },
        { name: 'missing-id' },
        null,
      ]),
    ).toEqual([
      expect.objectContaining({ id: 'tag_a', name: '读书' }),
    ])
  })
})
