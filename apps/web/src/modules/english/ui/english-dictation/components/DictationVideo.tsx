import { useState, type RefObject } from 'react'
import { CircleAlert, Play } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import type { EnglishDictationLayout } from '@/modules/settings/public'
import { DictationMask } from './DictationMask'
import type { MaskRect } from '../dictationLayout'

export interface DictationVideoProps {
  videoRef: RefObject<HTMLVideoElement | null>
  mediaUrl: string
  layout: EnglishDictationLayout
  sentenceLabel: string
  maskEnabled: boolean
  maskRect: MaskRect
  maskBlur: number
  maskOpacity: number
  onMaskChange: (rect: MaskRect) => void
  onMaskCommit: (rect: MaskRect) => void
  onLoadedMetadata: () => void
  onPlay: () => void
  onPause: () => void
  onEnded: () => void
  onTogglePlay: () => void
  playbackSpeed: number
  isPlaying: boolean
  playHint?: string
  className?: string
}

export function DictationVideo({
  videoRef,
  mediaUrl,
  layout,
  sentenceLabel,
  maskEnabled,
  maskRect,
  maskBlur,
  maskOpacity,
  onMaskChange,
  onMaskCommit,
  onLoadedMetadata,
  onPlay,
  onPause,
  onEnded,
  onTogglePlay,
  playbackSpeed,
  isPlaying,
  playHint,
  className,
}: DictationVideoProps) {
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const theater = layout === 'theater'
  const showControls = layout !== 'theater'

  return (
    <div
      data-testid="english-course-video-panel"
      data-layout={layout}
      className={cn(
        'ed-video-shell',
        theater ? 'ed-video-shell--theater' : 'ed-video-shell--framed',
        className,
      )}
    >
      <video
        ref={videoRef}
        src={mediaUrl}
        preload="metadata"
        playsInline
        controls={showControls}
        className={cn('ed-video', theater ? 'object-contain' : 'object-contain')}
        aria-label="英语听写视频"
        onLoadedMetadata={() => {
          setReady(true)
          onLoadedMetadata()
        }}
        onPlay={onPlay}
        onPause={onPause}
        onEnded={onEnded}
        onError={() => setFailed(true)}
        onClick={showControls ? undefined : onTogglePlay}
      />

      <div className="ed-video__vignette" aria-hidden />
      <div className="ed-video__topline">
        <span className="ed-video__label">{sentenceLabel}</span>
        {playbackSpeed !== 1 ? (
          <span className="ed-video__speed">{playbackSpeed.toFixed(2).replace(/0$/, '')}×</span>
        ) : null}
      </div>

      {!ready && !failed ? <div className="ed-video__loading" aria-label="视频载入中" /> : null}

      {failed ? (
        <div className="ed-video__error">
          <CircleAlert className="size-5" />
          <span>视频无法播放，请确认源文件仍在课程目录中。</span>
        </div>
      ) : null}

      {maskEnabled ? (
        <DictationMask
          rect={maskRect}
          blur={maskBlur}
          opacity={maskOpacity}
          isPlaying={isPlaying}
          onChange={onMaskChange}
          onCommit={onMaskCommit}
        />
      ) : null}

      {!showControls && !isPlaying && !failed ? (
        <button
          type="button"
          className="ed-video__play"
          onClick={(event) => {
            event.stopPropagation()
            onTogglePlay()
          }}
          aria-label="播放本句"
        >
          <span className="ed-video__play-ring">
            <Play className="size-7 translate-x-0.5" fill="currentColor" />
          </span>
          <span className="ed-video__play-hint">{playHint || '点击播放'}</span>
        </button>
      ) : null}

      {theater ? (
        <>
          <span className="ed-frame-corner ed-frame-corner--tl" aria-hidden />
          <span className="ed-frame-corner ed-frame-corner--tr" aria-hidden />
          <span className="ed-frame-corner ed-frame-corner--bl" aria-hidden />
          <span className="ed-frame-corner ed-frame-corner--br" aria-hidden />
        </>
      ) : null}
    </div>
  )
}
