from __future__ import annotations

import wave
from pathlib import Path

import av

from memory_anki.modules.english.domain.errors import EnglishCourseError


def extract_audio_track_to_wav(video_path: Path, output_path: Path) -> None:
    try:
        container = av.open(str(video_path))
    except Exception as exc:
        raise EnglishCourseError("无法读取上传的视频文件。") from exc
    try:
        audio_stream = next(
            (stream for stream in container.streams if stream.type == "audio"), None
        )
        if audio_stream is None:
            raise EnglishCourseError("视频中没有可识别的音轨。")
        output_path.parent.mkdir(parents=True, exist_ok=True)
        resampler = av.audio.resampler.AudioResampler(format="s16", layout="mono", rate=16000)
        with wave.open(str(output_path), "wb") as wav_file:
            wav_file.setnchannels(1)
            wav_file.setsampwidth(2)
            wav_file.setframerate(16000)
            for frame in container.decode(audio_stream):
                if not isinstance(frame, av.AudioFrame):
                    continue
                converted = resampler.resample(frame)
                frames = converted if isinstance(converted, list) else [converted]
                for item in frames:
                    if item is None:
                        continue
                    wav_file.writeframes(item.to_ndarray().tobytes())
            flushed = resampler.resample(None)
            frames = flushed if isinstance(flushed, list) else [flushed]
            for item in frames:
                if item is None:
                    continue
                wav_file.writeframes(item.to_ndarray().tobytes())
    finally:
        container.close()


def probe_media_duration_seconds(video_path: Path) -> int:
    try:
        container = av.open(str(video_path))
    except Exception:
        return 0
    try:
        if container.duration:
            return max(0, int(round(float(container.duration) / float(av.time_base))))
        video_stream = next(
            (stream for stream in container.streams if stream.type == "video"), None
        )
        if (
            video_stream is not None
            and video_stream.duration is not None
            and video_stream.time_base is not None
        ):
            return max(0, int(round(float(video_stream.duration * video_stream.time_base))))
        return 0
    finally:
        container.close()
