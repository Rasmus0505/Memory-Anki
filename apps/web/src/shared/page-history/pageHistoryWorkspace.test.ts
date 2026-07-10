import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getPageHistoryWorkspaceId,
  startPageHistoryWorkspaceHeartbeat,
} from './pageHistoryWorkspace'

class BroadcastChannelStub {
  static instances: BroadcastChannelStub[] = []
  readonly name: string
  listeners = new Set<(event: MessageEvent) => void>()
  messages: unknown[] = []

  constructor(name: string) {
    this.name = name
    BroadcastChannelStub.instances.push(this)
  }

  postMessage(message: unknown) {
    this.messages.push(message)
  }

  addEventListener(_type: string, listener: (event: MessageEvent) => void) {
    this.listeners.add(listener)
  }

  removeEventListener(_type: string, listener: (event: MessageEvent) => void) {
    this.listeners.delete(listener)
  }

  emit(message: unknown) {
    this.listeners.forEach((listener) => listener({ data: message } as MessageEvent))
  }

  close() {}
}

describe('pageHistoryWorkspace', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
    BroadcastChannelStub.instances.length = 0
    vi.stubGlobal('BroadcastChannel', BroadcastChannelStub)
  })

  it('keeps a stable workspace id within the same tab', () => {
    expect(getPageHistoryWorkspaceId()).toBe(getPageHistoryWorkspaceId())
  })

  it('rotates a duplicated workspace id after another live tab announces it', () => {
    const original = getPageHistoryWorkspaceId()
    const stop = startPageHistoryWorkspaceHeartbeat(original)
    const channel = BroadcastChannelStub.instances[0]
    channel.emit({
      type: 'heartbeat',
      workspaceId: original,
      instanceId: '0',
    })

    expect(getPageHistoryWorkspaceId()).not.toBe(original)
    stop()
  })
})
