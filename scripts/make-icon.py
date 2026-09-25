"""Renders Sentry's app icon (the four-tile storage mark) to resources/.

Run: python scripts/make-icon.py   (needs Pillow)
Outputs icon.png (1024), icon.ico (16-256, for Windows), and icon-<n>.png sizes.
"""
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / 'resources'
OUT.mkdir(exist_ok=True)

BG_TOP = (24, 28, 42)
BG_BOTTOM = (11, 13, 20)
AMBER = (242, 179, 91)
BLUE = (111, 149, 224)
VIOLET = (165, 125, 224)
TEAL = (79, 179, 179)

# Same geometry as the in-app <Logo>: a 22-unit grid.
TILES = [
    (0, 0, 13, 22, AMBER),
    (15, 0, 7, 11, BLUE),
    (15, 13, 7, 4, VIOLET),
    (15, 19, 7, 3, TEAL),
]


def render(size: int) -> Image.Image:
    s = size * 4  # supersample, then downscale for clean edges
    img = Image.new('RGBA', (s, s), (0, 0, 0, 0))

    # Rounded-square plate with a gentle vertical gradient.
    grad = Image.new('RGBA', (s, s))
    gd = ImageDraw.Draw(grad)
    for y in range(s):
        t = y / (s - 1)
        gd.line([(0, y), (s, y)], fill=tuple(round(a + (b - a) * t) for a, b in zip(BG_TOP, BG_BOTTOM)) + (255,))
    mask = Image.new('L', (s, s), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, s - 1, s - 1], radius=round(s * 0.225), fill=255)
    img.paste(grad, (0, 0), mask)

    # Faint hairline around the plate so it holds its edge on dark taskbars.
    edge = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    ImageDraw.Draw(edge).rounded_rectangle([0, 0, s - 1, s - 1], radius=round(s * 0.225), outline=(255, 255, 255, 22), width=max(2, s // 128))
    img = Image.alpha_composite(img, edge)

    # Small sizes get a bigger mark so it stays legible in the taskbar.
    pad = s * (0.2 if size >= 48 else 0.14)
    unit = (s - 2 * pad) / 22
    d = ImageDraw.Draw(img)
    r = max(2, unit * (1.7 if size >= 48 else 1.2))
    for x, y, w, h, c in TILES:
        d.rounded_rectangle(
            [pad + x * unit, pad + y * unit, pad + (x + w) * unit - 1, pad + (y + h) * unit - 1],
            radius=min(r, w * unit / 2, h * unit / 2),
            fill=c + (255,),
        )
    return img.resize((size, size), Image.LANCZOS)


big = render(1024)
big.save(OUT / 'icon.png')
sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256]
frames = [render(n) for n in sizes]
for n, im in zip(sizes, frames):
    im.save(OUT / f'icon-{n}.png')
frames[-1].save(OUT / 'icon.ico', sizes=[(n, n) for n in sizes], append_images=frames[:-1])
print('wrote', OUT)
