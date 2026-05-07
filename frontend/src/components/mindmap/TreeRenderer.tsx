import { useState, useCallback, type ReactNode } from 'react'
import { ChevronRight, ChevronDown } from 'lucide-react'

export interface TreeRenderMeta {
  depth: number
  path: number[]
  isExpanded: boolean
  isLeaf: boolean
  toggleExpand: () => void
  hasChildren: boolean
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
}: TreeRendererProps<T>) {
  const [internalExpanded, setInternalExpanded] = useState<Set<string | number>>(
    initialExpanded ?? new Set()
  )

  const isControlled = controlledExpanded !== undefined
  const expanded = controlledExpanded ?? internalExpanded

  const toggleExpand = useCallback(
    (key: string | number) => {
      const next = new Set(expanded)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      if (!isControlled) setInternalExpanded(next)
      onExpandedChange?.(next)
    },
    [expanded, isControlled, onExpandedChange]
  )

  const renderTree = (items: T[], depth: number, path: number[]): ReactNode => {
    return items.map((node, i) => {
      const key = getKey(node, i)
      const children = getChildren(node)
      const hasChildren = children.length > 0
      const isExpanded = expanded.has(key)
      const isLeaf = !hasChildren
      const currentPath = [...path, i]

      const row = renderNode(node, {
        depth,
        path: currentPath,
        isExpanded,
        isLeaf,
        toggleExpand: () => toggleExpand(key),
        hasChildren,
      })

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

      // Obsidian-style connector lines
      return (
        <div key={key}>
          <div className="relative">
            {/* Vertical connector extending upward from this node */}
            <div
              className="absolute border-l border-muted-foreground/20"
              style={{
                left: baseIndent + (depth - 1) * indentPerLevel + indentPerLevel / 2,
                top: 0,
                height: '100%',
              }}
            />
            {/* Horizontal connector */}
            <div className="relative">
              <div
                className="absolute border-t border-muted-foreground/20"
                style={{
                  left: baseIndent + (depth - 1) * indentPerLevel + indentPerLevel / 2,
                  top: '50%',
                  width: indentPerLevel / 2,
                }}
              />
              {row}
            </div>
            {childrenRows}
          </div>
        </div>
      )
    })
  }

  return <>{renderTree(nodes, 0, [])}</>
}
