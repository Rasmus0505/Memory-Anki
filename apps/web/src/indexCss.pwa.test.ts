import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const indexCssPath = resolve(process.cwd(), 'src/index.css')

describe('index.css mobile PWA contract', () => {
  it('keeps iOS Safari standalone PWA content within safe areas', () => {
    const css = readFileSync(indexCssPath, 'utf8')

    expect(css).toContain('body.memory-anki-mobile-pwa')
    expect(css).toContain('padding-top: env(safe-area-inset-top, 0px);')
    expect(css).toContain('padding-bottom: env(safe-area-inset-bottom, 0px);')
  })

  it('prevents accidental iOS Safari quiz gesture selection while keeping fields editable', () => {
    const css = readFileSync(indexCssPath, 'utf8')

    expect(css).toContain('.memory-anki-mobile-pwa *')
    expect(css).toContain('touch-action: manipulation;')
    expect(css).toContain('-webkit-user-select: none;')
    expect(css).toContain('user-select: none;')
    expect(css).toContain('.memory-anki-mobile-pwa input,\n.memory-anki-mobile-pwa textarea')
    expect(css).toContain('-webkit-user-select: text;')
    expect(css).toContain('user-select: text;')
  })
})
