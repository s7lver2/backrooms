"""Phoenyx logo: the vector is defined here (a 1254-unit square) and rendered to client/public/brand/
  phoenyx.svg                       the vector, white on transparent
  phoenyx-{16..1024}.png            white on transparent (UI use, several resolutions)
  icon-{16..512}.png, favicon.ico   white on black with padding (tab icon, apple-touch, PWA)
  og.png                            1200x630 social card
Run: python tools/make_logo.py
"""
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "client" / "public" / "brand"
SIDE = 1254
# traced from the logo artwork (1254x1254): head and stem, two upper wing bars, two lower wing feathers
SHAPES = [
    [(572, 422), (724, 461), (742, 482), (710, 478), (669, 497), (669, 556), (651, 645), (651, 834), (628, 866), (628, 643), (574, 527), (625, 463)],
    [(271, 379), (551, 533), (603, 642), (335, 489)],
    [(982, 379), (669, 556), (651, 645), (919, 490)],
    [(352, 527), (603, 672), (603, 835), (538, 761), (538, 707), (400, 627)],
    [(901, 528), (853, 627), (727, 704), (727, 760), (676, 806), (676, 658)],
]
BOX = (271, 379, 982, 866)  # the artwork's bounding box inside the canvas


def svg() -> str:
    x0, y0, x1, y1 = BOX
    pad = 20
    d = " ".join("M" + " L".join(f"{x},{y}" for x, y in s) + " Z" for s in SHAPES)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{x0 - pad} {y0 - pad} {x1 - x0 + 2 * pad} {y1 - y0 + 2 * pad}" role="img" aria-label="Phoenyx">'
            f'<path fill="#fff" d="{d}"/></svg>\n')


def render(size: int, bg: tuple | None, fill: float) -> Image.Image:
    """The mark centred in a size x size square, using `fill` of its width; supersampled 4x."""
    s = size * 4
    img = Image.new("RGBA", (s, s), bg or (0, 0, 0, 0))
    k = s * fill / (BOX[2] - BOX[0])
    cx, cy = (BOX[0] + BOX[2]) / 2, (BOX[1] + BOX[3]) / 2
    dr = ImageDraw.Draw(img)
    for poly in SHAPES:
        dr.polygon([((x - cx) * k + s / 2, (y - cy) * k + s / 2) for x, y in poly], fill=(255, 255, 255, 255))
    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "phoenyx.svg").write_text(svg(), encoding="utf-8")
    for n in (16, 32, 48, 64, 96, 128, 192, 256, 512, 1024):
        render(n, None, 0.96).save(OUT / f"phoenyx-{n}.png")
    for n in (16, 32, 48, 180, 192, 512):
        render(n, (0, 0, 0, 255), 0.62).save(OUT / f"icon-{n}.png")
    render(48, (0, 0, 0, 255), 0.62).save(OUT / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
    og = Image.new("RGBA", (1200, 630), (0, 0, 0, 255))
    og.alpha_composite(render(380, None, 0.96), (410, 125))
    og.convert("RGB").save(OUT / "og.png")
    print("brand ->", OUT)


if __name__ == "__main__":
    main()
