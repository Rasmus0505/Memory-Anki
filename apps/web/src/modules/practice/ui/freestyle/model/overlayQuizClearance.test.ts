import { describe, expect, it } from 'vitest'
import { settlementQuizClearCopy } from './overlayQuizClearance'

describe('settlementQuizClearCopy', () => {
  it('asks once for every palace in the configured round', () => {
    expect(settlementQuizClearCopy(1)).toContain('这个宫殿')
    expect(settlementQuizClearCopy(1)).not.toContain('本轮复习已评完')
    const many = settlementQuizClearCopy(3)
    expect(many).toContain('全部 3 个宫殿')
    expect(many).toContain('学习历史、作答统计和复习安排不会删除')
    expect(many).toContain('未完成的学习仍保留在本轮')
    expect(many).not.toContain('队列已完成')
    expect(many).not.toContain('随心配置')
  })
})
