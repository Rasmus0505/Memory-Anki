import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { promises as fs } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const srcDir = fileURLToPath(new URL('./src', import.meta.url))
const stableChunkNames = new Set(['PalaceEditPage', 'useMindMapImport'])
const releaseId = `${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${createHash('sha256')
  .update(`${Date.now()}-${Math.random()}`)
  .digest('hex')
  .slice(0, 10)}`
const manualRefreshGuardScript = String.raw`
  (() => {
    if (typeof window === 'undefined' || typeof window.WebSocket === 'undefined') return
    if (window.__memoryAnkiManualRefreshGuardInstalled__) return

    window.__memoryAnkiManualRefreshGuardInstalled__ = true

    const OriginalWebSocket = window.WebSocket
    const suppressedTypes = new Set(['update', 'full-reload'])
    const suppressedCustomEvents = new Set(['vite:ws:disconnect'])

    function isViteHmrSocket(protocols) {
      if (Array.isArray(protocols)) return protocols.includes('vite-hmr')
      return protocols === 'vite-hmr'
    }

    function shouldSuppressMessage(data) {
      if (typeof data !== 'string') return false
      try {
        const payload = JSON.parse(data)
        return Boolean(
          payload &&
            (suppressedTypes.has(payload.type) ||
              (payload.type === 'custom' && suppressedCustomEvents.has(payload.event))),
        )
      } catch {
        return false
      }
    }

    function logSuppressedUpdate() {
      console.info('[memory-anki] Vite auto update suppressed. Refresh the page manually to load latest changes.')
    }

    window.WebSocket = function MemoryAnkiWebSocket(url, protocols) {
      const socket =
        protocols === undefined
          ? new OriginalWebSocket(url)
          : new OriginalWebSocket(url, protocols)

      if (!isViteHmrSocket(protocols)) return socket

      const originalAddEventListener = socket.addEventListener.bind(socket)

      socket.addEventListener = function patchedAddEventListener(type, listener, options) {
        if (type !== 'message' || typeof listener !== 'function') {
          return originalAddEventListener(type, listener, options)
        }

        return originalAddEventListener(
          type,
          (event) => {
            if (shouldSuppressMessage(event?.data)) {
              logSuppressedUpdate()
              return
            }
            return listener.call(this, event)
          },
          options,
        )
      }

      Object.defineProperty(socket, 'onmessage', {
        configurable: true,
        enumerable: true,
        get() {
          return this.__memoryAnkiOnMessage || null
        },
        set(listener) {
          this.__memoryAnkiOnMessage = typeof listener === 'function' ? listener : null
          if (typeof listener !== 'function') {
            return
          }
          return originalAddEventListener('message', (event) => {
            if (shouldSuppressMessage(event?.data)) {
              logSuppressedUpdate()
              return
            }
            return listener.call(this, event)
          })
        },
      })

      return socket
    }

    window.WebSocket.prototype = OriginalWebSocket.prototype
    Object.setPrototypeOf(window.WebSocket, OriginalWebSocket)
  })()
`

function stableChunkCompatPlugin() {
  let outDir = ''
  let previousAssetNames = new Set<string>()

  return {
    name: 'memory-anki-stable-chunk-compat',
    apply: 'build' as const,
    async configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir)
      try {
        const assetDir = path.join(outDir, 'assets')
        const entries = await fs.readdir(assetDir, { withFileTypes: true })
        previousAssetNames = new Set(
          entries.filter((entry) => entry.isFile()).map((entry) => entry.name),
        )
      } catch {
        previousAssetNames = new Set()
      }
    },
    async writeBundle() {
      if (!outDir) return
      const assetDir = path.join(outDir, 'assets')
      for (const oldAssetName of previousAssetNames) {
        const match = oldAssetName.match(/^([A-Za-z0-9_-]+)-[A-Za-z0-9_-]+\.js$/)
        if (!match) continue
        const baseName = match[1]
        if (!stableChunkNames.has(baseName)) continue

        const stableFileName = `${baseName}.js`
        const stableFilePath = path.join(assetDir, stableFileName)
        const aliasFilePath = path.join(assetDir, oldAssetName)
        try {
          await fs.access(stableFilePath)
        } catch {
          continue
        }
        if (oldAssetName === stableFileName) continue
        const aliasSource =
          `export { default } from './${stableFileName}';\n` +
          `export * from './${stableFileName}';\n`
        await fs.writeFile(aliasFilePath, aliasSource, 'utf8')
      }
    },
  }
}

function releaseArtifactsPlugin() {
  let outDir = ''

  return {
    name: 'memory-anki-release-artifacts',
    apply: 'build' as const,
    configResolved(config: { root: string; build: { outDir: string } }) {
      outDir = path.resolve(config.root, config.build.outDir)
    },
    transformIndexHtml(html: string) {
      return html.replace(
        '</head>',
        `    <meta name="memory-anki-release" content="${releaseId}" />\n  </head>`,
      )
    },
    async closeBundle() {
      if (!outDir) return
      const release = { releaseId, builtAt: new Date().toISOString() }
      await fs.writeFile(path.join(outDir, 'release.json'), `${JSON.stringify(release, null, 2)}\n`, 'utf8')
      const serviceWorkerPath = path.join(outDir, 'sw.js')
      const serviceWorker = await fs.readFile(serviceWorkerPath, 'utf8')
      await fs.writeFile(
        serviceWorkerPath,
        serviceWorker.replaceAll('__MEMORY_ANKI_RELEASE_ID__', releaseId),
        'utf8',
      )
    },
  }
}

export default defineConfig({
  plugins: [
    {
      name: 'memory-anki-manual-refresh-guard',
      apply: 'serve',
      transformIndexHtml: {
        order: 'pre',
        handler(html) {
          return {
            html,
            tags: [
              {
                tag: 'script',
                injectTo: 'head-prepend',
                children: manualRefreshGuardScript,
              },
            ],
          }
        },
      },
    },
    react(),
    tailwindcss(),
    stableChunkCompatPlugin(),
    releaseArtifactsPlugin(),
  ],
  define: {
    __MEMORY_ANKI_RELEASE_ID__: JSON.stringify(releaseId),
  },
  build: {
    emptyOutDir: false,
    rollupOptions: {
      output: {
        chunkFileNames(chunkInfo) {
          if (stableChunkNames.has(chunkInfo.name)) {
            return 'assets/[name].js'
          }
          return 'assets/[name]-[hash].js'
        },
        manualChunks(id) {
          if (id.includes('node_modules/@xyflow/react')) {
            return 'mindmap-vendor'
          }
          if (id.includes('node_modules/recharts')) {
            return 'chart-vendor'
          }
          if (
            id.includes('node_modules/react/') ||
            id.includes('node_modules/react-dom/') ||
            id.includes('node_modules/react-router-dom/')
          ) {
            return 'react-vendor'
          }
          return undefined
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': srcDir,
    },
  },
  server: {
    hmr: false,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8012',
        changeOrigin: true,
      },
    },
  },
})
