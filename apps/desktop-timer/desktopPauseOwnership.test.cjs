const assert = require('node:assert/strict')
const test = require('node:test')

const { createDesktopPauseOwnership } = require('./desktopPauseOwnership.cjs')

const running = (ownerSessionId = 'session-a') => ({
  mode: 'study',
  status: 'running',
  ownerSessionId,
})

const paused = (ownerSessionId = 'session-a') => ({
  mode: 'study',
  status: 'paused',
  ownerSessionId,
})

test('resumes only the running session armed by external blur', () => {
  const ownership = createDesktopPauseOwnership()
  assert.equal(ownership.armForExternalBlur(running()), 'session-a')
  ownership.observeSnapshot(paused())
  assert.equal(ownership.consumeResume(paused()), 'session-a')
  assert.equal(ownership.consumeResume(paused()), null)
})

test('does not arm a timer that was already manually paused', () => {
  const ownership = createDesktopPauseOwnership()
  assert.equal(ownership.armForExternalBlur(paused()), null)
  assert.equal(ownership.consumeResume(paused()), null)
})

test('cancels resume when the active owner changes or leaves study', () => {
  const ownership = createDesktopPauseOwnership()
  ownership.armForExternalBlur(running())
  ownership.observeSnapshot(paused('session-b'))
  assert.equal(ownership.consumeResume(paused('session-a')), null)

  ownership.armForExternalBlur(running())
  ownership.observeSnapshot({ mode: 'study', status: 'completed', ownerSessionId: 'session-a' })
  assert.equal(ownership.consumeResume(paused()), null)
})

test('an explicit timer command cancels automatic resume', () => {
  const ownership = createDesktopPauseOwnership()
  ownership.armForExternalBlur(running())
  ownership.clearForCommand({ type: 'pause' })
  assert.equal(ownership.consumeResume(paused()), null)
})
