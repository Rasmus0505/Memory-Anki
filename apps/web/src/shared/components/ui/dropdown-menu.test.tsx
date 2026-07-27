import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './dropdown-menu'

describe('DropdownMenuContent portal host', () => {
  afterEach(() => {
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => null,
    })
  })

  it('portals into the native fullscreen element so system-fullscreen menus stay visible', () => {
    const fullscreenHost = document.createElement('div')
    fullscreenHost.setAttribute('data-testid', 'fullscreen-host')
    document.body.appendChild(fullscreenHost)
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => fullscreenHost,
    })

    render(
      <DropdownMenu defaultOpen>
        <DropdownMenuTrigger asChild>
          <button type="button">更多脑图操作</button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>清屏</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    )

    const item = screen.getByRole('menuitem', { name: '清屏' })
    expect(fullscreenHost.contains(item)).toBe(true)
    expect(document.body.contains(item)).toBe(true)
    // Not a direct child of body — nested under the fullscreen host.
    expect(item.closest('[data-testid="fullscreen-host"]')).toBe(fullscreenHost)

    fullscreenHost.remove()
  })

  it('keeps webpage-fullscreen menus above the fixed mind-map host z-index', () => {
    render(
      <DropdownMenu defaultOpen>
        <DropdownMenuTrigger asChild>
          <button type="button">更多脑图操作</button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>导出脑图</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    )

    const content = screen.getByRole('menu')
    expect(content.className).toContain('z-[250]')
  })

  it('accepts an explicit portal container override', () => {
    const custom = document.createElement('div')
    custom.setAttribute('data-testid', 'custom-portal')
    document.body.appendChild(custom)

    render(
      <DropdownMenu defaultOpen>
        <DropdownMenuTrigger asChild>
          <button type="button">更多脑图操作</button>
        </DropdownMenuTrigger>
        <DropdownMenuContent container={custom}>
          <DropdownMenuItem>导入脑图</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    )

    expect(custom.contains(screen.getByRole('menuitem', { name: '导入脑图' }))).toBe(true)
    custom.remove()
  })
})
