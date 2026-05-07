import { useState, useCallback, useRef, type ReactNode } from 'react'

export interface TreeRenderMeta {
  depth: number
  path: number[]
  isExpanded: boolean
  isLeaf: boolean
  toggleExpand: () => void
  hasChildren: boolean
  isLastChild: boolean
}

export interface TreeRendererProps<T> {
  nodes: T[]
  getKey: (node: T, index: number) => string | number
  getChildren: (node: T) => T[]
  renderNode: (node: T, meta: TreeRenderMeta) => ReactNode
  indentPerLevel?: number
  baseIndent?: number
  initialExpanded?: Set<string | number>
  expanded?: Set<string | number>
  onExpandedChange?: (s: Set<string | number>) => void
  showConnector?: boolean
  alwaysExpanded?: boolean
}

function useExpandState(
  controlledExpanded: Set<string | number> | undefined,
  onExpandedChange: ((s: Set<string | number>) => void) | undefined,
  initialExpanded: Set<string | number>
) {
  const [internal, setInternal] = useState(initialExpanded)

  const expanded = controlledExpanded ?? internal
  const expandedRef = useRef(expanded)
  expandedRef.current = expanded

  const onExpandedChangeRef = useRef(onExpandedChange)
  onExpandedChangeRef.current = onExpandedChange
  const controlledRef = useRef(controlledExpanded)
  controlledRef.current = controlledExpanded

  const toggles = useRef<Map<string | number, () => void>>(new Map())

  const getToggle = useCallback((key: string | number) => {
    let fn = toggles.current.get(key)
    if (!fn) {
      fn = () => {
        const current = controlledRef.current ?? expandedRef.current
        const next = new Set(current)
        if (next.has(key)) next.delete(key)
        else next.add(key)
        if (controlledRef.current === undefined) setInternal(next)
        onExpandedChangeRef.current?.(next)
      }
      toggles.current.set(key, fn)
    }
    return fn
  }, [])

  return { expanded, getToggle }
}

export function TreeRenderer<T>({
  nodes,
  getKey,
  getChildren,
  renderNode,
  indentPerLevel = 36,
  baseIndent = 18,
  initialExpanded,
  expanded: controlledExpanded,
  onExpandedChange,
  showConnector = false,
  alwaysExpanded = false,
}: TreeRendererProps<T>) {
  const { expanded, getToggle } = useExpandState(
    controlledExpanded,
    onExpandedChange,
    initialExpanded ?? new Set()
  )

  const renderTree = (
    items: T[],
    depth: number,
    path: number[],
    ancestorHasNext: boolean[]
  ): ReactNode => {
    const lastIdx = items.length - 1

    return items.map((node, i) => {
      const key = getKey(node, i)
      const children = getChildren(node)
      const hasChildren = children.length > 0
      const isExpanded = alwaysExpanded || expanded.has(key)
      const currentPath = [...path, i]
      const isLastChild = i === lastIdx

      const meta: TreeRenderMeta = {
        depth,
        path: currentPath,
        isExpanded,
        isLeaf: !hasChildren,
        toggleExpand: getToggle(key),
        hasChildren,
        isLastChild,
      }

      const row = renderNode(node, meta)
      const childrenRows = hasChildren && isExpanded
        ? renderTree(children, depth + 1, currentPath, [...ancestorHasNext, !isLastChild])
        : null

      if (!showConnector) {
        return (
          <div key={key}>
            {row}
            {childrenRows}
          </div>
        )
      }

      const verticals = ancestorHasNext.map((hasNext, idx) => {
        if (!hasNext) return null
        const left = baseIndent + idx * indentPerLevel + indentPerLevel / 2
        return (
          <div
            key={`v-${key}-${idx}`}
            className="absolute top-0 bottom-0 border-l border-slate-300/90"
            style={{ left }}
          />
        )
      })

      const branchLeft = baseIndent + Math.max(depth - 1, 0) * indentPerLevel + indentPerLevel / 2

      return (
        <div key={key} className="relative">
          {verticals}
          {depth > 0 ? (
            <>
              {!isLastChild ? (
                <div
                  className="absolute border-l border-slate-300/90"
                  style={{ left: branchLeft, top: '50%', bottom: 0 }}
                />
              ) : null}
              <div
                className="absolute border-t border-slate-400/90"
                style={{ left: branchLeft, top: '50%', width: indentPerLevel / 2 + 8 }}
              />
            </>
          ) : null}
          {row}
          {childrenRows}
        </div>
      )
    })
  }

  return <>{renderTree(nodes, 0, [], [])}</>
}
