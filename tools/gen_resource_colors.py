#!/usr/bin/env python3
"""Recolore les 8 icônes de ressources (public/assets/resources/*.png) en
duotone — une couleur distincte par ressource, alignée sur le mapping COLORS
de src/components/game/Hud.tsx — tout en conservant la forme/l'ombrage
d'origine (luminance -> dégradé sombre/couleur/clair).

Retour utilisateur (juillet 2026) : les icônes se ressemblaient trop pour
être identifiées d'un coup d'oeil. Relancer ce script si de nouvelles
ressources sont ajoutées ou si le mapping de couleurs change — il écrase les
PNG en place, donc versionner/sauvegarder avant de le relancer avec d'autres
teintes.
"""

from PIL import Image
import os

ASSETS = "public/assets/resources"

COLORS = {
    "energie": "#ff54d6",
    "vitalite": "#7ef7c1",
    "adn": "#6df6ff",
    "proteine": "#ffb347",
    "biomasse": "#a6ff3d",
    "enzyme": "#3fe0d8",
    "lipide": "#ffd15c",
    "signaux": "#c48bff",
}


def hex_to_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i : i + 2], 16) for i in (0, 2, 4))


def recolor(path, hexcolor):
    im = Image.open(path).convert("RGBA")
    r, g, b = hex_to_rgb(hexcolor)
    w, h = im.size
    px = im.load()
    for y in range(h):
        for x in range(w):
            R, G, B, A = px[x, y]
            if A == 0:
                continue
            lum = (0.3 * R + 0.59 * G + 0.11 * B) / 255.0
            if lum < 0.5:
                t = lum / 0.5
                nr, ng, nb = r * (0.32 + 0.68 * t), g * (0.32 + 0.68 * t), b * (0.32 + 0.68 * t)
            else:
                t = (lum - 0.5) / 0.5
                nr = r + (255 - r) * t * 0.6
                ng = g + (255 - g) * t * 0.6
                nb = b + (255 - b) * t * 0.6
            px[x, y] = (
                int(max(0, min(255, nr))),
                int(max(0, min(255, ng))),
                int(max(0, min(255, nb))),
                A,
            )
    im.save(path)


if __name__ == "__main__":
    for res, color in COLORS.items():
        p = os.path.join(ASSETS, f"{res}.png")
        if os.path.exists(p):
            recolor(p, color)
            print("recolored", p, "->", color)
        else:
            print("MISSING", p)
