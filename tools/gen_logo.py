#!/usr/bin/env python3
"""Genere le master du logo/emblene de l'app (icone PWA) via l'API PixelLab.

Contrairement a l'ancien icon-192/512/apple-touch-icon (crop PIL du sprite
Noyau Nv5, Phase 8), ceci est un dessin dedie, pense pour rester lisible en
tres petit format (favicon, icone d'accueil telephone) : silhouette large et
epaisse, pas de pointes fines (elles disparaissent en dessous de 48px).

Ce script produit tools/logo_master.png (128x128, fond transparent). Les 4
fichiers reellement servis (public/icons/icon-192.png, icon-512.png,
icon-512-maskable.png, apple-touch-icon.png) sont ensuite composes a la main
a partir de ce master : fond plein #050b14 (meme couleur que theme_color du
manifest), redimensionnement NEAREST (garde le pixel art net) sans marge
supplementaire (le master a deja ~69% de remplissage du canvas, sous le
seuil de 80% recommande pour la safe zone maskable).

Trois autres variantes ont ete testees et rejetees a la lecture a 32/48px
(gen_logo_variants_notes, non conserve) : un anneau charge de petits points
"organelles" qui se brouillait en dessous de 48px, et un anneau a crenelures
trop proche visuellement d'une icone de reglages (roue dentee). Celle-ci
(deux anneaux epais concentriques + coeur blanc) est celle qui restait la
plus lisible et la plus distincte a toutes les tailles testees.

Usage : PIXELLAB_TOKEN=... python3 tools/gen_logo.py
Idempotent : ne regenere pas si tools/logo_master.png existe deja.
"""
import base64
import json
import os
import sys
import urllib.error
import urllib.request

TOKEN = os.environ.get("PIXELLAB_TOKEN", "")
OUT = os.path.join(os.path.dirname(__file__), "logo_master.png")
DESCRIPTION = (
    "bold single-cell emblem, two concentric thick smooth rings (outer teal "
    "#3fe0d8, inner bright cyan #6df6ff) around a small glowing white "
    "nucleus core, centered and symmetric, high contrast, extremely simple "
    "clean silhouette readable tiny, pixel art app icon, organic cellular "
    "biotech style, dark abyssal palette, no text, no letters"
)


def main() -> int:
    if os.path.exists(OUT):
        print("skip  logo_master.png existe deja")
        return 0
    if not TOKEN:
        print("PIXELLAB_TOKEN manquant", file=sys.stderr)
        return 1
    req = urllib.request.Request(
        "https://api.pixellab.ai/v1/generate-image-pixflux",
        data=json.dumps(
            {
                "description": DESCRIPTION,
                "image_size": {"width": 128, "height": 128},
                "no_background": True,
            }
        ).encode(),
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            data = json.loads(r.read())
    except urllib.error.HTTPError as e:
        print(f"HTTP {e.code}: {e.read().decode(errors='replace')}", file=sys.stderr)
        return 1
    with open(OUT, "wb") as f:
        f.write(base64.b64decode(data["image"]["base64"]))
    print("OK    logo_master.png")
    return 0


if __name__ == "__main__":
    sys.exit(main())
