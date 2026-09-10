import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { addAppLog, clearAppLogs } from '@/shared/logs/model/appLogs'
import { describeClickForRecorder } from './sessionRecorderCapture'
import { summarizeEditorDocChange, summarizeRevealMapChange } from './sessionRecorderDocDiff'
import { buildSessionRecorderCopyText, formatSessionRecorderReport } from './sessionRecorderFormat'
import {
  getSelectedSessionRecorder,
  getSessionRecorderCopyText,
  getSessionRecorderState,
  deleteSelectedSessionRecorderHistory,
  openSessionRecorderDialog,
  recordMindMapDocumentChange,
  recordSessionRecorderRoute,
  recordSessionRecorderUiAction,
  resetSessionRecorderForTest,
  startSessionRecording,
  stopSessionRecording,
  updateSelectedSessionRecorderNotes,
} from './sessionRecorderStore'
import { SESSION_RECORDER_MAX_HISTORY } from './sessionRecorderTypes'

function makeDoc(nodes: Array<{ uid: string; text: string; children?: unknown[] }>) {
  return {
    root: {
      data: { uid: 'root', text: '根' },
      children: nodes.map((node) => ({
        data: { uid: node.uid, text: node.text },
        children: node.children ?? [],
      })),
    },
  }
}

describe('session recorder store', () => {
  beforeEach(() => {
    resetSessionRecorderForTest()
    clearAppLogs()
    localStorage.clear()
  })

  afterEach(() => {
    resetSessionRecorderForTest()
  })

  it('starts, records a route change, and stops into history', () => {
    startSessionRecording()
    expect(getSessionRecorderState().recording).toBe(true)
    recordSessionRecorderRoute('/palaces/1')
    recordSessionRecorderRoute('/dashboard')
    stopSessionRecording()

    const state = getSessionRecorderState()
    expect(state.recording).toBe(false)
    expect(state.dialogOpen).toBe(true)
    expect(state.history).toHaveLength(1)
    expect(state.history[0]?.routes).toContain('/dashboard')
    expect(state.history[0]?.reportText).toContain('请根据以下操作记录排查错误。')
    expect(state.history[0]?.reportText).toContain('/dashboard')
  })

  it('caps history at 20 sessions', () => {
    for (let index = 0; index < SESSION_RECORDER_MAX_HISTORY + 2; index += 1) {
      startSessionRecording()
      stopSessionRecording()
    }
    expect(getSessionRecorderState().history).toHaveLength(SESSION_RECORDER_MAX_HISTORY)
  })

  it('redacts sensitive input clicks', () => {
    const input = document.createElement('input')
    input.type = 'password'
    input.setAttribute('aria-label', 'API Key')
    const event = { target: input } as unknown as Event
    expect(describeClickForRecorder(event)).toEqual({ action: '输入敏感字段', detail: '已输入' })
  })

  it('omits empty notes from copy text and includes notes when present', () => {
    const report = formatSessionRecorderReport({
      startedAt: '2026-09-09T10:00:00.000Z',
      endedAt: '2026-09-09T10:01:00.000Z',
      routes: ['/palaces'],
      events: [{ at: '2026-09-09T10:00:10.000Z', kind: 'click', action: '点击', detail: '「保存」' }],
    })
    expect(buildSessionRecorderCopyText(report, '  ')).toBe(report)
    expect(buildSessionRecorderCopyText(report, '卡片消失了')).toContain('## 用户补充\n卡片消失了')
  })

  it('keeps user notes on the saved session for copy', () => {
    startSessionRecording()
    stopSessionRecording()
    updateSelectedSessionRecorderNotes('保存后空白')
    expect(getSelectedSessionRecorder()?.notes).toBe('保存后空白')
    expect(getSessionRecorderCopyText()).toContain('## 用户补充\n保存后空白')
  })

  it('summarizes document add/remove/move', () => {
    const previous = makeDoc([{ uid: 'a', text: '旧' }])
    const next = makeDoc([
      { uid: 'b', text: '新' },
      {
        uid: 'a',
        text: '旧改',
        children: [],
      },
    ])
    const summary = summarizeEditorDocChange(previous, next)
    expect(summary).toContain('新增 「新」')
    expect(summary).toContain('改文本 「旧」→「旧改」')
    expect(summary).not.toMatch(/[0-9a-f]{8,}/i)
  })

  it('records mindmap document changes only while recording', () => {
    recordMindMapDocumentChange('commit', makeDoc([]), makeDoc([{ uid: 'n1', text: '卡' }]))
    startSessionRecording()
    recordMindMapDocumentChange('commit', makeDoc([]), makeDoc([{ uid: 'n1', text: '卡' }]))
    stopSessionRecording()
    expect(getSessionRecorderState().history[0]?.reportText).toContain('文档变更(commit)')
    expect(getSessionRecorderState().history[0]?.reportText).toContain('新增 「卡」')
    expect(getSessionRecorderState().history[0]?.reportText).not.toContain('n1')
  })

  it('captures app errors emitted during the recording window', () => {
    startSessionRecording()
    addAppLog({ kind: 'app_error', feature: '保存宫殿', stage: 'http_error', errorMessage: '409 冲突' })
    stopSessionRecording()
    expect(getSessionRecorderState().history[0]?.reportText).toContain('保存宫殿')
    expect(getSessionRecorderState().history[0]?.reportText).toContain('409 冲突')
  })

  it('opens the history dialog without starting a recording', () => {
    openSessionRecorderDialog()
    expect(getSessionRecorderState().dialogOpen).toBe(true)
    expect(getSessionRecorderState().recording).toBe(false)
  })

  it('deletes the selected history session', () => {
    startSessionRecording()
    stopSessionRecording()
    expect(getSessionRecorderState().history).toHaveLength(1)
    deleteSelectedSessionRecorderHistory()
    expect(getSessionRecorderState().history).toHaveLength(0)
    expect(getSelectedSessionRecorder()).toBeNull()
  })

  it('omits full uuids from document summaries and only suffixes duplicate titles', () => {
    const uid = 'b84aa957ac314724a7fde0b2ba2d329f'
    const summary = summarizeEditorDocChange(
      makeDoc([]),
      makeDoc([
        { uid, text: '婴儿期（0～3岁）' },
        { uid: 'aaaaaaaaaaaabbbb', text: '同名' },
        { uid: 'ccccccccccccdddd', text: '同名' },
      ]),
    )
    expect(summary).toContain('新增 「婴儿期（0～3岁）」')
    expect(summary).toContain('「同名」#bbbb')
    expect(summary).toContain('「同名」#dddd')
    expect(summary).not.toContain(uid)
  })

  it('summarizes reveal map changes without node ids', () => {
    const detail = summarizeRevealMapChange(
      { root: 'revealed', a: 'hidden', b: 'revealed' },
      { root: 'revealed', a: 'revealed', b: 'hidden' },
      (id) => ({ a: '儿童发展与课程', b: '婴幼青' }[id] ?? id),
    )
    expect(detail).toBe('翻开「儿童发展与课程」；收起「婴幼青」')
  })

  it('merges consecutive identical mindmap clicks', () => {
    startSessionRecording()
    recordSessionRecorderUiAction('mindmap', '单击节点', '「根」')
    recordSessionRecorderUiAction('mindmap', '单击节点', '「根」')
    recordSessionRecorderUiAction('mindmap', '单击节点', '「根」')
    stopSessionRecording()
    const report = getSessionRecorderState().history[0]?.reportText ?? ''
    expect(report).toContain('单击节点 「根」 ×3')
    expect(report.match(/单击节点/g)?.length).toBe(1)
  })
})
