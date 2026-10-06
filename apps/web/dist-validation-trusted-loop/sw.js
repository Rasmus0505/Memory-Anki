const RELEASE_ID = '20261006140712-d7be24958a'
const APP_CACHE = `memory-anki-pwa-app-${RELEASE_ID}`
const API_CACHE = `memory-anki-pwa-api-${RELEASE_ID}`
const CACHE_PREFIX = 'memory-anki-pwa-'
const LEGACY_CACHE_PREFIX = 'memory-anki-mobile-'
const APP_CACHE_PREFIX = `${CACHE_PREFIX}app-`
const API_CACHE_PREFIX = `${CACHE_PREFIX}api-`
const RETAINED_APP_CACHE_GENERATIONS = 2
// The shell and every release asset are required before this worker may take
// control. Activating a partial generation leaves a cached HTML shell whose
// module graph cannot start after a network interruption.
const CORE_PRECACHE_URLS = [
  '/',
  '/freestyle',
  '/offline.html',
]
// Recovery affordances are useful, but an icon or metadata timeout must not
// prevent an otherwise complete application release from activating.
const AUXILIARY_PRECACHE_URLS = [
  '/pwa-reset.html',
  '/manifest.webmanifest',
  '/release.json',
  '/favicon.svg',
  '/pwa-icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/maskable-512.png',
  '/icons/apple-touch-icon.png',
]
// 构建时由 releaseArtifactsPlugin 注入本次发布的入口链路资产（JS/CSS），
// 使离线冷启动不依赖运行时缓存。未注入（dev/测试）时保持为空数组。
const PRECACHE_RELEASE_ASSETS = ["/assets/AiSettingsPage-CjBQcXtf.js","/assets/AnimatePresence-GcMo6ZWK.js","/assets/BackupSettingsPage-CRixPv9H.js","/assets/ComboMilestoneBurst-BfNst6S7.js","/assets/CompletionCelebration-CARzSgvE.js","/assets/DesktopApp-BdAWQ9dL.js","/assets/DevTokensPage-q5OUoMYs.js","/assets/EnglishCoursePage-v9ldFwZz.js","/assets/EnglishLibraryPage-DbjpwcCR.js","/assets/ExamWarRoomPage-CyP63myH.js","/assets/FeedbackSettingsPage-CpO_T2Rs.js","/assets/FeedbackStatus-ShPqrIkq.js","/assets/FreestyleComboChip-D2L0UvVr.js","/assets/FxLabPage-BRJ6HW2f.js","/assets/GrowthPage-lzhdhaUl.js","/assets/ImmersiveFreestylePage-g6-9fxh1.js","/assets/ImmersiveFreestyleSecondaryPage-CwJDJmPQ.js","/assets/InsightsPage-Dlx_1Sv7.js","/assets/InsightsPageLoading-CzQiH2-3.js","/assets/KaTeX_AMS-Regular-BQhdFMY1.woff2","/assets/KaTeX_AMS-Regular-DMm9YOAa.woff","/assets/KaTeX_AMS-Regular-DRggAlZN.ttf","/assets/KaTeX_Caligraphic-Bold-ATXxdsX0.ttf","/assets/KaTeX_Caligraphic-Bold-BEiXGLvX.woff","/assets/KaTeX_Caligraphic-Bold-Dq_IR9rO.woff2","/assets/KaTeX_Caligraphic-Regular-CTRA-rTL.woff","/assets/KaTeX_Caligraphic-Regular-Di6jR-x-.woff2","/assets/KaTeX_Caligraphic-Regular-wX97UBjC.ttf","/assets/KaTeX_Fraktur-Bold-BdnERNNW.ttf","/assets/KaTeX_Fraktur-Bold-BsDP51OF.woff","/assets/KaTeX_Fraktur-Bold-CL6g_b3V.woff2","/assets/KaTeX_Fraktur-Regular-CB_wures.ttf","/assets/KaTeX_Fraktur-Regular-CTYiF6lA.woff2","/assets/KaTeX_Fraktur-Regular-Dxdc4cR9.woff","/assets/KaTeX_Main-Bold-Cx986IdX.woff2","/assets/KaTeX_Main-Bold-Jm3AIy58.woff","/assets/KaTeX_Main-Bold-waoOVXN0.ttf","/assets/KaTeX_Main-BoldItalic-DxDJ3AOS.woff2","/assets/KaTeX_Main-BoldItalic-DzxPMmG6.ttf","/assets/KaTeX_Main-BoldItalic-SpSLRI95.woff","/assets/KaTeX_Main-Italic-3WenGoN9.ttf","/assets/KaTeX_Main-Italic-BMLOBm91.woff","/assets/KaTeX_Main-Italic-NWA7e6Wa.woff2","/assets/KaTeX_Main-Regular-B22Nviop.woff2","/assets/KaTeX_Main-Regular-Dr94JaBh.woff","/assets/KaTeX_Main-Regular-ypZvNtVU.ttf","/assets/KaTeX_Math-BoldItalic-B3XSjfu4.ttf","/assets/KaTeX_Math-BoldItalic-CZnvNsCZ.woff2","/assets/KaTeX_Math-BoldItalic-iY-2wyZ7.woff","/assets/KaTeX_Math-Italic-DA0__PXp.woff","/assets/KaTeX_Math-Italic-flOr_0UB.ttf","/assets/KaTeX_Math-Italic-t53AETM-.woff2","/assets/KaTeX_SansSerif-Bold-CFMepnvq.ttf","/assets/KaTeX_SansSerif-Bold-D1sUS0GD.woff2","/assets/KaTeX_SansSerif-Bold-DbIhKOiC.woff","/assets/KaTeX_SansSerif-Italic-C3H0VqGB.woff2","/assets/KaTeX_SansSerif-Italic-DN2j7dab.woff","/assets/KaTeX_SansSerif-Italic-YYjJ1zSn.ttf","/assets/KaTeX_SansSerif-Regular-BNo7hRIc.ttf","/assets/KaTeX_SansSerif-Regular-CS6fqUqJ.woff","/assets/KaTeX_SansSerif-Regular-DDBCnlJ7.woff2","/assets/KaTeX_Script-Regular-C5JkGWo-.ttf","/assets/KaTeX_Script-Regular-D3wIWfF6.woff2","/assets/KaTeX_Script-Regular-D5yQViql.woff","/assets/KaTeX_Size1-Regular-C195tn64.woff","/assets/KaTeX_Size1-Regular-Dbsnue_I.ttf","/assets/KaTeX_Size1-Regular-mCD8mA8B.woff2","/assets/KaTeX_Size2-Regular-B7gKUWhC.ttf","/assets/KaTeX_Size2-Regular-Dy4dx90m.woff2","/assets/KaTeX_Size2-Regular-oD1tc_U0.woff","/assets/KaTeX_Size3-Regular-CTq5MqoE.woff","/assets/KaTeX_Size3-Regular-DgpXs0kz.ttf","/assets/KaTeX_Size4-Regular-BF-4gkZK.woff","/assets/KaTeX_Size4-Regular-DWFBv043.ttf","/assets/KaTeX_Size4-Regular-Dl5lxZxV.woff2","/assets/KaTeX_Typewriter-Regular-C0xS9mPB.woff","/assets/KaTeX_Typewriter-Regular-CO6r4hn1.woff2","/assets/KaTeX_Typewriter-Regular-D3Ib7_Hf.ttf","/assets/KnowledgeLibraryPage-CIFlxsjM.js","/assets/MindMapCanvas-CjoOXnip.css","/assets/MindMapCanvas-Dll5wIVP.js","/assets/PalaceEditorPage-D0tWReGE.js","/assets/PalaceLibraryPage-DdEY8nU1.js","/assets/PalaceListPage-0hSbGBeT.js","/assets/PalaceReviewPage-DXrd4E8E.js","/assets/PalaceViewPage-CCUxy-6I.js","/assets/ProfileLayout-B-RBEsfI.js","/assets/ProgressPage-Drc_8AWx.js","/assets/QueryClientProvider-CpNFf3zg.js","/assets/QuizWorkspacePage-CuBxPbvw.js","/assets/SettingsOverviewPage-I9xUoUQY.js","/assets/TimeRecordsBreakdownChart.view-CN6uR2KM.js","/assets/TimeRecordsTrendChart.view-CLX5Vrj3.js","/assets/TimerOverlayApp-DLs7Hrw9.js","/assets/TimerSettingsPage-Jyjqunra.js","/assets/aiLogsApi-Bq3eL_SD.js","/assets/button-C6XB3TyO.js","/assets/chart-FL6pAMyO.js","/assets/dialog-CX0vlr4V.js","/assets/freestyleComboStore-Ce888blV.js","/assets/http-CItk0UYz.js","/assets/icons-vendor-BaxOjYdx.js","/assets/index-DFo_SZ8o.js","/assets/index-XqZSSJJH.css","/assets/input-mJ7tTjIn.js","/assets/knowledgeApi-CvutrFb3.js","/assets/label-CpgcfTVM.js","/assets/lazyWithRetry-DPtkGHEE.js","/assets/mindMapCollapse-DCXI0z5j.js","/assets/mindmap-document-conflict-CkoWxhd9.js","/assets/native-dialog-BNrGBP6Q.js","/assets/noto-sans-sc-100-wght-normal-DrqXJETY.woff2","/assets/noto-sans-sc-101-wght-normal-c94LAl5p.woff2","/assets/noto-sans-sc-102-wght-normal-C1RtbCZr.woff2","/assets/noto-sans-sc-103-wght-normal-DGHo20nu.woff2","/assets/noto-sans-sc-104-wght-normal-CJT2ioDJ.woff2","/assets/noto-sans-sc-105-wght-normal-BFoiJwz2.woff2","/assets/noto-sans-sc-106-wght-normal-D6uUHw3w.woff2","/assets/noto-sans-sc-107-wght-normal-kFQzJDLH.woff2","/assets/noto-sans-sc-108-wght-normal-7aXvqIa2.woff2","/assets/noto-sans-sc-109-wght-normal-CnjNbNmw.woff2","/assets/noto-sans-sc-110-wght-normal-D2JBr045.woff2","/assets/noto-sans-sc-111-wght-normal-ClFr5QXM.woff2","/assets/noto-sans-sc-112-wght-normal-CiZxJMyY.woff2","/assets/noto-sans-sc-113-wght-normal-OgQXOX6x.woff2","/assets/noto-sans-sc-114-wght-normal-CRH9SDZu.woff2","/assets/noto-sans-sc-115-wght-normal-BN__2iBG.woff2","/assets/noto-sans-sc-116-wght-normal-vdFVzbO2.woff2","/assets/noto-sans-sc-117-wght-normal-Dsz3vkzU.woff2","/assets/noto-sans-sc-118-wght-normal-BPEb0gM9.woff2","/assets/noto-sans-sc-119-wght-normal-BfzSEbFz.woff2","/assets/noto-sans-sc-21-wght-normal-DIu_1ZBI.woff2","/assets/noto-sans-sc-22-wght-normal-VXjdYcT-.woff2","/assets/noto-sans-sc-23-wght-normal-4HrHKhpL.woff2","/assets/noto-sans-sc-24-wght-normal-B58DWgHS.woff2","/assets/noto-sans-sc-25-wght-normal-C3Jm6l7O.woff2","/assets/noto-sans-sc-26-wght-normal-YNOygvr_.woff2","/assets/noto-sans-sc-27-wght-normal-BP2pEGQH.woff2","/assets/noto-sans-sc-28-wght-normal-BWPKDbtH.woff2","/assets/noto-sans-sc-29-wght-normal-45aVmHn_.woff2","/assets/noto-sans-sc-30-wght-normal-B8_s30jZ.woff2","/assets/noto-sans-sc-31-wght-normal-DW0t445S.woff2","/assets/noto-sans-sc-32-wght-normal-ShbWPcei.woff2","/assets/noto-sans-sc-33-wght-normal-BOTZYTjM.woff2","/assets/noto-sans-sc-34-wght-normal-BF1rqDSt.woff2","/assets/noto-sans-sc-35-wght-normal-Bosspiyr.woff2","/assets/noto-sans-sc-36-wght-normal-CtU9CyKw.woff2","/assets/noto-sans-sc-37-wght-normal-ghDiyiuv.woff2","/assets/noto-sans-sc-38-wght-normal-4Nz8k_dt.woff2","/assets/noto-sans-sc-39-wght-normal-Ddtm1XVC.woff2","/assets/noto-sans-sc-40-wght-normal-BVn4-kgX.woff2","/assets/noto-sans-sc-41-wght-normal-CZqajZnl.woff2","/assets/noto-sans-sc-42-wght-normal-CQ4lY28u.woff2","/assets/noto-sans-sc-43-wght-normal-psppu0d8.woff2","/assets/noto-sans-sc-44-wght-normal-cbKJlTUe.woff2","/assets/noto-sans-sc-45-wght-normal-MKIEVRIC.woff2","/assets/noto-sans-sc-46-wght-normal-CErGc6Mt.woff2","/assets/noto-sans-sc-47-wght-normal-C5Kgg1_m.woff2","/assets/noto-sans-sc-48-wght-normal-DFMjDDY6.woff2","/assets/noto-sans-sc-49-wght-normal-B7l_3BZr.woff2","/assets/noto-sans-sc-5-wght-normal-DI846rD9.woff2","/assets/noto-sans-sc-50-wght-normal-C5KfAmFp.woff2","/assets/noto-sans-sc-51-wght-normal-C2bq6hC8.woff2","/assets/noto-sans-sc-52-wght-normal-P18e_Y0j.woff2","/assets/noto-sans-sc-53-wght-normal-Bgkuo2tF.woff2","/assets/noto-sans-sc-54-wght-normal-DL5lmlUd.woff2","/assets/noto-sans-sc-55-wght-normal-BV_Oy6IF.woff2","/assets/noto-sans-sc-56-wght-normal-B4L7Hj8f.woff2","/assets/noto-sans-sc-57-wght-normal-DU8YBsDj.woff2","/assets/noto-sans-sc-58-wght-normal-CE0BKS9u.woff2","/assets/noto-sans-sc-59-wght-normal-Azv2Ku9_.woff2","/assets/noto-sans-sc-6-wght-normal-ozUCEY9O.woff2","/assets/noto-sans-sc-60-wght-normal-C1lngC61.woff2","/assets/noto-sans-sc-61-wght-normal-BxWkGF5M.woff2","/assets/noto-sans-sc-62-wght-normal-CXXMAq-5.woff2","/assets/noto-sans-sc-63-wght-normal-4La5uKvS.woff2","/assets/noto-sans-sc-64-wght-normal-CbIuD2Eg.woff2","/assets/noto-sans-sc-65-wght-normal-BGqvKda2.woff2","/assets/noto-sans-sc-66-wght-normal-BvNozWOY.woff2","/assets/noto-sans-sc-67-wght-normal-CC-WRBV-.woff2","/assets/noto-sans-sc-68-wght-normal-c0FjfUaj.woff2","/assets/noto-sans-sc-69-wght-normal-D596Jjl2.woff2","/assets/noto-sans-sc-70-wght-normal-ColEcmtJ.woff2","/assets/noto-sans-sc-71-wght-normal-ChZfXpdg.woff2","/assets/noto-sans-sc-72-wght-normal-D1VyfEG3.woff2","/assets/noto-sans-sc-73-wght-normal-DwSJRYPJ.woff2","/assets/noto-sans-sc-74-wght-normal-Cte7o1QG.woff2","/assets/noto-sans-sc-75-wght-normal-B0qL41rF.woff2","/assets/noto-sans-sc-76-wght-normal-BPLMO_2x.woff2","/assets/noto-sans-sc-77-wght-normal-Dkbi3pye.woff2","/assets/noto-sans-sc-78-wght-normal-BFUXeSw6.woff2","/assets/noto-sans-sc-79-wght-normal-DoJG4UTB.woff2","/assets/noto-sans-sc-80-wght-normal-BEFypWOO.woff2","/assets/noto-sans-sc-81-wght-normal-ed_TZlfo.woff2","/assets/noto-sans-sc-82-wght-normal-DcxfR5OJ.woff2","/assets/noto-sans-sc-83-wght-normal-C9UjAcMM.woff2","/assets/noto-sans-sc-84-wght-normal-C7NxT478.woff2","/assets/noto-sans-sc-85-wght-normal-DBcDBu1n.woff2","/assets/noto-sans-sc-86-wght-normal-CLJIoPpl.woff2","/assets/noto-sans-sc-87-wght-normal-DYfJ-vGE.woff2","/assets/noto-sans-sc-88-wght-normal-ClNDOCGW.woff2","/assets/noto-sans-sc-89-wght-normal-IQU_KQA8.woff2","/assets/noto-sans-sc-90-wght-normal-BWcrRNoG.woff2","/assets/noto-sans-sc-91-wght-normal-CGekvDdH.woff2","/assets/noto-sans-sc-99-wght-normal-Q_IptJM5.woff2","/assets/noto-sans-sc-cyrillic-wght-normal-CRA5_Pf1.woff2","/assets/noto-sans-sc-latin-ext-wght-normal-CqPqLCfe.woff2","/assets/noto-sans-sc-latin-wght-normal-DYAKOyvl.woff2","/assets/noto-sans-sc-vietnamese-wght-normal-y5SU35Rl.woff2","/assets/nunito-cyrillic-ext-wght-normal-D4X5GqEv.woff2","/assets/nunito-cyrillic-wght-normal-CY6AOgYE.woff2","/assets/nunito-latin-ext-wght-normal-CXYtwYOx.woff2","/assets/nunito-latin-wght-normal-BzFMHfZw.woff2","/assets/nunito-vietnamese-wght-normal-U01xdrZh.woff2","/assets/proxy-CP1YBwyk.js","/assets/public-B7H2NyUH.css","/assets/public-BF5V7-Nn.js","/assets/public-BVqiuwbT.js","/assets/public-C3FDLGlj.js","/assets/public-D_G_dVwg.js","/assets/public-Dk0f8T-8.js","/assets/radix-vendor-DzOvyo-0.js","/assets/react-vendor-rBAFV3VG.js","/assets/rolldown-runtime-Cyuzqnbw.js","/assets/rolling-number-CpGkncZx.js","/assets/runtimeApi-COh-u63R.js","/assets/skeleton-DVMSB1Yk.js","/assets/state-placeholders-y73CbBsW.js","/assets/tabs-BpmR1Vi_.js","/assets/ui-vendor-DFU-fYSx.js","/assets/utils-B6KiDbIe.js","/assets/value-8xOwwyZS.js","/assets/widget-error-boundary-aUQKRGOn.js"]
// 离线可回退的只读 API 白名单；除 freestyle feed 外暂不扩展，
// 避免 SRS 调度数据离线陈旧误导复习决策。
const OFFLINE_API_ALLOWLIST = ['/api/v1/freestyle/feed']
// 导航响应只回写这两个入口路径，避免 APP_CACHE 积累任意页面路径。
const NAVIGATION_CACHE_PATHS = ['/', '/freestyle']
const ZERO_COUNTS = { quiz_question: 0, review: 0, practice: 0, english: 0, english_reading: 0 }
// 网络超时预算。没有超时的 fetch 在半开连接（手机休眠、Tailscale 重连）下会永久挂住，
// 于是导航永远等不到网络、也永远走不到缓存兜底 —— 表现为 PWA 一直打不开，且清缓存无效。
// 导航给最短预算：有缓存外壳时，宁可先显示上一版，也不要白屏。
const NAVIGATION_TIMEOUT_MS = 4_000
// 缓存为空的冷启动没有外壳可显示，只能继续等网络；4s 会把慢链路上的首次安装判死刑。
const NAVIGATION_COLD_START_TIMEOUT_MS = 20_000
const ASSET_TIMEOUT_MS = 8_000
const API_TIMEOUT_MS = 8_000
// iOS Safari and Tailscale Serve can queue a large burst of requests behind a
// single connection. Keep release installation bounded without making it
// serial, so one slow asset cannot starve every other startup request.
const PRECACHE_CONCURRENCY = 6
const NAVIGATION_TIMED_OUT = { timedOut: true }

/** 全文件唯一的裸 fetch 出口：永不 reject，失败即 null。 */
async function startFetch(request, signal) {
  const input = signal ? new Request(request, { signal }) : request
  try {
    const response = await fetch(input)
    // Fetch resolves as soon as response headers arrive. Read a clone before
    // returning so the caller's deadline also covers a half-open response body.
    await response.clone().arrayBuffer()
    return response
  } catch {
    return null
  }
}

/**
 * 有界 fetch：返回响应，或在失败/超时时返回 null。永远不 reject，
 * 让每个调用方都能明确地回退到缓存，而不是把异常抛进 respondWith。
 */
function fetchWithin(request, timeoutMs) {
  const controller = new AbortController()
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      controller.abort()
      resolve(null)
    }, timeoutMs)
    startFetch(request, controller.signal).then((response) => {
      clearTimeout(timer)
      resolve(response)
    })
  })
}

function waitForResponseWithin(response, timeoutMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(NAVIGATION_TIMED_OUT), timeoutMs)
    response.then((value) => {
      clearTimeout(timer)
      resolve(value)
    })
  })
}

function startAbortableFetch(request) {
  const controller = new AbortController()
  return {
    response: startFetch(request, controller.signal),
    abort: () => controller.abort(),
  }
}

function cachePutWithin(cache, request, response, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false
    const settle = (stored) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(stored)
    }
    const timer = setTimeout(() => settle(false), timeoutMs)
    try {
      Promise.resolve(cache.put(request, response)).then(() => settle(true), () => settle(false))
    } catch {
      settle(false)
    }
  })
}

function cacheRuntimeResponse(cache, request, response) {
  // Cache writes must never turn an already-valid network response into a
  // failed page load. Safari may reject these under storage pressure.
  void cachePutWithin(cache, request, response.clone(), ASSET_TIMEOUT_MS)
}

function releaseAssetUrls() {
  if (!Array.isArray(PRECACHE_RELEASE_ASSETS)) return []
  return PRECACHE_RELEASE_ASSETS.filter((url) => typeof url === 'string' && url.startsWith('/assets/'))
}

function appCacheNamesToKeep(cacheNames) {
  const previous = cacheNames
    .filter((name) => name.startsWith(APP_CACHE_PREFIX) && name !== APP_CACHE)
    .sort((left, right) => right.localeCompare(left))
    .slice(0, RETAINED_APP_CACHE_GENERATIONS - 1)
  return new Set([APP_CACHE, ...previous])
}

async function cachedCurrentOrPreviousAsset(cache, request) {
  const current = await cache.match(request)
  if (current) return current
  const cacheNamesToKeep = appCacheNamesToKeep(await caches.keys())
  for (const cacheName of cacheNamesToKeep) {
    if (cacheName === APP_CACHE) continue
    const previous = await (await caches.open(cacheName)).match(request)
    if (previous) return previous
  }
  return null
}

async function runWithConcurrency(urls, worker) {
  if (!urls.length) return
  let cursor = 0
  const workerCount = Math.min(PRECACHE_CONCURRENCY, urls.length)
  const results = await Promise.allSettled(Array.from({ length: workerCount }, async () => {
    while (cursor < urls.length) {
      const index = cursor
      cursor += 1
      await worker(urls[index])
    }
  }))
  const failure = results.find((result) => result.status === 'rejected')
  if (failure) throw failure.reason
}

async function precacheCurrentRelease() {
  const cache = await caches.open(APP_CACHE)
  const cacheUrl = async (url) => {
    // 有界抓取：否则单个挂住的请求会把新 worker 永久钉在 installing 状态。
    const response = await fetchWithin(new Request(url, { cache: 'reload' }), ASSET_TIMEOUT_MS)
    if (!response || !response.ok) throw new Error(`Precache failed: ${url} (${response ? response.status : 'timeout'})`)
    if (!await cachePutWithin(cache, url, response, ASSET_TIMEOUT_MS)) {
      throw new Error(`Precache cache write failed: ${url}`)
    }
  }
  const coreUrls = [...CORE_PRECACHE_URLS, ...releaseAssetUrls()]
  try {
    // Do not replace a working release with an incomplete cache generation.
    await runWithConcurrency(coreUrls, cacheUrl)
  } catch (error) {
    await caches.delete(APP_CACHE)
    throw error
  }
  // Recovery links and icons are best-effort; the shell must remain installable
  // when one optional asset is unavailable on a constrained mobile network.
  await runWithConcurrency(AUXILIARY_PRECACHE_URLS, cacheUrl).catch(() => undefined)
}

self.addEventListener('install', (event) => {
  event.waitUntil(precacheCurrentRelease().then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => {
    const retainedAppCaches = appCacheNamesToKeep(keys)
    return Promise.all(keys
      .filter((key) => {
        if (key.startsWith(APP_CACHE_PREFIX)) return !retainedAppCaches.has(key)
        if (key.startsWith(API_CACHE_PREFIX)) return key !== API_CACHE
        return key.startsWith(CACHE_PREFIX) || key.startsWith(LEGACY_CACHE_PREFIX)
      })
      .map((key) => caches.delete(key)))
  }).then(() => self.clients.claim()))
})

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting()
})

// Break reminders are shown via registration.showNotification so they survive
// the page being backgrounded (the only path that works in an installed PWA).
// Clicking one must focus the existing window rather than opening a second copy.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = event.notification.data?.url || '/'
  event.waitUntil((async () => {
    const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of clientList) {
      if ('focus' in client) return client.focus()
    }
    if (self.clients.openWindow) return self.clients.openWindow(target)
  })())
})

function isSameOrigin(url) { return url.origin === self.location.origin }
function isLiveStudyStream(url) { return url.pathname.startsWith('/api/v1/session/live') }
function isOfflineCapableApi(url) { return OFFLINE_API_ALLOWLIST.includes(url.pathname) }
function isVersionMetadata(url) { return url.pathname === '/release.json' || url.pathname === '/sw.js' }
function isStaticAsset(request, url) {
  return url.pathname.startsWith('/assets/') || request.destination === 'script' || request.destination === 'style' || request.destination === 'image' || request.destination === 'font' || request.destination === 'manifest'
}

async function cachedFreestyleFallback(request) {
  const cache = await caches.open(API_CACHE)
  const exact = await cache.match(request)
  if (exact) return exact
  const keys = await cache.keys()
  for (let index = keys.length - 1; index >= 0; index -= 1) {
    const candidate = keys[index]
    if (new URL(candidate.url).pathname === '/api/v1/freestyle/feed') {
      const response = await cache.match(candidate)
      if (response) return response
    }
  }
  return new Response(JSON.stringify({ cards: [], counts: ZERO_COUNTS, generated_at: new Date().toISOString(), offline: true }), {
    status: 200,
    headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' },
  })
}

async function networkFirstOfflineApi(request) {
  const cache = await caches.open(API_CACHE)
  const response = await fetchWithin(request, API_TIMEOUT_MS)
  if (!response) return cachedFreestyleFallback(request)
  if (response.ok) cacheRuntimeResponse(cache, request, response)
  return response
}

async function currentReleaseAsset(request) {
  const cache = await caches.open(APP_CACHE)
  const cached = await cachedCurrentOrPreviousAsset(cache, request)
  if (cached) return cached
  // `cache: 'reload'` 绕过浏览器 HTTP 缓存。APP_CACHE 按 RELEASE_ID 分代只保证必然 miss，
  // 不保证 miss 之后拿到的是新字节：这里的文件名不是内容寻址，且 /assets/* 没有 cache-control，
  // 旧字节会被 cache.put 洗进新一代缓存里。precacheCurrentRelease 早已这么做，此处对齐。
  const response = await fetchWithin(new Request(request, { cache: 'reload' }), ASSET_TIMEOUT_MS)
  // 不再抛异常：抛进 respondWith 会让 import() 直接失败并炸掉整条路由。
  // 有响应就原样返回（哪怕 404），让 lazyWithRetry / RouteErrorBoundary 拿到可读的错误。
  if (!response) {
    return new Response('', {
      status: 504,
      statusText: 'Asset fetch timed out',
      headers: { 'Cache-Control': 'no-store' },
    })
  }
  if (response.ok) cacheRuntimeResponse(cache, request, response)
  return response
}

async function navigationFallback(request) {
  const cache = await caches.open(APP_CACHE)
  // 这里原来是裸 fetch：网络挂住时它永不 settle，缓存外壳永远轮不到，PWA 白屏到底。
  const network = startAbortableFetch(request)
  const settle = async (response) => {
    if (response.ok && NAVIGATION_CACHE_PATHS.includes(new URL(request.url).pathname)) {
      cacheRuntimeResponse(cache, request, response)
    }
    return response
  }

  const first = await waitForResponseWithin(network.response, NAVIGATION_TIMEOUT_MS)
  if (first !== NAVIGATION_TIMED_OUT) {
    if (first) return settle(first)
    return (await cachedShell(cache)) || Response.error()
  }

  // 超时了：有外壳就先把上一版显示出来，这条网络请求继续跑，只是不再等它。
  const shell = await cachedShell(cache)
  if (shell) {
    // 尽力把迟到的响应写回缓存，否则慢链路上的手机会一直启动旧外壳。
    void waitForResponseWithin(network.response, NAVIGATION_COLD_START_TIMEOUT_MS)
      .then((late) => {
        if (late && late !== NAVIGATION_TIMED_OUT) return settle(late)
        network.abort()
        return null
      })
      .catch(() => null)
    return shell
  }

  // 冷启动，无壳可退，只能把预算放宽继续等。
  const late = await waitForResponseWithin(network.response, NAVIGATION_COLD_START_TIMEOUT_MS)
  if (late && late !== NAVIGATION_TIMED_OUT) return settle(late)
  network.abort()
  return Response.error()
}

function cachedShell(cache) {
  return cache.match('/freestyle')
    .then((hit) => hit || cache.match('/'))
    .then((hit) => hit || cache.match('/offline.html'))
}

/**
 * /release.json 永不缓存，但也不能永不 settle：registerServiceWorker 每 60s 轮询一次，
 * 挂住的请求会一直堆积。超时就报 504，让轮询这一轮明确失败并等下一轮。
 */
async function versionMetadata(request) {
  const response = await fetchWithin(new Request(request, { cache: 'no-store' }), API_TIMEOUT_MS)
  if (response) return response
  return new Response('', {
    status: 504,
    statusText: 'Release metadata fetch timed out',
    headers: { 'Cache-Control': 'no-store' },
  })
}

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (!isSameOrigin(url)) return
  // Never buffer the live study SSE body through startFetch().arrayBuffer().
  if (isLiveStudyStream(url)) return
  if (request.mode === 'navigate') { event.respondWith(navigationFallback(request)); return }
  if (isVersionMetadata(url)) { event.respondWith(versionMetadata(request)); return }
  if (isOfflineCapableApi(url)) { event.respondWith(networkFirstOfflineApi(request)); return }
  if (isStaticAsset(request, url)) event.respondWith(currentReleaseAsset(request))
})
