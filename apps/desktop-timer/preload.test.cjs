const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

function loadPreload() {
  const listeners = new Map()
  const sent = []
  let exposed = null
  const ipcRenderer = {
    on(channel, listener) {
      listeners.set(channel, listener)
    },
    removeListener(channel, listener) {
      if (listeners.get(channel) === listener) listeners.delete(channel)
    },
    send(...args) {
      sent.push(args)
    },
  }
  const contextBridge = {
    exposeInMainWorld(_name, api) {
      exposed = api
    },
  }
  const source = fs.readFileSync(path.join(__dirname, 'preload.cjs'), 'utf8')
  vm.runInNewContext(source, {
    Promise,
    Set,
    require: () => ({ contextBridge, ipcRenderer }),
  })
  return { exposed, listeners, sent }
}

test('exposes desktop main-window fullscreen controls through the preload bridge', () => {
  const { exposed, listeners, sent } = loadPreload()

  exposed.setMainWindowFullscreen(true)
  assert.deepEqual(sent, [['memory-anki-main-window-fullscreen', true]])

  let received = null
  const dispose = exposed.onMainWindowFullscreenChange((active) => {
    received = active
  })
  listeners.get('memory-anki-main-window-fullscreen-change')({}, 1)
  assert.equal(received, true)

  dispose()
  assert.equal(listeners.has('memory-anki-main-window-fullscreen-change'), false)
})
