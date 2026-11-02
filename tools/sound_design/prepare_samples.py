"""Decode the downloaded CC0 paper recordings and expose isolated transients.

Run:  python tools/sound_design/prepare_samples.py <source-dir>
Writes cleaned mono one-shots into tools/sound_design/samples/.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import numpy as np
from scipy.io import wavfile

SR = 48000
ROOT = Path(__file__).resolve().parent
SAMPLES = ROOT / "samples"


def decode(src: Path, dst: Path) -> np.ndarray:
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-i", str(src), "-ac", "1", "-ar", str(SR),
         "-c:a", "pcm_f32le", str(dst)],
        check=True,
    )
    sr, data = wavfile.read(dst)
    assert sr == SR
    return data.astype(np.float64)


def envelope(x: np.ndarray, ms: float = 20.0) -> np.ndarray:
    w = max(1, int(SR * ms / 1000))
    c = np.concatenate([[0.0], np.cumsum(x ** 2)])
    e = np.sqrt(np.maximum(0.0, (c[w:] - c[:-w]) / w))
    return np.pad(e, (0, len(x) - len(e)), mode="edge")


def onsets(x: np.ndarray, threshold_db: float = -34.0, min_gap: float = 0.18):
    env = envelope(x)
    db = 20 * np.log10(env + 1e-9)
    gate = db > threshold_db
    edges = np.flatnonzero(np.diff(gate.astype(np.int8)) == 1) + 1
    picked = []
    gap = int(min_gap * SR)
    for e in edges:
        if not picked or e - picked[-1] > gap:
            picked.append(int(e))
    return picked, db


def describe(x: np.ndarray, at: int) -> dict:
    lo = max(0, at - int(0.12 * SR))
    hi = min(len(x), at + int(0.55 * SR))
    seg = x[lo:hi]
    pre = x[lo:at]
    return {
        "at": at / SR,
        "peak_db": 20 * np.log10(np.max(np.abs(seg)) + 1e-9),
        "pre_db": 20 * np.log10(np.sqrt(np.mean(pre ** 2)) + 1e-9) if len(pre) else -120,
        "tail_s": len(seg) / SR,
    }


def write(name: str, x: np.ndarray, start: int, length: float, fade_out: float = 0.06) -> Path:
    a = max(0, start)
    b = min(len(x), start + int(length * SR))
    seg = x[a:b].copy()
    # 2 ms in, smooth exponential-ish out
    n_in = int(0.002 * SR)
    if n_in < len(seg):
        seg[:n_in] *= np.linspace(0, 1, n_in)
    n_out = min(len(seg), int(fade_out * SR))
    seg[-n_out:] *= np.linspace(1, 0, n_out) ** 1.3
    seg -= np.mean(seg) * 0  # keep DC handling to the bus high-pass
    peak = np.max(np.abs(seg)) + 1e-9
    seg = seg / peak * 0.89
    dst = SAMPLES / f"{name}.wav"
    wavfile.write(dst, SR, seg.astype(np.float32))
    return dst


def main() -> None:
    src_dir = Path(sys.argv[1])
    SAMPLES.mkdir(parents=True, exist_ok=True)
    tmp = ROOT / "out" / "_decoded"
    tmp.mkdir(parents=True, exist_ok=True)
    for src in sorted(src_dir.glob("*.mp3")):
        x = decode(src, tmp / (src.stem + ".wav"))
        picked, db = onsets(x)
        print(f"\n== {src.name}  {len(x)/SR:.2f}s  events={len(picked)}")
        for at in picked[:12]:
            d = describe(x, at)
            print(f"   at {d['at']:.3f}s  peak {d['peak_db']:.1f} dB  pre {d['pre_db']:.1f} dB")

    # Hand-picked cuts (verified from the onset report above).
    single = tmp / "fs_63318_Page-Turn-Please-Turn-Over-PTO-paper_tur.wav"
    if single.exists():
        x = wavfile.read(single)[1].astype(np.float64)
        start = int(0.325 * SR)
        write("paper_turn", x, start, 0.62, fade_out=0.10)

    sketch = tmp / "fs_320148_Paper-Sketchbook-Page-Flips-1.wav"
    if sketch.exists():
        x = wavfile.read(sketch)[1].astype(np.float64)
        picked, _ = onsets(x)
        print("\nsketchbook onsets:", [round(p / SR, 3) for p in picked])
        if picked:
            # choose the most isolated of the first few
            best = max(picked[:6], key=lambda at: (
                describe(x, at)["peak_db"] - describe(x, at)["pre_db"]))
            write("paper_flip", x, best, 0.34, fade_out=0.07)

    various = tmp / "fs_450803_paper-sheets-flip-through-turn-page-nice.wav"
    if various.exists():
        x = wavfile.read(various)[1].astype(np.float64)
        picked, _ = onsets(x)
        print("various onsets:", [round(p / SR, 3) for p in picked])
        if picked:
            best = max(picked[:10], key=lambda at: (
                describe(x, at)["peak_db"] - describe(x, at)["pre_db"]))
            write("paper_sheet", x, best, 0.42, fade_out=0.08)

    for f in sorted(SAMPLES.glob("*.wav")):
        print("wrote", f.relative_to(ROOT.parent.parent), f.stat().st_size, "bytes")


if __name__ == "__main__":
    main()
