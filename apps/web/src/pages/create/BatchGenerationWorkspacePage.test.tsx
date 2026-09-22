import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import BatchGenerationWorkspacePage from './BatchGenerationWorkspacePage'

describe('BatchGenerationWorkspacePage', () => {
  it('shows that AI generation is disabled', () => {
    render(
      <MemoryRouter>
        <BatchGenerationWorkspacePage />
      </MemoryRouter>,
    )

    expect(screen.getByText('AI 出题、讲解、纠错和自由提问已禁用')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '删除当前工作区' })).toBeNull()
    expect(screen.queryByRole('button', { name: '宫殿调用包' })).toBeNull()
  })
})
