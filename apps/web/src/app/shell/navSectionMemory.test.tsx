import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  resetNavSectionHistoryForTest,
  resolveNavSectionTarget,
  useRememberNavSectionVisit,
} from './navSectionMemory'
import { navSections } from './navSections'

const freestyleSection = navSections.find((section) => section.key === 'freestyle')!

function RememberProbe() {
  useRememberNavSectionVisit()
  return null
}

function visit(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <RememberProbe />
    </MemoryRouter>,
  )
}

describe('随心 entry remembers the last opened workspace', () => {
  beforeEach(() => {
    resetNavSectionHistoryForTest()
  })

  it('opens 随心 1 by default when nothing was visited yet', () => {
    expect(resolveNavSectionTarget(freestyleSection)).toBe('/freestyle')
  })

  it('switches back to 随心 1 when it was the last workspace opened', () => {
    visit('/freestyle-2')
    visit('/freestyle')
    expect(resolveNavSectionTarget(freestyleSection)).toBe('/freestyle')
  })
})
