import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { MindMapNode } from './adapter'

const typeStyles: Record<string, { bg: string; border: string; text: string }> = {
  chapter: { bg: 'bg-blue-50 dark:bg-blue-950', border: 'border-blue-300 dark:border-blue-700', text: 'text-blue-700 dark:text-blue-300' },
  peg: { bg: 'bg-emerald-50 dark:bg-emerald-950', border: 'border-emerald-300 dark:border-emerald-700', text: 'text-emerald-700 dark:text-emerald-300' },
}

function MindMapNodeCard({ data }: NodeProps) {
  const nodeData = data as unknown as MindMapNode & { depth?: number }
  const styles = typeStyles[nodeData.type] ?? typeStyles.chapter

  return (
    <div className={`rounded-lg border-2 px-3 py-2 text-sm shadow-sm min-w-[120px] max-w-[200px] ${styles.bg} ${styles.border} ${styles.text}`}>
      <Handle type="target" position={Position.Top} className="!bg-muted-foreground" />
      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wider opacity-60 font-medium">
          {nodeData.type}
        </span>
      </div>
      <div className="font-semibold truncate">{nodeData.label}</div>
      {nodeData.metadata && (
        <div className="text-[10px] opacity-60 mt-0.5">
          {nodeData.type === 'chapter' && nodeData.metadata.palace_count !== undefined && (
            <span>{Number(nodeData.metadata.palace_count)} palaces</span>
          )}
          {nodeData.type === 'peg' && nodeData.metadata.content && (
            <span className="truncate block">{String(nodeData.metadata.content).slice(0, 30)}</span>
          )}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} className="!bg-muted-foreground" />
    </div>
  )
}

const nodeTypes = { mindmapNode: memo(MindMapNodeCard) }
export { nodeTypes }
export default MindMapNodeCard
