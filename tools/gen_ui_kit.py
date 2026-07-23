#!/usr/bin/env python3
"""Génère le kit UI pixel art organique (Âge 1 Cellule) via l'API PixelLab.
Idempotent (saute l'existant), retry avec backoff sur 429.
Usage : PIXELLAB_TOKEN=... python3 tools/gen_ui_kit.py
"""
import base64
import json
import os
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

TOKEN = os.environ.get("PIXELLAB_TOKEN", "")
OUT = os.path.join(os.path.dirname(__file__), "..", "public", "assets", "ui")
STYLE = "pixel art, organic cellular biotech style, dark abyssal palette, cyan #6df6ff and teal glow accents"

# (id, description, width, height, transparent)
ASSETS = [
    # Panneaux 9-slice
    ("panel_membrane", f"UI panel frame made of living cell membrane, rounded organic border with small vesicles, dark translucent center, {STYLE}", 128, 128, True),
    ("panel_noyau", f"ornate UI panel frame of nucleus tissue, reinforced organic header band on top, glowing rim, dark center, {STYLE}", 128, 128, True),
    ("panel_tooltip", f"small simple UI tooltip bubble frame, thin organic membrane border, dark center, {STYLE}", 96, 64, True),
    # Boutons (4 états, base 96x32, scalable)
    ("btn_normal", f"UI button, horizontal organic capsule of soft membrane tissue, subtle cyan rim light, idle state, {STYLE}", 96, 32, True),
    ("btn_hover", f"UI button, horizontal organic capsule of membrane tissue, bright cyan rim glow, highlighted hover state, {STYLE}", 96, 32, True),
    ("btn_pressed", f"UI button, horizontal organic capsule of membrane tissue, compressed and darker, pressed state, {STYLE}", 96, 32, True),
    ("btn_disabled", f"UI button, horizontal organic capsule of grey lifeless membrane, dim, disabled state, {STYLE}", 96, 32, True),
    # Jauges / barres
    ("bar_frame", f"empty UI progress bar frame, elongated organic tube of membrane with rounded ends, hollow dark interior, {STYLE}", 96, 16, True),
    ("bar_frame_large", f"empty UI progress bar frame, long organic vessel tube with rounded ends and small pores, hollow dark interior, {STYLE}", 128, 24, True),
    ("gauge_construction", f"circular UI gauge ring of cell membrane, open dark center, small tick pores around, {STYLE}", 48, 48, True),
    # Icônes navigation 32x32
    ("icon_base", f"UI icon of a small living cell with nucleus, {STYLE}", 32, 32, True),
    ("icon_habits", f"UI icon of a glowing checkmark inside an energy orb, {STYLE}", 32, 32, True),
    ("icon_mare", f"UI icon of a fishing hook with a small bubble, {STYLE}", 32, 32, True),
    ("icon_units", f"UI icon of a small aggressive bacteria warrior with tiny spikes, {STYLE}", 32, 32, True),
    ("icon_mutation", f"UI icon of a DNA helix with a spark, {STYLE}", 32, 32, True),
    ("icon_reports", f"UI icon of a scroll made of membrane tissue, {STYLE}", 32, 32, True),
    ("icon_settings", f"UI icon of an organic gear made of cell wall, {STYLE}", 32, 32, True),
    # Cadres de cartes (96x128) — 6 raretés + dos + slot vide
    ("card_commune", f"trading card frame, simple thin pale teal membrane border, empty dark center, {STYLE}", 96, 128, True),
    ("card_peucommune", f"trading card frame, green organic border with small buds, empty dark center, {STYLE}", 96, 128, True),
    ("card_rare", f"trading card frame, blue glowing organic border with flowing streaks, empty dark center, {STYLE}", 96, 128, True),
    ("card_epique", f"trading card frame, purple bioluminescent border with tendrils, empty dark center, {STYLE}", 96, 128, True),
    ("card_legendaire", f"trading card frame, golden radiant organic border with pulsing pores, empty dark center, {STYLE}", 96, 128, True),
    ("card_mythique", f"trading card frame, iridescent pink-white living border with aura, empty dark center, {STYLE}", 96, 128, True),
    ("card_back", f"trading card back, cell membrane texture with a glowing spiral emblem in center, {STYLE}", 96, 128, True),
    ("card_slot", f"empty card slot, dashed faint membrane outline, hollow, very dark, {STYLE}", 96, 128, True),
    # Overlays d'état bâtiment
    ("overlay_locked", f"UI overlay badge of an organic padlock wrapped in membrane, grey and dim, {STYLE}", 64, 64, True),
    ("overlay_construction", f"UI badge of a small cocoon wrapped in weaving filaments, under construction, {STYLE}", 64, 64, True),
    ("overlay_upgrade", f"UI badge of an upward glowing arrow made of light plasma, {STYLE}", 64, 64, True),
    # Divers
    ("check_habit", f"UI icon of a big satisfying glowing green checkmark, {STYLE}", 32, 32, True),
    ("notif_dot", f"tiny UI notification orb, bright magenta glowing sphere, {STYLE}", 32, 32, True),
    ("plus_minus", f"UI icon pair plus sign made of glowing plasma, {STYLE}", 32, 32, True),
    ("divider", f"thin horizontal UI divider, strand of glowing filament with small nodes, {STYLE}", 128, 16, True),
    # Fond
    ("bg_ocean", f"seamless background of primordial deep ocean water, floating plankton motes, faint light rays from above, very dark, {STYLE}", 256, 256, False),
]


def generate(aid, desc, w, h, transparent, attempt=1):
    path = os.path.join(OUT, f"age01_cell_ui_{aid}_v001.png")
    if os.path.exists(path):
        return f"skip  {aid}"
    req = urllib.request.Request(
        "https://api.pixellab.ai/v1/generate-image-pixflux",
        data=json.dumps({
            "description": desc,
            "image_size": {"width": w, "height": h},
            "no_background": transparent,
        }).encode(),
        headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            data = json.loads(r.read())
    except urllib.error.HTTPError as e:
        if e.code == 429 and attempt <= 4:
            time.sleep(20 * attempt)
            return generate(aid, desc, w, h, transparent, attempt + 1)
        raise
    with open(path, "wb") as f:
        f.write(base64.b64decode(data["image"]["base64"]))
    return f"OK    {aid}"


def main():
    if not TOKEN:
        print("PIXELLAB_TOKEN manquant", file=sys.stderr)
        return 1
    os.makedirs(OUT, exist_ok=True)
    fails = 0
    with ThreadPoolExecutor(max_workers=3) as ex:
        futs = {ex.submit(generate, *a): a[0] for a in ASSETS}
        for fut in as_completed(futs):
            try:
                print(fut.result(), flush=True)
            except Exception as e:  # noqa: BLE001
                fails += 1
                print(f"FAIL  {futs[fut]}: {e}", flush=True)
    done = len([f for f in os.listdir(OUT) if f.endswith(".png")])
    print(f"--- {done}/{len(ASSETS)} assets UI présents, {fails} échecs ---")
    return 0


if __name__ == "__main__":
    sys.exit(main())
