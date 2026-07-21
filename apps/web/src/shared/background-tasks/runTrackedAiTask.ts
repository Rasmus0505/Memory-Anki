import {
  completeTask,
  dismissTask,
  failTask,
  registerTask,
  updateTask,
  type BackgroundTaskSection,
  type TaskStep,
  type TaskStepStatus,
} from './backgroundTaskRegistry'

export interface TrackedAiStepDefinition {
  id: string
  label: string
}

export interface TrackedAiTaskController {
  taskId: string
  setStep: (stepId: string, detail?: string) => void
  setProgress: (progress: number, detail?: string) => void
  cancel: () => void
}

function buildSteps(
  definitions: TrackedAiStepDefinition[],
  activeId: string | null,
  terminal: TaskStepStatus | null,
): TaskStep[] {
  let sawActive = false
  return definitions.map((step) => {
    if (terminal === 'failed') {
      if (step.id === activeId) return { label: step.label, status: 'failed' }
      if (!sawActive && activeId && step.id !== activeId) {
        // keep previous done until active
      }
    }
    if (step.id === activeId) {
      sawActive = true
      if (terminal === 'done') return { label: step.label, status: 'done' }
      if (terminal === 'failed') return { label: step.label, status: 'failed' }
      return { label: step.label, status: 'active' }
    }
    if (!sawActive && activeId) {
      const activeIndex = definitions.findIndex((item) => item.id === activeId)
      const currentIndex = definitions.findIndex((item) => item.id === step.id)
      if (currentIndex < activeIndex) return { label: step.label, status: 'done' }
    }
    if (terminal === 'done') return { label: step.label, status: 'done' }
    return { label: step.label, status: 'pending' }
  })
}

/**
 * Wrap a long AI run with global BackgroundTaskBar progress.
 * Synchronous/non-streaming calls still get stage-based progress so the user
 * can see that work is in flight.
 */
export async function runTrackedAiTask<T>(options: {
  id: string
  section: BackgroundTaskSection
  title: string
  navigateTarget?: string
  steps: TrackedAiStepDefinition[]
  initialDetail?: string
  run: (controller: TrackedAiTaskController) => Promise<T>
}): Promise<T> {
  const firstStep = options.steps[0] ?? null
  let activeStepId = firstStep?.id ?? null
  registerTask({
    id: options.id,
    section: options.section,
    title: options.title,
    detail: options.initialDetail ?? firstStep?.label ?? '进行中…',
    progress: firstStep ? Math.round(100 / Math.max(options.steps.length, 1) / 2) : 5,
    navigateTarget: options.navigateTarget,
    steps: buildSteps(options.steps, activeStepId, null),
  })

  const controller: TrackedAiTaskController = {
    taskId: options.id,
    setStep(stepId, detail) {
      activeStepId = stepId
      const index = Math.max(
        0,
        options.steps.findIndex((item) => item.id === stepId),
      )
      const progress = Math.min(
        95,
        Math.round(((index + 0.5) / Math.max(options.steps.length, 1)) * 100),
      )
      updateTask(options.id, {
        detail: detail ?? options.steps[index]?.label ?? '进行中…',
        progress,
        steps: buildSteps(options.steps, activeStepId, null),
      })
    },
    setProgress(progress, detail) {
      updateTask(options.id, {
        progress: Math.max(0, Math.min(99, progress)),
        detail,
        steps: buildSteps(options.steps, activeStepId, null),
      })
    },
    cancel() {
      dismissTask(options.id)
    },
  }

  try {
    const result = await options.run(controller)
    updateTask(options.id, {
      progress: 100,
      steps: buildSteps(options.steps, activeStepId, 'done'),
    })
    completeTask(options.id)
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : 'AI 任务失败'
    updateTask(options.id, {
      steps: buildSteps(options.steps, activeStepId, 'failed'),
    })
    failTask(options.id, message)
    throw error
  }
}
