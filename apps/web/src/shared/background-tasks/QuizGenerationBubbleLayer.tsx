import { useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2, GripHorizontal, LoaderCircle, X, XCircle } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/shared/components/ui/button'
import { cn } from '@/shared/lib/utils'
import {
  dismissTask,
  setTaskBubblePosition,
  useBackgroundTasks,
} from '@/shared/background-tasks/backgroundTaskRegistry'

const QUIZ_BUBBLE_STORAGE_KEY = 'memory_anki_quiz_generation_bubble_positions'

type BubblePositionMap = Record<string, { x: number; y: number }>

function loadBubblePositions(): BubblePositionMap {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(QUIZ_BUBBLE_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as BubblePositionMap
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function saveBubblePositions(positions: BubblePositionMap) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(QUIZ_BUBBLE_STORAGE_KEY, JSON.stringify(positions))
  } catch {
    // Ignore storage failures and keep current-session interaction.
  }
}

function getFallbackBubblePosition(index: number) {
  return {
    x: Math.max(24, window.innerWidth - 332),
    y: Math.max(96, 112 + index * 108),
  }
}

function clampBubblePosition(position: { x: number; y: number }) {
  const maxX = Math.max(24, window.innerWidth - 320)
  const maxY = Math.max(24, window.innerHeight - 120)
  return {
    x: Math.min(maxX, Math.max(24, position.x)),
    y: Math.min(maxY, Math.max(24, position.y)),
  }
}

export function QuizGenerationBubbleLayer() {
  const navigate = useNavigate()
  const tasks = useBackgroundTasks().filter((task) => task.kind === 'quiz-generation')
  const positionsRef = useRef<BubblePositionMap>({})
  const [draggingId, setDraggingId] = useState<string | null>(null)

  useEffect(() => {
    positionsRef.current = loadBubblePositions()
  }, [])

  useEffect(() => {
    tasks.forEach((task, index) => {
      if (task.bubble) return
      const fallback = positionsRef.current[task.id] ?? getFallbackBubblePosition(index)
      const nextPosition = clampBubblePosition(fallback)
      positionsRef.current = {
        ...positionsRef.current,
        [task.id]: nextPosition,
      }
      setTaskBubblePosition(task.id, nextPosition)
    })
    saveBubblePositions(positionsRef.current)
  }, [tasks])

  const persistedTasks = useMemo(
    () =>
      tasks.map((task, index) => ({
        ...task,
        bubble:
          task.bubble ??
          clampBubblePosition(
            positionsRef.current[task.id] ?? getFallbackBubblePosition(index),
          ),
      })),
    [tasks],
  )

  if (persistedTasks.length === 0) return null

  return (
    <>
      {persistedTasks.map((task) => {
        const isRunning = task.status === 'running'
        const isCompleted = task.status === 'completed'
        const Icon = isRunning ? LoaderCircle : isCompleted ? CheckCircle2 : XCircle
        const bubble = task.bubble || { x: 24, y: 24 }

        return (
          <div
            key={task.id}
            style={{ left: bubble.x, top: bubble.y }}
            className={cn(
              'fixed z-[152] w-[296px] rounded-2xl border bg-background/96 shadow-floating backdrop-blur',
              isRunning && 'border-info/30',
              isCompleted && 'border-success/30',
              task.status === 'failed' && 'border-destructive/30',
            )}
          >
            <div
              className={cn(
                'flex cursor-grab items-center justify-between gap-3 rounded-t-2xl border-b px-3 py-2 text-sm',
                draggingId === task.id && 'cursor-grabbing',
              )}
              onMouseDown={(event) => {
                event.preventDefault()
                const startX = event.clientX
                const startY = event.clientY
                const origin = task.bubble || { x: 24, y: 24 }
                setDraggingId(task.id)

                const handleMouseMove = (moveEvent: MouseEvent) => {
                  const nextPosition = clampBubblePosition({
                    x: origin.x + moveEvent.clientX - startX,
                    y: origin.y + moveEvent.clientY - startY,
                  })
                  positionsRef.current = {
                    ...positionsRef.current,
                    [task.id]: nextPosition,
                  }
                  setTaskBubblePosition(task.id, nextPosition)
                }

                const handleMouseUp = () => {
                  saveBubblePositions(positionsRef.current)
                  setDraggingId((current) => (current === task.id ? null : current))
                  window.removeEventListener('mousemove', handleMouseMove)
                  window.removeEventListener('mouseup', handleMouseUp)
                }

                window.addEventListener('mousemove', handleMouseMove)
                window.addEventListener('mouseup', handleMouseUp)
              }}
            >
              <div className="flex min-w-0 items-center gap-2">
                <GripHorizontal className="h-4 w-4 shrink-0 text-muted-foreground" />
                <Icon
                  className={cn(
                    'h-4 w-4 shrink-0',
                    isRunning && 'animate-spin text-info',
                    isCompleted && 'text-success',
                    task.status === 'failed' && 'text-destructive',
                  )}
                />
                <div className="truncate font-medium">
                  {task.title}
                </div>
              </div>
              <button
                type="button"
                aria-label="关闭生成气泡"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
                onClick={() => dismissTask(task.id)}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3 px-3 py-3">
              <div className="text-sm text-muted-foreground">
                {task.detail || (isRunning ? '正在生成题目…' : isCompleted ? '题目已准备好。' : '生成失败。')}
              </div>
              {isRunning && typeof task.progress === 'number' ? (
                <div className="space-y-1.5">
                  <div className="h-1.5 overflow-hidden rounded-full bg-info/15">
                    <div
                      className="h-full rounded-full bg-info transition-all"
                      style={{ width: `${Math.max(0, Math.min(100, task.progress))}%` }}
                    />
                  </div>
                  <div className="text-right text-xs tabular-nums text-muted-foreground">
                    {Math.round(task.progress)}%
                  </div>
                </div>
              ) : null}
              <div className="flex justify-end gap-2">
                {task.navigateTarget ? (
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => navigate(task.navigateTarget!)}
                  >
                    {isCompleted ? '去做题' : '查看题库'}
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        )
      })}
    </>
  )
}
