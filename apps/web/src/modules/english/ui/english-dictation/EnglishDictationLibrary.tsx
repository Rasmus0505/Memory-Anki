import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  Captions,
  CircleAlert,
  Clapperboard,
  Clock3,
  FileText,
  Film,
  LoaderCircle,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import type { EnglishCourseSummary, EnglishWorkspaceResponse } from '@/shared/api/contracts'
import {
  deleteEnglishCourseApi,
  getEnglishWorkspaceApi,
  importEnglishCourseApi,
} from '@/modules/english/domain/english-entity/api'
import { EnglishZoneNav } from '@/modules/english/ui/english-shell'
import { cn } from '@/shared/lib/utils'

type Filter = 'all' | 'unfinished' | 'completed'

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'unfinished', label: '未完成' },
  { id: 'completed', label: '已完成' },
]

function formatDuration(seconds: number) {
  const safe = Math.max(0, Math.round(seconds))
  const minutes = Math.floor(safe / 60)
  const rest = safe % 60
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60)
    return `${hours} 小时 ${minutes % 60} 分`
  }
  return minutes > 0 ? `${minutes} 分 ${rest} 秒` : `${rest} 秒`
}

function formatFileSize(bytes: number) {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}

function formatDate(value: string | null) {
  if (!value) return '刚刚'
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(value))
  } catch {
    return '刚刚'
  }
}

function courseProgress(course: EnglishCourseSummary) {
  if (course.status === 'completed') return 1
  if (course.sentenceCount <= 0) return 0
  const completed = course.completedSentenceCount ?? course.currentSentenceIndex
  return Math.max(0, Math.min(1, completed / course.sentenceCount))
}

function errorMessage(value: unknown) {
  if (value instanceof Error && value.message.trim()) return value.message
  return '导入失败，请检查视频与字幕文件后重试。'
}

interface WorkspaceState {
  workspace: EnglishWorkspaceResponse | null
  loading: boolean
  error: string | null
}

export function EnglishDictationLibrary() {
  const navigate = useNavigate()
  const [state, setState] = useState<WorkspaceState>({ workspace: null, loading: true, error: null })
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [deletingId, setDeletingId] = useState<number | null>(null)

  const refresh = useCallback(async () => {
    setState((previous) => ({ ...previous, loading: previous.workspace == null, error: null }))
    try {
      const workspace = await getEnglishWorkspaceApi()
      setState({ workspace, loading: false, error: null })
    } catch (error) {
      setState({ workspace: null, loading: false, error: errorMessage(error) })
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const workspace = state.workspace
  const courses = useMemo(() => workspace?.recentCourses ?? [], [workspace])
  const visibleCourses = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return courses.filter((course) => {
      if (filter === 'unfinished' && course.status !== 'unfinished') return false
      if (filter === 'completed' && course.status !== 'completed') return false
      if (!normalizedQuery) return true
      return course.title.toLowerCase().includes(normalizedQuery)
    })
  }, [courses, filter, query])

  const handleDelete = async (course: EnglishCourseSummary) => {
    if (!window.confirm(`删除「${course.title}」？视频与字幕文件会一起删除，无法恢复。`)) return
    setDeletingId(course.id)
    try {
      await deleteEnglishCourseApi(course.id)
      toast.success('课程已删除。', undefined)
      await refresh()
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setDeletingId(null)
    }
  }

  if (state.loading) {
    return <LibraryLoading />
  }

  if (state.error) {
    return (
      <div className="ed-library ed-library--message">
        <div className="ed-empty">
          <CircleAlert className="size-7" />
          <h2>片库没有加载出来</h2>
          <p>{state.error}</p>
          <button type="button" className="ed-cta ed-cta--primary" onClick={() => void refresh()}>
            重试
          </button>
        </div>
      </div>
    )
  }

  const continueCourse = workspace?.continueCourse ?? null

  return (
    <div className="ed-library" data-testid="english-dictation-library">
      <div className="ed-library__ambient" aria-hidden />
      <div className="ed-library__inner">
        <EnglishZoneNav zone="listening" className="ed-zone-nav" />

        <header className="ed-library__hero">
          <div className="ed-library__hero-copy">
            <span className="ed-panel-eyebrow">ENGLISH · SPELLING THEATRE</span>
            <h1>听写剧场</h1>
            <p>
              上传视频与英文字幕，一句一句把台词拼出来。中文字幕可选，全键盘操作，鼠标可以完全不碰。
            </p>
          </div>
          <div className="ed-library__hero-actions">
            <span className="ed-library__formats">
              <Captions className="size-4" /> SRT · VTT · ASS
            </span>
            <button type="button" className="ed-cta ed-cta--primary ed-cta--lg" onClick={() => setImportOpen(true)}>
              <Plus className="size-4" />
              导入课程
            </button>
          </div>
        </header>

        {continueCourse ? (
          <ContinueCard
            course={continueCourse}
            onContinue={() => navigate(`/english/listening/courses/${continueCourse.id}`)}
            onImport={() => setImportOpen(true)}
          />
        ) : courses.length > 0 ? (
          <section className="ed-library-empty-hero">
            <div className="ed-library-empty-hero__icon">
              <Sparkles className="size-8" />
            </div>
            <div>
              <h2>手头的课程都完成了</h2>
              <p>从下面的片库挑一部再练一轮，或者导入新的视频与字幕。</p>
            </div>
            <button type="button" className="ed-cta ed-cta--primary" onClick={() => setImportOpen(true)}>
              <Upload className="size-4" /> 导入新的
            </button>
          </section>
        ) : (
          <section className="ed-library-empty-hero">
            <div className="ed-library-empty-hero__icon">
              <Film className="size-8" />
            </div>
            <div>
              <h2>片库还是空的</h2>
              <p>准备一个视频和它的英文字幕文件，剩下的交给本地解析。不需要联网，也不会上传素材到任何云端 AI。</p>
            </div>
            <button type="button" className="ed-cta ed-cta--primary" onClick={() => setImportOpen(true)}>
              <Upload className="size-4" /> 导入第一部
            </button>
          </section>
        )}

        <section className="ed-library__stats" aria-label="学习统计">
          <Stat label="课程" value={workspace?.stats.total_courses ?? courses.length} />
          <Stat label="未完成" value={workspace?.stats.unfinished_courses ?? 0} />
          <Stat label="已完成" value={workspace?.stats.completed_courses ?? 0} />
        </section>

        <section className="ed-library__shelf">
          <div className="ed-library__shelf-head">
            <div>
              <span className="ed-panel-eyebrow">YOUR SHELF</span>
              <h2>片库</h2>
            </div>
            <div className="ed-library__tools">
              <label className="ed-search">
                <Search className="size-4" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索课程"
                  aria-label="搜索课程"
                />
              </label>
              <div className="ed-filter" role="tablist" aria-label="课程筛选">
                {FILTERS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="tab"
                    aria-selected={filter === item.id}
                    className={cn(filter === item.id && 'is-active')}
                    onClick={() => setFilter(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {visibleCourses.length > 0 ? (
            <div className="ed-course-grid" data-testid="english-course-grid">
              {visibleCourses.map((course, index) => (
                <CourseCard
                  key={course.id}
                  course={course}
                  index={index}
                  deleting={deletingId === course.id}
                  onOpen={() => navigate(`/english/listening/courses/${course.id}`)}
                  onDelete={() => void handleDelete(course)}
                />
              ))}
            </div>
          ) : (
            <div className="ed-empty ed-empty--shelf">
              <Film className="size-6" />
              <h3>{courses.length === 0 ? '还没有课程' : '没有匹配的课程'}</h3>
              <p>
                {courses.length === 0
                  ? '导入视频和字幕，片库会记住每一句的进度。'
                  : '换一个关键词，或切回「全部」。'}
              </p>
            </div>
          )}
        </section>
      </div>

      <ImportCourseDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={(course) => {
          setImportOpen(false)
          void refresh()
          navigate(`/english/listening/courses/${course.id}`)
        }}
      />
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="ed-stat">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  )
}

function ContinueCard({
  course,
  onContinue,
  onImport,
}: {
  course: EnglishCourseSummary
  onContinue: () => void
  onImport: () => void
}) {
  const progress = courseProgress(course)
  return (
    <section className="ed-continue" data-testid="english-continue-card">
      <div className="ed-continue__backdrop" aria-hidden />
      <div className="ed-continue__body">
        <span className="ed-panel-eyebrow">CONTINUE</span>
        <h2>{course.title}</h2>
        <p>
          {course.completedSentenceCount > 0
            ? `已完成 ${course.completedSentenceCount} / ${course.sentenceCount} 句`
            : `共 ${course.sentenceCount} 句`}
          {' · '}
          {formatDuration(course.durationSeconds)}
        </p>
        <div className="ed-continue__progress" aria-hidden>
          <span style={{ width: `${progress * 100}%` }} />
        </div>
        <div className="ed-continue__actions">
          <button type="button" className="ed-cta ed-cta--primary ed-cta--lg" onClick={onContinue}>
            继续听写 <ArrowRight className="size-4" />
          </button>
          <button type="button" className="ed-cta" onClick={onImport}>
            <Plus className="size-4" /> 导入新的
          </button>
        </div>
      </div>
      <div className="ed-continue__reel" aria-hidden>
        <span />
        <span />
        <span />
        <span />
      </div>
    </section>
  )
}

function CourseCard({
  course,
  index,
  deleting,
  onOpen,
  onDelete,
}: {
  course: EnglishCourseSummary
  index: number
  deleting: boolean
  onOpen: () => void
  onDelete: () => void
}) {
  const progress = courseProgress(course)
  return (
    <article className="ed-course-card" style={{ animationDelay: `${Math.min(index, 10) * 45}ms` }}>
      <button type="button" className="ed-course-card__main" onClick={onOpen}>
        <div className="ed-course-card__art" aria-hidden>
          <Clapperboard className="size-7" />
          <span className="ed-course-card__frame">{String(index + 1).padStart(2, '0')}</span>
        </div>
        <div className="ed-course-card__copy">
          <div className="ed-course-card__title-row">
            <h3>{course.title}</h3>
            <span className={cn('ed-badge', course.status === 'completed' ? 'is-done' : 'is-live')}>
              {course.status === 'completed' ? '已完成' : '进行中'}
            </span>
          </div>
          <div className="ed-course-card__meta">
            <span>
              <Captions className="size-3.5" /> {course.sentenceCount} 句
            </span>
            <span>
              <Clock3 className="size-3.5" /> {formatDuration(course.durationSeconds)}
            </span>
            <span>{formatDate(course.updatedAt)}</span>
          </div>
          <div className="ed-course-card__progress" aria-hidden>
            <span style={{ width: `${progress * 100}%` }} />
          </div>
        </div>
      </button>
      <div className="ed-course-card__side">
        <span className="ed-course-card__percent">{Math.round(progress * 100)}%</span>
        <button
          type="button"
          className="ed-icon-button ed-icon-button--danger"
          onClick={onDelete}
          disabled={deleting}
          title="删除课程"
          aria-label={`删除课程 ${course.title}`}
        >
          {deleting ? <LoaderCircle className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
        </button>
      </div>
    </article>
  )
}

function LibraryLoading() {
  return (
    <div className="ed-library ed-library--message" aria-label="片库载入中">
      <div className="ed-library__loading">
        <LoaderCircle className="size-6 animate-spin" />
        <span>正在打开片库…</span>
      </div>
    </div>
  )
}

type FileSlot = 'video' | 'english' | 'chinese'

interface ImportCourseDialogProps {
  open: boolean
  onClose: () => void
  onImported: (course: EnglishCourseSummary) => void
}

function ImportCourseDialog({ open, onClose, onImported }: ImportCourseDialogProps) {
  const [videoFile, setVideoFile] = useState<File | null>(null)
  const [englishFile, setEnglishFile] = useState<File | null>(null)
  const [chineseFile, setChineseFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const titleTouchedRef = useRef(false)

  useEffect(() => {
    if (!open) return
    setVideoFile(null)
    setEnglishFile(null)
    setChineseFile(null)
    setTitle('')
    setError('')
    setUploading(false)
    titleTouchedRef.current = false
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !uploading) {
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, uploading, onClose])

  if (!open) return null

  const pickVideo = (file: File | null) => {
    setVideoFile(file)
    if (file && !titleTouchedRef.current) {
      setTitle(file.name.replace(/\.[^.]+$/, '').replace(/[_.-]+/g, ' ').trim())
    }
  }

  const submit = async () => {
    if (!videoFile) {
      setError('请选择视频文件。')
      return
    }
    if (!englishFile) {
      setError('请选择英文字幕文件（SRT / VTT / ASS）。')
      return
    }
    if (videoFile.size > 1024 * 1024 * 1024) {
      setError('视频超过 1 GB 上限，请先压缩或截取后再导入。')
      return
    }
    if (englishFile.size > 8 * 1024 * 1024 || (chineseFile && chineseFile.size > 8 * 1024 * 1024)) {
      setError('字幕文件超过 8 MB 上限，请检查是否选错了文件。')
      return
    }
    setUploading(true)
    setError('')
    try {
      const result = await importEnglishCourseApi({
        videoFile,
        englishSubtitle: englishFile,
        chineseSubtitle: chineseFile,
        title,
      })
      toast.success(
        `已导入 ${result.course.sentenceCount} 句${result.matchedTranslationCount > 0 ? '，译文已对齐' : ''}。`,
        undefined,
      )
      onImported(result.course)
    } catch (submitError) {
      setError(errorMessage(submitError))
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="ed-modal" role="dialog" aria-modal="true" aria-label="导入英语课程">
      <button type="button" className="ed-modal__backdrop" aria-label="关闭导入" onClick={uploading ? undefined : onClose} />
      <div className="ed-import">
        <header className="ed-import__head">
          <div>
            <span className="ed-panel-eyebrow">LOCAL IMPORT</span>
            <h2>导入一部听写课程</h2>
            <p>视频和字幕都在本机解析，不调用 ASR，也不上传到云端。</p>
          </div>
          <button
            type="button"
            className="ed-icon-button"
            onClick={onClose}
            disabled={uploading}
            aria-label="关闭"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="ed-import__body">
          <FileDrop
            slot="video"
            icon={<Film className="size-5" />}
            label="视频"
            hint="MP4 / MKV / MOV / WebM，最大 1 GB"
            accept="video/*,audio/*"
            file={videoFile}
            onPick={pickVideo}
          />
          <FileDrop
            slot="english"
            icon={<FileText className="size-5" />}
            label="英文字幕"
            hint="必需。SRT / VTT / ASS，双语字幕也可以"
            accept=".srt,.vtt,.ass,.ssa,text/plain"
            file={englishFile}
            onPick={setEnglishFile}
          />
          <FileDrop
            slot="chinese"
            icon={<Captions className="size-5" />}
            label="中文字幕"
            hint="按时间轴自动对齐到英文句子"
            accept=".srt,.vtt,.ass,.ssa,text/plain"
            file={chineseFile}
            onPick={setChineseFile}
          />

          <label className="ed-import__title">
            <span>课程标题</span>
            <input
              value={title}
              onChange={(event) => {
                titleTouchedRef.current = true
                setTitle(event.target.value)
              }}
              placeholder="默认使用视频文件名"
              maxLength={120}
            />
          </label>

          {error ? (
            <div className="ed-import__error">
              <CircleAlert className="size-4" />
              <span>{error}</span>
            </div>
          ) : null}

          <div className="ed-import__tips">
            <span>英文按句号、问号、感叹号切句，跨字幕条的半句会自动合并。</span>
            <span>中文字幕条数不同也没关系，会按时间重叠匹配。</span>
          </div>
        </div>

        <footer className="ed-import__foot">
          <span className="ed-panel-note">
            {videoFile ? formatFileSize(videoFile.size) : '等待选择视频'}
            {englishFile ? ` · 字幕 ${formatFileSize(englishFile.size)}` : ''}
          </span>
          <div className="ed-panel-actions">
            <button type="button" className="ed-cta" onClick={onClose} disabled={uploading}>
              取消
            </button>
            <button
              type="button"
              className="ed-cta ed-cta--primary"
              onClick={() => void submit()}
              disabled={uploading}
            >
              {uploading ? <LoaderCircle className="size-4 animate-spin" /> : <Upload className="size-4" />}
              {uploading ? '正在解析并建立课程…' : '导入并开始'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}

function FileDrop({
  slot,
  icon,
  label,
  hint,
  accept,
  file,
  onPick,
}: {
  slot: FileSlot
  icon: ReactNode
  label: string
  hint: string
  accept: string
  file: File | null
  onPick: (file: File | null) => void
}) {
  const [dragging, setDragging] = useState(false)
  const inputId = `ed-import-${slot}`
  return (
    <div
      className={cn('ed-drop', dragging && 'is-dragging', file && 'is-filled')}
      onDragOver={(event) => {
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault()
        setDragging(false)
        const dropped = event.dataTransfer.files?.[0] ?? null
        if (dropped) onPick(dropped)
      }}
      data-testid={`english-import-${slot}`}
    >
      <span className="ed-drop__icon">{icon}</span>
      <div className="ed-drop__copy">
        <span className="ed-drop__label">
          {label}
          {slot === 'chinese' ? <em>可选</em> : null}
        </span>
        {file ? (
          <span className="ed-drop__file">
            {file.name} · {formatFileSize(file.size)}
          </span>
        ) : (
          <span className="ed-drop__hint">{hint}</span>
        )}
      </div>
      <div className="ed-drop__actions">
        <label htmlFor={inputId} className="ed-mini-button">
          {file ? '更换' : '选择文件'}
        </label>
        {file ? (
          <button
            type="button"
            className="ed-mini-button ed-mini-button--ghost"
            onClick={() => onPick(null)}
            aria-label={`移除 ${label}`}
          >
            移除
          </button>
        ) : null}
      </div>
      <input
        id={inputId}
        type="file"
        accept={accept}
        className="sr-only"
        onChange={(event) => onPick(event.target.files?.[0] ?? null)}
      />
    </div>
  )
}
