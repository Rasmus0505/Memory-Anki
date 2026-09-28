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
          className="pointer-events-none absolute inset-x-1 -top-1.5 z-30 h-1.5 rounded-full bg-primary shadow-[0_0_0_3px_hsl(28_80%_51%/0.3)]"
        />
        <span
          aria-hidden="true"
          data-drop-placeholder-label="before"
          className="pointer-events-none absolute left-1/2 top-[-1.35rem] z-40 -translate-x-1/2 whitespace-nowrap rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-white shadow-sm"
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
          className="pointer-events-none absolute inset-x-1 -bottom-1.5 z-30 h-1.5 rounded-full bg-primary shadow-[0_0_0_3px_hsl(28_80%_51%/0.3)]"
        />
        <span
          aria-hidden="true"
          data-drop-placeholder-label="after"
          className="pointer-events-none absolute bottom-[-1.35rem] left-1/2 z-40 -translate-x-1/2 whitespace-nowrap rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-white shadow-sm"
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
        className="pointer-events-none absolute inset-1 z-10 rounded-lg border-2 border-dashed border-success/80 bg-success/10"
      />
      <span
        aria-hidden="true"
        data-drop-placeholder-label="inside"
        className="pointer-events-none absolute left-1/2 top-1/2 z-40 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full bg-success px-2 py-0.5 text-[10px] font-semibold text-white shadow-sm"
      >
        {MODE_LABEL.inside}
      </span>
      <span
        aria-hidden="true"
        data-drop-placeholder-slot="inside"
        className="pointer-events-none absolute left-3 right-3 -bottom-3 z-20 h-2 rounded-md border border-dashed border-success/70 bg-success/15"
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
      className="pointer-events-none fixed z-[10000] max-w-[14rem] -translate-x-1/2 -translate-y-[110%] rounded-xl border-2 border-dashed border-primary bg-primary-soft/95 px-3 py-2 text-xs font-medium text-primary-strong shadow-xl"
      style={{ left: ghost.x, top: ghost.y - 8 }}
    >
      <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary/90">
        新卡片
      </div>
      {ghost.text}
    </div>,
    portalHost,
  )
}
