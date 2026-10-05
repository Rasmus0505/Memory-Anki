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
  onCancel(fn: () => void): () => void
  /** Releases an idle playback after its synchronous setup is complete. */
  finish(): void
  cancel(): void
}

interface OwnerRecord {
  generation: number
  playbacks: Set<Playback>
}

const owners = new Map<string, OwnerRecord>()
// Skip persists for this mounted ceremony, including data arriving after the gesture.
const skippedOwners = new Set<string>()

export const roundFxOwner = (roundKey: string) => `round:${roundKey}`

export function skipOwner(owner: string) {
  skippedOwners.add(owner)
  retireOwner(owner)
}

export function resumeOwner(owner: string) {
  skippedOwners.delete(owner)
}

export function isOwnerSkipped(owner: string) {
  return skippedOwners.has(owner)
}

class Playback implements FxPlayback {
  readonly owner: string
  private readonly record: OwnerRecord
  private readonly generation: number
  private dead = false
  private readonly timers = new Set<number>()
  private readonly cleanups = new Set<() => void>()

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
    if (this.dead) {
      fn()
      return () => undefined
    }
    this.cleanups.add(fn)
    return () => {
      this.cleanups.delete(fn)
      this.settle()
    }
  }

  /** Releases an idle playback and unregisters all cancellation closures. */
  finish() {
    this.settle()
  }

  cancel() {
    if (this.dead) return
    this.dead = true
    this.timers.forEach((id) => window.clearTimeout(id))
    this.timers.clear()
    const cleanups = Array.from(this.cleanups)
    this.cleanups.clear()
    cleanups.forEach((fn) => fn())
    this.record.playbacks.delete(this)
  }

  /** Drops the playback from its owner once nothing is pending. */
  settle() {
    if (this.timers.size === 0 && this.cleanups.size === 0) {
      this.dead = true
      this.record.playbacks.delete(this)
      if (this.record.playbacks.size === 0 && owners.get(this.owner) === this.record) owners.delete(this.owner)
    }
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
  if (skippedOwners.has(owner)) playback.cancel()
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
