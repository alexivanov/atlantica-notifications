#!/usr/bin/env python3
"""
Generates the app icon: a Cycladic blue-domed chapel against an Aegean sunset.

Rendered at 4x and downsampled, because iOS icons are shown everywhere from
1024px on the App Store to 40px in Spotlight, and hand-rolled shapes alias
badly without supersampling.

Deliberately flat and high-contrast: at 40px the dome silhouette and the sea
band are all that survive, so those carry the design and the finer details
(cross, wave lines, sun) are a bonus at larger sizes.

Palette is anchored to the app's own accent (#f2b880) so the icon and the UI
read as one product.

    python3 scripts/make-icon.py
"""
from PIL import Image, ImageDraw

S = 1024
SS = 4  # supersample factor
W = S * SS


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def build() -> Image.Image:
    img = Image.new("RGB", (W, W))
    d = ImageDraw.Draw(img)

    # --- Sky: deep dusk blue at the top easing into a warm horizon ----------
    sky_top = (0x25, 0x3A, 0x6B)
    sky_mid = (0x6E, 0x7F, 0xA8)
    sky_low = (0xF2, 0xB8, 0x80)   # the app's accent
    horizon = (0xF9, 0xDA, 0xB4)

    sea_y = int(W * 0.72)
    for y in range(sea_y):
        t = y / sea_y
        if t < 0.45:
            c = lerp(sky_top, sky_mid, t / 0.45)
        elif t < 0.8:
            c = lerp(sky_mid, sky_low, (t - 0.45) / 0.35)
        else:
            c = lerp(sky_low, horizon, (t - 0.8) / 0.2)
        d.line([(0, y), (W, y)], fill=c)

    # --- Sun, low and soft, sitting just above the waterline ---------------
    sun_r = int(W * 0.135)
    sun_c = (int(W * 0.5), int(W * 0.60))
    for i in range(28, 0, -1):
        r = sun_r + int(i * W * 0.006)
        a = (28 - i) / 28.0
        glow = lerp(sky_low, (0xFF, 0xF0, 0xD8), a * 0.5)
        d.ellipse(
            [sun_c[0] - r, sun_c[1] - r, sun_c[0] + r, sun_c[1] + r], fill=glow
        )
    d.ellipse(
        [sun_c[0] - sun_r, sun_c[1] - sun_r, sun_c[0] + sun_r, sun_c[1] + sun_r],
        fill=(0xFF, 0xF4, 0xE0),
    )

    # --- Sea -----------------------------------------------------------------
    sea_top = (0x1E, 0x6E, 0xA8)
    sea_bot = (0x10, 0x35, 0x62)
    for y in range(sea_y, W):
        t = (y - sea_y) / (W - sea_y)
        d.line([(0, y), (W, y)], fill=lerp(sea_top, sea_bot, t))

    # Sun's reflection, broken into bands so it reads as water.
    for i, (dy, wd) in enumerate([(0.02, 0.10), (0.06, 0.14), (0.11, 0.09)]):
        y = sea_y + int(W * dy)
        half = int(W * wd / 2)
        h = int(W * 0.012)
        d.rounded_rectangle(
            [sun_c[0] - half, y, sun_c[0] + half, y + h],
            radius=h // 2,
            fill=lerp(sea_top, (0xFF, 0xE9, 0xC9), 0.55 - i * 0.12),
        )

    # --- Chapel: white cube, blue dome ---------------------------------------
    white = (0xFC, 0xFB, 0xF7)
    shade = (0xE2, 0xDD, 0xD2)
    dome_c = (0x2E, 0x86, 0xC7)
    dome_d = (0x1F, 0x63, 0x9B)

    body_w = int(W * 0.34)
    body_h = int(W * 0.20)
    body_x = int(W * 0.5 - body_w / 2)
    body_y = sea_y - body_h

    # Dome sits on a short drum above the body.
    drum_h = int(W * 0.035)
    dome_r = int(body_w * 0.34)
    dome_cx = int(W * 0.5)
    dome_cy = body_y - drum_h

    # Body, with one shaded face for a little depth.
    d.rectangle([body_x, body_y, body_x + body_w, body_y + body_h], fill=white)
    d.rectangle(
        [body_x + int(body_w * 0.72), body_y, body_x + body_w, body_y + body_h],
        fill=shade,
    )

    # Drum.
    drum_w = int(dome_r * 2.05)
    d.rectangle(
        [dome_cx - drum_w // 2, dome_cy, dome_cx + drum_w // 2, dome_cy + drum_h + 2],
        fill=white,
    )

    # Dome as a half-circle.
    d.pieslice(
        [dome_cx - dome_r, dome_cy - dome_r, dome_cx + dome_r, dome_cy + dome_r],
        start=180,
        end=360,
        fill=dome_c,
    )
    # Highlight, feathered in steps. A single lighter pieslice leaves a hard
    # vertical seam down the dome that reads as a rendering artefact.
    steps = 14
    for i in range(steps):
        t = i / steps
        w = int(dome_r * (0.62 - 0.62 * t))
        if w <= 2:
            break
        d.pieslice(
            [dome_cx - dome_r, dome_cy - dome_r, dome_cx - dome_r + w, dome_cy + dome_r],
            start=180,
            end=360,
            fill=lerp(dome_c, (0xFF, 0xFF, 0xFF), 0.05 + 0.16 * t),
        )
    d.arc(
        [dome_cx - dome_r, dome_cy - dome_r, dome_cx + dome_r, dome_cy + dome_r],
        start=180,
        end=360,
        fill=dome_d,
        width=int(W * 0.006),
    )

    # Cross.
    cw = int(W * 0.012)
    ch = int(W * 0.055)
    cross_y = dome_cy - dome_r
    d.rectangle(
        [dome_cx - cw // 2, cross_y - ch, dome_cx + cw // 2, cross_y + int(W * 0.004)],
        fill=white,
    )
    d.rectangle(
        [
            dome_cx - int(W * 0.021),
            cross_y - int(ch * 0.62),
            dome_cx + int(W * 0.021),
            cross_y - int(ch * 0.62) + cw,
        ],
        fill=white,
    )

    # Door and two windows — pure charm at large sizes, gone by 40px.
    door_w = int(body_w * 0.16)
    door_h = int(body_h * 0.52)
    door_x = dome_cx - door_w // 2
    door_y = body_y + body_h - door_h
    d.rounded_rectangle(
        [door_x, door_y, door_x + door_w, door_y + door_h],
        radius=door_w // 2,
        fill=dome_c,
    )
    win = int(body_w * 0.075)
    for off in (-0.26, 0.26):
        wx = int(dome_cx + body_w * off - win / 2)
        wy = body_y + int(body_h * 0.30)
        d.rectangle([wx, wy, wx + win, wy + win], fill=dome_c)

    return img.resize((S, S), Image.LANCZOS)


if __name__ == "__main__":
    import os

    here = os.path.dirname(os.path.abspath(__file__))
    assets = os.path.join(here, "..", "assets")

    icon = build()
    # iOS icons must be fully opaque -- any alpha is composited onto black.
    icon.convert("RGB").save(os.path.join(assets, "icon.png"))
    icon.resize((48, 48), Image.LANCZOS).save(os.path.join(assets, "favicon.png"))
    print("wrote assets/icon.png (1024) and assets/favicon.png (48)")
