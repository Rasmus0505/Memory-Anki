import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildRuntimeDiagnostics, copyRuntimeDiagnostics } from './runtimeDiagnostics'

describe('runtime diagnostics', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('includes the release, runtime state, service worker and error details', () => {
    vi.stubGlobal('navigator', {
      onLine: true,
      userAgent: 'MemoryAnki Test Browser',
      serviceWorker: { controller: { scriptURL: 'https://memory.test/sw.js' } },
    })
    const error = new Error('chunk timed out')
    error.stack = 'chunk stack'

    const text = buildRuntimeDiagnostics({
      area: 'route error',
      error,
      componentStack: 'at FreestylePage',
    })

    expect(text).toContain('Memory Anki route error diagnosis')
    expect(text).toContain('release=')
    expect(text).toContain('online=true')
    expect(text).toContain('service_worker=https://memory.test/sw.js')
    expect(text).toContain('browser=MemoryAnki Test Browser')
    expect(text).toContain('error=Error: chunk timed out')
    expect(text).toContain('stack=chunk stack')
    expect(text).toContain('component_stack=at FreestylePage')
  })

  it('reports clipboard failure without hiding the visible diagnostic text', async () => {
    vi.stubGlobal('navigator', {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    })

    await expect(copyRuntimeDiagnostics('diagnostic text')).resolves.toBe(false)
  })

  it('falls back to the selection copy path when Clipboard API is unavailable', async () => {
    vi.stubGlobal('navigator', { clipboard: undefined })
    const original = Object.getOwnPropertyDescriptor(document, 'execCommand')
    const execCommand = vi.fn().mockReturnValue(true)
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand })

    try {
      await expect(copyRuntimeDiagnostics('diagnostic text')).resolves.toBe(true)
      expect(execCommand).toHaveBeenCalledWith('copy')
    } finally {
      if (original) Object.defineProperty(document, 'execCommand', original)
      else Reflect.deleteProperty(document, 'execCommand')
    }
  })
})
