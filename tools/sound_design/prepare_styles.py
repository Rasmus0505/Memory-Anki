"""Prepare the extra one-shots used by the style lab.

Run:  python tools/sound_design/prepare_styles.py
Reads the downloads under tmp/, writes cleaned mono one-shots to samples/lib/.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, sosfiltfilt

SR = 48000
ROOT = Path(__file__).resolve().parent
PROJECT = ROOT.parent.parent
DEST = ROOT / "samples" / "lib"
FS = PROJECT / "tmp" / "audio-source-styles"
KEN = PROJECT / "tmp" / "kenney"

# name, input path, base pitch Hz (0 = unpitched), keep seconds, high-pass Hz
SPECS = [
    ("music_box", FS / "fs_218459_Music-box-note.mp3", 1488.0, 2.20, 100),
    ("glass_clink", FS / "fs_178178_Wine-glass-clink-deeper-wav.mp3", 876.0, 0.80, 150),
    ("glass_ani", FS / "fs_198401_ANI-Wine-Glass-Hard.mp3", 712.0, 0.65, 150),
    ("gong", FS / "fs_119545_Instrument_gong_soft-aif.mp3", 120.0, 3.60, 45),
    ("small_gong", FS / "fs_369428_Small-Gong_Soft-Hit_RAW.mp3", 452.0, 2.20, 55),
    ("k_click", KEN / "interface/Audio/click_002.ogg", 943.0, 0.06, 120),
    ("k_select", KEN / "interface/Audio/select_002.ogg", 595.0, 0.08, 120),
    ("k_tick", KEN / "interface/Audio/tick_001.ogg", 787.0, 0.06, 200),
    ("k_toggle", KEN / "interface/Audio/toggle_002.ogg", 2105.0, 0.16, 150),
    ("k_glass", KEN / "interface/Audio/glass_002.ogg", 1972.0, 0.16, 200),
    ("k_bong", KEN / "interface/Audio/bong_001.ogg", 234.0, 0.16, 80),
    ("k_drop", KEN / "interface/Audio/drop_002.ogg", 810.0, 0.22, 100),
    ("k_confirm", KEN / "interface/Audio/confirmation_002.ogg", 1760.0, 0.60, 120),
    ("k_pluck", KEN / "interface/Audio/pluck_001.ogg", 1315.0, 0.14, 150),
    ("k_question", KEN / "interface/Audio/question_002.ogg", 784.0, 0.36, 100),
    ("k_scratch", KEN / "interface/Audio/scratch_002.ogg", 0.0, 0.16, 400),
    ("d_tone1", KEN / "digital-audio/Audio/tone1.ogg", 0.0, 0.70, 60),
    ("d_two1", KEN / "digital-audio/Audio/twoTone1.ogg", 0.0, 0.75, 60),
    ("d_three1", KEN / "digital-audio/Audio/threeTone1.ogg", 0.0, 0.85, 60),
    ("d_lowdown", KEN / "digital-audio/Audio/lowDown.ogg", 0.0, 0.80, 50),
    ("d_power5", KEN / "digital-audio/Audio/powerUp5.ogg", 0.0, 0.50, 60),
    ("d_power7", KEN / "digital-audio/Audio/powerUp7.ogg", 0.0, 0.55, 60),
    ("d_power11", KEN / "digital-audio/Audio/powerUp11.ogg", 0.0, 0.70, 60),
]


def decode(src: Path, dst: Path) -> np.ndarray:
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(src), "-ac", "1", "-ar", str(SR),
                    "-c:a", "pcm_f32le", str(dst)], check=True)
    _, d = wavfile.read(dst)
    return d.astype(np.float64)


def hp(x: np.ndarray, cutoff: float) -> np.ndarray:
    sos = butter(2, cutoff / (SR / 2), btype="highpass", output="sos")
    return sosfiltfilt(sos, x)


def main() -> None:
    tmp = ROOT / "out" / "_styles"
    tmp.mkdir(parents=True, exist_ok=True)
    DEST.mkdir(parents=True, exist_ok=True)
    for name, path, base, keep, cutoff in SPECS:
        if not path.exists():
            print("missing", path)
            continue
        x = decode(path, tmp / f"{name}.wav")
        db = 20 * np.log10(np.abs(x) + 1e-9)
        above = np.flatnonzero(db > -42)
        on = int(above[0]) if len(above) else 0
        y = x[on: on + int(keep * SR)].copy()
        need = int(keep * SR) - len(y)
        if need > 0:
            y = np.pad(y, (0, need))
        y = hp(y, cutoff)
        n_in = int(0.0015 * SR)
        y[:n_in] *= np.linspace(0, 1, n_in)
        n_out = min(len(y), int(min(0.16, keep * 0.4) * SR))
        y[-n_out:] *= np.linspace(1, 0, n_out) ** 1.5
        y /= np.max(np.abs(y)) + 1e-9
        y *= 0.95
        wavfile.write(DEST / f"{name}.wav", SR, y.astype(np.float32))
        print(f"{name:13s} {len(y)/SR:5.2f}s base {base:6.0f}")
    print("wrote", DEST)


if __name__ == "__main__":
    main()
