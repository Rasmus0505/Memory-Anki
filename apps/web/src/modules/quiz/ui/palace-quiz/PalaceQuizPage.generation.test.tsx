import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  renderPage,
  setupPalaceQuizPageTest,
} from '@/modules/quiz/ui/palace-quiz/PalaceQuizPage.test-utils'

describe('PalaceQuizPage generation entry', () => {
  beforeEach(setupPalaceQuizPageTest)

  it('does not offer the AI generation workspace', async () => {
    renderPage()
    expect(await screen.findByText('细胞生物学宫殿 · 配套习题')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'AI生成' })).toBeNull()
    expect(screen.queryByText('AI 题库生成工作台')).toBeNull()
  })
})
