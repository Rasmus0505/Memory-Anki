import { describe, expect, it } from 'vitest'
import { settlementQuizClearCopy } from './overlayQuizClearance'

describe('settlementQuizClearCopy', () => {
  it('asks once for every palace in the configured round', () => {
    expect(settlementQuizClearCopy(1)).toContain('这个宫殿')
    expect(settlementQuizClearCopy(1)).not.toContain('本轮复习已评完')
    const many = settlementQuizClearCopy(3)
    expect(many).toContain('全部 3 个宫殿')
    expect(many).toContain('保留则之后仍可查看')
  })
})
