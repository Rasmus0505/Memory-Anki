import type { RefObject } from 'react'
import type { EnglishMaskSettings, EnglishPracticeSettings } from '@/modules/settings/public'
import type { DictationVideoProps } from './components/DictationVideo'
import { buildPlayHint } from './dictationControllerUtils'
import type { MaskRect } from './dictationLayout'

export interface DictationVideoPlaybackControls {
  isPlaying: boolean
  handleLoadedMetadata: () => void
  handlePlay: () => void
  handlePause: () => void
  handleEnded: () => void
  togglePlay: () => void
}

interface Params {
  videoRef: RefObject<HTMLVideoElement | null>
  mediaUrl: string
  maskEnabled: boolean
  maskRect: MaskRect
  mask: EnglishMaskSettings
  onMaskChange: (rect: MaskRect) => void
  onMaskCommit: (rect: MaskRect) => void
  playback: DictationVideoPlaybackControls
  settings: EnglishPracticeSettings
}

/** Compose the video/mask prop bundle once so the page stays focused on layout. */
export function buildDictationVideoProps({
  videoRef,
  mediaUrl,
  maskEnabled,
  maskRect,
  mask,
  onMaskChange,
  onMaskCommit,
  playback,
  settings,
}: Params): Omit<DictationVideoProps, 'layout' | 'sentenceLabel' | 'className'> {
  return {
    videoRef,
    mediaUrl,
    maskEnabled,
    maskRect,
    maskBlur: mask.blur,
    maskOpacity: mask.opacity,
    onMaskChange,
    onMaskCommit,
    onLoadedMetadata: playback.handleLoadedMetadata,
    onPlay: playback.handlePlay,
    onPause: playback.handlePause,
    onEnded: playback.handleEnded,
    onTogglePlay: playback.togglePlay,
    playbackSpeed: settings.stage.playbackSpeed,
    isPlaying: playback.isPlaying,
    playHint: buildPlayHint(settings),
  }
}
