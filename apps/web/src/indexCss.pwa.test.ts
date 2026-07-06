import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const indexCssPath = resolve(process.cwd(), 'src/index.css')

describe('index.css desktop PWA contract', () => {
  it('does not keep a separate mobile PWA stylesheet surface', () => {
    const css = readFileSync(indexCssPath, 'utf8')

    expect(css).not.toContain('memory-anki-mobile-pwa')
    expect(css).not.toContain('--mobile-safe-area-inset-top')
    expect(css).not.toContain('.mobile-tab-bar')
    expect(css).not.toContain('.mobile-touch-button')
  })
})
