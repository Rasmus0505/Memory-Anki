import { useCallback, useEffect, useState } from 'react'
import { CalendarClock, Check, Plus, Trash2 } from 'lucide-react'
import type { MilestoneBoard, StudyMilestone } from '@/shared/api/contracts'
import { getMilestonesApi, saveExamSettingsApi, saveMilestonesApi } from '../api/examApi'

const STATUS_LABELS: Record<StudyMilestone['status'], string> = {
  done: '已完成',
  overdue: '已过期',
  due_soon: '快到了',
  upcoming: '未到期',
}

function daysText(daysLeft: number): string {
  if (daysLeft === 0) return '就是今天'
  if (daysLeft > 0) return `还有 ${daysLeft} 天`
  return `已过 ${Math.abs(daysLeft)} 天`
}

/**
 * Sprint switch + study milestones for the progress page.
 *
 * Milestones are plan checkpoints ("中教史 10/31 完成"), not scheduling state:
 * they never move a due date. The sprint switch is the only control here that
 * reaches scheduling, and it only caps how far out a review can be booked.
 */
export function MilestonePanel() {
  const [board, setBoard] = useState<MilestoneBoard | null>(null)
  const [items, setItems] = useState<StudyMilestone[]>([])
  const [examDate, setExamDate] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [dirty, setDirty] = useState(false)

  const apply = useCallback((next: MilestoneBoard) => {
    setBoard(next)
    setItems(next.items)
    setExamDate(next.sprint.exam_date ?? '')
    setDirty(false)
  }, [])

  const load = useCallback(async () => {
    try {
      apply(await getMilestonesApi())
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '里程碑读取失败')
    }
  }, [apply])

  useEffect(() => {
    void load()
  }, [load])

  const patch = (id: string, change: Partial<StudyMilestone>) => {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...change } : item)))
    setDirty(true)
  }

  const toggleSprint = async (next: boolean) => {
    setBusy(true)
    setStatus(next ? '正在打开冲刺模式…' : '正在关闭冲刺模式…')
    try {
      await saveExamSettingsApi({ sprint_mode: next })
      apply(await getMilestonesApi())
      setStatus(
        next
          ? '冲刺模式已打开：复习间隔会被压到考前，原本排在考后的卡已经拉回来了。'
          : '冲刺模式已关闭：恢复完整阶梯间隔。',
      )
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '冲刺模式切换失败')
    } finally {
      setBusy(false)
    }
  }

  const commitExamDate = async () => {
    setBusy(true)
    try {
      await saveExamSettingsApi({ exam_date: examDate || null })
      apply(await getMilestonesApi())
      setStatus('考试日期已保存')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '考试日期保存失败')
    } finally {
      setBusy(false)
    }
  }

  const saveItems = async () => {
    setBusy(true)
    setStatus('保存中…')
    try {
      apply(await saveMilestonesApi(items))
      setStatus('里程碑已保存')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '里程碑保存失败')
    } finally {
      setBusy(false)
    }
  }

  const addItem = () => {
    const today = board?.today ?? new Date().toISOString().slice(0, 10)
    setItems((current) => [
      ...current,
      {
        id: `m-${Date.now().toString(36)}`,
        date: today,
        title: '',
        category: '',
        detail: '',
        notify_days_before: 3,
        enabled: true,
        done: false,
        days_left: 0,
        status: 'upcoming',
      },
    ])
    setDirty(true)
  }

  const sprint = board?.sprint
  const counts = board?.counts

  return (
    <section className="lp-panel ms-panel" aria-label="冲刺与里程碑">
      <div className="lp-explorer-header">
        <div className="lp-section-heading">
          <h2>冲刺与里程碑</h2>
          {counts && (
            <span className="ms-summary">
              {counts.done}/{counts.total} 完成
              {counts.overdue > 0 && <em> · {counts.overdue} 项已过期</em>}
              {counts.due_soon > 0 && <em className="soon"> · {counts.due_soon} 项临近</em>}
            </span>
          )}
        </div>
        <p className="lp-subtitle ms-intro">
          里程碑只提醒「该完成什么」，不会改动任何复习间隔。冲刺开关只做一件事：不让任何一次复习排到考试之后——本该排到考后的卡会提前到考前最后一周，并且按单元错开，不会都堆在考前一天。
        </p>

        <div className="ms-sprint">
          <label className="ms-switch">
            <input
              type="checkbox"
              checked={Boolean(sprint?.sprint_mode)}
              disabled={busy}
              onChange={(event) => void toggleSprint(event.target.checked)}
            />
            <span>冲刺模式</span>
          </label>
          <label className="ms-date-field">
            考试日期
            <input
              type="date"
              className="lp-select"
              value={examDate}
              disabled={busy}
              onChange={(event) => setExamDate(event.target.value)}
              onBlur={() => void commitExamDate()}
            />
          </label>
          <span className="ms-hint" role="status">
            {sprint?.active && sprint.max_interval_days != null
              ? `距离考试 ${sprint.days_left} 天 · 所有复习都会排在 ${sprint.last_due} 之前`
              : sprint?.sprint_mode
                ? '已打开，但还没有考试日期，暂时不生效'
                : '未开启：按完整阶梯排期'}
          </span>
        </div>
      </div>

      <ul className="ms-list" aria-label="里程碑列表">
        {items.map((item) => (
          <li className="ms-row" key={item.id} data-status={item.status}>
            <input
              type="date"
              className="lp-select ms-date"
              aria-label={`${item.title || '里程碑'}的日期`}
              value={item.date}
              onChange={(event) => patch(item.id, { date: event.target.value })}
            />
            <input
              className="ms-title"
              aria-label="里程碑标题"
              placeholder="例如：中国教育史完成"
              value={item.title}
              onChange={(event) => patch(item.id, { title: event.target.value })}
            />
            <input
              className="ms-category"
              aria-label="分类"
              placeholder="分类"
              value={item.category}
              onChange={(event) => patch(item.id, { category: event.target.value })}
            />
            <label className="ms-notify" title="提前几天提醒">
              <CalendarClock size={13} aria-hidden="true" />
              <input
                type="number"
                min={0}
                max={30}
                aria-label="提前几天提醒"
                value={item.notify_days_before}
                onChange={(event) =>
                  patch(item.id, { notify_days_before: Number(event.target.value) || 0 })
                }
              />
              天前
            </label>
            <span className="ms-status" data-status={item.status}>
              {STATUS_LABELS[item.status]} · {daysText(item.days_left)}
            </span>
            <button
              type="button"
              className="ms-done"
              aria-pressed={item.done}
              aria-label={`${item.title || '里程碑'}标记为${item.done ? '未完成' : '完成'}`}
              onClick={() => patch(item.id, { done: !item.done })}
            >
              <Check size={14} />
            </button>
            <button
              type="button"
              className="lp-icon-button ms-remove"
              aria-label={`删除${item.title || '里程碑'}`}
              onClick={() => {
                setItems((current) => current.filter((row) => row.id !== item.id))
                setDirty(true)
              }}
            >
              <Trash2 size={14} />
            </button>
          </li>
        ))}
      </ul>

      <div className="ms-actions">
        <button type="button" className="lp-button" onClick={addItem}>
          <Plus size={13} />新增里程碑
        </button>
        <button type="button" className="lp-button lp-button-primary" onClick={() => void saveItems()} disabled={busy || !dirty}>
          保存里程碑
        </button>
        <span role="status" className="lp-subtitle">{status}</span>
      </div>
    </section>
  )
}
