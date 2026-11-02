"""Five complete sound directions, eight cues each, for A/B listening.

Every style is built from one coherent library family so the choice is about
character, not about which individual file happened to be good.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from scipy.io import wavfile
from scipy.signal import resample_poly

import dsp
from fractions import Fraction

SR = dsp.SR
ROOT = Path(__file__).resolve().parent
LIB = ROOT / "samples" / "lib"

IR_SHORT = dsp.make_ir(0.75, 3.4, 0.006, 5200, seed=21)
IR_LONG = dsp.make_ir(1.8, 2.4, 0.014, 4000, seed=33)

_cache: dict[str, np.ndarray] = {}


def src(name: str) -> np.ndarray:
    if name not in _cache:
        path = LIB / f"{name}.wav"
        if not path.exists():
            path = ROOT / "samples" / f"{name}.wav"
        _, d = wavfile.read(path)
        _cache[name] = d.astype(np.float64)
    return _cache[name]


def rate(x: np.ndarray, r: float) -> np.ndarray:
    r = float(np.clip(r, 0.5, 2.0))
    fr = Fraction(r).limit_denominator(200)
    return resample_poly(x, fr.denominator, fr.numerator)


def cut(x: np.ndarray, dur: float, fade_out: float = 0.05) -> np.ndarray:
    n = max(1, int(dur * SR))
    y = x[:n].copy() if len(x) >= n else np.pad(x, (0, n - len(x)))
    fo = int(min(n * 0.5, max(0.008, fade_out) * SR))
    if fo > 1:
        y[-fo:] *= np.linspace(1, 0, fo) ** 1.4
    return y


def v(name: str, r: float = 1.0, dur: float | None = None, gain: float = 1.0,
      hp: float | None = None, lp: float | None = None, fade: float = 0.05) -> np.ndarray:
    x = src(name)
    if abs(r - 1.0) > 1e-4:
        x = rate(x, r)
    if dur:
        x = cut(x, dur, fade)
    if hp:
        x = dsp.hp(x, hp)
    if lp:
        x = dsp.lp(x, lp)
    return x * gain


def mix(events, dur: float | None = None) -> np.ndarray:
    return dsp.mix(events, dur=dur)


@dataclass
class Cue:
    id: str
    name: str
    target: float
    build: object = None


@dataclass
class Style:
    id: str
    name: str
    tagline: str
    bullets: tuple
    wet: float
    long_ir: bool
    cues: list = field(default_factory=list)


# --------------------------------------------------------------------------- #
# A · 木质轻触 — Kenney interface pack, close and dry
# --------------------------------------------------------------------------- #

def a_click():
    return v("k_click", gain=1.0, dur=0.06)

def a_reveal():
    return mix([
        (v("k_glass", gain=0.9), 0.000, 1.0, 0.0),
        (v("paper_flip", gain=0.32, dur=0.30), 0.005, 1.0, 0.0),
    ])

def a_grade():
    return v("k_pluck", gain=0.9, dur=0.14)

def a_correct():
    return mix([
        (v("k_confirm", gain=0.85, dur=0.50), 0.000, 1.0, -0.10),
        (v("k_pluck", gain=0.55), 0.060, 1.0, 0.10),
    ])

def a_wrong():
    return mix([
        (v("k_bong", gain=0.85), 0.000, 1.0, 0.0),
        (v("k_scratch", gain=0.40, dur=0.12), 0.010, 1.0, 0.0),
    ])

def a_success():
    return mix([
        (v("k_confirm", gain=0.8, dur=0.50), 0.000, 1.0, -0.12),
        (v("k_pluck", gain=0.6), 0.065, 1.0, 0.12),
        (v("k_glass", gain=0.55), 0.130, 1.0, 0.0),
    ], dur=0.75)

def a_unit():
    return mix([
        (v("k_confirm", gain=0.75, dur=0.55), 0.000, 1.0, -0.14),
        (v("k_glass", gain=0.6, r=1.12), 0.085, 1.0, 0.0),
        (v("k_glass", gain=0.55, r=1.26), 0.170, 1.0, 0.14),
        (v("k_bong", gain=0.35), 0.000, 1.0, 0.0),
    ], dur=0.9)

def a_milestone():
    return mix([
        (v("thump", gain=0.55, dur=0.40), 0.000, 1.0, 0.0),
        (v("k_bong", gain=0.55), 0.000, 1.0, -0.10),
        (v("k_confirm", gain=0.75, dur=0.70), 0.030, 1.0, 0.0),
        (v("k_glass", gain=0.55, r=1.12), 0.140, 1.0, 0.18),
        (v("k_glass", gain=0.50, r=1.33), 0.250, 1.0, -0.18),
        (v("paper_sheet", gain=0.35, dur=0.45), 0.000, 1.0, 0.0),
    ], dur=1.2)


# --------------------------------------------------------------------------- #
# B · 玻璃风铃 — wine glass + music box, airy and wet
# --------------------------------------------------------------------------- #

def b_click():
    return v("glass_clink", dur=0.10, hp=900, gain=0.9)

def b_reveal():
    return mix([
        (v("glass_clink", gain=0.9, dur=0.70), 0.000, 1.0, -0.12),
        (v("glass_ani", gain=0.55, dur=0.60), 0.040, 1.0, 0.12),
    ], dur=0.9)

def b_grade():
    return v("glass_ani", gain=0.9, dur=0.60)

def b_correct():
    return mix([
        (v("glass_clink", gain=0.8, dur=0.55), 0.000, 1.0, -0.14),
        (v("music_box", gain=0.55, dur=0.80), 0.055, 1.0, 0.14),
    ], dur=1.0)

def b_wrong():
    return mix([
        (v("glass_ani", r=0.82, gain=0.65, dur=0.55, lp=1500), 0.000, 1.0, 0.0),
        (v("small_gong", gain=0.30, dur=0.50, lp=1200), 0.020, 1.0, 0.0),
    ], dur=0.7)

def b_success():
    return mix([
        (v("music_box", gain=0.75, dur=1.00), 0.000, 1.0, -0.16),
        (v("glass_clink", gain=0.65, dur=0.60), 0.070, 1.0, 0.16),
        (v("glass_ani", gain=0.50, dur=0.65), 0.150, 1.0, 0.0),
    ], dur=1.3)

def b_unit():
    return mix([
        (v("music_box", r=0.84, gain=0.70, dur=1.10), 0.000, 1.0, -0.18),
        (v("music_box", r=1.00, gain=0.65, dur=1.10), 0.090, 1.0, 0.0),
        (v("music_box", r=1.12, gain=0.60, dur=1.20), 0.180, 1.0, 0.18),
        (v("glass_clink", gain=0.45, dur=0.50), 0.000, 1.0, 0.0),
    ], dur=1.6)

def b_milestone():
    return mix([
        (v("cymbal", gain=0.45, dur=1.20), 0.000, 1.0, 0.0),
        (v("music_box", r=0.84, gain=0.65, dur=1.30), 0.000, 1.0, -0.22),
        (v("music_box", r=1.00, gain=0.62, dur=1.35), 0.110, 1.0, 0.0),
        (v("music_box", r=1.19, gain=0.58, dur=1.40), 0.220, 1.0, 0.22),
        (v("glass_clink", gain=0.55, dur=0.70), 0.330, 1.0, 0.0),
        (v("glass_ani", gain=0.40, dur=0.80), 0.420, 1.0, 0.0),
    ], dur=2.0)


# --------------------------------------------------------------------------- #
# C · 电子极简 — Kenney digital, dry and tight
# --------------------------------------------------------------------------- #

def c_click():
    return v("k_tick", gain=1.0, dur=0.06)

def c_reveal():
    return v("d_two1", gain=0.95, dur=0.38)

def c_grade():
    return v("d_tone1", gain=0.95, dur=0.24)

def c_correct():
    return v("d_three1", gain=0.95, dur=0.55)

def c_wrong():
    return v("d_lowdown", gain=0.9, dur=0.50)

def c_success():
    return v("d_power7", gain=0.95, dur=0.55)

def c_unit():
    return mix([
        (v("d_power5", gain=0.9), 0.000, 1.0, 0.0),
        (v("d_tone1", gain=0.45), 0.180, 1.0, 0.0),
    ], dur=0.8)

def c_milestone():
    return mix([
        (v("d_power11", gain=0.95), 0.000, 1.0, 0.0),
        (v("d_three1", gain=0.55), 0.120, 1.0, 0.0),
    ], dur=0.9)


# --------------------------------------------------------------------------- #
# D · 禅颂钵 — singing bowl and gong, deep and spacious
# --------------------------------------------------------------------------- #

def d_click():
    return v("small_gong", gain=0.8, dur=0.12, fade=0.02)

def d_reveal():
    return v("small_gong", gain=0.95, dur=1.30, fade=0.30)

def d_grade():
    return v("small_gong", r=0.89, gain=0.95, dur=1.20, fade=0.28)

def d_correct():
    return mix([
        (v("small_gong", gain=0.85, dur=1.20, fade=0.28), 0.000, 1.0, -0.12),
        (v("music_box", r=0.84, gain=0.30, dur=0.80), 0.150, 1.0, 0.14),
    ], dur=1.5)

def d_wrong():
    return mix([
        (v("gong", r=1.35, gain=0.55, dur=0.90, lp=1400, fade=0.25), 0.000, 1.0, 0.0),
        (v("small_gong", r=0.80, gain=0.35, dur=0.70, fade=0.2), 0.030, 1.0, 0.0),
    ], dur=1.1)

def d_success():
    return mix([
        (v("small_gong", gain=0.85, dur=1.40, fade=0.35), 0.000, 1.0, -0.16),
        (v("glass_ani", gain=0.30, dur=0.60), 0.120, 1.0, 0.16),
        (v("music_box", r=0.84, gain=0.25, dur=0.90), 0.240, 1.0, 0.0),
    ], dur=1.8)

def d_unit():
    return mix([
        (v("gong", gain=0.65, dur=2.60, fade=0.6), 0.000, 1.0, 0.0),
        (v("small_gong", gain=0.55, dur=1.60, fade=0.4), 0.140, 1.0, -0.14),
        (v("music_box", r=0.84, gain=0.22, dur=1.10), 0.300, 1.0, 0.14),
    ], dur=3.2)

def d_milestone():
    return mix([
        (v("gong", gain=0.70, dur=2.80, fade=0.7), 0.000, 1.0, 0.0),
        (v("cymbal", gain=0.30, dur=1.60), 0.000, 1.0, 0.0),
        (v("small_gong", gain=0.55, dur=1.80, fade=0.5), 0.220, 1.0, 0.18),
        (v("music_box", r=0.84, gain=0.22, dur=1.30), 0.420, 1.0, -0.18),
    ], dur=3.2)


# --------------------------------------------------------------------------- #
# E · 八音盒 — one music-box note, gentle and nostalgic
# --------------------------------------------------------------------------- #

def e_click():
    return v("music_box", gain=0.75, dur=0.09, hp=1200, fade=0.02)

def e_reveal():
    return v("music_box", gain=0.95, dur=1.50, fade=0.35)

def e_grade():
    return v("music_box", gain=0.95, dur=1.10, fade=0.28)

def e_correct():
    return mix([
        (v("music_box", gain=0.85, dur=1.10, fade=0.3), 0.000, 1.0, -0.10),
        (v("music_box", r=1.335, gain=0.60, dur=1.00, fade=0.3), 0.090, 1.0, 0.10),
    ], dur=1.4)

def e_wrong():
    return mix([
        (v("music_box", r=0.75, gain=0.70, dur=0.90, lp=1800, fade=0.25), 0.000, 1.0, 0.0),
        (v("thump", gain=0.28, dur=0.35, lp=900), 0.010, 1.0, 0.0),
    ], dur=1.1)

def e_success():
    return mix([
        (v("music_box", r=0.75, gain=0.70, dur=1.10, fade=0.3), 0.000, 1.0, -0.16),
        (v("music_box", r=1.00, gain=0.65, dur=1.15, fade=0.3), 0.100, 1.0, 0.0),
        (v("music_box", r=1.335, gain=0.60, dur=1.20, fade=0.3), 0.200, 1.0, 0.16),
    ], dur=1.7)

def e_unit():
    return mix([
        (v("music_box", r=0.75, gain=0.65, dur=1.20, fade=0.3), 0.000, 1.0, -0.20),
        (v("music_box", r=1.00, gain=0.62, dur=1.25, fade=0.3), 0.105, 1.0, 0.0),
        (v("music_box", r=1.19, gain=0.58, dur=1.30, fade=0.3), 0.210, 1.0, 0.20),
        (v("music_box", r=1.50, gain=0.50, dur=1.35, fade=0.35), 0.315, 1.0, 0.0),
    ], dur=2.0)

def e_milestone():
    return mix([
        (v("cymbal", gain=0.32, dur=1.50), 0.000, 1.0, 0.0),
        (v("music_box", r=0.75, gain=0.62, dur=1.40, fade=0.35), 0.000, 1.0, -0.22),
        (v("music_box", r=1.00, gain=0.60, dur=1.45, fade=0.35), 0.120, 1.0, 0.0),
        (v("music_box", r=1.19, gain=0.56, dur=1.50, fade=0.35), 0.240, 1.0, 0.22),
        (v("music_box", r=1.50, gain=0.50, dur=1.55, fade=0.4), 0.360, 1.0, 0.0),
        (v("thump", gain=0.25, dur=0.45, lp=700), 0.000, 1.0, 0.0),
    ], dur=2.4)


# --------------------------------------------------------------------------- #
# catalogue
# --------------------------------------------------------------------------- #

CUE_NAMES = [
    ("click", "点击"),
    ("reveal", "翻卡"),
    ("grade", "评分 · 良好"),
    ("correct", "答对"),
    ("wrong", "答错"),
    ("success", "保存成功"),
    ("unit", "单元完成"),
    ("milestone", "里程碑"),
]

TARGETS = {"click": -31, "reveal": -27, "grade": -28, "correct": -26,
           "wrong": -28, "success": -26, "unit": -24, "milestone": -22}

STYLES = [
    Style("a", "A · 木质轻触", "干、近、像指尖敲在桌面上",
          ("吉卜力式小木槌", "短、干、几乎无尾音", "连点不糊，最耐听"), 0.05, False, [
              Cue("click", "点击", -31, a_click), Cue("reveal", "翻卡", -27, a_reveal),
              Cue("grade", "评分 · 良好", -28, a_grade), Cue("correct", "答对", -26, a_correct),
              Cue("wrong", "答错", -28, a_wrong), Cue("success", "保存成功", -26, a_success),
              Cue("unit", "单元完成", -24, a_unit), Cue("milestone", "里程碑", -22, a_milestone)]),
    Style("b", "B · 玻璃风铃", "亮、透、有余韵",
          ("真实红酒杯与八音盒", "尾音长，空间感强", "揭示与成就有仪式感"), 0.18, False, [
              Cue("click", "点击", -31, b_click), Cue("reveal", "翻卡", -27, b_reveal),
              Cue("grade", "评分 · 良好", -28, b_grade), Cue("correct", "答对", -26, b_correct),
              Cue("wrong", "答错", -28, b_wrong), Cue("success", "保存成功", -26, b_success),
              Cue("unit", "单元完成", -24, b_unit), Cue("milestone", "里程碑", -22, b_milestone)]),
    Style("c", "C · 电子极简", "短、干、零尾音",
          ("合成器 UI 音", "最不打扰，适合快刷", "情绪表达最克制"), 0.02, False, [
              Cue("click", "点击", -31, c_click), Cue("reveal", "翻卡", -27, c_reveal),
              Cue("grade", "评分 · 良好", -28, c_grade), Cue("correct", "答对", -26, c_correct),
              Cue("wrong", "答错", -28, c_wrong), Cue("success", "保存成功", -26, c_success),
              Cue("unit", "单元完成", -24, c_unit), Cue("milestone", "里程碑", -22, c_milestone)]),
    Style("d", "D · 禅颂钵", "低、稳、留白多",
          ("颂钵与小铜锣", "尾音最长，像呼吸", "适合安静复习，不适合快节奏"), 0.30, True, [
              Cue("click", "点击", -31, d_click), Cue("reveal", "翻卡", -27, d_reveal),
              Cue("grade", "评分 · 良好", -28, d_grade), Cue("correct", "答对", -26, d_correct),
              Cue("wrong", "答错", -28, d_wrong), Cue("success", "保存成功", -26, d_success),
              Cue("unit", "单元完成", -24, d_unit), Cue("milestone", "里程碑", -22, d_milestone)]),
    Style("e", "E · 八音盒", "软、旧、带一点甜",
          ("单一八音盒音源", "靠音高和叠音做情绪", "亲切，但甜度偏高"), 0.14, False, [
              Cue("click", "点击", -31, e_click), Cue("reveal", "翻卡", -27, e_reveal),
              Cue("grade", "评分 · 良好", -28, e_grade), Cue("correct", "答对", -26, e_correct),
              Cue("wrong", "答错", -28, e_wrong), Cue("success", "保存成功", -26, e_success),
              Cue("unit", "单元完成", -24, e_unit), Cue("milestone", "里程碑", -22, e_milestone)]),
]


def render(style: Style, cue: Cue) -> np.ndarray:
    x = cue.build()
    if x.ndim == 1:
        pass
    x = dsp.hp(x, 35)
    x = dsp.reverb(x, style.wet, IR_LONG if style.long_ir else IR_SHORT)
    x = dsp.normalize(x, cue.target)
    # Keep every cue inside a listenable window: a 90 ms tick normalised only by
    # attack RMS can land 8 dB under a bell and disappear.
    p = dsp.peak(x)
    floor = 10 ** (-20 / 20)
    ceiling = 10 ** (-8 / 20)
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
