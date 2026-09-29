/**
 * Owner-scoped scheduling for effects. Every delayed step of a cue belongs to an
 * owner (a card encounter, a round, a page); retiring the owner cancels all of
 * its pending steps, so a stale sequence can never land on the next card.
 */

export interface FxPlayback {
  readonly owner: string
  /** False once the owner is retired or this playback was cancelled. */
  alive(): boolean
  /** Runs `fn` after `ms` unless the playback died first. */
  at(ms: number, fn: () => void): void
  /** Registers teardown (DOM ghosts, intervals) for cancellation. */
  onCancel(fn: () => void): void
  cancel(): void
}

interface OwnerRecord {
  generation: number
  playbacks: Set<Playback>
}

const owners = new Map<string, OwnerRecord>()

class Playback implements FxPlayback {
  readonly owner: string
  private readonly record: OwnerRecord
  private readonly generation: number
  private dead = false
  private readonly timers = new Set<number>()
  private readonly cleanups: Array<() => void> = []

  constructor(owner: string, record: OwnerRecord, generation: number) {
    this.owner = owner
    this.record = record
    this.generation = generation
  }

  alive() {
    return !this.dead && this.record.generation === this.generation
  }

  at(ms: number, fn: () => void) {
    if (!this.alive()) return
    if (ms <= 0) {
      fn()
      return
    }
    const id = window.setTimeout(() => {
      this.timers.delete(id)
      if (this.alive()) fn()
      this.settle()
    }, ms)
    this.timers.add(id)
  }

  onCancel(fn: () => void) {
    if (this.dead) fn()
    else this.cleanups.push(fn)
  }

  cancel() {
    if (this.dead) return
    this.dead = true
    this.timers.forEach((id) => window.clearTimeout(id))
    this.timers.clear()
    this.cleanups.splice(0).forEach((fn) => fn())
    this.record.playbacks.delete(this)
  }

  /** Drops the playback from its owner once nothing is pending. */
  settle() {
    if (this.timers.size === 0 && this.cleanups.length === 0) this.record.playbacks.delete(this)
  }
}

function recordFor(owner: string) {
  let record = owners.get(owner)
  if (!record) {
    record = { generation: 0, playbacks: new Set() }
    owners.set(owner, record)
  }
  return record
}

export const GLOBAL_OWNER = 'fx:global'

export function openPlayback(owner: string = GLOBAL_OWNER): FxPlayback {
  const record = recordFor(owner)
  const playback = new Playback(owner, record, record.generation)
  record.playbacks.add(playback)
  return playback
}

/** Cancels everything the owner has in flight; later cues for the same owner still play. */
export function retireOwner(owner: string) {
  const record = owners.get(owner)
  if (!record) return
  record.generation += 1
  Array.from(record.playbacks).forEach((playback) => playback.cancel())
  owners.delete(owner)
}

export function pendingPlaybackCount(owner?: string) {
  if (owner) return owners.get(owner)?.playbacks.size ?? 0
  let total = 0
  owners.forEach((record) => { total += record.playbacks.size })
  return total
}
