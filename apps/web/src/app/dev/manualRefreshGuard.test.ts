import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('manual refresh guard config', () => {
  it('configures vite dev to require manual refresh', () => {
    const viteConfigSource = readFileSync(resolve(process.cwd(), 'vite.config.ts'), 'utf8')

    expect(viteConfigSource).toContain("name: 'memory-anki-manual-refresh-guard'")
    expect(viteConfigSource).toContain("injectTo: 'head-prepend'")
    expect(viteConfigSource).toContain("suppressedTypes = new Set(['update', 'full-reload'])")
    expect(viteConfigSource).toContain("suppressedCustomEvents = new Set(['vite:ws:disconnect'])")
    expect(viteConfigSource).toContain("Object.defineProperty(socket, 'onmessage'")
    expect(viteConfigSource).toContain('server: {')
    expect(viteConfigSource).toContain('hmr: false')
  })
})
