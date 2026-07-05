import { beforeEach, describe, expect, it } from 'vitest'
import {
  addAppLog,
  clearAppLogs,
  formatAppLogEntry,
  formatAppLogs,
  readAppLogs,
  removeAppLog,
} from '@/shared/logs/model/appLogs'

describe('appLogs', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('adds, formats, removes, and clears logs', () => {
    const entry = addAppLog({
      kind: 'ai_call',
      feature: 'AI 整理',
      stage: 'success',
      requestSummary: '知识点: 1',
      responseSummary: '新增 1 个分类',
      meta: { palaceId: 1 },
    })

    expect(readAppLogs()).toHaveLength(1)
    expect(formatAppLogEntry(entry)).toContain('AI 整理')
    expect(formatAppLogs(readAppLogs())).toContain('新增 1 个分类')

    removeAppLog(entry.id)
    expect(readAppLogs()).toHaveLength(0)

    addAppLog({ kind: 'app_error', feature: 'API 请求', stage: 'http_error', errorMessage: '500' })
    clearAppLogs()
    expect(readAppLogs()).toHaveLength(0)
  })
})
