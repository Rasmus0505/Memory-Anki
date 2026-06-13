import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useAiRunConfigDialog } from '@/features/ai-config/useAiRunConfigDialog'
import type {
  EnglishGenerationLogEvent,
  EnglishGenerationLogResponse,
  EnglishWorkspaceResponse,
} from '@/shared/api/contracts'
import {
  clearEnglishCurrentTaskApi,
  deleteEnglishCourseApi,
  getEnglishTaskGenerationLogApi,
  getEnglishWorkspaceApi,
  retryEnglishCurrentTaskApi,
  subscribeEnglishTaskStream,
  uploadEnglishVideoApi,
} from '@/features/english/api/englishApi'

function summarizeTaskEvents(events: EnglishGenerationLogEvent[]) {
  return events.slice(-5).reverse()
}

export function useEnglishWorkspaceController() {
  const navigate = useNavigate()
  const { promptForAiOptions, aiRunConfigDialog } = useAiRunConfigDialog()
  const [workspace, setWorkspace] = useState<EnglishWorkspaceResponse | null>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [actionLoading, setActionLoading] = useState<'retry' | 'clear' | number | null>(null)
  const [taskEvents, setTaskEvents] = useState<EnglishGenerationLogEvent[]>([])
  const [streamConnected, setStreamConnected] = useState(false)
  const [logDialogOpen, setLogDialogOpen] = useState(false)
  const [logLoading, setLogLoading] = useState(false)
  const [logError, setLogError] = useState('')
  const [logData, setLogData] = useState<EnglishGenerationLogResponse | null>(null)
  const [pendingNavigationCourseId, setPendingNavigationCourseId] = useState<number | null>(null)

  const loadWorkspace = useCallback(async () => {
    const nextWorkspace = await getEnglishWorkspaceApi()
    setWorkspace(nextWorkspace)
  }, [])

  const loadTaskLog = useCallback(async (taskId: string) => {
    const response = await getEnglishTaskGenerationLogApi(taskId)
    setLogData(response)
    setTaskEvents(response.events)
    return response
  }, [])

  useEffect(() => {
    void loadWorkspace()
  }, [loadWorkspace])

  const currentTask = workspace?.currentTask ?? null
  const activeTaskId = currentTask?.id ?? ''
  const activeTaskRunning = Boolean(currentTask && ['queued', 'running'].includes(currentTask.status))

  useEffect(() => {
    if (!activeTaskId) {
      setTaskEvents([])
      setStreamConnected(false)
      return
    }
    let cancelled = false
    void loadTaskLog(activeTaskId).catch((error) => {
      if (cancelled) return
      console.error(error)
    })
    return () => {
      cancelled = true
    }
  }, [activeTaskId, loadTaskLog])

  useEffect(() => {
    if (!activeTaskId || !activeTaskRunning) {
      setStreamConnected(false)
      return
    }
    let closed = false
    const unsubscribe = subscribeEnglishTaskStream(activeTaskId, {
      onStatus: ({ task }) => {
        if (closed) return
        setStreamConnected(true)
        setWorkspace((current) => (current ? { ...current, currentTask: task } : current))
        setLogData((current) => (current ? { ...current, task } : current))
      },
      onLog: ({ event }) => {
        if (closed) return
        setTaskEvents((current) => {
          if (current.some((item) => item.id === event.id)) return current
          return [...current, event]
        })
        setLogData((current) => {
          if (!current) return current
          if (current.events.some((item) => item.id === event.id)) return current
          return { ...current, events: [...current.events, event] }
        })
      },
      onDone: ({ task }) => {
        if (closed) return
        setWorkspace((current) => (current ? { ...current, currentTask: task } : current))
        setLogData((current) => (current ? { ...current, task } : current))
        setStreamConnected(false)
        if (typeof task.courseId === 'number' && task.courseId > 0) {
          setPendingNavigationCourseId(task.courseId)
        } else {
          toast.success('英语课程已生成。')
        }
        void loadWorkspace()
      },
      onError: ({ task, error }) => {
        if (closed) return
        if (task) {
          setWorkspace((current) => (current ? { ...current, currentTask: task } : current))
          setLogData((current) => (current ? { ...current, task } : current))
        }
        setStreamConnected(false)
        if (error && error !== '英语任务实时连接已断开。') {
          toast.error(error)
        }
      },
    })
    return () => {
      closed = true
      unsubscribe()
    }
  }, [activeTaskId, activeTaskRunning, loadWorkspace])

  useEffect(() => {
    if (!currentTask || !activeTaskRunning || streamConnected) return
    const timer = window.setTimeout(() => {
      void loadWorkspace()
    }, 2000)
    return () => window.clearTimeout(timer)
  }, [activeTaskRunning, currentTask, loadWorkspace, streamConnected])

  useEffect(() => {
    if (!pendingNavigationCourseId) return
    toast.success('英语课程已生成，正在进入课程。')
    navigate(`/english/courses/${pendingNavigationCourseId}`)
    setPendingNavigationCourseId(null)
  }, [navigate, pendingNavigationCourseId])

  const canUpload = useMemo(() => {
    return !uploading && !workspace?.currentTask
  }, [uploading, workspace?.currentTask])

  const handleOpenLog = useCallback(async () => {
    const taskId = workspace?.currentTask?.id
    if (!taskId) return
    setLogDialogOpen(true)
    setLogLoading(true)
    setLogError('')
    try {
      await loadTaskLog(taskId)
    } catch (error) {
      setLogError(error instanceof Error ? error.message : '加载生成日志失败。')
    } finally {
      setLogLoading(false)
    }
  }, [loadTaskLog, workspace?.currentTask?.id])

  const handleUpload = useCallback(async () => {
    if (!selectedFile || !canUpload) return
    setUploading(true)
    try {
      const aiOptions = await promptForAiOptions({
        scenarioKey: 'asr',
        entrypointKey: 'english-course-upload-asr',
        title: '英语课程 ASR 配置',
        description: '这次上传会沿用这里的 ASR 模型配置完成整条转写链路。',
      })
      if (!aiOptions) {
        setUploading(false)
        return
      }
      await uploadEnglishVideoApi(selectedFile, aiOptions)
      toast.success('视频已上传，正在生成英语课程。')
      setSelectedFile(null)
      await loadWorkspace()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '上传失败，请重试。')
    } finally {
      setUploading(false)
    }
  }, [canUpload, loadWorkspace, promptForAiOptions, selectedFile])

  const handleRetry = useCallback(async () => {
    setActionLoading('retry')
    try {
      await retryEnglishCurrentTaskApi()
      toast.success('已重新开始生成。')
      await loadWorkspace()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '重试失败，请稍后再试。')
    } finally {
      setActionLoading(null)
    }
  }, [loadWorkspace])

  const handleClearTask = useCallback(async () => {
    setActionLoading('clear')
    try {
      await clearEnglishCurrentTaskApi()
      toast.success('当前任务已清除。')
      setTaskEvents([])
      setLogData(null)
      await loadWorkspace()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '清除失败，请稍后再试。')
    } finally {
      setActionLoading(null)
    }
  }, [loadWorkspace])

  const handleDeleteCourse = useCallback(
    async (courseId: number, title: string) => {
      const confirmed = window.confirm(`确定删除英语课程“${title}”吗？原始视频也会一起删除。`)
      if (!confirmed) return
      setActionLoading(courseId)
      try {
        await deleteEnglishCourseApi(courseId)
        toast.success('英语课程已删除。')
        await loadWorkspace()
      } catch (error) {
        toast.error(error instanceof Error ? error.message : '删除失败，请稍后再试。')
      } finally {
        setActionLoading(null)
      }
    },
    [loadWorkspace],
  )

  const navigateToCourse = useCallback(
    (courseId: number | undefined) => {
      if (!courseId) return
      navigate(`/english/courses/${courseId}`)
    },
    [navigate],
  )

  return {
    actionLoading,
    aiRunConfigDialog,
    canUpload,
    currentTask,
    handleClearTask,
    handleDeleteCourse,
    handleOpenLog,
    handleRetry,
    handleUpload,
    logData,
    logDialogOpen,
    logError,
    logLoading,
    navigateToCourse,
    selectedFile,
    setLogDialogOpen,
    setSelectedFile,
    streamConnected,
    uploading,
    visibleTaskEvents: summarizeTaskEvents(taskEvents),
    workspace,
  }
}
