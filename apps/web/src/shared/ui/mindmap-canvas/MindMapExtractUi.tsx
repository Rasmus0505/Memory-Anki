import { createPortal } from 'react-dom'
import type { ExtractDropMode } from './mindMapExtractDrag'
import { getExtractPortalHost } from './mindMapExtractDrag'

const MODE_LABEL: Record<ExtractDropMode, string> = {
  before: '同级 · 前',
  after: '同级 · 后',
  inside: '成为子卡片',
}

export function ExtractDropPlaceholders({
  mode,
  visible,
}: {
  mode: ExtractDropMode | null
  visible: boolean
}) {
  if (!visible || !mode) return null
  if (mode === 'before') {
    return (
      <>
        <span
          aria-hidden="true"
          data-drop-placeholder="before"
          data-extract-placeholder="before"
          className="pointer-events-none absolute inset-x-1 -top-1.5 z-30 h-1.5 rounded-full bg-sky-400 shadow-[0_0_0_3px_rgba(56,189,248,0.35)]"
        />
        <span
          aria-hidden="true"
          data-drop-placeholder-label="before"
          className="pointer-events-none absolute left-1/2 top-[-1.35rem] z-40 -translate-x-1/2 whitespace-nowrap rounded-full bg-sky-500 px-2 py-0.5 text-[10px] font-semibold text-white shadow-sm"
        >
          {MODE_LABEL.before}
        </span>
      </>
    )
  }
  if (mode === 'after') {
    return (
      <>
        <span
          aria-hidden="true"
          data-drop-placeholder="after"
          data-extract-placeholder="after"
          className="pointer-events-none absolute inset-x-1 -bottom-1.5 z-30 h-1.5 rounded-full bg-sky-400 shadow-[0_0_0_3px_rgba(56,189,248,0.35)]"
        />
        <span
          aria-hidden="true"
          data-drop-placeholder-label="after"
          className="pointer-events-none absolute bottom-[-1.35rem] left-1/2 z-40 -translate-x-1/2 whitespace-nowrap rounded-full bg-sky-500 px-2 py-0.5 text-[10px] font-semibold text-white shadow-sm"
        >
          {MODE_LABEL.after}
        </span>
      </>
    )
  }
  return (
    <>
      <span
        aria-hidden="true"
        data-drop-placeholder="inside"
        data-extract-placeholder="inside"
        className="pointer-events-none absolute inset-1 z-10 rounded-lg border-2 border-dashed border-emerald-400/80 bg-emerald-50/20"
      />
      <span
        aria-hidden="true"
        data-drop-placeholder-label="inside"
        className="pointer-events-none absolute left-1/2 top-1/2 z-40 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-semibold text-white shadow-sm"
      >
        {MODE_LABEL.inside}
      </span>
      <span
        aria-hidden="true"
        data-drop-placeholder-slot="inside"
        className="pointer-events-none absolute left-3 right-3 -bottom-3 z-20 h-2 rounded-md border border-dashed border-emerald-400/70 bg-emerald-100/50"
      />
    </>
  )
}

export function ExtractGhostPortal({
  ghost,
}: {
  ghost: { x: number; y: number; text: string } | null
}) {
  if (!ghost) return null
  const portalHost = getExtractPortalHost()
  if (!portalHost) return null
  return createPortal(
    <div
      data-extract-ghost="true"
      className="pointer-events-none fixed z-[10000] max-w-[14rem] -translate-x-1/2 -translate-y-[110%] rounded-xl border-2 border-dashed border-sky-500 bg-sky-50/95 px-3 py-2 text-xs font-medium text-sky-900 shadow-xl"
      style={{ left: ghost.x, top: ghost.y - 8 }}
    >
      <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-600/90">
        新卡片
      </div>
      {ghost.text}
    </div>,
    portalHost,
  )
}
