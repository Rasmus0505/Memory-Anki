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
  /** 为 true 时所有节点始终展开，忽略 expand 状态 (适用于编辑模式) */
  alwaysExpanded?: boolean
}

// Stable per-key toggle functions
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
  indentPerLevel = 20,
  baseIndent = 12,
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

  const renderTree = (items: T[], depth: number, path: number[]): ReactNode => {
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
      const childrenRows =
        hasChildren && isExpanded ? renderTree(children, depth + 1, currentPath) : null

      if (!showConnector || depth === 0) {
        return (
          <div key={key}>
            {row}
            {childrenRows}
          </div>
        )
      }

      // Obsidian-style connector: vertical line + horizontal T-branch
      const connectorLeft = baseIndent + (depth - 1) * indentPerLevel + indentPerLevel / 2

      return (
        <div key={key} className="relative">
          {/* Vertical line extending through this node */}
          {!isLastChild && (
            <div
              className="absolute border-l border-muted-foreground/25"
              style={{
                left: connectorLeft,
                top: '50%',
                bottom: 0,
              }}
            />
          )}
          {/* Horizontal T-branch */}
          <div
            className="absolute border-t border-muted-foreground/25"
            style={{
              left: connectorLeft,
              top: '50%',
              width: indentPerLevel / 2,
            }}
          />
          {row}
          {childrenRows}
        </div>
      )
    })
  }

  return <>{renderTree(nodes, 0, [])}</>
}
