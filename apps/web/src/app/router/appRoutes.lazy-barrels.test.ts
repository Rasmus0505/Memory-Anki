import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = resolve(process.cwd(), 'src')

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return walk(full)
    return /\.tsx?$/.test(name) && !/\.test\./.test(name) ? [full] : []
  })
}

describe('lazy module barrel exports', () => {
  // A barrel export that is `lazy(...)` is already a lazy element. A page that re-exports it as its default
  // export is then wrapped by lazyWithRetry a second time, which React rejects at render ("wrapped in React.lazy() more than once").
  it('are never re-exported as a page default export', () => {
    const lazyNames = new Set<string>()
    for (const file of walk(join(SRC, 'modules'))) {
      if (!/\/public\.ts$/.test(file.replace(/\\/g, '/'))) continue
      for (const match of readFileSync(file, 'utf8').matchAll(/export const (\w+) = lazy\(/g)) {
        lazyNames.add(match[1])
      }
    }
    expect(lazyNames.size).toBeGreaterThan(0)

    const offenders: string[] = []
    for (const file of walk(join(SRC, 'pages'))) {
      const source = readFileSync(file, 'utf8')
      for (const name of lazyNames) {
        const reexport = new RegExp(`export \\{\\s*${name}\\s+as\\s+default\\s*\\}`)
        if (reexport.test(source)) offenders.push(`${relative(SRC, file)} re-exports ${name} as default`)
      }
    }
    expect(offenders).toEqual([])
  })
})
