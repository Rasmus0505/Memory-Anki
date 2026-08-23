import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const appPath = resolve(process.cwd(), 'src/app/App.tsx')

describe('root application chunk loading', () => {
  it('routes hung root chunk imports through the bounded retry loader', () => {
    const source = readFileSync(appPath, 'utf8')

    expect(source).toContain("import { lazyWithRetry } from '@/shared/lib/lazyWithRetry'")
    expect(source).toContain("const DesktopApp = lazyWithRetry(() => import('@/app/DesktopApp'))")
    expect(source).toContain('const TimerOverlayApp = lazyWithRetry(() =>')
    expect(source).not.toContain("import { Suspense, lazy } from 'react'")
  })
})
