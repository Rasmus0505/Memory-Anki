"""Print duration / onset / pitch / brightness for candidate library one-shots."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import numpy as np
from scipy.io import wavfile

SR = 48000


def decode(src: Path, dst: Path) -> np.ndarray:
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(src), "-ac", "1", "-ar", str(SR),
                    "-c:a", "pcm_f32le", str(dst)], check=True)
    _, d = wavfile.read(dst)
    return d.astype(np.float64)


def main() -> None:
    src_dir = Path(sys.argv[1])
    out = Path(__file__).resolve().parent / "out" / "_lib"
    out.mkdir(parents=True, exist_ok=True)
    for src in sorted(src_dir.iterdir()):
        if src.suffix.lower() not in (".mp3", ".ogg", ".wav", ".flac"):
            continue
        x = decode(src, out / (src.stem + ".wav"))
        n = len(x)
        peak = np.max(np.abs(x)) + 1e-9
        db = 20 * np.log10(np.abs(x) + 1e-9)
        above = np.flatnonzero(db > -40)
        onset = above[0] / SR if len(above) else 0.0
        tail = above[-1] / SR if len(above) else 0.0
        seg = x[int(onset * SR): int(min(tail, onset + 0.25) * SR)]
        if len(seg) < 256:
            seg = x[: min(n, 4096)]
        win = np.hanning(len(seg))
        spec = np.abs(np.fft.rfft(seg * win))
        freqs = np.fft.rfftfreq(len(seg), 1 / SR)
        band = (freqs > 60) & (freqs < 8000)
        peak_bin = np.argmax(spec[band])
        f0 = freqs[band][peak_bin]
        centroid = float(np.sum(freqs * spec) / (np.sum(spec) + 1e-9))
        # crude tonalness: energy within 3 bins of the peak / total
        lo = max(0, np.flatnonzero(band)[peak_bin] - 3)
        hi = lo + 7
        tonal = float(np.sum(spec[lo:hi] ** 2) / (np.sum(spec ** 2) + 1e-9))
        print(f"{src.stem[:44]:44s} {n/SR:6.2f}s onset {onset:5.2f} tail {tail:5.2f} "
              f"peak {20*np.log10(peak):6.1f} f0~{f0:6.0f}Hz centroid {centroid:6.0f}Hz tonal {tonal:.2f}")


if __name__ == "__main__":
    main()
