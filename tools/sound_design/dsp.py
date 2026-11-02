"""DSP primitives for the Memory Anki sound palette.

Everything is synthesised offline in numpy/scipy, then exported as short
44.1 kHz WAV one-shots. The runtime only decodes and plays buffers, so the
timbres here are the whole sound design.
"""

from __future__ import annotations

import numpy as np
from scipy.signal import butter, sosfilt, sosfiltfilt, fftconvolve, resample_poly

SR = 48000
OUT_SR = 44100


# --------------------------------------------------------------------------- #
# basics
# --------------------------------------------------------------------------- #

def nsamples(dur: float, sr: int = SR) -> int:
    return max(1, int(round(dur * sr)))


def timeline(dur: float, sr: int = SR) -> np.ndarray:
    return np.arange(nsamples(dur, sr), dtype=np.float64) / sr


def white(n: int, rng: np.random.Generator) -> np.ndarray:
    return rng.standard_normal(n)


def pink(n: int, rng: np.random.Generator) -> np.ndarray:
    """Paul Kellet's pink-noise approximation; reads as paper, not hiss."""
    x = rng.standard_normal(n)
    b0 = b1 = b2 = 0.0
    out = np.empty(n)
    for i in range(n):
        w = x[i]
        b0 = 0.99765 * b0 + w * 0.0990460
        b1 = 0.96300 * b1 + w * 0.2965164
        b2 = 0.57000 * b2 + w * 1.0526913
        out[i] = b0 + b1 + b2 + w * 0.1848
    return out * 0.18


def fade_edges(x: np.ndarray, fade_in: float = 0.002, fade_out: float = 0.012, sr: int = SR) -> np.ndarray:
    """Fade the last axis. Works for mono (n,) and stereo (channels, n)."""
    y = x.copy()
    n = y.shape[-1]
    a = min(n // 2, nsamples(fade_in, sr))
    b = min(n // 2, nsamples(fade_out, sr))
    if a > 1:
        y[..., :a] *= np.linspace(0.0, 1.0, a) ** 0.7
    if b > 1:
        y[..., -b:] *= np.linspace(1.0, 0.0, b) ** 1.4
    return y


def ensure_length(x: np.ndarray, n: int) -> np.ndarray:
    if len(x) >= n:
        return x[:n]
    return np.pad(x, (0, n - len(x)))


# --------------------------------------------------------------------------- #
# filters
# --------------------------------------------------------------------------- #

def lp(x: np.ndarray, cutoff: float, order: int = 2, sr: int = SR) -> np.ndarray:
    cutoff = float(np.clip(cutoff, 20.0, sr * 0.47))
    sos = butter(order, cutoff / (sr / 2), btype="lowpass", output="sos")
    return sosfiltfilt(sos, x)


def hp(x: np.ndarray, cutoff: float, order: int = 2, sr: int = SR) -> np.ndarray:
    cutoff = float(np.clip(cutoff, 20.0, sr * 0.47))
    sos = butter(order, cutoff / (sr / 2), btype="highpass", output="sos")
    return sosfiltfilt(sos, x)


def bandpass(x: np.ndarray, lo: float, hi: float, order: int = 2, sr: int = SR) -> np.ndarray:
    lo = float(np.clip(lo, 20.0, sr * 0.46))
    hi = float(np.clip(hi, lo + 50.0, sr * 0.47))
    sos = butter(order, [lo / (sr / 2), hi / (sr / 2)], btype="bandpass", output="sos")
    return sosfiltfilt(sos, x)


def svf(x: np.ndarray, fc, q: float = 0.8, mode: str = "bp", sr: int = SR) -> np.ndarray:
    """Time-varying TPT state-variable filter. `fc` may be a scalar or per-sample array."""
    n = len(x)
    fc_arr = np.full(n, float(fc)) if np.isscalar(fc) else np.asarray(fc, dtype=np.float64)
    fc_arr = np.clip(fc_arr, 30.0, sr * 0.45)
    g = np.tan(np.pi * fc_arr / sr)
    k = 1.0 / max(0.15, q)
    a1 = 1.0 / (1.0 + g * (g + k))
    a2 = g * a1
    a3 = g * a2
    out = np.empty(n)
    ic1 = ic2 = 0.0
    for i in range(n):
        v3 = x[i] - ic2
        v1 = a1[i] * ic1 + a2[i] * v3
        v2 = ic2 + a2[i] * ic1 + a3[i] * v3
        ic1 = 2.0 * v1 - ic1
        ic2 = 2.0 * v2 - ic2
        out[i] = v1 if mode == "bp" else (v2 if mode == "lp" else v3)
    return out


# --------------------------------------------------------------------------- #
# tonal synthesis
# --------------------------------------------------------------------------- #

def modal(
    freq: float,
    dur: float,
    partials,
    tau0: float,
    sr: int = SR,
    detune_cents: float = 0.0,
    rng: np.random.Generator | None = None,
    attack: float = 0.0015,
    pitch_drop_cents: float = 0.0,
) -> np.ndarray:
    """Sum of exponentially decaying sinusoids.

    partials: iterable of (ratio, amplitude, tau_factor).
    detune_cents: split every partial into two slightly detuned copies so the
    tail beats like a real struck object instead of sounding like a synth.
    """
    rng = rng or np.random.default_rng(0)
    n = nsamples(dur, sr)
    t = np.arange(n, dtype=np.float64) / sr
    out = np.zeros(n)
    for ratio, amp, tau_f in partials:
        f0 = freq * ratio
        if f0 >= sr * 0.46 or amp <= 0:
            continue
        tau = max(0.004, tau0 * tau_f)
        env = np.exp(-t / tau)
        if pitch_drop_cents:
            drop = 2.0 ** (-pitch_drop_cents * (1.0 - np.exp(-t / 0.03)) / 1200.0)
            phase = 2 * np.pi * np.cumsum(f0 * drop) / sr
        else:
            phase = 2 * np.pi * f0 * t
        if detune_cents > 0:
            d = 2.0 ** (detune_cents / 1200.0)
            out += amp * 0.5 * env * np.sin(phase + rng.uniform(0, 2 * np.pi))
            out += amp * 0.5 * env * np.sin(phase * d + rng.uniform(0, 2 * np.pi))
        else:
            out += amp * env * np.sin(phase + rng.uniform(0, 2 * np.pi))
    a = nsamples(attack, sr)
    if a > 1:
        out[:a] *= np.linspace(0.0, 1.0, a) ** 0.6
    return out


def noise_strike(dur: float, lo: float, hi: float, rng: np.random.Generator, sr: int = SR,
                 q: float = 0.9, sweep_to: float | None = None) -> np.ndarray:
    n = nsamples(dur, sr)
    src = white(n, rng)
    if sweep_to is None:
        y = bandpass(src, lo, hi, sr=sr)
    else:
        fc = np.geomspace(lo, sweep_to, n)
        y = svf(src, fc, q=q, mode="bp", sr=sr)
    return y


# --------------------------------------------------------------------------- #
# mixing / space
# --------------------------------------------------------------------------- #

def pan_mono(x: np.ndarray, p: float) -> np.ndarray:
    """Equal-power pan of a mono signal. Centre stays mono to save bytes."""
    p = float(np.clip(p, -1.0, 1.0))
    if abs(p) < 1e-6:
        return x
    angle = (p + 1.0) * np.pi / 4.0
    return np.stack([x * np.cos(angle), x * np.sin(angle)])


def mix(events, dur: float | None = None, sr: int = SR) -> np.ndarray:
    """events: iterable of (signal, offset_s, gain, pan).

    Mono signals at pan 0 stay mono; anything panned or already stereo makes the
    whole cue stereo. Longest tail wins unless `dur` is given.
    """
    placed = []
    end = 0.0
    stereo = False
    for sig, at, gain, p in events:
        if sig.ndim == 2:
            st = sig
            stereo = True
        else:
            st = pan_mono(sig, p)
            if st.ndim == 2:
                stereo = True
        start = max(0, nsamples(at, sr))
        end = max(end, start + st.shape[-1])
        placed.append((st, start, float(gain)))
    total = nsamples(dur, sr) if dur else end
    out = np.zeros((2, total)) if stereo else np.zeros(total)
    for st, start, gain in placed:
        stop = min(total, start + st.shape[-1])
        if stop <= start:
            continue
        if st.ndim == 1:
            if stereo:
                out[0, start:stop] += st[: stop - start] * gain
                out[1, start:stop] += st[: stop - start] * gain
            else:
                out[start:stop] += st[: stop - start] * gain
        else:
            out[:, start:stop] += st[:, : stop - start] * gain
    return out


def make_ir(seconds: float = 0.9, decay: float = 3.4, predelay: float = 0.008,
            damp: float = 5200.0, sr: int = SR, seed: int = 7) -> np.ndarray:
    """Small warm room: decorrelated stereo noise tail plus a few early reflections."""
    rng = np.random.default_rng(seed)
    n = nsamples(seconds, sr)
    t = np.arange(n) / sr
    pre = nsamples(predelay, sr)
    chans = []
    for ch in range(2):
        body = rng.standard_normal(n) * np.exp(-decay * t / seconds)
        body = lp(body, damp)
        body[:pre] = 0.0
        for at, g in ((0.011, 0.5), (0.017, 0.36), (0.023, 0.27), (0.031, 0.19)):
            idx = pre + nsamples(at, sr)
            if idx < n:
                body[idx] += g * rng.choice([-1.0, 1.0])
        chans.append(body)
    ir = np.stack(chans)
    ir /= np.sqrt(np.sum(ir ** 2) / 2) + 1e-9
    return ir


def reverb(x: np.ndarray, wet: float, ir: np.ndarray | None = None) -> np.ndarray:
    if wet <= 0:
        return x
    ir = ir if ir is not None else make_ir()
    n = x.shape[-1]
    if x.ndim == 1:
        conv = fftconvolve(x, ir.mean(axis=0), mode="full")[:n]
        return x * (1.0 - wet * 0.35) + conv * wet
    out = x.copy()
    for ch in range(2):
        conv = fftconvolve(x[ch], ir[ch], mode="full")[:n]
        out[ch] = x[ch] * (1.0 - wet * 0.35) + conv * wet
    return out


# --------------------------------------------------------------------------- #
# loudness / export
# --------------------------------------------------------------------------- #

def k_weight(x: np.ndarray) -> np.ndarray:
    """ITU-R BS.1770 K-weighting (48 kHz coefficients)."""
    from scipy.signal import lfilter

    y = lfilter([1.53512485958697, -2.69169618940638, 1.19839281085285],
                [1.0, -1.69065929318241, 0.73248077421585], x)
    y = lfilter([1.0, -2.0, 1.0],
                [1.0, -1.99004745483398, 0.99007225036621], y)
    return y


def onset_rms(x: np.ndarray, window_ms: float = 110.0, sr: int = SR,
              weighted: bool = True) -> float:
    mono = x.mean(axis=0) if x.ndim == 2 else x
    if weighted and len(mono) > 64:
        mono = k_weight(mono)
    w = max(1, int(sr * window_ms / 1000.0))
    if len(mono) <= w:
        return float(np.sqrt(np.mean(mono ** 2) + 1e-12))
    # cumulative energy -> every window's mean square
    c = np.concatenate([[0.0], np.cumsum(mono ** 2)])
    sums = c[w:] - c[:-w]
    return float(np.sqrt(max(np.max(sums) / w, 1e-12)))


def peak(x: np.ndarray) -> float:
    return float(np.max(np.abs(x)) + 1e-12)


def normalize(x: np.ndarray, target_onset_db: float, peak_ceiling_db: float = -1.5) -> np.ndarray:
    """Set the attack's perceived level, then pull back if peaks get too hot."""
    cur = onset_rms(x)
    target = 10 ** (target_onset_db / 20.0)
    y = x * (target / cur)
    ceiling = 10 ** (peak_ceiling_db / 20.0)
    p = peak(y)
    if p > ceiling:
        y *= ceiling / p
    return y


def soft_clip(x: np.ndarray, drive: float = 1.0) -> np.ndarray:
    if drive <= 1.0:
        return x
    return np.tanh(x * drive) / np.tanh(drive)


def to_pcm16(x: np.ndarray, sr: int = SR, out_sr: int = OUT_SR, dither: bool = True,
             rng: np.random.Generator | None = None) -> np.ndarray:
    """Resample, dither, round to int16. Returns shape (channels, n)."""
    rng = rng or np.random.default_rng(11)
    if x.ndim == 1:
        x = x[None, :]
    chans = []
    for ch in range(x.shape[0]):
        y = x[ch]
        if out_sr != sr:
            y = resample_poly(y, out_sr, sr)
        if dither:
            y = y + (rng.random(len(y)) - rng.random(len(y))) / 32768.0
        chans.append(np.clip(np.round(y * 32767.0), -32768, 32767).astype(np.int16))
    n = min(len(c) for c in chans)
    return np.stack([c[:n] for c in chans])


def wav_bytes(int16: np.ndarray, sr: int = OUT_SR) -> bytes:
    import io
    import wave

    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(int16.shape[0])
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(np.ascontiguousarray(int16.T).tobytes())
    return buf.getvalue()
