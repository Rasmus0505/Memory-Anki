import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const indexCssPath = resolve(process.cwd(), 'src/index.css')
const celebrationsCssPath = resolve(process.cwd(), 'src/styles/celebrations.css')
const indexHtmlPath = resolve(process.cwd(), 'index.html')

describe('index.css desktop PWA contract', () => {
  it('enables installed-PWA safe-area viewport coordinates', () => {
    const html = readFileSync(indexHtmlPath, 'utf8')

    expect(html).toContain('viewport-fit=cover')
  })

  it('does not keep a separate mobile PWA stylesheet surface', () => {
    const css = readFileSync(indexCssPath, 'utf8')

    expect(css).not.toContain('memory-anki-mobile-pwa')
    expect(css).not.toContain('--mobile-safe-area-inset-top')
    expect(css).not.toContain('.mobile-tab-bar')
    expect(css).not.toContain('.mobile-touch-button')
  })

  it('keeps viewport fullscreen controls inside installed-PWA safe areas', () => {
    const css = readFileSync(celebrationsCssPath, 'utf8')

    expect(css).toContain(`[data-presentation-mode='viewport']`)
    expect(css).toContain('env(safe-area-inset-top, 0px)')
    expect(css).toContain('env(safe-area-inset-right, 0px)')
    expect(css).toContain('env(safe-area-inset-bottom, 0px)')
    expect(css).toContain('env(safe-area-inset-left, 0px)')
  })
})
