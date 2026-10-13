import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const indexCssPath = resolve(process.cwd(), 'src/index.css')
const layoutCssPath = resolve(process.cwd(), 'src/styles/layout.css')
const foundationCssPath = resolve(process.cwd(), 'src/styles/foundation.css')
const indexHtmlPath = resolve(process.cwd(), 'index.html')

describe('index.css desktop PWA contract', () => {
  it('enables installed-PWA safe-area viewport coordinates', () => {
    const html = readFileSync(indexHtmlPath, 'utf8')

    expect(html).toContain('viewport-fit=cover')
  })

  it('keeps boot failures fully diagnosable and copyable before React mounts', () => {
    const html = readFileSync(indexHtmlPath, 'utf8')

    expect(html).toContain('meta[name="memory-anki-release"]')
    expect(html).toContain('serviceWorkerController')
    expect(html).toContain('display_mode=')
    expect(html).toContain('error_name=')
    expect(html).toContain('error_message=')
    expect(html).toContain('error_stack=')
    expect(html).toContain('document.execCommand(\'copy\')')
    expect(html).toContain('boot_elapsed_ms=')
  })

  it('does not keep a separate mobile PWA stylesheet surface', () => {
    const css = readFileSync(indexCssPath, 'utf8')

    expect(css).not.toContain('memory-anki-mobile-pwa')
    expect(css).not.toContain('--mobile-safe-area-inset-top')
    expect(css).not.toContain('.mobile-tab-bar')
    expect(css).not.toContain('.mobile-touch-button')
  })

  it('keeps viewport fullscreen controls inside installed-PWA safe areas', () => {
    const css = readFileSync(layoutCssPath, 'utf8')

    expect(css).toContain(`[data-presentation-mode='viewport']`)
    expect(css).toContain('env(safe-area-inset-top, 0px)')
    expect(css).toContain('env(safe-area-inset-right, 0px)')
    expect(css).toContain('env(safe-area-inset-bottom, 0px)')
    expect(css).toContain('env(safe-area-inset-left, 0px)')
  })

  it('keeps phone text fields at 16px so iOS does not zoom on focus, and sizes the root with dvh', () => {
    const css = readFileSync(foundationCssPath, 'utf8')

    expect(css).toContain('@media (max-width: 767px)')
    expect(css).toMatch(/input:not\(\[type='checkbox'\]\)[\s\S]*?textarea,\s*select\s*\{\s*font-size: 16px;/)
    expect(css).toContain('min-height: 100dvh;')
  })
})
