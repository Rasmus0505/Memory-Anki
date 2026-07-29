/**
 * Singleton audio player — Saladict AudioManager port.
 * Only one clip plays at a time; a new play interrupts the previous.
 */
export class LookupAudioManager {
  private static instance: LookupAudioManager | null = null

  static getInstance(): LookupAudioManager {
    if (!LookupAudioManager.instance) {
      LookupAudioManager.instance = new LookupAudioManager()
    }
    return LookupAudioManager.instance
  }

  private audio: HTMLAudioElement | null = null
  currentSrc = ''

  reset() {
    if (this.audio) {
      this.audio.pause()
      this.audio.currentTime = 0
      this.audio.src = ''
      this.audio.onended = null
    }
    this.currentSrc = ''
  }

  load(src: string): HTMLAudioElement {
    this.reset()
    this.currentSrc = src
    this.audio = new Audio(src)
    return this.audio
  }

  async play(src?: string | null): Promise<void> {
    if (!src) {
      this.reset()
      return
    }
    // Same src while playing: treat as stop (Saladict toggle).
    if (src === this.currentSrc && this.audio && !this.audio.paused) {
      this.reset()
      return
    }
    const audio = this.load(src)
    try {
      await audio.play()
    } catch {
      if (this.audio === audio) this.reset()
    }
  }

  stop() {
    this.reset()
  }
}

export function getLookupAudioManager() {
  return LookupAudioManager.getInstance()
}
