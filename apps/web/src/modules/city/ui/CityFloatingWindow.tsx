import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  ChevronDown,
  ChevronUp,
  Maximize2,
  Minimize2,
  Orbit,
  Play,
  RefreshCw,
  RotateCcw,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react'
import {
  CITY_WINDOW_DISABLED_KEY,
  CITY_WINDOW_STORAGE_KEY,
} from '../model/cityWindowKeys'
import {
  useCityBridge,
  type CityAudioState,
  type CityStats,
} from './useCityBridge'
import './cityFloatingWindow.css'

interface CityGeometry {
  x: number
  y: number
  w: number
  h: number
}

interface StoredCityWindow {
  open?: boolean
  muted?: boolean
  orbit?: boolean
  geometry?: CityGeometry
}

interface DragState {
  pointerId: number
  startX: number
  startY: number
  originX: number
  originY: number
}

interface ResizeState {
  pointerId: number
  startX: number
  startY: number
  originW: number
  originH: number
}

const MIN_W = 360
const MIN_H = 280
const HEADER_H = 46
const MARGIN = 12
const DEFAULT_W = 580
const DEFAULT_H = 440
const CITY_URL = `${import.meta.env.BASE_URL.replace(/\/?$/, '/')}city/index.html?embed=1`

function readStoredWindow(): StoredCityWindow {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(CITY_WINDOW_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as StoredCityWindow
    const geometry = parsed.geometry
    const hasGeometry =
      geometry != null && [geometry.x, geometry.y, geometry.w, geometry.h].every(Number.isFinite)
    return {
      open: parsed.open === true,
      muted: parsed.muted === true,
      orbit: parsed.orbit === true,
      geometry: hasGeometry ? geometry : undefined,
    }
  } catch {
    return {}
  }
}

function clampGeometry(geometry: CityGeometry): CityGeometry {
  if (typeof window === 'undefined') return geometry
  const viewportW = window.innerWidth
  const viewportH = window.innerHeight
  const maxW = Math.max(280, viewportW - 16)
  const maxH = Math.max(240, viewportH - 16)
  const w = Math.min(Math.max(Math.min(MIN_W, maxW), geometry.w), maxW)
  const h = Math.min(Math.max(Math.min(MIN_H, maxH), geometry.h), maxH)
  const x = Math.min(Math.max(MARGIN, geometry.x), Math.max(MARGIN, viewportW - w - MARGIN))
  const y = Math.min(Math.max(MARGIN, geometry.y), Math.max(MARGIN, viewportH - h - MARGIN))
  return { x, y, w, h }
}

function defaultGeometry(): CityGeometry {
  const viewportW = window.innerWidth
  const viewportH = window.innerHeight
  const w = Math.min(DEFAULT_W, Math.max(320, viewportW - 32))
  const h = Math.min(DEFAULT_H, Math.max(260, viewportH - 32))
  return clampGeometry({ x: viewportW - w - 20, y: viewportH - h - 20, w, h })
}

function isCityDisabled(): boolean {
  try {
    return window.localStorage.getItem(CITY_WINDOW_DISABLED_KEY) === '1'
  } catch {
    return false
  }
}

/** Global floating learning city. The Three.js scene stays in an isolated iframe. */
export function CityFloatingWindow() {
  if (import.meta.env.MODE === 'test') return null
  if (typeof window !== 'undefined' && isCityDisabled()) return null
  return <CityWindowImpl />
}

function CityWindowImpl() {
  const stored = useMemo(() => readStoredWindow(), [])
  const [open, setOpen] = useState(stored.open === true)
  const [hasOpened, setHasOpened] = useState(stored.open === true)
  const [geometry, setGeometry] = useState<CityGeometry>(() =>
    stored.geometry ? clampGeometry(stored.geometry) : defaultGeometry(),
  )
  const [collapsed, setCollapsed] = useState(false)
  const [maximized, setMaximized] = useState(false)
  const [restoreGeometry, setRestoreGeometry] = useState(geometry)
  const [muted, setMuted] = useState(stored.muted === true)
  const [orbit, setOrbit] = useState(stored.orbit === true)
  const [stats, setStats] = useState<CityStats | null>(null)
  const [ready, setReady] = useState(false)
  const [audio, setAudio] = useState<CityAudioState | null>(null)
  const [notice, setNotice] = useState<{ text: string; tone: string; id: number } | null>(null)
  const [loadHint, setLoadHint] = useState(false)

  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const resizeRef = useRef<ResizeState | null>(null)

  const onStats = useCallback((next: CityStats) => setStats(next), [])
  const onNotice = useCallback((text: string, tone: string) => {
    setNotice({ text, tone, id: Date.now() })
  }, [])
  const onAudio = useCallback((next: CityAudioState) => setAudio(next), [])
  const onReady = useCallback(() => setReady(true), [])
  const { send } = useCityBridge(iframeRef, { onStats, onNotice, onAudio, onReady })

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(
          CITY_WINDOW_STORAGE_KEY,
          JSON.stringify({
            open,
            muted,
            orbit,
            geometry: maximized ? restoreGeometry : geometry,
          }),
        )
      } catch {
        // Storage may be unavailable in private or embedded contexts.
      }
    }, 180)
    return () => window.clearTimeout(timer)
  }, [geometry, maximized, muted, open, orbit, restoreGeometry])

  useEffect(() => {
    const onResize = () => {
      setGeometry((current) =>
        maximized
          ? clampGeometry({
              x: MARGIN,
              y: MARGIN,
              w: window.innerWidth - MARGIN * 2,
              h: window.innerHeight - MARGIN * 2,
            })
          : clampGeometry(current),
      )
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [maximized])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 2600)
    return () => window.clearTimeout(timer)
  }, [notice])

  useEffect(() => {
    if (!hasOpened || ready) {
      setLoadHint(false)
      return
    }
    const timer = window.setTimeout(() => setLoadHint(true), 12_000)
    return () => window.clearTimeout(timer)
  }, [hasOpened, ready])

  useEffect(() => {
    if (!ready) return
    send({ type: 'mute', payload: { muted } })
    send({ type: 'orbit', payload: { on: orbit } })
  }, [muted, orbit, ready, send])

  useEffect(() => {
    if (!ready) return
    send({ type: 'active', payload: { on: open && !collapsed } })
  }, [collapsed, open, ready, send])

  const openWindow = useCallback(() => {
    setHasOpened(true)
    setOpen(true)
    setCollapsed(false)
    setLoadHint(false)
  }, [])

  const closeWindow = useCallback(() => setOpen(false), [])

  const toggleMute = useCallback(() => {
    const next = !muted
    setMuted(next)
    send({ type: 'mute', payload: { muted: next } })
  }, [muted, send])

  const toggleOrbit = useCallback(() => {
    const next = !orbit
    setOrbit(next)
    send({ type: 'orbit', payload: { on: next } })
  }, [orbit, send])

  const resetCamera = useCallback(() => send({ type: 'reset' }), [send])
  const resetCity = useCallback(() => {
    const confirmed = window.confirm('重置城邦会清空当前所有建筑，只保留悬浮岛。继续吗？')
    if (!confirmed) return
    send({ type: 'reset-city' })
  }, [send])
  const runDemo = useCallback(() => send({ type: 'demo' }), [send])

  const toggleCollapse = useCallback(() => setCollapsed((current) => !current), [])

  const toggleMaximize = useCallback(() => {
    if (maximized) {
      setGeometry(restoreGeometry)
      setMaximized(false)
      return
    }
    setRestoreGeometry(geometry)
    setGeometry(
      clampGeometry({
        x: MARGIN,
        y: MARGIN,
        w: window.innerWidth - MARGIN * 2,
        h: window.innerHeight - MARGIN * 2,
      }),
    )
    setCollapsed(false)
    setMaximized(true)
  }, [geometry, maximized, restoreGeometry])

  const startDrag = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (maximized) return
      if ((event.target as HTMLElement).closest('button')) return
      event.currentTarget.setPointerCapture(event.pointerId)
      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: geometry.x,
        originY: geometry.y,
      }
    },
    [geometry.x, geometry.y, maximized],
  )

  const moveDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    setGeometry((current) =>
      clampGeometry({
        ...current,
        x: drag.originX + event.clientX - drag.startX,
        y: drag.originY + event.clientY - drag.startY,
      }),
    )
  }, [])

  const endDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }, [])

  const startResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault()
      event.stopPropagation()
      event.currentTarget.setPointerCapture(event.pointerId)
      resizeRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originW: geometry.w,
        originH: geometry.h,
      }
    },
    [geometry.h, geometry.w],
  )

  const moveResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const resize = resizeRef.current
    if (!resize || resize.pointerId !== event.pointerId) return
    setGeometry((current) =>
      clampGeometry({
        ...current,
        w: resize.originW + event.clientX - resize.startX,
        h: resize.originH + event.clientY - resize.startY,
      }),
    )
  }, [])

  const endResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (resizeRef.current?.pointerId !== event.pointerId) return
    resizeRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }, [])

  const audioHint = hasOpened && ready && !muted && audio?.state !== 'running'
  const windowStyle: CSSProperties = {
    left: geometry.x,
    top: geometry.y,
    width: geometry.w,
    height: collapsed ? HEADER_H : geometry.h,
    display: open ? 'flex' : 'none',
  }

  const noticeClass = notice
    ? ['city-window__notice', notice.tone === 'amber' ? 'amber' : notice.tone === 'good' ? 'good' : '']
        .filter(Boolean)
        .join(' ')
    : ''

  return (
    <>
      {!open ? (
        <button
          type="button"
          className="city-launcher"
          onClick={openWindow}
          data-testid="city-launcher"
          aria-label="打开记忆城邦"
          title="打开记忆城邦"
        >
          <span className="city-launcher__icon" aria-hidden="true">
            ✦
          </span>
          <span className="city-launcher__text">记忆城邦</span>
          {stats ? <span className="city-launcher__stat">翻卡 {stats.flips}</span> : null}
          <span className="city-launcher__dot" aria-hidden="true" />
        </button>
      ) : null}

      <div className="city-window" style={windowStyle} data-testid="city-window">
        <div
          className="city-window__header"
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <span className="city-window__dot" aria-hidden="true" />
          <span className="city-window__title">记忆城邦</span>
          {stats ? (
            <div className="city-window__stats">
              <span className="city-window__stat">
                翻卡 <b>{stats.flips}</b>
              </span>
              <span className="city-window__stat">
                单元 <b>{stats.units}</b>
              </span>
              <span className="city-window__stat">
                重点 <b>{stats.highlights}</b>
              </span>
            </div>
          ) : null}
          <div className="city-window__controls">
            <button
              type="button"
              className="city-window__btn"
              onClick={toggleMute}
              title={muted ? '开启音效' : '静音'}
              aria-label={muted ? '开启城邦音效' : '静音城邦'}
            >
              {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
            </button>
            <button
              type="button"
              className={orbit ? 'city-window__btn on' : 'city-window__btn'}
              onClick={toggleOrbit}
              title={orbit ? '停止镜头环绕' : '镜头环绕'}
              aria-label={orbit ? '停止镜头环绕' : '镜头环绕'}
            >
              <Orbit size={14} />
            </button>
            <button
              type="button"
              className="city-window__btn"
              onClick={resetCamera}
              title="重置视角"
              aria-label="重置城邦视角"
            >
              <RotateCcw size={14} />
            </button>
            <button
              type="button"
              className="city-window__btn"
              onClick={resetCity}
              title="重置城邦（清空建筑，只留悬浮岛）"
              aria-label="重置城邦"
            >
              <RefreshCw size={14} />
            </button>
            <button
              type="button"
              className="city-window__btn"
              onClick={runDemo}
              title="自动沉浸演示"
              aria-label="自动沉浸演示"
            >
              <Play size={14} />
            </button>
            <button
              type="button"
              className="city-window__btn"
              onClick={toggleMaximize}
              title={maximized ? '还原窗口' : '放大窗口'}
              aria-label={maximized ? '还原城邦窗口' : '放大城邦窗口'}
            >
              {maximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>
            <button
              type="button"
              className="city-window__btn"
              onClick={toggleCollapse}
              title={collapsed ? '展开窗口' : '收起窗口'}
              aria-label={collapsed ? '展开城邦窗口' : '收起城邦窗口'}
            >
              {collapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
            <button
              type="button"
              className="city-window__btn"
              onClick={closeWindow}
              title="关闭窗口"
              aria-label="关闭城邦窗口"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        <div className="city-window__body" style={{ display: collapsed ? 'none' : 'block' }}>
          {hasOpened ? (
            <iframe
              ref={iframeRef}
              className="city-window__frame"
              src={CITY_URL}
              title="记忆城邦 3D 学习城市"
              allow="autoplay"
            />
          ) : null}
          {hasOpened && !ready ? (
            <div className="city-window__loading">
              <span className="city-window__spinner" aria-hidden="true" />
              <span>城邦正在醒来…</span>
              {loadHint ? (
                <small>加载较慢。请确认本地服务正在运行；城邦资源位于 public/city。</small>
              ) : null}
            </div>
          ) : null}
          {audioHint ? <div className="city-window__audio-hint">点击城邦画面开启音效</div> : null}
          {notice ? (
            <div key={notice.id} className={noticeClass}>
              {notice.text}
            </div>
          ) : null}
          {!collapsed && !maximized ? (
            <div
              className="city-window__resize"
              onPointerDown={startResize}
              onPointerMove={moveResize}
              onPointerUp={endResize}
              onPointerCancel={endResize}
              aria-hidden="true"
            />
          ) : null}
        </div>
      </div>
    </>
  )
}
