import { useCallback, useEffect, useRef } from 'react'

interface ToneSpec {
  frequency: number
  durationMs: number
  gain: number
  type: 'sine' | 'triangle' | 'square'
}

function createToneWavBlobUrl({ frequency, durationMs, gain, type }: ToneSpec) {
  const sampleRate = 22050
  const totalSamples = Math.max(1, Math.round((sampleRate * durationMs) / 1000))
  const bytesPerSample = 2
  const dataSize = totalSamples * bytesPerSample
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)

  const writeAscii = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index))
    }
  }

  writeAscii(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeAscii(8, 'WAVE')
  writeAscii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * bytesPerSample, true)
  view.setUint16(32, bytesPerSample, true)
  view.setUint16(34, 16, true)
  writeAscii(36, 'data')
  view.setUint32(40, dataSize, true)

  for (let sampleIndex = 0; sampleIndex < totalSamples; sampleIndex += 1) {
    const time = sampleIndex / sampleRate
    const phase = 2 * Math.PI * frequency * time
    let waveform = Math.sin(phase)
    if (type === 'square') {
      waveform = waveform >= 0 ? 1 : -1
    } else if (type === 'triangle') {
      waveform = (2 / Math.PI) * Math.asin(Math.sin(phase))
    }

    const fadeInSamples = Math.max(1, Math.round(sampleRate * 0.01))
    const fadeOutSamples = Math.max(1, Math.round(sampleRate * 0.04))
    const fadeIn = Math.min(1, sampleIndex / fadeInSamples)
    const fadeOut = Math.min(1, (totalSamples - sampleIndex) / fadeOutSamples)
    const envelope = Math.min(fadeIn, fadeOut)
    const sample = Math.max(-1, Math.min(1, waveform * gain * envelope))
    view.setInt16(44 + sampleIndex * bytesPerSample, Math.round(sample * 0x7fff), true)
  }

  return URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }))
}

function tryPlay(audio: HTMLAudioElement | null, enabled: boolean) {
  if (!audio || !enabled) return
  audio.currentTime = 0
  void audio.play().catch(() => undefined)
}

export function useEnglishTypingFeedbackSounds(enabled: boolean) {
  const keyRef = useRef<HTMLAudioElement | null>(null)
  const wrongRef = useRef<HTMLAudioElement | null>(null)
  const correctRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    const keyUrl = createToneWavBlobUrl({ frequency: 860, durationMs: 28, gain: 0.12, type: 'triangle' })
    const wrongUrl = createToneWavBlobUrl({ frequency: 260, durationMs: 170, gain: 0.2, type: 'square' })
    const correctUrl = createToneWavBlobUrl({ frequency: 720, durationMs: 150, gain: 0.18, type: 'triangle' })

    const key = new Audio(keyUrl)
    const wrong = new Audio(wrongUrl)
    const correct = new Audio(correctUrl)

    key.preload = 'auto'
    wrong.preload = 'auto'
    correct.preload = 'auto'

    keyRef.current = key
    wrongRef.current = wrong
    correctRef.current = correct

    return () => {
      for (const audio of [key, wrong, correct]) {
        audio.pause()
        audio.src = ''
      }
      URL.revokeObjectURL(keyUrl)
      URL.revokeObjectURL(wrongUrl)
      URL.revokeObjectURL(correctUrl)
      keyRef.current = null
      wrongRef.current = null
      correctRef.current = null
    }
  }, [])

  const playKeySound = useCallback(() => {
    tryPlay(keyRef.current, enabled)
  }, [enabled])

  const playWrongSound = useCallback(() => {
    tryPlay(wrongRef.current, enabled)
  }, [enabled])

  const playCorrectSound = useCallback(() => {
    tryPlay(correctRef.current, enabled)
  }, [enabled])

  return {
    playKeySound,
    playWrongSound,
    playCorrectSound,
  }
}
