# -*- coding: utf-8 -*-
"""Build the standalone Song-education infographic page.

Generates the three data graphics as inline SVG, inlines the scroll crops as
base64, and writes a single self-contained HTML file.
"""
import base64
import math
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, "..", "assets")

GOLD = "#b08b3e"
GOLD_L = "#cbb27a"
SEPIA = "#8a6a45"
INK = "#3b352a"
VIOLET = "#6f6aa8"


def b64(name):
    with open(os.path.join(ASSETS, name), "rb") as fh:
        return "data:image/jpeg;base64," + base64.b64encode(fh.read()).decode()


def pol(angle_deg, r):
    a = math.radians(angle_deg)
    return r * math.cos(a), r * math.sin(a)


# ---------------------------------------------------------------- radial wheel
SECTORS = [
    ("官学系统", "国子监 · 太学 · 州县学"),
    ("私学书院", "书院 · 精舍 · 讲会"),
    ("科举取士", "解试 · 省试 · 殿试"),
    ("专科学校", "武学 · 律学 · 医学 · 算学"),
    ("蒙学教化", "蒙学 · 家塾 · 乡约"),
    ("教材典籍", "九经 · 三经新义 · 蒙书"),
]
R_IN, R_OUT = 196, 300


def wedge_path(a0, a1, r_in=R_IN, r_out=R_OUT):
    x1i, y1i = pol(a0, r_in)
    x2i, y2i = pol(a1, r_in)
    x1o, y1o = pol(a0, r_out)
    x2o, y2o = pol(a1, r_out)
    large = 1 if abs(a1 - a0) > 180 else 0
    return (
        f"M {x1i:.2f} {y1i:.2f} L {x1o:.2f} {y1o:.2f} "
        f"A {r_out} {r_out} 0 {large} 1 {x2o:.2f} {y2o:.2f} "
        f"L {x2i:.2f} {y2i:.2f} "
        f"A {r_in} {r_in} 0 {large} 0 {x1i:.2f} {y1i:.2f} Z"
    )


def arc_path(a0, a1, r):
    x1, y1 = pol(a0, r)
    x2, y2 = pol(a1, r)
    large = 1 if abs(a1 - a0) > 180 else 0
    sweep = 1 if a1 > a0 else 0
    return f"M {x1:.2f} {y1:.2f} A {r} {r} 0 {large} {sweep} {x2:.2f} {y2:.2f}"


def wheel_svg(img):
    parts = []
    # radiating hairline ticks with terminal dots
    ticks = []
    n = 108
    for i in range(n):
        a = -90 + i * (360 / n)
        if i % 9 in (0, 1):
            continue
        length = 16 + (i * 37) % 30
        x1, y1 = pol(a, R_OUT + 8)
        x2, y2 = pol(a, R_OUT + 8 + length)
        dot_r = 1.6 + ((i * 13) % 5) * 0.85
        ticks.append(
            f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" '
            f'stroke="{INK}" stroke-width=".7" opacity=".45"/>'
        )
        ticks.append(
            f'<circle cx="{x2:.1f}" cy="{y2:.1f}" r="{dot_r:.1f}" fill="{GOLD}" '
            f'opacity="{0.25 + 0.1 * (i % 4):.2f}"/>'
        )
    parts.append("".join(ticks))

    clip_defs, images, dividers, labels, label_paths = [], [], [], [], []
    for i, (name, words) in enumerate(SECTORS):
        a0 = -90 + i * 60
        a1 = a0 + 60
        d = wedge_path(a0, a1)
        clip_defs.append(f'<clipPath id="wedge{i}"><path d="{d}"/></clipPath>')
        images.append(
            f'<g clip-path="url(#wedge{i})">'
            f'<image href="{img}" x="-310" y="-310" width="620" height="600" '
            f'preserveAspectRatio="xMidYMid slice" opacity=".8" '
            f'transform="rotate({i * 47})"/>'
            f'<rect x="-310" y="-310" width="620" height="620" fill="#efe2c4" opacity=".16"/>'
            f"</g>"
        )
        images.append(f'<path d="{d}" fill="none" stroke="{GOLD}" stroke-width="1" opacity=".85"/>')
        x1, y1 = pol(a0, R_IN)
        x2, y2 = pol(a0, R_OUT)
        dividers.append(
            f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" '
            f'stroke="{GOLD}" stroke-width="1.2"/>'
        )
        # per-character ring label: rotation corrected so no glyph lands upside down
        mid = a0 + 30
        mid_r = (R_IN + R_OUT) / 2 + 6
        step = 6.4
        flip = math.sin(math.radians(mid)) > 0.01 or (
            abs(math.sin(math.radians(mid))) <= 0.01 and math.cos(math.radians(mid)) < 0
        )
        chars = list(name)
        for k, ch in enumerate(chars):
            offset = (k - (len(chars) - 1) / 2) * step
            a = mid - offset if flip else mid + offset
            cx_, cy_ = pol(a, mid_r)
            rot = a - 90 if flip else a + 90
            labels.append(
                f'<text x="{cx_:.1f}" y="{cy_:.1f}" transform="rotate({rot:.1f} {cx_:.1f} {cy_:.1f})" '
                f'text-anchor="middle" dominant-baseline="central" class="sector-label">{ch}</text>'
            )

    return f"""
<svg class="wheel" viewBox="-352 -352 704 704" role="img" aria-label="宋代教育六域">
  <defs>{''.join(clip_defs)}{''.join(label_paths)}</defs>
  {''.join(parts)}
  <circle cx="0" cy="0" r="{R_OUT + 6}" fill="none" stroke="{GOLD}" stroke-width="1" opacity=".7"/>
  <circle cx="0" cy="0" r="{R_IN - 4}" fill="#f3ebd8"/>
  {''.join(images)}
  {''.join(dividers)}
  {''.join([l for l in labels if l.startswith("<text")])}
  <circle cx="0" cy="0" r="{R_IN - 4}" fill="none" stroke="{GOLD}" stroke-width="2"/>
  <clipPath id="coreClip"><circle cx="0" cy="0" r="{R_IN - 16}"/></clipPath>
  <image href="{img}" x="-190" y="-190" width="380" height="380"
         preserveAspectRatio="xMidYMid slice" clip-path="url(#coreClip)" opacity=".9"/>
  <defs><radialGradient id="coreFade">
    <stop offset="86%" stop-color="#efe6d2" stop-opacity="0"/>
    <stop offset="100%" stop-color="#efe6d2" stop-opacity=".96"/>
  </radialGradient></defs>
  <circle cx="0" cy="0" r="{R_IN - 16}" fill="url(#coreFade)"/>
  <circle cx="0" cy="0" r="96" fill="#f6efdd" stroke="{GOLD}" stroke-width="1.4" opacity=".97"/>
  <circle cx="0" cy="0" r="88" fill="none" stroke="{GOLD}" stroke-width=".6" opacity=".6"/>
  <text x="0" y="-4" text-anchor="middle" class="core-cn">宋</text>
  <text x="0" y="34" text-anchor="middle" class="core-en">EDUCATION · 960—1127</text>
</svg>"""


# ------------------------------------------------------------------- timeline
ROWS = ["政令", "兴学", "官学", "科举", "书院", "教材", "专科"]
EVENTS = [
    (960, 0, "北宋立国 · 重文抑武", 1.0),
    (1127, 0, "靖康之变", 0.9),
    (1044, 1, "庆历兴学", 1.2),
    (1069, 1, "熙宁兴学", 1.2),
    (1102, 1, "崇宁兴学", 1.2),
    (1044, 2, "创建太学", 1.0),
    (1079, 2, "太学三舍法定额", 1.0),
    (1044, 3, "先策论、后诗赋", 0.9),
    (1104, 3, "罢科举 · 取士由学校", 1.1),
    (977, 4, "赐白鹿洞《九经》", 0.8),
    (1009, 4, "应天府书院赐额", 0.8),
    (1075, 5, "颁《三经新义》", 1.0),
    (1072, 6, "设武学 · 律学", 0.9),
    (1104, 6, "设书学 · 画学", 0.9),
]
Y0, Y1 = 952, 1132


def timeline_svg():
    left, right = 118, 742
    top, step = 34, 42
    height = top + step * len(ROWS) + 34

    def x_of(year):
        return left + (year - Y0) / (Y1 - Y0) * (right - left)

    out = [f'<svg class="timeline" viewBox="0 0 780 {height}" role="img" aria-label="北宋教育大事">']
    # decade grid
    for year in range(960, 1131, 10):
        x = x_of(year)
        major = (year - 960) % 20 == 0
        out.append(
            f'<line x1="{x:.1f}" y1="{top - 14}" x2="{x:.1f}" y2="{top + step * len(ROWS)}" '
            f'stroke="{INK}" stroke-width="{0.8 if major else 0.4}" opacity="{0.2 if major else 0.1}"/>'
        )
        if major:
            out.append(
                f'<text x="{x:.1f}" y="{top + step * len(ROWS) + 22}" text-anchor="middle" '
                f'class="axis-num">{year}</text>'
            )
    out.append(
        f'<line x1="{left}" y1="{top + step * len(ROWS) + 8}" x2="{right}" '
        f'y2="{top + step * len(ROWS) + 8}" stroke="{INK}" stroke-width=".7" opacity=".3"/>'
    )
    # row labels + baselines
    for i, name in enumerate(ROWS):
        y = top + step * i
        out.append(
            f'<line x1="{left}" y1="{y:.1f}" x2="{right}" y2="{y:.1f}" '
            f'stroke="{INK}" stroke-width=".6" opacity=".18"/>'
        )
        out.append(f'<text x="{left - 16}" y="{y + 5:.1f}" text-anchor="end" class="row-label">{name}</text>')
    # event dots + labels
    for year, row, label, weight in EVENTS:
        x = x_of(year)
        y = top + step * row
        colour = VIOLET if row in (3, 5) else (SEPIA if row in (4, 6) else GOLD)
        r = 3.4 + weight * 2.8
        out.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r:.1f}" fill="{colour}" opacity=".9"/>')
        out.append(
            f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r + 3.4:.1f}" fill="none" stroke="{colour}" '
            f'stroke-width=".7" opacity=".4"/>'
        )
        if row <= 1:
            out.append(
                f'<text x="{x:.1f}" y="{y - r - 7:.1f}" text-anchor="middle" class="dot-label">{label}</text>'
            )
    out.append("</svg>")
    return "".join(out)


TIMELINE_KEYS = [
    (GOLD, "兴学 · 官学"),
    (VIOLET, "科举 · 教材"),
    (SEPIA, "书院 · 专科"),
]


# ------------------------------------------------------------------ bar chart
CLUSTERS = [
    ("庆历 1044", "范仲淹", [("官学与教学", 3, "州县立学 · 创建太学 · 苏湖教法"),
                          ("取士与教材", 1, "先策论、后诗赋")]),
    ("熙宁 1069", "王安石", [("官学与教学", 3, "太学三舍法 · 整顿州县学 · 设武律医学"),
                          ("取士与教材", 2, "罢诗赋帖经 · 颁《三经新义》")]),
    ("崇宁 1102", "蔡　京", [("官学与教学", 3, "州县普遍立学 · 三舍推及州县 · 定三级学制"),
                          ("取士与教材", 2, "罢科举由学校取士 · 设书画算学")]),
]


def bars_svg():
    w, h = 640, 300
    base_y, unit, col_w, inner_gap = 246, 46, 44, 22
    top_y = base_y - unit * 3
    out = [f'<svg class="bars" viewBox="0 0 {w} {h}" role="img" aria-label="三次兴学举措构成">']
    for gy in range(4):
        y = base_y - gy * unit
        out.append(
            f'<line x1="52" y1="{y:.1f}" x2="{w - 8}" y2="{y:.1f}" stroke="{INK}" '
            f'stroke-width=".5" opacity="{0.32 if gy == 0 else 0.12}"/>'
        )
        out.append(f'<text x="44" y="{y + 4:.1f}" text-anchor="end" class="axis-num">{gy}</text>')
    out.append(f'<text x="44" y="{top_y - 14}" text-anchor="end" class="axis-unit">条</text>')

    x = 84
    for label, who, series in CLUSTERS:
        group_start = x
        for name, value, gloss in series:
            colour = GOLD if name == "官学与教学" else SEPIA
            for k in range(value):
                y = base_y - (k + 1) * unit
                out.append(
                    f'<rect x="{x}" y="{y + 3}" width="{col_w}" height="{unit - 6}" '
                    f'fill="{colour}" opacity="{0.78 - k * 0.09:.2f}"/>'
                )
                out.append(
                    f'<rect x="{x}" y="{y + 3}" width="{col_w}" height="{unit - 6}" fill="none" '
                    f'stroke="#f3ebd8" stroke-width="1.2" opacity=".55"/>'
                )
            out.append(
                f'<text x="{x + col_w / 2}" y="{base_y - value * unit - 9}" text-anchor="middle" '
                f'class="bar-val">{value}</text>'
            )
            x += col_w + inner_gap
        mid = (group_start + x - inner_gap) / 2
        out.append(f'<line x1="{group_start - 6}" y1="{base_y + 6}" x2="{x - inner_gap + 6}" '
                   f'y2="{base_y + 6}" stroke="{GOLD}" stroke-width=".8" opacity=".5"/>')
        out.append(f'<text x="{mid:.1f}" y="{base_y + 26}" text-anchor="middle" class="cluster-label">{label}</text>')
        out.append(f'<text x="{mid:.1f}" y="{base_y + 42}" text-anchor="middle" class="cluster-who">{who}</text>')
        x += 44
    out.append("</svg>")
    return "".join(out)


# ------------------------------------------------------------------- pie ring
def pie_svg():
    r, inner = 58, 24
    names = ["官学", "书院", "科举", "专科", "蒙学", "教材"]
    out = ['<svg class="pie" viewBox="-124 -124 248 248" role="img" aria-label="教育场域构成">',
           '<g>']
    for i in range(6):
        a0, a1 = -90 + i * 60, -30 + i * 60
        d = wedge_path(a0, a1, inner, r)
        out.append(f'<path d="{d}" fill="{GOLD if i % 2 == 0 else SEPIA}" opacity="{0.22 + 0.07 * i:.2f}" '
                   f'stroke="{GOLD}" stroke-width=".8"/>')
        mid = (a0 + a1) / 2
        x1, y1 = pol(mid, r + 5)
        x2, y2 = pol(mid, 84)
        out.append(f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" '
                   f'stroke="{INK}" stroke-width=".55" opacity=".32"/>')
        lx, ly = pol(mid, 96)
        c = math.cos(math.radians(mid))
        anchor = "start" if c > 0.25 else ("end" if c < -0.25 else "middle")
        out.append(f'<text x="{lx:.1f}" y="{ly + 3:.1f}" text-anchor="{anchor}" class="pie-label">{names[i]}</text>')
    out.append(f'<circle cx="0" cy="0" r="{inner}" fill="#f3ebd8" stroke="{GOLD}" stroke-width="1"/>')
    out.append('<text x="0" y="-1" text-anchor="middle" class="pie-core">六域</text>')
    out.append('<text x="0" y="15" text-anchor="middle" class="pie-sub">FIELDS</text>')
    out.append("</g></svg>")
    return "".join(out)


def main():
    template = open(os.path.join(HERE, "template.html"), encoding="utf-8").read()
    html = (
        template.replace("{{PANORAMA}}", b64("panorama.jpg"))
        .replace("{{DETAIL_BRIDGE}}", b64("detail-bridge.jpg"))
        .replace("{{DETAIL_MARKET}}", b64("detail-market.jpg"))
        .replace("{{DETAIL_GATE}}", b64("detail-gate.jpg"))
        .replace("{{DETAIL_COUNTRY}}", b64("detail-country.jpg"))
        .replace("{{WHEEL}}", wheel_svg(b64("detail-market.jpg")))
        .replace("{{TIMELINE}}", timeline_svg())
        .replace("{{BARS}}", bars_svg())
        .replace("{{PIE}}", pie_svg())
    )
    out = os.path.join(HERE, "..", "宋代教育图鉴.html")
    with open(out, "w", encoding="utf-8") as fh:
        fh.write(html)
    print("wrote", os.path.abspath(out), round(len(html) / 1024), "KB")


if __name__ == "__main__":
    main()
