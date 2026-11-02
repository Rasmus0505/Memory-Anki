"""Four H-family game-feedback directions for direct A/B listening.

H0 is the original H direction. The other three keep its short pluck and
pitch-bend grammar while changing the jelly, bounce, and arcade character.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

import dsp
import jelly_lab

SR = dsp.SR
IR_SHORT = dsp.make_ir(0.72, 3.5, 0.006, 5000, seed=71)
IR_LONG = dsp.make_ir(1.25, 2.8, 0.010, 4200, seed=72)


src = jelly_lab.src
cut = jelly_lab.cut
bend = jelly_lab.bend
sub = jelly_lab.sub
squish = jelly_lab.squish
spark = jelly_lab.spark
m = jelly_lab.m


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
    bullets: tuple[str, ...]
    wet: float
    long_ir: bool
    lowpass: float
    cues: list[Cue] = field(default_factory=list)


NAMES = [
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


# H0 · the original: bright digital pluck with a firm downward bend.
def h0_click():
    return m((bend("k_pluck", 1.38, 1.00, 0.14, tau=0.02, lp=7000), 0.000, 0.9, 0.0),
             (sub(96, 0.05, 0.24), 0.000, 1.0, 0.0))


def h0_reveal():
    return m((bend("k_pluck", 1.30, 1.00, 0.24, tau=0.025, lp=7000), 0.000, 0.9, 0.0),
             (cut(src("d_two1"), 0.30, 0.05), 0.010, 0.45, 0.0),
             (sub(94, 0.07, 0.28), 0.000, 1.0, 0.0))


def h0_grade():
    return m((bend("k_glass", 1.22, 1.00, 0.18, tau=0.03, lp=6500), 0.000, 0.9, 0.0),
             (sub(90, 0.06, 0.22), 0.000, 1.0, 0.0))


def h0_correct():
    return m((bend("k_confirm", 1.06, 1.00, 0.45, tau=0.04, lp=7500), 0.000, 0.85, -0.10),
             (bend("k_pluck", 1.30, 1.10, 0.20, tau=0.03, lp=7000), 0.080, 0.60, 0.10),
             (sub(92, 0.07, 0.20), 0.000, 1.0, 0.0))


def h0_wrong():
    return m((cut(src("d_lowdown"), 0.55, 0.10), 0.000, 0.85, 0.0),
             (squish(0.040, 0.22, 1600), 0.010, 1.0, 0.0),
             (spark("pop9", 0.06, 0.18, r=1.3), 0.000, 1.0, 0.0),
             (sub(72, 0.10, 0.22), 0.000, 1.0, 0.0))


def h0_success():
    return m((cut(src("d_power7"), 0.55, 0.10), 0.000, 0.85, 0.0),
             (spark("waterdrop", 0.18, 0.16, r=1.2), 0.050, 1.0, 0.0),
             (sub(90, 0.08, 0.20), 0.000, 1.0, 0.0))


def h0_unit():
    return m((cut(src("d_power5"), 0.48, 0.10), 0.000, 0.85, -0.10),
             (bend("k_pluck", 1.28, 1.08, 0.22, tau=0.03, lp=7000), 0.160, 0.55, 0.10),
             (sub(88, 0.09, 0.22), 0.000, 1.0, 0.0))


def h0_milestone():
    return m((cut(src("d_power11"), 0.70, 0.15), 0.000, 0.80, 0.0),
             (bend("boing", 1.10, 0.86, 0.55, tau=0.05, wobble=0.015, lp=3800), 0.000, 0.40, 0.0),
             (bend("k_pluck", 1.25, 1.05, 0.24, tau=0.03, lp=7000), 0.110, 0.55, 0.0),
             (sub(80, 0.14, 0.26), 0.000, 1.0, 0.0), dur=1.0)


# H1 · soft candy: the same snap, but with a wet, rounded attack.
def h1_click():
    return m((bend("k_pluck", 1.26, 0.98, 0.16, tau=0.032, lp=5200), 0.000, 0.82, 0.0),
             (cut(src("pop9"), 0.075, 0.018), 0.000, 0.26, 0.0),
             (squish(0.026, 0.15, 1250), 0.000, 1.0, 0.0),
             (sub(94, 0.055, 0.22), 0.000, 1.0, 0.0))


def h1_reveal():
    return m((bend("k_pluck", 1.22, 0.94, 0.30, tau=0.04, lp=5400), 0.000, 0.82, 0.0),
             (cut(src("d_two1"), 0.26, 0.05), 0.020, 0.25, 0.0),
             (squish(0.040, 0.17, 1300), 0.000, 1.0, 0.0),
             (sub(92, 0.075, 0.25), 0.000, 1.0, 0.0))


def h1_grade():
    return m((bend("k_pluck", 1.16, 0.92, 0.23, tau=0.045, wobble=0.012, lp=5000), 0.000, 0.84, 0.0),
             (squish(0.034, 0.13, 1200), 0.000, 1.0, 0.0),
             (sub(88, 0.065, 0.20), 0.000, 1.0, 0.0))


def h1_correct():
    return m((bend("k_confirm", 1.04, 0.96, 0.48, tau=0.05, lp=5600), 0.000, 0.78, -0.10),
             (bend("k_pluck", 1.22, 1.06, 0.25, tau=0.04, lp=5200), 0.095, 0.56, 0.10),
             (squish(0.042, 0.15, 1300), 0.000, 1.0, 0.0),
             (spark("waterdrop", 0.16, 0.08, r=1.12), 0.075, 1.0, 0.0),
             (sub(90, 0.075, 0.20), 0.000, 1.0, 0.0))


def h1_wrong():
    return m((bend("k_bong", 0.88, 0.70, 0.42, tau=0.07, lp=1250), 0.000, 0.75, 0.0),
             (squish(0.060, 0.20, 950), 0.010, 1.0, 0.0),
             (sub(70, 0.12, 0.22), 0.000, 1.0, 0.0))


def h1_success():
    return m((cut(src("d_power5"), 0.42, 0.10), 0.000, 0.60, 0.0),
             (bend("k_confirm", 1.04, 0.96, 0.48, tau=0.05, lp=5600), 0.020, 0.68, -0.12),
             (bend("k_pluck", 1.20, 1.06, 0.25, tau=0.04, lp=5200), 0.115, 0.52, 0.12),
             (squish(0.045, 0.14, 1200), 0.020, 1.0, 0.0),
             (sub(88, 0.10, 0.20), 0.000, 1.0, 0.0))


def h1_unit():
    return m((cut(src("d_power5"), 0.48, 0.11), 0.000, 0.58, -0.10),
             (bend("k_pluck", 1.18, 1.02, 0.28, tau=0.04, lp=5200), 0.120, 0.58, 0.0),
             (bend("k_pluck", 1.32, 1.12, 0.30, tau=0.04, lp=5200), 0.220, 0.50, 0.10),
             (squish(0.055, 0.16, 1200), 0.000, 1.0, 0.0),
             (sub(86, 0.12, 0.24), 0.000, 1.0, 0.0))


def h1_milestone():
    return m((cut(src("d_power7"), 0.58, 0.14), 0.000, 0.58, 0.0),
             (bend("boing_cartoon", 1.10, 0.82, 0.58, tau=0.08, lp=3000), 0.000, 0.34, 0.0),
             (bend("k_pluck", 1.18, 1.02, 0.30, tau=0.04, lp=5200), 0.120, 0.55, -0.08),
             (bend("k_pluck", 1.34, 1.12, 0.34, tau=0.04, lp=5200), 0.225, 0.50, 0.10),
             (squish(0.065, 0.18, 1100), 0.000, 1.0, 0.0),
             (sub(80, 0.16, 0.28), 0.000, 1.0, 0.0), dur=1.2)


# H2 · trampoline: deeper bounce, rubbery motion, and a visible settle.
def h2_click():
    return m((bend("boing_cartoon", 1.18, 0.78, 0.24, tau=0.07, lp=2800), 0.000, 0.44, 0.0),
             (bend("k_pluck", 1.30, 1.00, 0.14, tau=0.025, lp=5800), 0.015, 0.72, 0.0),
             (sub(88, 0.08, 0.30), 0.000, 1.0, 0.0))


def h2_reveal():
    return m((bend("boing", 1.22, 0.76, 0.48, tau=0.09, wobble=0.018, lp=2600), 0.000, 0.38, 0.0),
             (bend("k_pluck", 1.24, 0.96, 0.28, tau=0.04, lp=5800), 0.045, 0.72, 0.0),
             (cut(src("bubble"), 0.20, 0.05), 0.055, 0.20, 0.0),
             (sub(92, 0.10, 0.30), 0.000, 1.0, 0.0))


def h2_grade():
    return m((bend("k_pluck", 1.16, 0.88, 0.23, tau=0.05, wobble=0.015, lp=5000), 0.000, 0.72, 0.0),
             (bend("boing_cartoon", 1.06, 0.84, 0.30, tau=0.08, lp=2500), 0.000, 0.24, 0.0),
             (sub(84, 0.085, 0.24), 0.000, 1.0, 0.0))


def h2_correct():
    return m((bend("k_confirm", 1.05, 0.96, 0.45, tau=0.05, lp=5800), 0.000, 0.70, -0.10),
             (bend("boing_cartoon", 1.15, 0.82, 0.42, tau=0.08, lp=2700), 0.030, 0.28, 0.0),
             (bend("k_pluck", 1.28, 1.08, 0.23, tau=0.04, lp=5600), 0.105, 0.52, 0.10),
             (spark("waterdrop", 0.15, 0.07, r=1.16), 0.075, 1.0, 0.0),
             (sub(88, 0.09, 0.25), 0.000, 1.0, 0.0))


def h2_wrong():
    return m((bend("boing", 0.78, 0.58, 0.55, tau=0.10, lp=1200), 0.000, 0.38, 0.0),
             (cut(src("d_lowdown"), 0.42, 0.10), 0.025, 0.52, 0.0),
             (squish(0.070, 0.18, 850), 0.015, 1.0, 0.0),
             (sub(66, 0.14, 0.28), 0.000, 1.0, 0.0))


def h2_success():
    return m((bend("boing_cartoon", 1.10, 0.80, 0.52, tau=0.09, lp=2800), 0.000, 0.28, 0.0),
             (cut(src("d_power7"), 0.50, 0.12), 0.025, 0.58, 0.0),
             (bend("k_pluck", 1.16, 1.00, 0.26, tau=0.04, lp=5600), 0.100, 0.50, 0.10),
             (spark("waterdrop", 0.17, 0.07, r=1.18), 0.055, 1.0, 0.0),
             (sub(86, 0.11, 0.24), 0.000, 1.0, 0.0))


def h2_unit():
    return m((bend("boing", 1.14, 0.78, 0.62, tau=0.10, lp=2800), 0.000, 0.32, 0.0),
             (cut(src("d_power5"), 0.48, 0.11), 0.035, 0.56, -0.08),
             (bend("k_pluck", 1.18, 1.00, 0.28, tau=0.04, lp=5600), 0.145, 0.52, 0.0),
             (bend("k_pluck", 1.34, 1.10, 0.30, tau=0.04, lp=5600), 0.245, 0.46, 0.12),
             (sub(82, 0.13, 0.28), 0.000, 1.0, 0.0))


def h2_milestone():
    return m((bend("boing", 1.16, 0.74, 0.72, tau=0.12, wobble=0.02, lp=2600), 0.000, 0.38, 0.0),
             (cut(src("d_power11"), 0.62, 0.16), 0.025, 0.62, 0.0),
             (bend("k_pluck", 1.20, 1.00, 0.30, tau=0.04, lp=5600), 0.130, 0.52, -0.08),
             (bend("k_pluck", 1.36, 1.12, 0.34, tau=0.04, lp=5600), 0.245, 0.46, 0.10),
             (squish(0.070, 0.18, 950), 0.000, 1.0, 0.0),
             (sub(78, 0.17, 0.32), 0.000, 1.0, 0.0), dur=1.35)


# H3 · candy arcade: a cleaner reward arc, with soft sparkle instead of harsh highs.
def h3_click():
    return m((bend("k_tick", 1.28, 0.98, 0.10, tau=0.018, lp=6200), 0.000, 0.78, 0.0),
             (cut(src("pop5"), 0.065, 0.016), 0.000, 0.22, 0.0),
             (sub(100, 0.045, 0.18), 0.000, 1.0, 0.0))


def h3_reveal():
    return m((bend("k_pluck", 1.34, 1.00, 0.22, tau=0.025, lp=6500), 0.000, 0.76, 0.0),
             (cut(src("d_two1"), 0.25, 0.05), 0.010, 0.34, 0.0),
             (spark("bubble", 0.16, 0.10, r=1.1), 0.040, 1.0, 0.0),
             (sub(96, 0.065, 0.22), 0.000, 1.0, 0.0))


def h3_grade():
    return m((bend("k_glass", 1.24, 1.02, 0.17, tau=0.028, lp=6200), 0.000, 0.78, 0.0),
             (spark("waterdrop", 0.12, 0.08, r=1.18), 0.025, 1.0, 0.0),
             (sub(92, 0.06, 0.18), 0.000, 1.0, 0.0))


def h3_correct():
    return m((bend("k_confirm", 1.08, 1.00, 0.42, tau=0.04, lp=6800), 0.000, 0.72, -0.10),
             (bend("k_pluck", 1.34, 1.12, 0.19, tau=0.03, lp=6500), 0.075, 0.56, 0.10),
             (spark("bubble", 0.14, 0.09, r=1.2), 0.045, 1.0, 0.0),
             (sub(94, 0.065, 0.18), 0.000, 1.0, 0.0))


def h3_wrong():
    return m((cut(src("d_lowdown"), 0.42, 0.10), 0.000, 0.62, 0.0),
             (squish(0.044, 0.18, 1250), 0.010, 1.0, 0.0),
             (sub(70, 0.09, 0.20), 0.000, 1.0, 0.0))


def h3_success():
    return m((cut(src("d_power7"), 0.48, 0.10), 0.000, 0.64, 0.0),
             (spark("bubble", 0.16, 0.10, r=1.18), 0.045, 1.0, 0.0),
             (bend("k_pluck", 1.18, 1.04, 0.24, tau=0.035, lp=6400), 0.090, 0.48, 0.08),
             (sub(92, 0.075, 0.18), 0.000, 1.0, 0.0))


def h3_unit():
    return m((cut(src("d_power5"), 0.44, 0.10), 0.000, 0.62, -0.08),
             (bend("k_pluck", 1.22, 1.06, 0.22, tau=0.03, lp=6400), 0.115, 0.52, 0.0),
             (bend("k_pluck", 1.38, 1.16, 0.24, tau=0.03, lp=6400), 0.205, 0.46, 0.10),
             (spark("waterdrop", 0.15, 0.08, r=1.22), 0.235, 1.0, 0.0),
             (sub(88, 0.09, 0.20), 0.000, 1.0, 0.0))


def h3_milestone():
    return m((cut(src("d_power11"), 0.64, 0.15), 0.000, 0.70, 0.0),
             (bend("boing_cartoon", 1.10, 0.86, 0.46, tau=0.06, lp=3400), 0.000, 0.26, 0.0),
             (spark("bubble", 0.18, 0.10, r=1.18), 0.050, 1.0, -0.08),
             (bend("k_pluck", 1.26, 1.06, 0.24, tau=0.03, lp=6400), 0.105, 0.48, 0.0),
             (bend("k_pluck", 1.42, 1.18, 0.27, tau=0.03, lp=6400), 0.205, 0.42, 0.10),
             (sub(82, 0.13, 0.25), 0.000, 1.0, 0.0), dur=1.05)


def cues(prefix: str, builders) -> list[Cue]:
    return [Cue(f"{prefix}.{key}", name, TARGETS[key], fn)
            for (key, name), fn in zip(NAMES, builders)]


FEELS = [
    Feel("h0", "H0 · 弹跳合成原版", "脆、亮、下落弯音最明显",
         ("原始 H 的 pluck + digital reward", "最强的游戏音反馈", "高频已压住，但仍保留脆度"),
         0.05, False, 11000,
         cues("h0", [h0_click, h0_reveal, h0_grade, h0_correct, h0_wrong, h0_success, h0_unit, h0_milestone])),
    Feel("h1", "H1 · 软糖弹跳", "更软、更黏，像糖胶被弹起",
         ("保留 H 的短 pluck 骨架", "pop + slime 把起音揉圆", "适合高频连续操作"),
         0.08, False, 7200,
         cues("h1", [h1_click, h1_reveal, h1_grade, h1_correct, h1_wrong, h1_success, h1_unit, h1_milestone])),
    Feel("h2", "H2 · 泡泡蹦床", "低一点、弹一点，落下还有回弹",
         ("boing 负责身体运动感", "低频落点更有重量", "最像游戏里的软物理反馈"),
         0.10, False, 6200,
         cues("h2", [h2_click, h2_reveal, h2_grade, h2_correct, h2_wrong, h2_success, h2_unit, h2_milestone])),
    Feel("h3", "H3 · 糖果街机", "奖励感更强，但亮度更圆",
         ("Kenney digital 的街机骨架", "泡泡亮点替代尖锐高频", "连击和完成音最有记忆点"),
         0.07, False, 8500,
         cues("h3", [h3_click, h3_reveal, h3_grade, h3_correct, h3_wrong, h3_success, h3_unit, h3_milestone])),
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
