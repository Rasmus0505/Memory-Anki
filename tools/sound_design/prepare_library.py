"""Clean the downloaded CC0 library one-shots into project samples.

Run:  python tools/sound_design/prepare_library.py <source-dir>
Out:  tools/sound_design/samples/lib/<name>.wav  +  lib.json
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, sosfiltfilt

SR = 48000
ROOT = Path(__file__).resolve().parent
DEST = ROOT / "samples" / "lib"

# name -> (source stem, base pitch Hz or 0, seconds to keep, high-pass Hz)
SOURCES = {
    "wood_lo":     ("fs_218460_Wood-block-hit", 706.0, 0.24, 60),
    "wood_mid":    ("fs_218461_wood-block", 704.0, 0.30, 60),
    "wood_hi":     ("fs_533093_Wood-Block", 1239.0, 0.26, 80),
    "click_tiny":  ("fs_256116_Click-wav", 494.0, 0.07, 200),
    "click_ui":    ("fs_546974_UI_Click-wav", 494.0, 0.30, 80),
    "click_soft":  ("fs_528561_Soft-UI-Button-Click", 3489.0, 0.24, 300),
    "click_switch": ("fs_215772_click", 0.0, 0.09, 700),
    "blip":        ("fs_657948_Family-Friendly-Inspect-Sound-UI-or-In-G", 1516.0, 0.10, 300),
    "bell_glass":  ("fs_127149_ding-wav", 1306.0, 1.30, 120),
    "bell_approve": ("fs_625174_UI-Sound-Approval-High-Pitched-Bell-Synt", 1761.0, 0.85, 200),
    "bowl":        ("fs_271370_singing-bowl-strike-sound", 1878.0, 2.30, 100),
    "kalimba":     ("fs_331047_Kalimba-C-note", 267.0, 3.00, 80),
    "marimba":     ("fs_185833_Marimba-note-struck", 283.0, 0.95, 80),
    "thump":       ("fs_405705_found-matress-hit-wav", 117.0, 0.95, 28),
    "whoosh":      ("fs_449996_whoosh_short_mid-wav", 0.0, 0.50, 260),
    "swoosh":      ("fs_419341_Swoosh-ogg", 0.0, 0.28, 200),
    "cymbal":      ("fs_39664_Cymbal-Swish-Short-wav", 0.0, 1.30, 2500),
}


def decode(src: Path, dst: Path) -> np.ndarray:
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(src), "-ac", "1", "-ar", str(SR),
                    "-c:a", "pcm_f32le", str(dst)], check=True)
    _, d = wavfile.read(dst)
    return d.astype(np.float64)


def hp(x: np.ndarray, cutoff: float) -> np.ndarray:
    sos = butter(2, cutoff / (SR / 2), btype="highpass", output="sos")
    return sosfiltfilt(sos, x)


def main() -> None:
    src_dir = Path(sys.argv[1])
    tmp = ROOT / "out" / "_lib2"
    tmp.mkdir(parents=True, exist_ok=True)
    DEST.mkdir(parents=True, exist_ok=True)
    index = {}
    for name, (stem, base, keep, cutoff) in SOURCES.items():
        src = src_dir / f"{stem}.mp3"
        if not src.exists():
            print("missing", src)
            continue
        x = decode(src, tmp / f"{stem}.wav")
        db = 20 * np.log10(np.abs(x) + 1e-9)
        above = np.flatnonzero(db > -42)
        on = int(above[0]) if len(above) else 0
        y = x[on: on + int(keep * SR)].copy()
        if len(y) < int(keep * SR):
            y = np.pad(y, (0, int(keep * SR) - len(y)))
        y = hp(y, cutoff)
        n_in = int(0.0015 * SR)
        y[:n_in] *= np.linspace(0, 1, n_in)
        n_out = min(len(y), int(min(0.18, keep * 0.4) * SR))
        y[-n_out:] *= np.linspace(1, 0, n_out) ** 1.5
        y /= np.max(np.abs(y)) + 1e-9
        y *= 0.95
        wavfile.write(DEST / f"{name}.wav", SR, y.astype(np.float32))
        index[name] = {"base": base, "seconds": round(len(y) / SR, 3)}
        print(f"{name:13s} <- {stem[:40]:40s} {len(y)/SR:5.2f}s base {base or '-':>6}")

    (DEST / "lib.json").write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8")
    print("wrote", DEST)


if __name__ == "__main__":
    main()
