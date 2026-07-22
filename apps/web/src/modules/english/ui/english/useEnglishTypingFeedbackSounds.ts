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

function createChimeWavBlobUrl() {
  const sampleRate = 22050
  const bytesPerSample = 2
  const tone1Ms = 100
  const tone2Ms = 200
  const totalMs = tone1Ms + tone2Ms
  const totalSamples = Math.max(1, Math.round((sampleRate * totalMs) / 1000))
  const tone1Samples = Math.round((sampleRate * tone1Ms) / 1000)
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

  const crossfadeSamples = Math.round(sampleRate * 0.005)

  for (let i = 0; i < totalSamples; i++) {
    const freq = i < tone1Samples ? 660 : 880
    const t = i < tone1Samples ? i / sampleRate : (i - tone1Samples) / sampleRate
    const phase = 2 * Math.PI * freq * t
    const waveform = (2 / Math.PI) * Math.asin(Math.sin(phase))

    const fadeIn = Math.min(1, i / (sampleRate * 0.006))
    const fadeOut = Math.min(1, (totalSamples - i) / (sampleRate * 0.04))

    let gapFade = 1
    const inCrossfade = i >= tone1Samples - crossfadeSamples && i < tone1Samples + crossfadeSamples
    if (inCrossfade) {
      if (i < tone1Samples) {
        gapFade = (tone1Samples - i) / crossfadeSamples
      } else {
        gapFade = (i - tone1Samples) / crossfadeSamples
      }
    }

    const envelope = Math.min(fadeIn, fadeOut, gapFade)
    const sample = Math.max(-1, Math.min(1, waveform * 0.10 * envelope))
    view.setInt16(44 + i * bytesPerSample, Math.round(sample * 0x7fff), true)
  }

  return URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }))
}

function tryPlay(audio: HTMLAudioElement | null, vol: number) {
  if (!audio || vol <= 0) return
  audio.volume = vol
  audio.currentTime = 0
  void audio.play().catch(() => undefined)
}

export function useEnglishTypingFeedbackSounds(sound: { enabled: boolean; masterVolume: number }) {
  const keyRef = useRef<HTMLAudioElement | null>(null)
  const wrongRef = useRef<HTMLAudioElement | null>(null)
  const correctRef = useRef<HTMLAudioElement | null>(null)
  const chimeRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    const keyUrl = createToneWavBlobUrl({ frequency: 800, durationMs: 25, gain: 0.08, type: 'triangle' })
    const wrongUrl = createToneWavBlobUrl({ frequency: 220, durationMs: 150, gain: 0.12, type: 'triangle' })
    const correctUrl = createToneWavBlobUrl({ frequency: 660, durationMs: 120, gain: 0.1, type: 'triangle' })
    const chimeUrl = createChimeWavBlobUrl()

    const key = new Audio(keyUrl)
    const wrong = new Audio(wrongUrl)
    const correct = new Audio(correctUrl)
    const chime = new Audio(chimeUrl)

    key.preload = 'auto'
    wrong.preload = 'auto'
    correct.preload = 'auto'
    chime.preload = 'auto'

    keyRef.current = key
    wrongRef.current = wrong
    correctRef.current = correct
    chimeRef.current = chime

    return () => {
      for (const audio of [key, wrong, correct, chime]) {
        audio.pause()
        audio.src = ''
      }
      URL.revokeObjectURL(keyUrl)
      URL.revokeObjectURL(wrongUrl)
      URL.revokeObjectURL(correctUrl)
      URL.revokeObjectURL(chimeUrl)
      keyRef.current = null
      wrongRef.current = null
      correctRef.current = null
      chimeRef.current = null
    }
  }, [])

  const playKeySound = useCallback(() => {
    tryPlay(keyRef.current, sound.enabled ? sound.masterVolume : 0)
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
