"""The Memory Anki sound palette — one coherent acoustic family.

Materials, not arbitrary beeps:

    wood    a soft wooden mallet / tongue drum      (interface, structure)
    glass   a tuned glass bell                      (reveal, success)
    felt    a felted piano / celesta                (grading, human voice)
    skin    a muted hand drum                       (landing, denial)
    paper   real CC0 page foley                     (pages, drags, friction)
    air     filtered noise                          (hover, focus, motion)
    metal   a soft cymbal swell + sparkle cluster   (milestones)

Everything is pitched in D major pentatonic so simultaneous sounds never clash.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from scipy.io import wavfile

import dsp
from dsp import SR, bandpass

# --------------------------------------------------------------------------- #
# pitch material
# --------------------------------------------------------------------------- #

NOTES = {
    "G3": 196.00, "A3": 220.00, "B3": 246.94,
    "D4": 293.66, "E4": 329.63, "F#4": 369.99, "A4": 440.00, "B4": 493.88,
    "D5": 587.33, "E5": 659.25, "F#5": 739.99, "A5": 880.00, "B5": 987.77,
    "D6": 1174.66, "E6": 1318.51, "F#6": 1479.98, "A6": 1760.00, "B6": 1975.53,
    "D7": 2349.32,
}
N = NOTES

ROOT = Path(__file__).resolve().parent
SAMPLES = ROOT / "samples"
IR = dsp.make_ir(seconds=0.85, decay=3.2, predelay=0.007, damp=5000.0, seed=7)
IR_LONG = dsp.make_ir(seconds=1.6, decay=2.6, predelay=0.012, damp=4200.0, seed=13)


def rng_for(seed: int) -> np.random.Generator:
    return np.random.default_rng(seed)


# --------------------------------------------------------------------------- #
# voices (all mono)
# --------------------------------------------------------------------------- #

# --------------------------------------------------------------------------- #
# library voices
#
# Every timbre below is a real CC0 recording (Freesound), pitch-shifted by
# varispeed and trimmed. The cue builders only ever ask for a pitch, a length
# and a velocity, so the whole catalogue stays one instrument family.
# --------------------------------------------------------------------------- #

from fractions import Fraction
from scipy.signal import resample_poly

LIB_DIR = SAMPLES / "lib"
_LIB_CACHE: dict[str, np.ndarray] = {}

LIB_BASE = {
    "bell_glass": 1306.0,
    "bell_approve": 1761.0,
    "kalimba": 267.0,
    "marimba": 283.0,
    "wood_lo": 706.0,
    "wood_mid": 704.0,
    "wood_hi": 1239.0,
    "click_tiny": 494.0,
    "click_ui": 494.0,
    "click_soft": 3489.0,
    "blip": 1516.0,
    "thump": 117.0,
}


def src(name: str) -> np.ndarray:
    if name not in _LIB_CACHE:
        _, data = wavfile.read(LIB_DIR / f"{name}.wav")
        _LIB_CACHE[name] = data.astype(np.float64)
    return _LIB_CACHE[name]


def varispeed(x: np.ndarray, ratio: float) -> np.ndarray:
    """Change pitch and length together, like a tape machine."""
    if not np.isfinite(ratio) or ratio <= 0:
        ratio = 1.0
    ratio = float(np.clip(ratio, 0.12, 8.0))
    fr = Fraction(ratio).limit_denominator(400)
    if fr.numerator == fr.denominator:
        return x
    # resample_poly(x, up, down) lengthens by up/down; to play `ratio` times
    # faster (higher and shorter) we must decimate by the ratio.
    return resample_poly(x, fr.denominator, fr.numerator)


def fit(x: np.ndarray, dur: float, fade_out: float = 0.06) -> np.ndarray:
    n = max(1, int(dur * SR))
    if len(x) >= n:
        y = x[:n].copy()
    else:
        y = np.pad(x, (0, n - len(x)))
    fo = int(min(n * 0.45, max(0.008, fade_out) * SR))
    if fo > 1:
        y[-fo:] *= np.linspace(1.0, 0.0, fo) ** 1.4
    return y


def tone(name: str, freq: float, dur: float, vel: float = 1.0,
         lowpass: float | None = None, fade_out: float = 0.08) -> np.ndarray:
    base = LIB_BASE[name]
    x = varispeed(src(name), freq / base)
    x = fit(x, dur, fade_out)
    if lowpass:
        x = dsp.lp(x, lowpass)
    return x * vel


def glass(freq: float, vel: float = 1.0, dur: float = 0.9, bright: float = 1.0,
          seed: int = 1, drop: float = 0.0) -> np.ndarray:
    x = tone("bell_glass", freq, dur, vel, lowpass=4200 + 9000 * min(1.6, bright),
             fade_out=min(0.18, dur * 0.3))
    return dsp.hp(x, 70)


def wood(freq: float = 560.0, vel: float = 1.0, soft: float = 0.0, dur: float = 0.16,
         seed: int = 2) -> np.ndarray:
    name = "wood_hi" if soft > 0.45 else "wood_lo"
    x = tone(name, freq, dur, vel, lowpass=9000 - 4200 * soft, fade_out=0.02)
    return dsp.hp(x, 55)


def felt(freq: float, vel: float = 1.0, dur: float = 1.05, mute: float = 0.0,
         seed: int = 3, bright: float = 1.0) -> np.ndarray:
    x = tone("kalimba", freq, dur, vel, lowpass=6200 - 3800 * mute, fade_out=min(0.25, dur * 0.4))
    return dsp.hp(x, 55)


def skin(f0: float = 95.0, vel: float = 1.0, dur: float = 0.34, mute: float = 0.8,
         seed: int = 4) -> np.ndarray:
    x = tone("thump", f0, dur, vel, lowpass=2800 - 1600 * mute, fade_out=0.09)
    return dsp.hp(x, 32)


def air(dur: float = 0.075, f0: float = 3600.0, f1: float = 6400.0, q: float = 1.15,
        vel: float = 1.0, seed: int = 5, attack: float = 0.006) -> np.ndarray:
    ratio = 0.50 / max(0.02, dur)
    x = varispeed(src("whoosh"), ratio)
    x = fit(x, dur, dur * 0.5)
    x = dsp.hp(x, max(140.0, f0 * 0.35))
    x = dsp.lp(x, min(15500.0, f1 * 1.8))
    a = int(min(len(x) * 0.6, max(0.001, attack) * SR))
    if a > 1:
        x[:a] *= np.linspace(0.0, 1.0, a) ** 0.8
    return x * vel


def sparkle(freq: float = 2400.0, dur: float = 0.5, vel: float = 1.0, seed: int = 6) -> np.ndarray:
    n = max(1, int(dur * SR))
    y = np.zeros(n)
    body = tone("bell_approve", freq, dur, vel, fade_out=min(0.2, dur * 0.4))
    y[: min(n, len(body))] += body[:n]
    tick = tone("blip", freq * 2.0, min(0.12, dur), vel * 0.45, fade_out=0.03)
    y[: min(n, len(tick))] += tick[:n]
    return dsp.hp(y, 220)


def metal(dur: float = 0.9, vel: float = 1.0, seed: int = 7) -> np.ndarray:
    x = varispeed(src("cymbal"), 1.30 / max(0.2, dur))
    x = fit(x, dur, dur * 0.5)
    a = int(len(x) * 0.35)
    if a > 1:
        x[:a] *= np.linspace(0.0, 1.0, a) ** 1.2
    return dsp.hp(x, 2200) * vel


_PAPER_CACHE: dict[str, np.ndarray] = {}


def paper(name: str, vel: float = 1.0, shape: float = 1.0) -> np.ndarray:
    """Real CC0 page foley, cleaned: rumble removed, body tapered."""
    if name not in _PAPER_CACHE:
        path = SAMPLES / f"{name}.wav"
        if not path.exists():
            raise FileNotFoundError(f"run prepare_samples.py first: {path}")
        _, data = wavfile.read(path)
        _PAPER_CACHE[name] = data.astype(np.float64)
    x = _PAPER_CACHE[name].copy()
    x = dsp.hp(x, 140)
    t = np.arange(len(x)) / SR
    # Keep the transient, let the fibre noise settle instead of running flat.
    env = np.minimum(1.0, 0.35 + 0.65 * np.exp(-t / (len(x) / SR * 0.55)))
    return x * env * vel * shape


# --------------------------------------------------------------------------- #
# cue definitions
# --------------------------------------------------------------------------- #

@dataclass
class Cue:
    id: str
    section: str
    name: str
    desc: str
    category: str          # micro | action | milestone
    wet: float = 0.10
    ir_long: bool = False
    build: object = None   # callable -> stereo ndarray
    tags: tuple = field(default_factory=tuple)


def _st(mono: np.ndarray, pan: float = 0.0) -> np.ndarray:
    return dsp.pan_mono(mono, pan)


def _seq(notes, voice, pan_spread=0.0, **kw):
    """notes: iterable of (freq, offset_ms, gain)."""
    events = []
    n = max(1, len(notes))
    for i, (freq, at, gain) in enumerate(notes):
        p = 0.0
        if pan_spread:
            p = ((i / max(1, n - 1)) * 2 - 1) * pan_spread
        events.append((voice(freq, **kw), at / 1000.0, gain, p))
    return dsp.mix(events)


# --- interface -------------------------------------------------------------- #

def ui_click():
    return _st(wood(520, soft=0.0))

def ui_soft():
    return _st(wood(720, soft=0.55))

def ui_toggle_on():
    return dsp.mix([
        (wood(560, soft=0.1), 0, 1.0, -0.05),
        (glass(N["D6"], vel=0.45, dur=0.34, seed=21), 0.035, 0.42, 0.10),
    ])

def ui_toggle_off():
    return dsp.mix([
        (wood(560, soft=0.1), 0, 1.0, 0.05),
        (glass(N["A5"], vel=0.40, dur=0.30, seed=22), 0.032, 0.38, -0.10),
    ])

def ui_paper():
    return _st(paper("paper_turn", vel=0.95))

def ui_swish():
    return dsp.mix([
        (air(0.16, 700, 3000, q=0.9, seed=23), 0.0, 1.0, 0.0),
        (air(0.10, 3000, 1600, q=1.1, seed=24), 0.05, 0.45, 0.12),
    ])

def ui_thud():
    return _st(skin(78, mute=0.92, vel=0.85, seed=25))

def ui_focus():
    return dsp.mix([
        (air(0.055, 3200, 5200, q=1.2, seed=26, attack=0.004), 0, 0.8, 0.0),
        (wood(880, soft=1.0, vel=0.22, seed=27), 0.004, 0.6, 0.0),
    ])

def ui_hover():
    return _st(air(0.035, 4200, 7000, q=1.4, seed=28, attack=0.003), 0.06)

def ui_key():
    x = wood(950, soft=0.85, vel=0.32, dur=0.09, seed=29)
    click = bandpass(dsp.white(len(x), rng_for(30)), 3000, 9000) * np.exp(-dsp.timeline(len(x) / SR) / 0.0025) * 0.12
    return _st(x + click, -0.04)

def ui_menu():
    return dsp.mix([
        (wood(430, soft=0.3, seed=31), 0.0, 1.0, -0.06),
        (wood(520, soft=0.4, seed=32), 0.055, 0.75, 0.06),
    ])

def ui_toolbar():
    return dsp.mix([
        (wood(620, soft=0.2, seed=33), 0, 1.0, 0.0),
        (glass(N["D6"], vel=0.32, dur=0.24, seed=34), 0.040, 0.42, 0.10),
    ])

def ui_nav():
    return dsp.mix([
        (glass(N["D5"], vel=0.55, dur=0.45, seed=35), 0.00, 0.7, -0.20),
        (glass(N["A5"], vel=0.55, dur=0.50, seed=36), 0.075, 0.7, 0.20),
        (air(0.16, 900, 3400, q=0.9, seed=37), 0.00, 0.35, 0.0),
    ])

def ui_mode():
    return dsp.mix([
        (glass(N["D5"], vel=0.5, dur=0.40, seed=38), 0.00, 0.7, -0.18),
        (glass(N["F#5"], vel=0.5, dur=0.45, seed=39), 0.080, 0.7, 0.18),
        (air(0.22, 700, 4200, q=0.8, seed=40), 0.00, 0.40, 0.0),
    ])


# --- cards ------------------------------------------------------------------ #

def card_reveal():
    return dsp.mix([
        (glass(N["D6"], vel=1.0, dur=0.95, seed=41), 0.0, 1.0, 0.0),
        (air(0.10, 2500, 7000, q=1.0, seed=42), 0.0, 0.30, 0.0),
    ])

def card_deal():
    return dsp.mix([
        (wood(700, soft=0.25, seed=43), 0.0, 1.0, 0.05),
        (glass(N["A6"], vel=0.30, dur=0.22, seed=44), 0.028, 0.45, 0.12),
    ])

def card_fold():
    return dsp.mix([
        (glass(N["E5"], vel=0.45, dur=0.34, seed=45, drop=40), 0.0, 0.9, -0.06),
        (paper("paper_flip", vel=0.30), 0.0, 0.35, 0.06),
    ])

def card_remove():
    return dsp.mix([
        (glass(N["A5"], vel=0.55, dur=0.42, seed=46), 0.000, 0.85, 0.10),
        (glass(N["D5"], vel=0.50, dur=0.50, seed=47), 0.070, 0.80, -0.10),
        (paper("paper_flip", vel=0.55), 0.000, 0.55, 0.0),
    ])

def card_lift():
    return dsp.mix([
        (glass(N["D5"], vel=0.40, dur=0.26, seed=48), 0.000, 0.8, -0.08),
        (glass(N["F#5"], vel=0.40, dur=0.30, seed=49), 0.050, 0.8, 0.08),
    ])

def card_select():
    return dsp.mix([
        (glass(N["D6"], vel=0.30, dur=0.20, seed=50), 0.0, 0.7, 0.0),
        (wood(820, soft=0.7, vel=0.35, seed=51), 0.0, 0.5, 0.0),
    ])

def card_unlink():
    return dsp.mix([
        (paper("paper_flip", vel=0.70), 0.0, 0.8, 0.0),
        (skin(140, mute=0.95, vel=0.30, seed=52), 0.0, 0.5, -0.1),
    ])

def card_deny():
    return dsp.mix([
        (skin(92, mute=0.92, vel=0.70, seed=53), 0.0, 0.8, 0.0),
        (glass(N["D4"], vel=0.40, dur=0.40, seed=54, drop=70), 0.0, 0.7, 0.0),
    ])

def card_land():
    return dsp.mix([
        (skin(88, mute=0.85, vel=0.85, seed=55), 0.0, 0.9, 0.0),
        (wood(430, soft=0.3, vel=0.55, seed=56), 0.008, 0.6, 0.06),
    ])

def card_close():
    return dsp.mix([
        (glass(N["D5"], vel=0.85, dur=0.85, seed=57), 0.000, 0.85, -0.12),
        (glass(N["A5"], vel=0.80, dur=0.95, seed=58), 0.090, 0.80, 0.12),
        (glass(N["D6"], vel=0.75, dur=1.20, seed=59), 0.190, 0.75, 0.0),
    ])

def card_undo():
    return dsp.mix([
        (felt(N["A4"], vel=0.55, dur=0.75, mute=0.35, seed=60), 0.00, 0.8, 0.06),
        (felt(N["D4"], vel=0.50, dur=0.85, mute=0.40, seed=61), 0.095, 0.8, -0.06),
    ])


# --- grading ---------------------------------------------------------------- #

def grade_forget():
    return _st(felt(N["D4"], vel=0.85, dur=0.90, mute=0.35, seed=62))

def grade_hard():
    return _st(felt(N["F#4"], vel=0.88, dur=0.95, mute=0.22, seed=63))

def grade_good():
    return _st(felt(N["A4"], vel=0.92, dur=1.00, mute=0.10, seed=64))

def grade_easy():
    return dsp.mix([
        (felt(N["D5"], vel=0.95, dur=1.05, mute=0.0, seed=65), 0.0, 1.0, 0.0),
        (glass(N["D7"], vel=0.18, dur=0.55, seed=66), 0.030, 0.28, 0.0),
    ])

def grade_combo():
    return dsp.mix([
        (glass(N["D5"], vel=0.70, dur=0.70, seed=67), 0.000, 0.80, -0.24),
        (glass(N["A5"], vel=0.70, dur=0.75, seed=68), 0.070, 0.80, 0.02),
        (glass(N["D6"], vel=0.65, dur=0.85, seed=69), 0.140, 0.78, 0.24),
        (sparkle(3200, 0.60, vel=0.35, seed=70), 0.140, 0.45, 0.10),
        (air(0.30, 1200, 6000, q=0.8, seed=71), 0.000, 0.30, 0.0),
    ], dur=1.8)

def grade_landing():
    return dsp.mix([
        (glass(N["D6"], vel=0.28, dur=0.24, seed=72), 0.0, 0.7, 0.0),
        (wood(760, soft=0.8, vel=0.20, seed=73), 0.0, 0.4, 0.0),
    ])


# --- quiz ------------------------------------------------------------------- #

def quiz_select():
    return dsp.mix([
        (wood(820, soft=0.5, vel=0.45, seed=74), 0.0, 0.8, 0.04),
        (glass(N["A6"], vel=0.18, dur=0.16, seed=75), 0.0, 0.35, 0.08),
    ])

def quiz_submit():
    return dsp.mix([
        (wood(600, soft=0.15, vel=0.70, seed=76), 0.000, 0.8, -0.08),
        (glass(N["F#5"], vel=0.35, dur=0.36, seed=77), 0.055, 0.55, 0.06),
        (glass(N["A5"], vel=0.35, dur=0.42, seed=78), 0.108, 0.55, 0.14),
    ])

def quiz_correct():
    return dsp.mix([
        (glass(N["D5"], vel=0.62, dur=0.60, seed=79), 0.000, 0.75, -0.16),
        (glass(N["A5"], vel=0.62, dur=0.72, seed=80), 0.055, 0.75, 0.16),
        (glass(N["D6"], vel=0.55, dur=0.85, seed=81), 0.130, 0.70, 0.0),
        (sparkle(3600, 0.45, vel=0.25, seed=82), 0.130, 0.35, 0.0),
    ], dur=1.35)

def quiz_wrong():
    return dsp.mix([
        (skin(92, mute=0.9, vel=0.75, seed=83), 0.000, 0.85, 0.0),
        (felt(N["B3"], vel=0.45, dur=0.65, mute=0.55, seed=84), 0.015, 0.60, -0.08),
        (felt(N["A3"], vel=0.42, dur=0.75, mute=0.62, seed=85), 0.125, 0.55, 0.08),
    ], dur=1.0)

def quiz_reveal():
    return dsp.mix([
        (paper("paper_flip", vel=0.60), 0.000, 0.55, 0.0),
        (glass(N["E5"], vel=0.42, dur=0.50, seed=86), 0.035, 0.65, -0.10),
        (glass(N["A5"], vel=0.40, dur=0.60, seed=87), 0.105, 0.60, 0.10),
    ], dur=0.9)

def quiz_ai_ready():
    return dsp.mix([
        (glass(N["B4"], vel=0.42, dur=0.45, seed=88), 0.000, 0.65, -0.18),
        (glass(N["D5"], vel=0.42, dur=0.50, seed=89), 0.070, 0.65, 0.00),
        (glass(N["F#5"], vel=0.40, dur=0.60, seed=90), 0.150, 0.62, 0.18),
        (air(0.22, 1800, 5500, q=0.9, seed=91), 0.000, 0.22, 0.0),
    ], dur=1.0)


# --- progress --------------------------------------------------------------- #

def progress_q1():
    return _st(glass(N["D6"], vel=0.32, dur=0.27, seed=92))

def progress_q2():
    return dsp.mix([
        (glass(N["D6"], vel=0.30, dur=0.25, seed=93), 0.000, 0.75, -0.10),
        (glass(N["A6"], vel=0.30, dur=0.27, seed=94), 0.055, 0.72, 0.10),
    ])

def progress_q3():
    return dsp.mix([
        (glass(N["D6"], vel=0.28, dur=0.23, seed=95), 0.000, 0.72, -0.14),
        (glass(N["A6"], vel=0.28, dur=0.25, seed=96), 0.055, 0.70, 0.00),
        (glass(N["D7"], vel=0.26, dur=0.27, seed=97), 0.110, 0.66, 0.14),
    ])

def page_turn():
    return dsp.mix([
        (paper("paper_turn", vel=1.0), 0.0, 1.0, 0.0),
        (air(0.14, 1400, 4800, q=0.8, seed=98), 0.0, 0.18, 0.0),
    ])

def unit_complete():
    return dsp.mix([
        (glass(N["D5"], vel=0.70, dur=0.80, seed=99), 0.000, 0.80, -0.18),
        (glass(N["F#5"], vel=0.68, dur=0.85, seed=100), 0.080, 0.78, 0.00),
        (glass(N["A5"], vel=0.65, dur=0.95, seed=101), 0.160, 0.75, 0.18),
        (glass(N["D6"], vel=0.60, dur=1.25, seed=102), 0.260, 0.72, 0.0),
        (sparkle(2800, 0.55, vel=0.22, seed=103), 0.260, 0.30, 0.0),
    ], dur=1.9)

def round_complete():
    return dsp.mix([
        (skin(70, mute=0.7, vel=0.70, dur=0.55, seed=104), 0.000, 0.55, 0.0),
        (metal(1.5, vel=0.55, seed=105), 0.000, 0.38, 0.0),
        (glass(N["D5"], vel=0.62, dur=1.10, seed=106), 0.000, 0.78, -0.24),
        (glass(N["A5"], vel=0.62, dur=1.20, seed=107), 0.110, 0.78, -0.04),
        (glass(N["D6"], vel=0.60, dur=1.40, seed=108), 0.230, 0.76, 0.20),
        (glass(N["B6"], vel=0.50, dur=1.50, seed=109), 0.360, 0.68, 0.0),
        (glass(N["D7"], vel=0.40, dur=1.60, seed=110), 0.520, 0.58, 0.0),
        (sparkle(3000, 0.90, vel=0.42, seed=111), 0.230, 0.40, 0.0),
        (air(0.70, 800, 8000, q=0.6, seed=112), 0.000, 0.30, 0.0),
    ], dur=2.8)


# --- editing ---------------------------------------------------------------- #

def node_create():
    return dsp.mix([
        (wood(680, soft=0.15, seed=113), 0.000, 0.85, -0.06),
        (glass(N["D6"], vel=0.42, dur=0.50, seed=114), 0.025, 0.60, 0.10),
        (air(0.09, 2200, 6000, q=1.0, seed=115), 0.000, 0.25, 0.0),
    ])

def node_delete():
    return dsp.mix([
        (glass(N["A5"], vel=0.50, dur=0.42, seed=116), 0.000, 0.72, 0.10),
        (glass(N["D5"], vel=0.48, dur=0.52, seed=117), 0.060, 0.70, -0.10),
        (paper("paper_flip", vel=0.42), 0.000, 0.42, 0.0),
    ])

def node_move():
    return dsp.mix([
        (air(0.11, 1200, 4000, q=1.0, seed=118), 0.0, 0.55, -0.10),
        (wood(520, soft=0.55, vel=0.32, seed=119), 0.02, 0.5, 0.10),
    ])

def drag_start():
    return dsp.mix([
        (paper("paper_flip", vel=0.40), 0.0, 0.65, -0.08),
        (air(0.12, 900, 3200, q=0.9, seed=120), 0.0, 0.30, 0.08),
    ])

def drag_drop():
    return dsp.mix([
        (skin(95, mute=0.8, vel=0.75, seed=121), 0.000, 0.85, 0.0),
        (wood(480, soft=0.4, vel=0.42, seed=122), 0.010, 0.55, 0.06),
    ])

def field_commit():
    return dsp.mix([
        (wood(600, soft=0.2, vel=0.55, seed=123), 0.000, 0.7, -0.04),
        (glass(N["F#5"], vel=0.32, dur=0.38, seed=124), 0.040, 0.5, 0.08),
    ])

def save_success():
    return dsp.mix([
        (glass(N["D5"], vel=0.50, dur=0.55, seed=125), 0.000, 0.72, -0.14),
        (glass(N["A5"], vel=0.50, dur=0.65, seed=126), 0.060, 0.72, 0.14),
        (glass(N["D6"], vel=0.45, dur=0.80, seed=127), 0.130, 0.66, 0.0),
    ], dur=1.25)

def import_apply():
    return dsp.mix([
        (paper("paper_sheet", vel=0.55), 0.000, 0.55, 0.0),
        (glass(N["D4"], vel=0.50, dur=0.70, seed=128), 0.000, 0.70, -0.22),
        (glass(N["A4"], vel=0.50, dur=0.75, seed=129), 0.095, 0.70, 0.00),
        (glass(N["D5"], vel=0.48, dur=0.85, seed=130), 0.180, 0.68, 0.22),
        (glass(N["A5"], vel=0.42, dur=0.95, seed=131), 0.265, 0.60, 0.0),
    ], dur=1.6)

def category_expand():
    return dsp.mix([
        (glass(N["E5"], vel=0.42, dur=0.40, seed=132), 0.000, 0.68, -0.12),
        (glass(N["A5"], vel=0.42, dur=0.48, seed=133), 0.060, 0.68, 0.12),
        (air(0.12, 1400, 5000, q=0.9, seed=134), 0.000, 0.22, 0.0),
    ])

def branch_clear():
    return dsp.mix([
        (glass(N["D5"], vel=0.60, dur=0.85, seed=135), 0.000, 0.78, -0.22),
        (glass(N["A5"], vel=0.58, dur=0.95, seed=136), 0.080, 0.76, 0.0),
        (glass(N["D6"], vel=0.52, dur=1.10, seed=137), 0.170, 0.72, 0.22),
        (sparkle(2900, 0.60, vel=0.26, seed=138), 0.170, 0.32, 0.0),
    ], dur=1.8)

def all_clear():
    return dsp.mix([
        (glass(N["D5"], vel=0.55, dur=0.90, seed=139), 0.000, 0.74, -0.26),
        (glass(N["F#5"], vel=0.55, dur=1.00, seed=140), 0.080, 0.74, 0.00),
        (glass(N["A5"], vel=0.55, dur=1.10, seed=141), 0.160, 0.74, 0.26),
        (glass(N["D6"], vel=0.50, dur=1.30, seed=142), 0.260, 0.70, 0.0),
        (glass(N["D7"], vel=0.36, dur=1.40, seed=143), 0.360, 0.58, 0.0),
        (metal(1.2, vel=0.45, seed=144), 0.000, 0.28, 0.0),
        (sparkle(3200, 0.80, vel=0.34, seed=145), 0.260, 0.36, 0.0),
    ], dur=2.3)

def session_complete():
    return dsp.mix([
        (skin(64, mute=0.6, vel=0.65, dur=0.70, seed=146), 0.000, 0.48, 0.0),
        (metal(2.0, vel=0.60, seed=147), 0.000, 0.32, 0.0),
        (glass(N["D4"], vel=0.55, dur=1.10, seed=148), 0.000, 0.72, -0.30),
        (glass(N["D5"], vel=0.58, dur=1.20, seed=149), 0.120, 0.76, -0.10),
        (glass(N["A5"], vel=0.58, dur=1.35, seed=150), 0.240, 0.76, 0.10),
        (glass(N["D6"], vel=0.55, dur=1.55, seed=151), 0.380, 0.74, 0.30),
        (glass(N["B6"], vel=0.46, dur=1.70, seed=152), 0.520, 0.64, 0.0),
        (glass(N["D7"], vel=0.38, dur=1.80, seed=153), 0.660, 0.56, 0.0),
        (sparkle(2600, 1.10, vel=0.40, seed=154), 0.300, 0.38, 0.0),
        (air(0.90, 600, 9000, q=0.6, seed=155), 0.000, 0.28, 0.0),
    ], dur=3.2)

def firework():
    return dsp.mix([
        (air(0.35, 300, 9000, q=0.6, seed=156), 0.000, 0.45, 0.0),
        (skin(60, mute=0.55, vel=0.55, dur=0.55, seed=157), 0.090, 0.40, 0.0),
        (sparkle(3400, 1.00, vel=0.55, seed=158), 0.110, 0.50, 0.20),
        (sparkle(2200, 1.20, vel=0.40, seed=159), 0.170, 0.42, -0.20),
        (glass(N["D6"], vel=0.40, dur=1.20, seed=160), 0.110, 0.55, 0.0),
        (glass(N["A6"], vel=0.34, dur=1.10, seed=161), 0.200, 0.45, 0.0),
    ], dur=2.2)


# --- errors ----------------------------------------------------------------- #

def error_missing():
    return dsp.mix([
        (wood(360, soft=0.75, vel=0.40, seed=162), 0.000, 0.7, 0.0),
        (felt(N["D4"], vel=0.28, dur=0.40, mute=0.7, seed=163), 0.030, 0.5, 0.0),
    ])

def error_ai():
    return dsp.mix([
        (felt(N["A3"], vel=0.42, dur=0.75, mute=0.55, seed=164), 0.000, 0.70, -0.06),
        (felt(N["F#3"] if "F#3" in N else 185.00, vel=0.40, dur=0.85, mute=0.62, seed=165), 0.135, 0.65, 0.06),
        (air(0.18, 900, 2600, q=1.0, seed=166), 0.000, 0.16, 0.0),
    ], dur=1.1)

def error_persist():
    return dsp.mix([
        (skin(80, mute=0.95, vel=0.60, seed=167), 0.000, 0.75, 0.0),
        (paper("paper_flip", vel=0.30), 0.020, 0.35, 0.0),
        (felt(N["G3"], vel=0.30, dur=0.55, mute=0.7, seed=168), 0.010, 0.45, 0.0),
    ], dur=0.9)

def error_stat():
    return dsp.mix([
        (wood(420, soft=0.65, vel=0.42, seed=169), 0.000, 0.75, 0.0),
        (glass(N["D4"], vel=0.22, dur=0.28, seed=170, drop=90), 0.030, 0.45, 0.0),
    ])


# --------------------------------------------------------------------------- #
# A/B directions for the identity sounds
# --------------------------------------------------------------------------- #

def b_click():
    """琉璃方向：一记高而薄的双音玻璃点。"""
    return dsp.mix([
        (tone("blip", N["A6"], 0.16, 0.9, lowpass=16000), 0.0, 0.9, -0.06),
        (air(0.05, 5000, 10000, q=1.2, seed=202), 0.0, 0.28, 0.06),
    ])

def b_reveal():
    """琉璃方向：更亮、更宽、更长的玻璃钟。"""
    return dsp.mix([
        (tone("bell_approve", N["A6"], 1.45, 0.85, lowpass=16000), 0.0, 1.0, 0.0),
        (tone("bell_glass", N["D7"], 1.20, 0.34, lowpass=17000), 0.085, 0.55, 0.20),
        (metal(1.1, 0.32, seed=205), 0.0, 0.20, 0.0),
    ], dur=1.8)

def b_grade_good():
    """琉璃方向：评分不用毛毡，改成一只温润的玻璃钟。"""
    return dsp.mix([
        (tone("bell_glass", N["A4"], 1.30, 0.80, lowpass=14000), 0.0, 0.92, 0.0),
        (tone("bell_glass", N["E5"], 1.10, 0.40, lowpass=15000), 0.080, 0.50, 0.10),
    ], dur=1.6)

def b_success():
    """琉璃方向：三音玻璃，混响更宽。"""
    return dsp.mix([
        (tone("bell_glass", N["D5"], 1.00, 0.70), 0.000, 0.78, -0.18),
        (tone("bell_glass", N["A5"], 1.15, 0.70), 0.070, 0.78, 0.18),
        (tone("bell_approve", N["D6"], 1.55, 0.62), 0.150, 0.70, 0.0),
        (metal(1.0, 0.26, seed=211), 0.000, 0.16, 0.0),
    ], dur=2.0)

def c_click():
    """极简方向：一只极短、极干的电子 tick。"""
    t = dsp.timeline(0.045)
    tick = np.sin(2 * np.pi * 1900 * t) * np.exp(-t / 0.006)
    click = dsp.bandpass(dsp.white(len(t), rng_for(212)), 3000, 8000) * np.exp(-t / 0.002) * 0.18
    return _st((tick + click) * 0.7, 0.0)

def c_reveal():
    """极简方向：两音 blip，无尾音。"""
    return dsp.mix([
        (tone("blip", N["D6"], 0.10, 1.0, fade_out=0.03), 0.000, 0.95, 0.0),
        (tone("blip", N["A6"], 0.08, 0.7, fade_out=0.03), 0.035, 0.60, 0.0),
    ])

def c_grade_good():
    """极简方向：干净拨弦，120ms 收掉。"""
    return _st(tone("click_soft", N["A4"], 0.20, 1.0, fade_out=0.05), 0.0)

def c_success():
    """极简方向：三音琶音，无混响。"""
    return dsp.mix([
        (tone("blip", N["D5"], 0.09, 0.9, fade_out=0.02), 0.000, 0.85, -0.1),
        (tone("blip", N["A5"], 0.09, 0.9, fade_out=0.02), 0.070, 0.85, 0.1),
        (tone("blip", N["D6"], 0.10, 0.8, fade_out=0.02), 0.140, 0.75, 0.0),
    ], dur=0.4)


# --------------------------------------------------------------------------- #
# catalogue
# --------------------------------------------------------------------------- #

def _cue(id, section, name, desc, category, build, wet=0.10, ir_long=False, tags=()):
    return Cue(id=id, section=section, name=name, desc=desc, category=category,
               wet=wet, ir_long=ir_long, build=build, tags=tags)


CUES: list[Cue] = [
    # interface
    _cue("ui.click", "ui", "按钮 · 单击", "木槌轻叩，应用里出现最多的一记", "micro", ui_click, 0.06),
    _cue("ui.soft", "ui", "标签 · 切换", "更轻更圆的木击，不抢注意力", "micro", ui_soft, 0.06),
    _cue("ui.toggle.on", "ui", "开关 · 打开", "木击后跟一个上行玻璃音", "micro", ui_toggle_on, 0.09),
    _cue("ui.toggle.off", "ui", "开关 · 关闭", "木击后跟一个下行玻璃音", "micro", ui_toggle_off, 0.09),
    _cue("ui.paper", "ui", "纸张 · 翻动", "真实纸张摩擦（CC0 录音）", "micro", ui_paper, 0.05),
    _cue("ui.swish", "ui", "划动 · 轻扫", "短促气流，用于滑动与切换", "micro", ui_swish, 0.06),
    _cue("ui.thud", "ui", "背景 · 闷响", "低软的落垫，用于弹层与遮罩", "micro", ui_thud, 0.05),
    _cue("ui.focus", "ui", "输入 · 聚焦", "极轻的一口气", "micro", ui_focus, 0.04),
    _cue("ui.hover", "ui", "悬停 · 掠过", "几乎只够察觉", "micro", ui_hover, 0.02),
    _cue("ui.key", "ui", "键盘 · 按键", "打字机的轻响", "micro", ui_key, 0.03),
    _cue("ui.menu", "ui", "右键 · 菜单", "两声木击，第二声更轻", "micro", ui_menu, 0.06),
    _cue("ui.toolbar", "ui", "工具条 · 动作", "木击加一记玻璃点", "micro", ui_toolbar, 0.08),
    _cue("ui.nav", "ui", "页面 · 导航", "玻璃两音带气流，方向向上", "action", ui_nav, 0.14),
    _cue("ui.mode", "ui", "模式 · 切换", "玻璃上行双音，比导航更宽", "action", ui_mode, 0.16),

    # cards
    _cue("card.reveal", "cards", "翻卡 · 揭示", "玻璃钟，整套声音的签名音", "action", card_reveal, 0.16),
    _cue("card.deal", "cards", "发牌", "木击先落，玻璃随后点亮", "micro", card_deal, 0.10),
    _cue("card.fold", "cards", "收起", "短促下行，尾音收得快", "micro", card_fold, 0.08),
    _cue("card.remove", "cards", "移除", "下行玻璃加一点纸张撕裂", "action", card_remove, 0.10),
    _cue("card.lift", "cards", "上提", "两记上行短玻璃，轻而快", "micro", card_lift, 0.09),
    _cue("card.select", "cards", "选中", "一记玻璃点，几乎不占空间", "micro", card_select, 0.06),
    _cue("card.unlink", "cards", "断边", "纸张断开，低频只做垫底", "micro", card_unlink, 0.06),
    _cue("card.deny", "cards", "无效操作", "闷住的下行钟，不惩罚耳朵", "micro", card_deny, 0.08),
    _cue("card.land", "cards", "落定", "软鼓加木击，像东西放稳了", "action", card_land, 0.08),
    _cue("card.close", "cards", "单元收尾", "玻璃五度上行，长尾告诉耳朵结束了", "action", card_close, 0.20),
    _cue("card.undo", "cards", "撤销评分", "下行毛毡音，把刚才那一下收回来", "micro", card_undo, 0.09),

    # grading
    _cue("grade.forget", "grade", "评分 · 忘记", "毛毡 D4，最短最暗", "action", grade_forget, 0.10),
    _cue("grade.hard", "grade", "评分 · 困难", "毛毡 F#4", "action", grade_hard, 0.10),
    _cue("grade.good", "grade", "评分 · 良好", "毛毡 A4", "action", grade_good, 0.10),
    _cue("grade.easy", "grade", "评分 · 简单", "毛毡 D5，另加一层极轻的玻璃", "action", grade_easy, 0.13),
    _cue("grade.combo", "grade", "连击里程碑", "玻璃琶音加闪光，连击越高越亮", "action", grade_combo, 0.20),
    _cue("grade.landing", "grade", "进度落点", "极短玻璃叮，评分后落在进度条上", "micro", grade_landing, 0.07),

    # quiz
    _cue("quiz.select", "quiz", "选项 · 选中", "木击加一点玻璃尖", "micro", quiz_select, 0.06),
    _cue("quiz.submit", "quiz", "提交 · 作答", "两音上行，表示答案交出去了", "action", quiz_submit, 0.11),
    _cue("quiz.correct", "quiz", "答对", "D 与 A 的五度，再亮到高八度", "action", quiz_correct, 0.18),
    _cue("quiz.wrong", "quiz", "答错", "软鼓与毛毡下行，不刺耳", "action", quiz_wrong, 0.10),
    _cue("quiz.reveal", "quiz", "查看答案", "纸张掀开，玻璃两音跟上", "action", quiz_reveal, 0.11),
    _cue("quiz.ai.ready", "quiz", "AI 反馈就绪", "三音上行加一层气", "action", quiz_ai_ready, 0.14),

    # progress
    _cue("progress.q1", "progress", "进度 25%", "一记玻璃叮", "micro", progress_q1, 0.07),
    _cue("progress.q2", "progress", "进度 50%", "两记，音高上一级", "micro", progress_q2, 0.07),
    _cue("progress.q3", "progress", "进度 75%", "三记，音高再上一级", "micro", progress_q3, 0.07),
    _cue("page.turn", "progress", "翻页", "真实翻页声", "action", page_turn, 0.06),
    _cue("unit.complete", "progress", "单元完成", "四音琶音，单元的门关上了", "action", unit_complete, 0.20),
    _cue("round.complete", "progress", "本轮完成", "低鼓、铜片、琶音一起落下", "milestone", round_complete, 0.24, True),

    # editing
    _cue("node.create", "edit", "新建节点", "木击起头，玻璃点亮", "action", node_create, 0.10),
    _cue("node.delete", "edit", "删除节点", "下行玻璃，纸张在下面", "action", node_delete, 0.09),
    _cue("node.move", "edit", "移动节点", "几乎没有音高，只有一点气流", "micro", node_move, 0.05),
    _cue("drag.start", "edit", "开始拖拽", "纸被捏起来", "micro", drag_start, 0.05),
    _cue("drag.drop", "edit", "拖拽落定", "软鼓，东西放下了", "action", drag_drop, 0.08),
    _cue("field.commit", "edit", "输入提交", "木击加玻璃三度", "micro", field_commit, 0.08),
    _cue("save.success", "edit", "保存成功", "三音上行，最短的成功句", "action", save_success, 0.14),
    _cue("import.apply", "edit", "导入应用", "纸张铺开，四音一路向上", "action", import_apply, 0.18),
    _cue("category.expand", "edit", "展开分类", "两音上行，带一点气", "action", category_expand, 0.11),
    _cue("branch.clear", "edit", "分支清空", "三音琶音，分支被收干净", "milestone", branch_clear, 0.20),
    _cue("all.clear", "edit", "全清就绪", "五音琶音加铜片，比分支更大", "milestone", all_clear, 0.24, True),
    _cue("session.complete", "edit", "会话完成", "整套庆典：低鼓、琶音、闪光", "milestone", session_complete, 0.26, True),
    _cue("firework", "edit", "礼花", "气流冲高，闪光散开", "milestone", firework, 0.20),

    # errors
    _cue("error.missing", "error", "缺少输入", "一记偏低的木击，点到为止", "micro", error_missing, 0.06),
    _cue("error.ai", "error", "AI 失败", "毛毡下行，有点空，但不吓人", "action", error_ai, 0.10),
    _cue("error.persist", "error", "保存失败", "闷鼓加一点纸声", "action", error_persist, 0.08),
    _cue("error.stat", "error", "统计失败", "木击后一记很短的下行", "micro", error_stat, 0.06),

    # directions
    _cue("cmp.click", "compare", "方向 A · 单击", "当前方案：木质", "micro", ui_click, 0.06),
    _cue("cmp.reveal", "compare", "方向 A · 揭示", "当前方案：玻璃钟", "action", card_reveal, 0.16),
    _cue("cmp.grade", "compare", "方向 A · 评分", "当前方案：毛毡", "action", grade_good, 0.10),
    _cue("cmp.success", "compare", "方向 A · 成功", "当前方案：三音玻璃", "action", save_success, 0.14),
    _cue("cmp2.click", "compare", "方向 B · 单击", "琉璃：更亮、更薄", "micro", b_click, 0.12),
    _cue("cmp2.reveal", "compare", "方向 B · 揭示", "琉璃：长尾、宽混响", "action", b_reveal, 0.30, True),
    _cue("cmp2.grade", "compare", "方向 B · 评分", "琉璃：玻璃代替毛毡", "action", b_grade_good, 0.24, True),
    _cue("cmp2.success", "compare", "方向 B · 成功", "琉璃：更宽的成功句", "action", b_success, 0.30, True),
    _cue("cmp3.click", "compare", "方向 C · 单击", "极简：干脆的电子 tick", "micro", c_click, 0.02),
    _cue("cmp3.reveal", "compare", "方向 C · 揭示", "极简：两音 blip", "action", c_reveal, 0.03),
    _cue("cmp3.grade", "compare", "方向 C · 评分", "极简：干净拨弦", "action", c_grade_good, 0.02),
    _cue("cmp3.success", "compare", "方向 C · 成功", "极简：三音琶音，无尾音", "action", c_success, 0.02),
]


# Loudness targets (attack RMS, dBFS) by category. Clicks sit lower than bells
# because a 50 ms tick and a 900 ms ring are not heard at the same RMS.
TARGETS = {"micro": -31.0, "action": -27.0, "milestone": -23.0}


def render_cue(cue: Cue) -> np.ndarray:
    x = cue.build()
    x = dsp.hp(x, 38)
    x = dsp.reverb(x, cue.wet, IR_LONG if cue.ir_long else IR)
    x = dsp.normalize(x, TARGETS[cue.category])
    # trim digital silence at the tail so files stay small
    mono = np.max(np.abs(x), axis=0) if x.ndim == 2 else np.abs(x)
    floor = 10 ** (-60 / 20)
    above = np.flatnonzero(mono > floor)
    if len(above):
        end = min(x.shape[-1], above[-1] + int(0.02 * SR))
        x = x[..., :end]
    return x
