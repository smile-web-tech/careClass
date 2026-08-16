"""
Draw the "Cc" mark and write every icon asset the app ships.

The icons are generated rather than drawn by hand so they cannot drift from the
title card in `src/components/Intro.tsx`: same face, same blue, same green, same
green-over-blue overlap. Change a colour here and on the card together.

    python3 scripts/make-icons.py            # writes assets/images
    python3 scripts/make-icons.py /tmp/out   # somewhere else, to look first

Needs Pillow and the Archivo Black package (`@expo-google-fonts/archivo-black`),
both of which are already present for development.
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
FONT = ROOT / "node_modules/@expo-google-fonts/archivo-black/400Regular/ArchivoBlack_400Regular.ttf"

BLACK = (0, 0, 0)
BLUE = (36, 87, 232)
GREEN = (0, 165, 81)
WHITE = (255, 255, 255)


def glyph(ch, size, colour):
    """One letter on its own transparent layer, cropped to its ink."""
    font = ImageFont.truetype(str(FONT), size)
    layer = Image.new("RGBA", (size * 3, size * 3), (0, 0, 0, 0))
    ImageDraw.Draw(layer).text(
        (size, size * 2), ch, font=font, fill=colour + (255,), anchor="ls"
    )
    return layer.crop(layer.getbbox())


def mark(size, blue=BLUE, green=GREEN, tracking=-0.10):
    """
    The mark on transparent ground.

    Both letters are set at one size on one baseline, so the lowercase c stays
    lowercase — matching their heights would spell CC. `tracking` is a share of
    the type size and is negative: the letters overlap the way CARE overlaps
    CLASS on the title card, green in front.
    """
    font = ImageFont.truetype(str(FONT), size)
    layer = Image.new("RGBA", (size * 3, size * 3), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    baseline = size * 2
    d.text((size, baseline), "C", font=font, fill=blue + (255,), anchor="ls")
    d.text(
        (size + font.getlength("C") + tracking * size, baseline),
        "c",
        font=font,
        fill=green + (255,),
        anchor="ls",
    )
    return layer.crop(layer.getbbox())


def fitted(canvas, share, ground=None, **kw):
    """The mark centred on a `canvas`-square, its width `share` of the side."""
    img = Image.new("RGBA", (canvas, canvas), (ground + (255,)) if ground else (0, 0, 0, 0))
    m = mark(canvas, **kw)
    target = int(canvas * share)
    m = m.resize((target, max(1, int(m.height * target / m.width))), Image.LANCZOS)
    img.alpha_composite(m, ((canvas - m.width) // 2, (canvas - m.height) // 2))
    return img


out = Path(sys.argv[1] if len(sys.argv) > 1 else ROOT / "assets/images")
out.mkdir(parents=True, exist_ok=True)

# App icon — the title card's palette, cropped to a square.
fitted(1024, 0.62, ground=BLACK).convert("RGB").save(out / "icon.png")

# Adaptive icon. Android masks the foreground to a circle two thirds of the
# side, so the mark's diagonal has to fit inside that: 56% of the side clears
# it on every mask shape the launchers use.
fitted(432, 0.56).save(out / "android-icon-foreground.png")
Image.new("RGB", (432, 432), BLACK).save(out / "android-icon-background.png")

# Themed icons keep only the alpha, so the monochrome cut goes one colour.
fitted(432, 0.56, blue=WHITE, green=WHITE).save(out / "android-icon-monochrome.png")

# The notification icon lands in the status bar at 24dp. Two letters at that
# size are mush, so it gets the capital alone — the mark's first half, legible.
solo = glyph("C", 432, WHITE)
solo = solo.resize((int(solo.width * 300 / solo.height), 300), Image.LANCZOS)
note = Image.new("RGBA", (432, 432), (0, 0, 0, 0))
note.alpha_composite(solo, ((432 - solo.width) // 2, (432 - solo.height) // 2))
note.save(out / "notification-icon.png")

# Native splash. Transparent, on the same black the intro starts from.
fitted(1024, 0.86).save(out / "splash-icon.png")
fitted(64, 0.9, ground=BLACK).convert("RGB").save(out / "favicon.png")

print(f"wrote 7 icons to {out}")
