import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { visualizer } from 'rollup-plugin-visualizer'
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

// 本次构建写出的兼容别名文件（assets/ 相对路径），并入 release 清单，
// 供 tools/clean_web_dist.py 判断保留范围。
const compatAliasFiles: string[] = []

function stableChunkCompatPlugin() {
  let outDir = ''
  let previousAssetNames = new Set<string>()

  return {
    name: 'memory-anki-stable-chunk-compat',
    apply: 'build' as const,
    async configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir)
      compatAliasFiles.length = 0
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
        compatAliasFiles.push(`assets/${oldAssetName}`)
      }
    },
  }
}

function releaseArtifactsPlugin() {
  let outDir = ''
  let bundleAssetFiles: string[] = []

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
    writeBundle(_options: unknown, bundle: Record<string, unknown>) {
      bundleAssetFiles = Object.keys(bundle).filter((fileName) => fileName.startsWith('assets/'))
    },
    async closeBundle() {
      if (!outDir) return
      const release = { releaseId, builtAt: new Date().toISOString() }
      await fs.writeFile(path.join(outDir, 'release.json'), `${JSON.stringify(release, null, 2)}\n`, 'utf8')

      // 当前版本的全部构建资源都要进入 sw.js 预缓存清单。入口页会马上
      // 动态导入 DesktopApp 和 /freestyle 等路由；只缓存 index.html 的静态
      // import 链会留下“HTML 能打开、React 永远起不来”的半份 PWA。
      const indexHtml = await fs.readFile(path.join(outDir, 'index.html'), 'utf8')
      const entryAssets = Array.from(
        new Set(indexHtml.match(/assets\/[^"']+/g) ?? []),
        (assetPath) => `/${assetPath}`,
      )
      const releaseFiles = Array.from(new Set([
        ...bundleAssetFiles.filter((fileName) => fileName.startsWith('assets/')),
        ...compatAliasFiles,
      ])).sort()
      const precacheAssets = Array.from(new Set([
        ...entryAssets,
        ...releaseFiles.map((fileName) => `/${fileName}`),
      ])).sort()
      const serviceWorkerPath = path.join(outDir, 'sw.js')
      const serviceWorker = await fs.readFile(serviceWorkerPath, 'utf8')
      await fs.writeFile(
        serviceWorkerPath,
        serviceWorker
          .replaceAll("'__MEMORY_ANKI_PRECACHE_ASSETS__'", JSON.stringify(precacheAssets))
          .replaceAll('__MEMORY_ANKI_RELEASE_ID__', releaseId),
        'utf8',
      )

      // 每次发布的全量 assets 清单：tools/clean_web_dist.py 按“最近 N 份清单
      // 的并集”决定 dist/assets 里哪些历史文件可以删除。
      const releasesDir = path.join(outDir, 'releases')
      await fs.mkdir(releasesDir, { recursive: true })
      const releaseManifest = {
        releaseId,
        builtAt: release.builtAt,
        files: releaseFiles,
      }
      await fs.writeFile(
        path.join(releasesDir, `${releaseId}.json`),
        `${JSON.stringify(releaseManifest, null, 2)}\n`,
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
    ...(process.env.ANALYZE
      ? [visualizer({ filename: 'stats.html', gzipSize: true, brotliSize: true })]
      : []),
  ],
  define: {
    __MEMORY_ANKI_RELEASE_ID__: JSON.stringify(releaseId),
  },
  build: {
    emptyOutDir: false,
    target: ['es2022', 'safari16'],
    rollupOptions: {
      output: {
        chunkFileNames(chunkInfo) {
          if (stableChunkNames.has(chunkInfo.name)) {
            return 'assets/[name].js'
          }
          return 'assets/[name]-[hash].js'
        },
        manualChunks(id) {
          // React 核心必须最先匹配：否则 react/react-dom 的 CJS 产物会被
          // 后续 vendor 规则（如 chart-vendor）吸走，导致入口静态依赖该 vendor。
          if (
            id.includes('node_modules/react/') ||
            id.includes('node_modules/react-dom/') ||
            id.includes('node_modules/scheduler/') ||
            id.includes('node_modules/react-router/') ||
            id.includes('node_modules/react-router-dom/')
          ) {
            return 'react-vendor'
          }
          if (
            id.includes('node_modules/@radix-ui/') ||
            id.includes('node_modules/react-remove-scroll') ||
            id.includes('node_modules/react-style-singleton/') ||
            id.includes('node_modules/use-callback-ref/') ||
            id.includes('node_modules/use-sidecar/') ||
            id.includes('node_modules/aria-hidden/') ||
            id.includes('node_modules/get-nonce/')
          ) {
            return 'radix-vendor'
          }
          if (id.includes('node_modules/lucide-react/')) {
            return 'icons-vendor'
          }
          if (id.includes('node_modules/sonner/') || id.includes('node_modules/cmdk/')) {
            return 'ui-vendor'
          }
          // @xyflow 与 recharts 不做强制分组：它们只被懒加载边界
          // （MindMapCanvasLazy / *.view.tsx）引用，跟随动态导入自然成为
          // 异步块；强制分组会把 react 的 CJS interop 模块一并吸进 vendor
          // 组（manualChunks 对这些模块不生效），导致入口静态依赖整个 vendor。
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
