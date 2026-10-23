import { useCallback, useEffect, useRef } from 'react'

type WaveType = 'sine' | 'triangle' | 'square'

interface ToneLayer {
  /** Offset from the start of the clip, in milliseconds. */
  startMs?: number
  durationMs: number
  frequency: number
  gain: number
  type: WaveType
  /** Exponential decay time; longer feels rounder, shorter feels like a click. */
  decayMs?: number
}

const SAMPLE_RATE = 22050
const BYTES_PER_SAMPLE = 2
/** Feedback sits over video audio; boost it without changing the saved 0-1 value. */
const FEEDBACK_VOLUME_BOOST = 1.7

function writeAscii(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index))
  }
}

/**
 * Render several short tones into one WAV clip. Layered clips avoid the thin,
 * single-beep feel of one oscillator: a keystroke gets a bright tick, a short
 * body, and a soft low tail in one sample buffer.
 */
function createLayeredWavBlobUrl(layers: ToneLayer[]) {
  const totalMs = Math.max(
    1,
    ...layers.map((layer) => (layer.startMs || 0) + layer.durationMs),
  )
  const totalSamples = Math.max(1, Math.round((SAMPLE_RATE * totalMs) / 1000))
  const dataSize = totalSamples * BYTES_PER_SAMPLE
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)

  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeAscii(view, 8, 'WAVE')
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, SAMPLE_RATE, true)
  view.setUint32(28, SAMPLE_RATE * BYTES_PER_SAMPLE, true)
  view.setUint16(32, BYTES_PER_SAMPLE, true)
  view.setUint16(34, 16, true)
  writeAscii(view, 36, 'data')
  view.setUint32(40, dataSize, true)

  const rendered = new Float32Array(totalSamples)
  for (const layer of layers) {
    const startSample = Math.max(0, Math.round(((layer.startMs || 0) * SAMPLE_RATE) / 1000))
    const layerSamples = Math.max(1, Math.round((layer.durationMs * SAMPLE_RATE) / 1000))
    const decaySeconds = Math.max(0.004, (layer.decayMs ?? layer.durationMs * 0.7) / 1000)
    for (let index = 0; index < layerSamples; index += 1) {
      const sampleIndex = startSample + index
      if (sampleIndex >= totalSamples) break
      const time = index / SAMPLE_RATE
      const phase = 2 * Math.PI * layer.frequency * time
      let wave = Math.sin(phase)
      if (layer.type === 'square') {
        wave = wave >= 0 ? 1 : -1
      } else if (layer.type === 'triangle') {
        wave = (2 / Math.PI) * Math.asin(Math.sin(phase))
      }
      const attack = Math.min(1, index / Math.max(1, SAMPLE_RATE * 0.003))
      const decay = Math.exp(-(time * 1000) / (decaySeconds * 1000))
      const tailFade = Math.min(1, (layerSamples - index) / Math.max(1, SAMPLE_RATE * 0.008))
      rendered[sampleIndex] += wave * layer.gain * attack * decay * tailFade
    }
  }

  for (let index = 0; index < totalSamples; index += 1) {
    const sample = Math.max(-1, Math.min(1, rendered[index]))
    view.setInt16(44 + index * BYTES_PER_SAMPLE, Math.round(sample * 0x7fff), true)
  }
  return URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }))
}

function createKeyClickWavBlobUrl(variant: number) {
  const pitch = [1, 1.035, 0.972, 1.016][variant % 4] || 1
  return createLayeredWavBlobUrl([
    {
      durationMs: 13,
      frequency: 1820 * pitch,
      gain: 0.09,
      type: 'sine',
      decayMs: 7,
    },
    {
      startMs: 1,
      durationMs: 32,
      frequency: 690 * pitch,
      gain: 0.125,
      type: 'triangle',
      decayMs: 20,
    },
    {
      startMs: 2,
      durationMs: 44,
      frequency: 315 * pitch,
      gain: 0.07,
      type: 'triangle',
      decayMs: 30,
    },
  ])
}

function createCorrectWavBlobUrl() {
  return createLayeredWavBlobUrl([
    { durationMs: 58, frequency: 880, gain: 0.11, type: 'sine', decayMs: 34 },
    { startMs: 3, durationMs: 115, frequency: 1320, gain: 0.065, type: 'triangle', decayMs: 62 },
  ])
}

function createWrongWavBlobUrl() {
  return createLayeredWavBlobUrl([
    { durationMs: 165, frequency: 150, gain: 0.22, type: 'triangle', decayMs: 82 },
    { durationMs: 225, frequency: 94, gain: 0.15, type: 'sine', decayMs: 120 },
    { startMs: 8, durationMs: 90, frequency: 208, gain: 0.075, type: 'square', decayMs: 45 },
  ])
}

function createChimeWavBlobUrl() {
  return createLayeredWavBlobUrl([
    { durationMs: 210, frequency: 660, gain: 0.1, type: 'triangle', decayMs: 190 },
    { startMs: 105, durationMs: 235, frequency: 880, gain: 0.09, type: 'triangle', decayMs: 215 },
    { startMs: 200, durationMs: 300, frequency: 1320, gain: 0.065, type: 'sine', decayMs: 280 },
  ])
}

function tryPlay(audio: HTMLAudioElement | null, vol: number) {
  if (!audio || vol <= 0) return
  audio.volume = Math.min(1, vol * FEEDBACK_VOLUME_BOOST)
  audio.currentTime = 0
  void audio.play().catch(() => undefined)
}

export function useEnglishTypingFeedbackSounds(sound: { enabled: boolean; masterVolume: number }) {
  const keyRefs = useRef<HTMLAudioElement[]>([])
  const keyVariantRef = useRef(0)
  const wrongRef = useRef<HTMLAudioElement | null>(null)
  const correctRef = useRef<HTMLAudioElement | null>(null)
  const chimeRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    // Key: a layered click with slight pitch variation. Wrong: low thump +
    // rumble. Correct: bright two-tone tick. Chime: a rising three-note finish.
    const keyUrls = [0, 1, 2, 3].map(createKeyClickWavBlobUrl)
    const wrongUrl = createWrongWavBlobUrl()
    const correctUrl = createCorrectWavBlobUrl()
    const chimeUrl = createChimeWavBlobUrl()

    const keys = keyUrls.map((url) => {
      const audio = new Audio(url)
      audio.preload = 'auto'
      return audio
    })
    const wrong = new Audio(wrongUrl)
    const correct = new Audio(correctUrl)
    const chime = new Audio(chimeUrl)
    wrong.preload = 'auto'
    correct.preload = 'auto'
    chime.preload = 'auto'

    keyRefs.current = keys
    wrongRef.current = wrong
    correctRef.current = correct
    chimeRef.current = chime

    return () => {
      for (const audio of [...keys, wrong, correct, chime]) {
        audio.pause()
        audio.src = ''
      }
      for (const url of [...keyUrls, wrongUrl, correctUrl, chimeUrl]) {
        URL.revokeObjectURL(url)
      }
      keyRefs.current = []
      wrongRef.current = null
      correctRef.current = null
      chimeRef.current = null
    }
  }, [])

  const playKeySound = useCallback(() => {
    const keys = keyRefs.current
    if (keys.length === 0) return
    const key = keys[keyVariantRef.current % keys.length]
    keyVariantRef.current = (keyVariantRef.current + 1) % keys.length
    tryPlay(key, sound.enabled ? sound.masterVolume : 0)
  }, [sound.enabled, sound.masterVolume])

  const playWrongSound = useCallback(() => {
    tryPlay(wrongRef.current, sound.enabled ? sound.masterVolume : 0)
  }, [sound.enabled, sound.masterVolume])

  const playCorrectSound = useCallback(() => {
    tryPlay(correctRef.current, sound.enabled ? sound.masterVolume : 0)
  }, [sound.enabled, sound.masterVolume])

  const playSentenceComplete = useCallback(() => {
    tryPlay(chimeRef.current, sound.enabled ? sound.masterVolume : 0)
  }, [sound.enabled, sound.masterVolume])

  return {
    playKeySound,
    playWrongSound,
    playCorrectSound,
    playSentenceComplete,
  }
}
