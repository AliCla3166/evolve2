#!/usr/bin/env python3
"""Génère les portraits des nouvelles créatures de la Mare (extension collection
24/07, cf. docs/JOURNAL.md) via l'API PixelLab. Lit tools/portrait_jobs.json
(liste des espèces dont le portrait n'existe pas encore). Idempotent : saute les
fichiers déjà présents. Même style/résolution que tools/gen_portraits.py (64x64,
cohérence visuelle avec les 12 + 8 portraits déjà en place dans la collection).
Usage : PIXELLAB_TOKEN=... python3 tools/gen_species_portraits.py
"""
import base64
import json
import os
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

TOKEN = os.environ.get("PIXELLAB_TOKEN", "")
OUT = os.path.join(os.path.dirname(__file__), "..", "public", "assets", "portraits")
JOBS_PATH = os.path.join(os.path.dirname(__file__), "portrait_jobs.json")
STYLE = (
    "close-up face portrait, mystical alien creature, pixel art, "
    "glowing bioluminescent details, dark abyssal water background, "
    "front view, eerie and majestic"
)


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
    with open(JOBS_PATH, encoding="utf-8") as f:
        jobs = json.load(f)
    os.makedirs(OUT, exist_ok=True)
    failures = 0
    with ThreadPoolExecutor(max_workers=4) as ex:
        futs = {ex.submit(generate, j["id"], j["desc"]): j["id"] for j in jobs}
        for fut in as_completed(futs):
            pid = futs[fut]
            try:
                print(fut.result(), flush=True)
            except Exception as e:  # noqa: BLE001
                failures += 1
                print(f"FAIL  {pid}: {e}", flush=True)
    done = sum(
        1 for j in jobs
        if os.path.exists(os.path.join(OUT, f"age01_cell_portrait_{j['id']}_v001.png"))
    )
    print(f"--- {done}/{len(jobs)} portraits présents, {failures} échecs ce run ---")
    return 0


if __name__ == "__main__":
    sys.exit(main())
