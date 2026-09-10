import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(
  resolve(process.cwd(), 'src/modules/practice/ui/freestyle/ImmersiveFreestylePage.tsx'),
  'utf8',
)

describe('ImmersiveFreestylePage layout', () => {
  it('locks the snap scroller to one viewport without min-h-full cards', () => {
    expect(source).toContain('data-testid="freestyle-feed-scroller"')
    expect(source).toContain('min-h-0 flex-1 snap-y snap-mandatory')
    expect(source).toContain('h-full min-h-0 shrink-0 flex-col snap-start snap-always')
    expect(source).not.toContain('min-h-full')
  })
})
