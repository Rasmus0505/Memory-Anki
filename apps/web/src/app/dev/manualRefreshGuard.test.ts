import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const viteConfigSource = readFileSync(resolve(process.cwd(), 'vite.config.ts'), 'utf8')

function readGuardScript(): string {
  const match = viteConfigSource.match(/const manualRefreshGuardScript = String\.raw`([\s\S]*?)`\n/)
  if (!match) throw new Error('manualRefreshGuardScript not found in vite.config.ts')
  return match[1]
}

type Listener = (event: { data: string }) => void

class FakeWebSocket {
  url: string
  protocols?: string | string[]
  listeners = new Map<string, Listener[]>()

  constructor(url: string, protocols?: string | string[]) {
    this.url = url
    this.protocols = protocols
  }

  addEventListener(type: string, listener: Listener) {
    const listeners = this.listeners.get(type) ?? []
    listeners.push(listener)
    this.listeners.set(type, listeners)
  }

  receive(payload: unknown) {
    const event = { data: JSON.stringify(payload) }
    for (const listener of this.listeners.get('message') ?? []) listener(event)
  }
}

/** 安装守卫脚本，返回 vite 自己那条 HMR 连接。 */
function installGuard() {
  const fakeWindow = { WebSocket: FakeWebSocket as unknown as typeof WebSocket }
  new Function('window', 'console', readGuardScript())(fakeWindow, { info: () => {} })
  const PatchedWebSocket = fakeWindow.WebSocket as unknown as new (url: string, protocols?: string) => FakeWebSocket
  return new PatchedWebSocket('ws://127.0.0.1:5173/', 'vite-hmr')
}

function delivered(socket: FakeWebSocket, payload: unknown): boolean {
  let count = 0
  socket.addEventListener('message', () => {
    count += 1
  })
  socket.receive(payload)
  return count > 0
}

describe('manual refresh guard config', () => {
  it('configures vite dev to require manual refresh', () => {
    expect(viteConfigSource).toContain("name: 'memory-anki-manual-refresh-guard'")
    expect(viteConfigSource).toContain("injectTo: 'head-prepend'")
    expect(viteConfigSource).toContain("suppressedTypes = new Set(['update'])")
    expect(viteConfigSource).toContain("suppressedCustomEvents = new Set(['vite:ws:disconnect'])")
    expect(viteConfigSource).toContain("Object.defineProperty(socket, 'onmessage'")
    expect(viteConfigSource).toContain('server: {')
    // 通道必须留着，否则依赖重新预构建的整页刷新发不出去。
    expect(viteConfigSource).toContain('hmr: true')
  })

  it('suppresses source updates that would reload a study session', () => {
    const socket = installGuard()

    expect(delivered(socket, { type: 'update', updates: [{ path: '/src/app/App.tsx' }] })).toBe(false)
    expect(delivered(socket, { type: 'full-reload', path: '/index.html' })).toBe(false)
    expect(delivered(socket, { type: 'custom', event: 'vite:ws:disconnect', data: {} })).toBe(false)
    expect(delivered(socket, { type: 'full-reload' })).toBe(false)
    // 改源码后 Vite 也会发 path: "*"，但带 triggeredBy。
    expect(
      delivered(socket, { type: 'full-reload', path: '*', triggeredBy: '/src/app/App.tsx' }),
    ).toBe(false)
  })

  it('lets the dependency re-optimization reload through', () => {
    const socket = installGuard()

    // 预构建换了 deps 的 ?v=hash，不刷新就会在页面里留下两份 React。
    expect(delivered(socket, { type: 'full-reload', path: '*' })).toBe(true)
  })
})
