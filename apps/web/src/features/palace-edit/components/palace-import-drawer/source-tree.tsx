import type { MindMapImportSourceNode } from '@/shared/api/contracts'

export function SourceTreeNode({
  node,
  depth = 0,
}: {
  node: MindMapImportSourceNode
  depth?: number
}) {
  return (
    <div className="space-y-2">
      <div
        className="rounded-xl border border-border/70 bg-background/70 px-3 py-2 text-sm whitespace-pre-wrap break-words"
        style={{ marginLeft: depth * 14 }}
      >
        {node.rich_text_html ? (
          <div
            className="mindmap-import-richtext whitespace-pre-wrap break-words [&_u]:underline [&_u]:decoration-solid [&_[data-underline-style='wavy']]:underline [&_[data-underline-style='wavy']]:decoration-wavy"
            dangerouslySetInnerHTML={{ __html: node.rich_text_html }}
          />
        ) : (
          node.text
        )}
      </div>
      {node.children?.length ? (
        <div className="space-y-2">
          {node.children.map((child, index) => (
            <SourceTreeNode key={`${child.text}-${index}`} node={child} depth={depth + 1} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function countSourceTreeNodes(nodes: MindMapImportSourceNode[]) {
  return nodes.reduce((sum, node) => sum + 1 + countSourceTreeNodes(node.children || []), 0)
}
