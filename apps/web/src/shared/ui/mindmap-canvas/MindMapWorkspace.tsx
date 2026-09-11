import { useState, type ReactNode } from 'react'
import { MindMapSplitLayout } from '@/shared/components/layout/MindMapSplitLayout'

interface MindMapWorkspaceProps {
  leftSidebar?: ReactNode
  main: ReactNode
  rightSidebar?: ReactNode
  focusMode?: boolean
}

export function MindMapWorkspace({
  leftSidebar,
  main,
  rightSidebar,
  focusMode = false,
}: MindMapWorkspaceProps) {
  const [leftCollapsed, setLeftCollapsed] = useState(false)
  const [rightCollapsed, setRightCollapsed] = useState(false)

  if (focusMode || (!leftSidebar && !rightSidebar)) {
    return <div className="flex min-h-0 flex-1 flex-col">{main}</div>
  }

  let body: ReactNode = main
  if (rightSidebar) {
    body = (
      <MindMapSplitLayout
        side="end"
        collapsed={rightCollapsed}
        onCollapsedChange={setRightCollapsed}
        sidePanel={rightSidebar}
        sideClassName="w-[min(300px,85vw)]"
      >
        {body}
      </MindMapSplitLayout>
    )
  }
  if (leftSidebar) {
    body = (
      <MindMapSplitLayout
        side="start"
        collapsed={leftCollapsed}
        onCollapsedChange={setLeftCollapsed}
        sidePanel={leftSidebar}
        sideClassName="w-[min(260px,85vw)]"
      >
        {body}
      </MindMapSplitLayout>
    )
  }
  return body
}
