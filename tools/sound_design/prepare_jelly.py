"""Prepare the squishy / bubbly one-shots used by the jelly directions."""

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
SRC = PROJECT / "tmp" / "audio-source-jelly"

SPECS = [
    ("pop5", SRC / "fs_439186_Pop-5-ogg.mp3", 910.0, 0.16, 250),
    ("pop9", SRC / "fs_328119_Pop-9.mp3", 902.0, 0.11, 250),
    ("bubble", SRC / "fs_411462_Bubble-Pop.mp3", 1491.0, 0.30, 250),
    ("waterdrop", SRC / "fs_165206_Water-Drop-Sound-wav.mp3", 664.0, 0.28, 300),
    ("slime", SRC / "fs_442772_Slime-Squish.mp3", 0.0, 0.25, 300),
    ("boing", SRC / "fs_540790_Boing-2.mp3", 1068.0, 1.10, 180),
    ("boing_cartoon", SRC / "fs_731262_cartoon-sound-single-boing.mp3", 796.0, 0.90, 150),
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
    tmp = ROOT / "out" / "_jelly"
    tmp.mkdir(parents=True, exist_ok=True)
    DEST.mkdir(parents=True, exist_ok=True)
    for name, path, base, keep, cutoff in SPECS:
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
        n_out = min(len(y), int(0.12 * SR))
        y[-n_out:] *= np.linspace(1, 0, n_out) ** 1.5
        y /= np.max(np.abs(y)) + 1e-9
        y *= 0.95
        wavfile.write(DEST / f"{name}.wav", SR, y.astype(np.float32))
        print(f"{name:14s} {len(y)/SR:5.2f}s base {base:6.0f}")
    print("wrote", DEST)


if __name__ == "__main__":
    main()
