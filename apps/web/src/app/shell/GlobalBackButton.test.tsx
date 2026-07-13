import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GlobalBackButton } from './GlobalBackButton'

const navigate = vi.fn()
let pathname = '/palaces/12'

vi.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname }),
  useNavigate: () => navigate,
}))

describe('GlobalBackButton', () => {
  beforeEach(() => {
    navigate.mockReset()
    pathname = '/palaces/12'
  })

  it('is hidden on a main route', () => {
    pathname = '/palaces'
    render(<GlobalBackButton />)
    expect(screen.queryByRole('button', { name: /返回/ })).toBeNull()
  })

  it('always uses the semantic parent route', () => {
    render(<GlobalBackButton />)
    fireEvent.click(screen.getByRole('button', { name: '返回宫殿书架' }))
    expect(navigate).toHaveBeenCalledWith('/palaces', { replace: true })
  })
  it('exits batch generation to the creation root', () => {
    pathname = '/batch-generation'
    render(<GlobalBackButton />)
    fireEvent.click(screen.getByRole('button', { name: '退出批量生成' }))
    expect(navigate).toHaveBeenCalledWith('/palaces/new', { replace: true })
  })

})
