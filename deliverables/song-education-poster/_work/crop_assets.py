"""Cut print-ready sepia crops out of the public-domain Qing court version scroll."""
import os

from PIL import Image, ImageEnhance, ImageOps

SRC = "source-qingming.jpg"  # 清院本《清明上河图》公开扫描件，公有领域
OUT = "../assets"
os.makedirs(OUT, exist_ok=True)
os.makedirs("specimens", exist_ok=True)


def strip_rows(im):
    """Find horizontal white gutters between stacked scroll strips."""
    g = im.convert("L")
    w, h = g.size
    px = g.load()
    rows = []
    for y in range(h):
        s = 0
        for x in range(0, w, 37):
            s += px[x, y]
        rows.append(s / len(range(0, w, 37)))
    gutters, run = [], None
    for y, v in enumerate(rows):
        if v > 245:
            run = y if run is None else run
        else:
            if run is not None and y - run > 3:
                gutters.append((run, y))
            run = None
    return gutters


def sepia(im, strength=0.72):
    """Mute the Qing palette toward the Song-silk parchment register."""
    im = im.convert("RGB")
    im = ImageEnhance.Color(im).enhance(0.22)
    im = ImageOps.autocontrast(im, cutoff=0.6)
    im = ImageEnhance.Contrast(im).enhance(1.12)
    im = ImageEnhance.Brightness(im).enhance(0.97)
    warm = Image.new("RGB", im.size, (206, 178, 132))
    return Image.blend(im, Image.blend(im, warm, 0.42), strength)


def save(im, name, width):
    ratio = width / im.size[0]
    im = im.resize((width, int(im.size[1] * ratio)), Image.LANCZOS)
    im.save(os.path.join(OUT, name), quality=86, optimize=True)
    print(name, im.size)


def main():
    src = Image.open(SRC)
    print("source", src.size)
    gut = strip_rows(src)
    print("gutters", gut)
    bands = []
    prev = 0
    for a, b in gut:
        bands.append((prev, a))
        prev = b
    bands.append((prev, src.size[1]))
    bands = [b for b in bands if b[1] - b[0] > 200]
    print("bands", bands)

    for i, (a, b) in enumerate(bands):
        band = src.crop((0, a, src.size[0], b))
        band.save(f"specimens/band{i}.jpg", quality=88)
        print("band", i, band.size)

    # hero panorama: the busiest band (the bridge / city gate band)
    hero_band = bands[1]
    hero = src.crop((0, hero_band[0], src.size[0], hero_band[1]))
    save(sepia(hero), "panorama.jpg", 2400)

    # square-ish detail medallions from different bands
    picks = [
        ("detail-bridge.jpg", bands[1], 0.22, 0.52, 1.0),
        ("detail-market.jpg", bands[2], 0.30, 0.62, 1.0),
        ("detail-gate.jpg", bands[2], 0.62, 0.92, 1.0),
        ("detail-country.jpg", bands[0], 0.45, 0.85, 1.0),
    ]
    for name, (a, b), x0, x1, pad in picks:
        h = b - a
        w = int(h * 1.35)
        cx = int(src.size[0] * (x0 + x1) / 2)
        left = max(0, min(src.size[0] - w, cx - w // 2))
        crop = src.crop((left, a, left + w, b))
        save(sepia(crop), name, 1100)


if __name__ == "__main__":
    main()
