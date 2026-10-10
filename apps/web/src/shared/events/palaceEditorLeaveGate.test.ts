import { afterEach, describe, expect, it } from 'vitest'
import {
  notePalaceEditorClosed,
  notePalaceEditorOpen,
  palaceEditorLeavePending,
  palaceEditorVisitGeneration,
  resetPalaceEditorLeaveGateForTests,
  trackPalaceEditorLeave,
  waitForPalaceEditorLeave,
} from './palaceEditorLeaveGate'

describe('palaceEditorLeaveGate', () => {
  afterEach(() => {
    resetPalaceEditorLeaveGateForTests()
  })

  it('resolves immediately when no editor leave is in flight', async () => {
    await expect(waitForPalaceEditorLeave()).resolves.toBeUndefined()
  })

  it('waits until the leave flush settles', async () => {
    let release: (() => void) | null = null
    const flush = new Promise<void>((resolve) => {
      release = resolve
    })
    trackPalaceEditorLeave(flush)
    expect(palaceEditorLeavePending()).toBe(1)
    let settled = false
    const waiting = waitForPalaceEditorLeave().then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)
    release?.()
    await waiting
    expect(settled).toBe(true)
    expect(palaceEditorLeavePending()).toBe(0)
  })

  it('counts one visit even if the editor opens twice before it closes', () => {
    notePalaceEditorOpen()
    notePalaceEditorOpen()
    expect(palaceEditorVisitGeneration()).toBe(1)
    notePalaceEditorClosed()
    notePalaceEditorOpen()
    expect(palaceEditorVisitGeneration()).toBe(2)
  })
})
