"""Jelly / juicy game-feedback directions.

The character comes from three things:
  * a pitch bend on every body note (the "boing" of a soft object),
  * a tiny wet squish under the attack (so it reads as jelly, not a beep),
  * a soft sub and a very quiet sparkle for weight and shine.
Everything is low-passed to keep it from getting sharp.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from fractions import Fraction
from pathlib import Path

import numpy as np
from scipy.io import wavfile
from scipy.signal import resample_poly

import dsp

SR = dsp.SR
ROOT = Path(__file__).resolve().parent
LIB = ROOT / "samples" / "lib"
IR_SHORT = dsp.make_ir(0.8, 3.2, 0.006, 5000, seed=41)
IR_LONG = dsp.make_ir(1.6, 2.6, 0.012, 3800, seed=42)

_cache: dict[str, np.ndarray] = {}


def src(name: str) -> np.ndarray:
    if name not in _cache:
        path = LIB / f"{name}.wav"
        if not path.exists():
            path = ROOT / "samples" / f"{name}.wav"
        _, d = wavfile.read(path)
        _cache[name] = d.astype(np.float64)
    return _cache[name]


def cut(x: np.ndarray, dur: float, fade_out: float = 0.03) -> np.ndarray:
    n = max(1, int(dur * SR))
    y = x[:n].copy() if len(x) >= n else np.pad(x, (0, n - len(x)))
    fo = int(min(n * 0.5, max(0.006, fade_out) * SR))
    if fo > 1:
        y[-fo:] *= np.linspace(1, 0, fo) ** 1.4
    return y


def bend(name: str, r0: float, r1: float, dur: float, tau: float = 0.04,
         wobble: float = 0.0, wob_hz: float = 8.5, hp: float | None = None,
         lp: float | None = None, gain: float = 1.0) -> np.ndarray:
    """Read a one-shot at a time-varying rate: the body of a squishy bounce."""
    x = src(name)
    n = max(1, int(dur * SR))
    t = np.arange(n) / SR
    r = r1 + (r0 - r1) * np.exp(-t / max(0.005, tau))
    if wobble:
        r = r * (1.0 + wobble * np.sin(2 * np.pi * wob_hz * t)
                 * np.exp(-t / max(0.05, dur) * 1.6))
    pos = np.cumsum(r)
    if pos[-1] > len(x) - 2:
        pos *= (len(x) - 2) / pos[-1]
    y = np.interp(pos, np.arange(len(x)), x)
    a = int(0.004 * SR)
    if a > 1:
        y[:a] *= np.linspace(0, 1, a) ** 0.8
    if hp:
        y = dsp.hp(y, hp)
    if lp:
        y = dsp.lp(y, lp)
    return y * gain


def sub(f: float = 92.0, dur: float = 0.09, gain: float = 0.45) -> np.ndarray:
    t = dsp.timeline(dur)
    ft = f * (0.78 + 0.45 * np.exp(-t / 0.018))
    ph = 2 * np.pi * np.cumsum(ft) / SR
    return np.sin(ph) * np.exp(-t / 0.040) * gain


def squish(dur: float = 0.035, gain: float = 0.18, lp: float = 1500.0) -> np.ndarray:
    y = cut(src("slime"), dur, 0.01)
    return dsp.hp(dsp.lp(y, lp), 220) * gain


def spark(name: str = "waterdrop", dur: float = 0.18, gain: float = 0.14,
          lp: float = 6500.0, r: float = 1.0) -> np.ndarray:
    y = src(name)
    if abs(r - 1) > 1e-4:
        fr = Fraction(r).limit_denominator(200)
        y = resample_poly(y, fr.denominator, fr.numerator)
    return dsp.lp(cut(y, dur, 0.05), lp) * gain


def m(*events, dur: float | None = None) -> np.ndarray:
    return dsp.mix(events, dur=dur)


@dataclass
class Cue:
    id: str
    name: str
    target: float
    build: object


@dataclass
class Feel:
    id: str
    name: str
    tagline: str
    bullets: tuple
    wet: float
    long_ir: bool
    lowpass: float
    cues: list = field(default_factory=list)


# --------------------------------------------------------------------------- #
# F · 果冻泡泡 — round pops with an upward bend
# --------------------------------------------------------------------------- #

def f_click():
    return m((cut(src("pop9"), 0.10, 0.02), 0.000, 0.9, 0.0),
             (squish(0.022, 0.10), 0.000, 1.0, 0.0),
             (sub(98, 0.06, 0.28), 0.000, 1.0, 0.0))

def f_reveal():
    return m((bend("marimba", 1.24, 0.97, 0.34, tau=0.030, lp=6500), 0.000, 0.9, 0.0),
             (cut(src("pop5"), 0.12, 0.03), 0.010, 0.55, 0.10),
             (squish(0.030, 0.14), 0.000, 1.0, 0.0))

def f_grade():
    return m((bend("marimba", 1.06, 0.94, 0.42, tau=0.045, wobble=0.010, lp=5200), 0.000, 0.95, 0.0),
             (sub(92, 0.08, 0.30), 0.000, 1.0, 0.0))

def f_correct():
    return m((bend("marimba", 1.10, 1.00, 0.40, tau=0.03, lp=5600), 0.000, 0.9, -0.10),
             (bend("marimba", 1.24, 1.12, 0.42, tau=0.03, lp=5600), 0.085, 0.8, 0.10),
             (spark("waterdrop", 0.22, 0.20, r=1.15), 0.060, 1.0, 0.0),
             (sub(92, 0.07, 0.22), 0.000, 1.0, 0.0))

def f_wrong():
    return m((bend("marimba", 0.86, 0.72, 0.40, tau=0.05, lp=1400), 0.000, 0.9, 0.0),
             (squish(0.055, 0.22, 1100), 0.010, 1.0, 0.0),
             (sub(74, 0.10, 0.25), 0.000, 1.0, 0.0))

def f_success():
    return m((bend("marimba", 1.00, 0.94, 0.38, tau=0.03, lp=6000), 0.000, 0.85, -0.14),
             (bend("marimba", 1.18, 1.08, 0.40, tau=0.03, lp=6000), 0.080, 0.80, 0.00),
             (bend("marimba", 1.33, 1.20, 0.44, tau=0.03, lp=6000), 0.160, 0.75, 0.14),
             (cut(src("pop5"), 0.12, 0.03), 0.000, 0.45, 0.0),
             (sub(92, 0.08, 0.22), 0.000, 1.0, 0.0))

def f_unit():
    return m((bend("marimba", 0.94, 0.90, 0.42, tau=0.03, lp=6000), 0.000, 0.80, -0.18),
             (bend("marimba", 1.10, 1.02, 0.44, tau=0.03, lp=6000), 0.080, 0.78, 0.00),
             (bend("marimba", 1.24, 1.12, 0.46, tau=0.03, lp=6000), 0.160, 0.74, 0.18),
             (bend("marimba", 1.45, 1.30, 0.50, tau=0.03, lp=6200), 0.240, 0.68, 0.0),
             (spark("waterdrop", 0.25, 0.16, r=1.3), 0.240, 1.0, 0.0),
             (sub(88, 0.10, 0.25), 0.000, 1.0, 0.0))

def f_milestone():
    return m((bend("boing", 1.15, 0.86, 0.55, tau=0.06, wobble=0.02, lp=4200), 0.000, 0.55, 0.0),
             (cut(src("pop5"), 0.14, 0.03), 0.000, 0.65, -0.12),
             (bend("marimba", 1.10, 1.02, 0.45, tau=0.03, lp=6000), 0.070, 0.72, 0.0),
             (bend("marimba", 1.24, 1.12, 0.48, tau=0.03, lp=6000), 0.150, 0.68, 0.14),
             (bend("marimba", 1.45, 1.30, 0.52, tau=0.03, lp=6200), 0.230, 0.62, 0.0),
             (squish(0.050, 0.20, 1200), 0.000, 1.0, 0.0),
             (sub(82, 0.14, 0.30), 0.000, 1.0, 0.0), dur=1.2)


# --------------------------------------------------------------------------- #
# G · 软糖木琴 — kalimba body, warm and round
# --------------------------------------------------------------------------- #

def g_click():
    return m((cut(src("pop9"), 0.10, 0.02), 0.000, 0.85, 0.0),
             (squish(0.022, 0.09, 1300), 0.000, 1.0, 0.0),
             (sub(100, 0.06, 0.16), 0.000, 1.0, 0.0))

def g_reveal():
    return m((bend("kalimba", 1.14, 0.96, 0.55, tau=0.035, wobble=0.008, lp=4400), 0.000, 0.95, 0.0),
             (cut(src("pop5"), 0.12, 0.03), 0.015, 0.40, 0.08),
             (squish(0.028, 0.12, 1300), 0.000, 1.0, 0.0))

def g_grade():
    return m((bend("kalimba", 1.02, 0.92, 0.50, tau=0.05, wobble=0.010, lp=5200), 0.000, 0.95, 0.0),
             (bend("kalimba", 2.04, 1.84, 0.30, tau=0.03, lp=5200), 0.000, 0.16, 0.10),
             (cut(src("pop9"), 0.08, 0.02), 0.000, 0.22, 0.0),
             (sub(90, 0.08, 0.18), 0.000, 1.0, 0.0))

def g_correct():
    return m((bend("kalimba", 1.00, 0.94, 0.48, tau=0.03, lp=5200), 0.000, 0.9, -0.10),
             (bend("kalimba", 1.26, 1.14, 0.50, tau=0.03, lp=5200), 0.090, 0.8, 0.10),
             (bend("kalimba", 2.00, 1.88, 0.28, tau=0.03, lp=5200), 0.000, 0.14, 0.0),
             (spark("waterdrop", 0.16, 0.14, r=1.2), 0.060, 1.0, 0.0),
             (sub(90, 0.07, 0.14), 0.000, 1.0, 0.0))

def g_wrong():
    return m((bend("kalimba", 0.84, 0.70, 0.42, tau=0.05, lp=1200), 0.000, 0.9, 0.0),
             (squish(0.050, 0.20, 1000), 0.010, 1.0, 0.0),
             (sub(72, 0.11, 0.18), 0.000, 1.0, 0.0))

def g_success():  # presence layer keeps it from going muddy
    return m((bend("kalimba", 0.94, 0.90, 0.45, tau=0.03, lp=4400), 0.000, 0.85, -0.14),
             (bend("kalimba", 1.10, 1.02, 0.48, tau=0.03, lp=4400), 0.085, 0.80, 0.0),
             (bend("kalimba", 1.26, 1.14, 0.52, tau=0.03, lp=5200), 0.170, 0.74, 0.14),
             (bend("kalimba", 2.00, 1.88, 0.30, tau=0.03, lp=5200), 0.000, 0.13, 0.0),
             (cut(src("pop5"), 0.12, 0.03), 0.000, 0.40, 0.0),
             (sub(90, 0.08, 0.14), 0.000, 1.0, 0.0))

def g_unit():  # presence layer keeps it from going muddy
    return m((bend("kalimba", 0.88, 0.84, 0.50, tau=0.03, lp=4400), 0.000, 0.80, -0.18),
             (bend("kalimba", 1.02, 0.96, 0.52, tau=0.03, lp=4400), 0.085, 0.78, 0.0),
             (bend("kalimba", 1.14, 1.06, 0.54, tau=0.03, lp=4400), 0.170, 0.74, 0.18),
             (bend("kalimba", 1.34, 1.22, 0.58, tau=0.03, lp=5200), 0.255, 0.68, 0.0),
             (bend("kalimba", 2.00, 1.88, 0.34, tau=0.03, lp=5200), 0.000, 0.12, 0.0),
             (spark("waterdrop", 0.22, 0.12, r=1.2), 0.255, 1.0, 0.0),
             (sub(86, 0.10, 0.16), 0.000, 1.0, 0.0))

def g_milestone():  # presence layer keeps it from going muddy
    return m((bend("boing", 1.05, 0.82, 0.60, tau=0.06, wobble=0.018, lp=3600), 0.000, 0.50, 0.0),
             (bend("kalimba", 0.94, 0.90, 0.50, tau=0.03, lp=4400), 0.000, 0.72, -0.14),
             (bend("kalimba", 1.10, 1.02, 0.54, tau=0.03, lp=4400), 0.090, 0.70, 0.0),
             (bend("kalimba", 1.26, 1.14, 0.58, tau=0.03, lp=4400), 0.180, 0.66, 0.16),
             (bend("kalimba", 1.48, 1.34, 0.62, tau=0.03, lp=5200), 0.270, 0.60, 0.0),
             (bend("kalimba", 2.00, 1.88, 0.36, tau=0.03, lp=5200), 0.000, 0.12, 0.0),
             (squish(0.050, 0.18, 1100), 0.000, 1.0, 0.0),
             (sub(82, 0.14, 0.18), 0.000, 1.0, 0.0), dur=1.3)


# --------------------------------------------------------------------------- #
# H · 弹跳合成 — Kenney plucks with a hard bend, gamey but filtered
# --------------------------------------------------------------------------- #

def h_click():
    return m((bend("k_pluck", 1.38, 1.00, 0.14, tau=0.02, lp=7000), 0.000, 0.9, 0.0),
             (sub(96, 0.05, 0.24), 0.000, 1.0, 0.0))

def h_reveal():
    return m((bend("k_pluck", 1.30, 1.00, 0.24, tau=0.025, lp=7000), 0.000, 0.9, 0.0),
             (cut(src("d_two1"), 0.30, 0.05), 0.010, 0.45, 0.0),
             (sub(94, 0.07, 0.28), 0.000, 1.0, 0.0))

def h_grade():
    return m((bend("k_glass", 1.22, 1.00, 0.18, tau=0.03, lp=6500), 0.000, 0.9, 0.0),
             (sub(90, 0.06, 0.22), 0.000, 1.0, 0.0))

def h_correct():
    return m((bend("k_confirm", 1.06, 1.00, 0.45, tau=0.04, lp=7500), 0.000, 0.85, -0.10),
             (bend("k_pluck", 1.30, 1.10, 0.20, tau=0.03, lp=7000), 0.080, 0.60, 0.10),
             (sub(92, 0.07, 0.20), 0.000, 1.0, 0.0))

def h_wrong():
    return m((cut(src("d_lowdown"), 0.55, 0.10), 0.000, 0.85, 0.0),
             (squish(0.040, 0.22, 1600), 0.010, 1.0, 0.0),
             (spark("pop9", 0.06, 0.18, r=1.3), 0.000, 1.0, 0.0),
             (sub(72, 0.10, 0.22), 0.000, 1.0, 0.0))

def h_success():
    return m((cut(src("d_power7"), 0.55, 0.10), 0.000, 0.85, 0.0),
             (spark("waterdrop", 0.18, 0.16, r=1.2), 0.050, 1.0, 0.0),
             (sub(90, 0.08, 0.20), 0.000, 1.0, 0.0))

def h_unit():
    return m((cut(src("d_power5"), 0.48, 0.10), 0.000, 0.85, -0.10),
             (bend("k_pluck", 1.28, 1.08, 0.22, tau=0.03, lp=7000), 0.160, 0.55, 0.10),
             (sub(88, 0.09, 0.22), 0.000, 1.0, 0.0))

def h_milestone():
    return m((cut(src("d_power11"), 0.70, 0.15), 0.000, 0.80, 0.0),
             (bend("boing", 1.10, 0.86, 0.55, tau=0.05, wobble=0.015, lp=3800), 0.000, 0.40, 0.0),
             (bend("k_pluck", 1.25, 1.05, 0.24, tau=0.03, lp=7000), 0.110, 0.55, 0.0),
             (sub(80, 0.14, 0.26), 0.000, 1.0, 0.0), dur=1.0)


# --------------------------------------------------------------------------- #
# I · 棉花糖 — soft water-drop body, almost no transient
# --------------------------------------------------------------------------- #

def i_click():
    return m((bend("waterdrop", 1.18, 0.98, 0.20, tau=0.03, lp=2800), 0.000, 0.85, 0.0),
             (sub(96, 0.06, 0.30), 0.000, 1.0, 0.0))

def i_reveal():
    return m((bend("waterdrop", 1.20, 0.95, 0.42, tau=0.035, wobble=0.010, lp=3200), 0.000, 0.95, 0.0),
             (bend("music_box", 0.84, 0.80, 0.60, tau=0.04, lp=3000), 0.040, 0.30, 0.08),
             (sub(92, 0.08, 0.26), 0.000, 1.0, 0.0))

def i_grade():
    return m((bend("waterdrop", 1.02, 0.90, 0.45, tau=0.05, wobble=0.008, lp=2600), 0.000, 0.95, 0.0),
             (sub(90, 0.08, 0.28), 0.000, 1.0, 0.0))

def i_correct():
    return m((bend("waterdrop", 1.00, 0.94, 0.40, tau=0.04, lp=3200), 0.000, 0.9, -0.10),
             (bend("music_box", 0.84, 0.80, 0.55, tau=0.04, lp=3000), 0.080, 0.35, 0.10),
             (sub(90, 0.07, 0.22), 0.000, 1.0, 0.0))

def i_wrong():
    return m((bend("waterdrop", 0.78, 0.66, 0.45, tau=0.05, lp=1200), 0.000, 0.9, 0.0),
             (squish(0.040, 0.12, 900), 0.010, 1.0, 0.0),
             (sub(72, 0.11, 0.24), 0.000, 1.0, 0.0))

def i_success():
    return m((bend("waterdrop", 0.94, 0.90, 0.42, tau=0.04, lp=3200), 0.000, 0.85, -0.14),
             (bend("waterdrop", 1.10, 1.02, 0.45, tau=0.04, lp=3200), 0.085, 0.78, 0.0),
             (bend("waterdrop", 1.26, 1.14, 0.48, tau=0.04, lp=3200), 0.170, 0.72, 0.14),
             (sub(90, 0.08, 0.20), 0.000, 1.0, 0.0))

def i_unit():
    return m((bend("waterdrop", 0.88, 0.84, 0.48, tau=0.04, lp=3200), 0.000, 0.80, -0.18),
             (bend("waterdrop", 1.02, 0.96, 0.50, tau=0.04, lp=3200), 0.090, 0.76, 0.0),
             (bend("waterdrop", 1.14, 1.06, 0.52, tau=0.04, lp=3200), 0.180, 0.72, 0.18),
             (bend("music_box", 0.84, 0.80, 0.65, tau=0.04, lp=3000), 0.270, 0.32, 0.0),
             (sub(86, 0.10, 0.22), 0.000, 1.0, 0.0))

def i_milestone():
    return m((bend("gong", 1.20, 1.00, 1.20, tau=0.08, lp=2200), 0.000, 0.55, 0.0),
             (bend("waterdrop", 0.94, 0.90, 0.50, tau=0.04, lp=3200), 0.000, 0.72, -0.14),
             (bend("waterdrop", 1.10, 1.02, 0.54, tau=0.04, lp=3200), 0.100, 0.70, 0.0),
             (bend("waterdrop", 1.26, 1.14, 0.58, tau=0.04, lp=3200), 0.200, 0.66, 0.16),
             (bend("music_box", 0.84, 0.80, 0.70, tau=0.04, lp=3000), 0.300, 0.30, 0.0),
             (sub(82, 0.16, 0.28), 0.000, 1.0, 0.0), dur=1.8)


# --------------------------------------------------------------------------- #
# catalogue
# --------------------------------------------------------------------------- #

TARGETS = {"click": -31, "reveal": -27, "grade": -28, "correct": -26,
           "wrong": -28, "success": -26, "unit": -24, "milestone": -22}

NAMES = [("click", "点击"), ("reveal", "翻卡"), ("grade", "评分 · 良好"),
         ("correct", "答对"), ("wrong", "答错"), ("success", "保存成功"),
         ("unit", "单元完成"), ("milestone", "里程碑")]


def _cues(prefix, builders):
    return [Cue(f"{prefix}.{k}", name, TARGETS[k], fn)
            for (k, name), fn in zip(NAMES, builders)]


FEELS = [
    Feel("f", "F · 果冻泡泡", "圆、弹、往上冒的泡泡",
         ("每个音都带一点上扬再回落", "低频垫一点重量，不飘", "不抢、不刺，连点很爽"),
         0.12, False, 9000,
         _cues("f", [f_click, f_reveal, f_grade, f_correct, f_wrong, f_success, f_unit, f_milestone])),
    Feel("g", "G · 软糖木琴", "暖、糯、像捏软糖",
         ("卡林巴打底，木头的软", "下弯音高，有弹性", "最耐听的一套"),
         0.08, False, 7000,
         _cues("g", [g_click, g_reveal, g_grade, g_correct, g_wrong, g_success, g_unit, g_milestone])),
    Feel("h", "H · 弹跳合成", "脆、亮一点，但压住了毛刺",
         ("Kenney 合成器 pluck", "强弯音，游戏感最足", "成功音最“爽”"),
         0.05, False, 11000,
         _cues("h", [h_click, h_reveal, h_grade, h_correct, h_wrong, h_success, h_unit, h_milestone])),
    Feel("i", "I · 棉花糖", "软、湿、几乎没有起音",
         ("水滴打底，全部低通", "最不刺耳的一套", "安静复习时最舒服"),
         0.22, True, 4500,
         _cues("i", [i_click, i_reveal, i_grade, i_correct, i_wrong, i_success, i_unit, i_milestone])),
]


def render(feel: Feel, cue: Cue) -> np.ndarray:
    x = cue.build()
    x = dsp.hp(x, 38)
    x = dsp.lp(x, feel.lowpass)
    x = dsp.reverb(x, feel.wet, IR_LONG if feel.long_ir else IR_SHORT)
    x = dsp.normalize(x, cue.target)
    p = dsp.peak(x)
    floor, ceiling = 10 ** (-20 / 20), 10 ** (-8 / 20)
    if p < floor:
        x = x * (floor / p)
    elif p > ceiling:
        x = x * (ceiling / p)
    mono = np.max(np.abs(x), axis=0) if x.ndim == 2 else np.abs(x)
    above = np.flatnonzero(mono > 10 ** (-58 / 20))
    if len(above):
        end = min(mono.shape[0], above[-1] + int(0.02 * SR))
        x = x[..., :end]
    return x
