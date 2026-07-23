#!/usr/bin/env python3
"""Génère les 20 portraits alien 64x64 (création de perso) via l'API PixelLab.
Idempotent : saute les fichiers déjà présents. Concurrence limitée à 4.
Usage : PIXELLAB_TOKEN=... python3 tools/gen_portraits.py
"""
import base64
import json
import os
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

TOKEN = os.environ.get("PIXELLAB_TOKEN", "")
OUT = os.path.join(os.path.dirname(__file__), "..", "public", "assets", "portraits")
STYLE = (
    "close-up face portrait, mystical alien creature, pixel art, "
    "glowing bioluminescent details, dark abyssal water background, "
    "front view, eerie and majestic"
)

PORTRAITS = [
    ("abyssal", "deep-sea abyssal creature with multiple glowing amber eyes"),
    ("meduse", "ethereal jellyfish being with luminous trailing veils, translucent cyan"),
    ("crustace", "crystalline crustacean with faceted gemstone shell, teal glow"),
    ("larve", "stellar larva with constellation freckles on pale skin"),
    ("cephalopode", "dreaming cephalopod with heavy-lidded eye and coiled tentacles"),
    ("predateur", "ciliated predator with needle teeth and sweeping cilia crown"),
    ("symbiote", "twin symbiotic organisms fused, two small faces sharing one body"),
    ("spore", "awakened spore with a single opening eye, cracked glowing shell"),
    ("lanterne", "ancestral lanternfish with hanging glowing lure, scarred skin"),
    ("amibe", "royal amoeba with crown-like membrane folds, regal violet glow"),
    ("trilobite", "chromed trilobite with mirror-metal segmented shell"),
    ("hydre", "nascent hydra with three budding heads, soft green glow"),
    ("ver", "bioluminescent worm with ringed segments of pulsing light"),
    ("diatomee", "jewel diatom with geometric glass shell, prismatic light"),
    ("embryon", "cosmic embryo curled in a translucent orb, nebula colors"),
    ("radiolaire", "architect radiolarian with intricate lattice skeleton, white-gold"),
    ("planaire", "two-faced planarian, mirrored faces on one flat head"),
    ("colonie", "colony organism forming a single large face from many small cells"),
    ("archee", "archaea of the deep vents, rugged fire-lit silhouette"),
    ("germe", "divine germ radiating soft golden light, serene closed eyes"),
]


def generate(pid: str, desc: str) -> str:
    path = os.path.join(OUT, f"age01_cell_portrait_{pid}_v001.png")
    if os.path.exists(path):
        return f"skip  {pid}"
    req = urllib.request.Request(
        "https://api.pixellab.ai/v1/generate-image-pixflux",
        data=json.dumps(
            {
                "description": f"{desc}, {STYLE}",
                "image_size": {"width": 64, "height": 64},
                "no_background": False,
            }
        ).encode(),
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=180) as r:
        data = json.loads(r.read())
    with open(path, "wb") as f:
        f.write(base64.b64decode(data["image"]["base64"]))
    return f"OK    {pid}"


def main() -> int:
    if not TOKEN:
        print("PIXELLAB_TOKEN manquant", file=sys.stderr)
        return 1
    os.makedirs(OUT, exist_ok=True)
    failures = 0
    with ThreadPoolExecutor(max_workers=4) as ex:
        futs = {ex.submit(generate, pid, desc): pid for pid, desc in PORTRAITS}
        for fut in as_completed(futs):
            pid = futs[fut]
            try:
                print(fut.result(), flush=True)
            except Exception as e:  # noqa: BLE001
                failures += 1
                print(f"FAIL  {pid}: {e}", flush=True)
    done = len([f for f in os.listdir(OUT) if f.endswith(".png")])
    print(f"--- {done}/20 portraits présents, {failures} échecs ce run ---")
    return 0


if __name__ == "__main__":
    sys.exit(main())
