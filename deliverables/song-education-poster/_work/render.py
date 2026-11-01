# -*- coding: utf-8 -*-
"""Render the poster page to PNG (full page + inspection crops)."""
import os
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
TARGET = (HERE.parent / "宋代教育图鉴.html").as_uri()
OUT = HERE / "render"
OUT.mkdir(exist_ok=True)

CROPS = {
    "header": (0, 0, 1600, 400),
    "pie": (680, 10, 380, 330),
    "right": (1300, 740, 300, 620),
    "panorama": (140, 600, 1450, 170),
    "wheel": (650, 700, 720, 720),
    "collage": (60, 740, 640, 660),
    "bars": (70, 1390, 700, 400),
    "timeline": (760, 1390, 810, 360),
    "bottom": (60, 1760, 1480, 500),
}


def main():
    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel="chrome")
        page = browser.new_page(viewport={"width": 1600, "height": 2263},
                                device_scale_factor=2)
        page.goto(TARGET, wait_until="networkidle")
        page.evaluate("""() => {
            const s = document.getElementById('stage');
            s.style.transform='none'; s.style.height='auto'; s.style.width='1600px';
            document.body.style.padding='0'; document.body.style.background='#fff';
        }""")
        page.wait_for_timeout(400)
        page.screenshot(path=str(OUT / "poster@2x.png"), full_page=True)
        page.pdf(path=str(OUT / "poster.pdf"), width="420mm", height="594mm",
                 margin={"top": "0", "right": "0", "bottom": "0", "left": "0"},
                 print_background=True, scale=0.99)
        page.close()

        page = browser.new_page(viewport={"width": 1600, "height": 1200},
                                device_scale_factor=1)
        page.goto(TARGET, wait_until="networkidle")
        page.evaluate("""() => {
            const s = document.getElementById('stage');
            s.style.transform='none'; s.style.height='auto'; s.style.width='1600px';
            document.body.style.padding='0'; document.body.style.background='#fff';
        }""")
        page.wait_for_timeout(300)
        for name, (x, y, w, h) in CROPS.items():
            page.screenshot(path=str(OUT / f"{name}.png"), full_page=True,
                            clip={"x": x, "y": y, "width": w, "height": h})
            print("crop", name)
        info = page.evaluate("""() => {
          const p = document.querySelector('.poster');
          const box = el => { const r = el.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; };
          return {
            poster: [p.offsetWidth, p.offsetHeight],
            wheel: box(document.querySelector('.wheel-wrap')),
            bars: box(document.querySelector('.bars-panel')),
            timeline: box(document.querySelector('.tl-panel')),
            abstract: box(document.querySelector('.abstract')),
            review: box(document.querySelector('.review')),
            foot: box(document.querySelector('.foot')),
            scrollH: document.body.scrollHeight
          };
        }""")
        print(info)
        browser.close()
    print("ok")


if __name__ == "__main__":
    sys.exit(main())
