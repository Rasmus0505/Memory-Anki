import { lookupVoiceUrl, proxiedLookupAudioUrl } from './normalize'

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
      this.audio.onerror = null
    }
    this.currentSrc = ''
  }

  load(src: string): HTMLAudioElement {
    this.reset()
    this.currentSrc = src
    this.audio = new Audio(src)
    this.audio.preload = 'auto'
    return this.audio
  }

  async play(src?: string | null, fallbackQuery?: string | null): Promise<void> {
    if (!src) {
      this.reset()
      return
    }
    const playable = proxiedLookupAudioUrl(src) ?? src
    // Same src while playing: treat as stop (Saladict toggle).
    if (playable === this.currentSrc && this.audio && !this.audio.paused) {
      this.reset()
      return
    }
    try {
      await this.playOnce(playable)
    } catch {
      const fallback = fallbackQuery ? lookupVoiceUrl(fallbackQuery, 'us') : null
      if (fallback && fallback !== playable) {
        try {
          await this.playOnce(fallback)
          return
        } catch {
          // Fall through to reset.
        }
      }
      this.reset()
    }
  }

  private playOnce(src: string): Promise<void> {
    const audio = this.load(src)
    return new Promise((resolve, reject) => {
      const fail = () => reject(new Error('audio failed'))
      audio.onerror = fail
      void audio.play().then(() => resolve()).catch(fail)
    })
  }

  stop() {
    this.reset()
  }
}

export function getLookupAudioManager() {
  return LookupAudioManager.getInstance()
}
