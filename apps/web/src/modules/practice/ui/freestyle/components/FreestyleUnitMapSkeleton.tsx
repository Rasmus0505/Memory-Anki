import type { FreestyleReviewUnitCard } from '@/shared/api/contracts'

function hashString(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

/** Deterministic per card, so the same unit always shows the same silhouette. */
export function skeletonBranchWidths(cardId: string, nodeCount: number): number[] {
  const count = Math.max(3, Math.min(6, nodeCount > 1 ? nodeCount - 1 : 3))
  let seed = hashString(cardId)
  return Array.from({ length: count }, () => {
    seed = Math.imul(seed ^ (seed >>> 15), 2246822507) >>> 0
    return 42 + (seed % 38)
  })
}

const ROW_GAP = 46
const ROOT_X = 8
const CHILD_X = 46

/**
 * Stand-in for a unit whose content has not arrived. The identity row above already
 * shows the real palace title; this adds the chapter path and a mind-map-shaped
 * shimmer so the page never lands on an empty sheet and the map fades into its place.
 */
export function FreestyleUnitMapSkeleton({ card }: { card: FreestyleReviewUnitCard }) {
  const widths = skeletonBranchWidths(card.id, card.node_count)
  const height = (widths.length - 1) * ROW_GAP
  const rootY = height / 2
  const path = card.context_path?.map((item) => item.text).filter(Boolean).join(' / ')

  return (
    <div
      role="status"
      aria-label="正在准备这张卡"
      data-testid="freestyle-unit-skeleton"
      className="fs-unit-skeleton flex h-full flex-col bg-paper px-5 pb-28 pt-5 text-paper-ink"
    >
      {path ? <span className="truncate text-xs text-paper-muted">{path}</span> : null}
      <div className="flex min-h-0 flex-1 items-center">
        <div className="relative w-full max-w-[34rem]" style={{ height: height + 28 }}>
          {/* Path data has no % units: x lives in a 0–100 viewBox stretched to the box width. */}
          <svg
            className="absolute inset-0 size-full overflow-visible"
            viewBox={`0 0 100 ${height + 28}`}
            preserveAspectRatio="none"
            aria-hidden
          >
            {widths.map((_, index) => {
              const y = index * ROW_GAP + 14
              const fromY = rootY + 14
              const fromX = ROOT_X + 18
              const midX = (fromX + CHILD_X) / 2
              return (
                <path
                  key={index}
                  d={`M ${fromX} ${fromY} C ${midX} ${fromY}, ${midX} ${y}, ${CHILD_X} ${y}`}
                  className="fs-skeleton-edge"
                  fill="none"
                  vectorEffect="non-scaling-stroke"
                  style={{ animationDelay: `${index * 70}ms` }}
                />
              )
            })}
          </svg>
          <span
            className="ma-skeleton absolute h-7 w-[22%] rounded-full"
            style={{ left: `${ROOT_X}%`, top: rootY }}
          />
          {widths.map((width, index) => (
            <span
              key={index}
              className="ma-skeleton fs-skeleton-node absolute h-6 rounded-full"
              style={{
                left: `${CHILD_X}%`,
                top: index * ROW_GAP + 2,
                width: `${width * 0.6}%`,
                animationDelay: `${index * 70}ms`,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
