import { createRequire } from 'node:module'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)

/**
 * Resolve the dismissable layer exactly as `pkg` itself would.
 *
 * npm gives every Radix package an exact `@radix-ui/react-dismissable-layer`
 * pin (`1.1.12` for dialog/menu, `1.2.1` for the newer context menu). Without
 * the `overrides` entry in package.json npm installs several copies, and each
 * copy keeps its own module-level "original body pointer-events" value. A
 * right-click menu (copy A) disables body pointer events; opening a confirm
 * dialog on top of it (copy B) then captures `none` as the original, and when
 * the dialog closes it writes `none` back — the whole app stops responding
 * until a reload. `apps/web/package.json` therefore pins the layer to one
 * version; this guard fails the moment a dependency bump reintroduces a second
 * copy.
 */
function dismissableLayerUsedBy(pkg: string): string {
  const entryDir = path.dirname(require.resolve(pkg))
  return require.resolve('@radix-ui/react-dismissable-layer', { paths: [entryDir] })
}

describe('Radix overlay body lock', () => {
  it('gives every overlay the same dismissable-layer copy', () => {
    const owners = [
      '@radix-ui/react-context-menu',
      '@radix-ui/react-dialog',
      '@radix-ui/react-dropdown-menu',
      '@radix-ui/react-popover',
      '@radix-ui/react-select',
    ]
    const resolved = new Map(owners.map((pkg) => [pkg, dismissableLayerUsedBy(pkg)]))
    const copies = new Set(resolved.values())
    expect(
      [...copies],
      `Different dismissable-layer copies restore body pointer-events independently; keep the package.json overrides entry in sync with these versions:\n${[...resolved].map(([pkg, file]) => `  ${pkg} -> ${file}`).join('\n')}`,
    ).toHaveLength(1)
  })
})
