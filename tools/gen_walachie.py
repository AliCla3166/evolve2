#!/usr/bin/env python3
"""Genere les assets pixel art du mode Walachie via l'API PixelLab.
Idempotent (saute l'existant), retry avec backoff sur 429.
Usage : PIXELLAB_TOKEN=... python3 tools/gen_walachie.py
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
OUT = os.path.join(os.path.dirname(__file__), "..", "public", "assets", "walachie")
API = "https://api.pixellab.ai/v1/generate-image-pixflux"

# Direction artistique Walachie : exoplanete, realisme scientifique, palette
# violet-magenta-emeraude, bioluminescence — distincte de la palette Cellule.
STYLE = (
    "pixel art, scientific realistic style, alien exoplanet ecosystem, "
    "bioluminescent violet magenta and emerald palette, detailed shading, "
    "seen from above in three-quarter top-down view, dark alien soil background"
)
STYLE_ICON = (
    "pixel art icon, scientific alien style, bioluminescent violet magenta emerald glow, "
    "dark background, centered symbol"
)
# Decors : UN SEUL grand tableau peint par groupe d'eres (remplace le quadrillage
# de petites tuiles) — WalachieScene dessine ce fond plein cadre, sans repetition
# visible, et les creatures se deplacent librement par-dessus.
STYLE_DECOR = (
    "pixel art, scientific realistic style, alien exoplanet landscape, wide scenic backdrop, "
    "bioluminescent violet magenta and emerald palette, atmospheric depth, painterly detail, "
    "no characters, background scenery only"
)

# (id, description, width, height, transparent)
ASSETS = [
    # --- Tuiles de sol (opaques, tuilables) ---
    ("sol_seve", f"seamless ground tile of dark violet alien soil with thin glowing emerald sap veins, {STYLE}", 64, 64, False),
    ("sol_mousse", f"seamless ground tile of dense radiant teal alien moss with tiny glowing spores, {STYLE}", 64, 64, False),
    ("sol_roche", f"seamless ground tile of cracked purple alien rock with faint magenta crystal shards, {STYLE}", 64, 64, False),
    # --- Flore ---
    ("flore_spores", f"cluster of small alien spore pods releasing glowing motes, alien plant, {STYLE}", 64, 64, True),
    ("flore_helice", f"alien helix shaped photosynthetic plant, spiral translucent leaves glowing emerald, {STYLE}", 64, 64, True),
    ("flore_lanterne", f"alien lantern plant, hanging glowing magenta bulbs on thin curved stem, {STYLE}", 64, 64, True),
    ("flore_voile", f"alien veil plant, tall translucent singing membranes like sails, cyan glow, {STYLE}", 64, 64, True),
    ("flore_arbrelum", f"large alien light-tree, twisted trunk with canopy of bioluminescent violet fronds, Pandora style, {STYLE}", 96, 96, True),
    ("flore_corail", f"land coral reef formation, branching alien coral in magenta and emerald, {STYLE}", 64, 64, True),
    # --- Faune ---
    ("faune_sporule", f"tiny drifting alien sporule creature, translucent bell with glowing nucleus, {STYLE}", 48, 48, True),
    ("faune_rampant", f"small alien crawler creature, segmented invertebrate with bioluminescent dots, {STYLE}", 48, 48, True),
    ("faune_brouteur", f"alien grazer creature, six legged herbivore with armored emerald back plates, {STYLE}", 64, 64, True),
    ("faune_meduse", f"floating alien air jellyfish, translucent dome and glowing magenta tendrils, {STYLE}", 64, 64, True),
    ("faune_errant", f"colossal alien wanderer megafauna, long legged giant with mossy back carrying plants, {STYLE}", 96, 96, True),
    ("faune_predateur", f"lean alien predator with oversized fearsome jaw, thin fast body, avian raptor stance, {STYLE}", 64, 64, True),
    # --- Walachiens (creatures fines, grosse machoire, gardiens de la nature) ---
    ("walachien_primitif", f"primitive alien humanoid hunter, thin wiry body, elongated skull with huge fearsome jaw, avian legs, carrying bone spear, kroot-like, {STYLE}", 64, 64, True),
    ("walachien_tribal", f"tribal alien humanoid shaman, thin body, huge jaw, glowing war paint and feather totems, kroot-like, {STYLE}", 64, 64, True),
    ("walachien_sentinelle", f"alien sentinel warrior in sleek fluorescent bio-armor, thin tall body, huge jaw helmet, energy rifle, guardian of nature, kroot-like, {STYLE}", 64, 64, True),
    ("walachien_ancien", f"ancient alien elder, very tall thin luminous body, immense jaw, robes of living light, {STYLE}", 64, 64, True),
    # --- Structures ---
    ("totem_fluo", f"alien tribal totem pole of carved bone and glowing fluorescent runes, {STYLE}", 64, 64, True),
    ("hutte_fluo", f"alien tribal hut grown from living plants with glowing membrane windows, {STYLE}", 64, 64, True),
    ("spire_fluo", f"fluorescent alien city spire, organic tower of light woven with vegetation, {STYLE}", 96, 96, True),
    ("portail_divin", f"divine alien portal, ring of pure light surrounded by floating glowing glyphs, {STYLE}", 96, 96, True),
    ("divinite", f"alien deity of life, radiant translucent figure of light with many eyes and branching antlers of energy, {STYLE}", 96, 96, True),
    # --- Icones d'eres (32x32) ---
    ("ere_protoplanete", f"molten protoplanet sphere with accretion ring, {STYLE_ICON}", 32, 32, True),
    ("ere_ocean", f"drop of glowing emerald sap with a wave, {STYLE_ICON}", 32, 32, True),
    ("ere_protovie", f"single alien proto cell with double nucleus, {STYLE_ICON}", 32, 32, True),
    ("ere_flore", f"glowing alien sprout with spiral leaf, {STYLE_ICON}", 32, 32, True),
    ("ere_faune", f"small alien crawler silhouette with glowing dots, {STYLE_ICON}", 32, 32, True),
    ("ere_errants", f"giant creature silhouette with long legs, {STYLE_ICON}", 32, 32, True),
    ("ere_predateurs", f"fearsome alien jaw skull, {STYLE_ICON}", 32, 32, True),
    ("ere_eveil", f"alien skull with a glowing spark of consciousness, {STYLE_ICON}", 32, 32, True),
    ("ere_tribus", f"tribal bone totem with glowing runes, {STYLE_ICON}", 32, 32, True),
    ("ere_civilisation", f"fluorescent organic city spire, {STYLE_ICON}", 32, 32, True),
    ("ere_sentinelles", f"sleek alien warrior helmet with huge jaw, {STYLE_ICON}", 32, 32, True),
    ("ere_ascension", f"ring of divine light with rising figure, {STYLE_ICON}", 32, 32, True),
    ("ere_essaimage", f"small seed-ship trailing a glowing trail toward a tiny planet, {STYLE_ICON}", 32, 32, True),
    ("ere_choeur", f"cluster of connected stars forming a constellation glyph, {STYLE_ICON}", 32, 32, True),
    ("ere_toile", f"spiral galaxy icon with a glowing core, {STYLE_ICON}", 32, 32, True),
    # --- Nouvelles creatures des eres post-Ascension ---
    ("nef_semence", f"small organic seed-ship alien vessel trailing glowing spores, sleek biological hull, {STYLE}", 64, 64, True),
    ("sentinelle_stellaire", f"alien sentinel guardian made of starlight, thin tall body huge jaw silhouette, glowing constellation patterns, {STYLE}", 64, 64, True),
    ("choeur_etoiles", f"ethereal alien being woven from starlight and song, glowing translucent humanoid form, {STYLE}", 64, 64, True),
    ("toile_vivante", f"living galactic web creature, glowing thread-like tendrils spiraling like a small galaxy, {STYLE}", 96, 96, True),
    # --- Decors plein-cadre (un par groupe d'eres, PAS transparents, taille max API 400x300) ---
    ("decor_espace", f"lone rocky protoplanet cooling in the void of space, glowing magma cracks across the surface, faint distant starfield, seen from orbit, {STYLE_DECOR}", 400, 300, False),
    ("decor_primordial", f"steaming primordial soup lagoon on a young alien world, glowing emerald geysers bubbling at the volcanic rim, {STYLE_DECOR}", 400, 300, False),
    ("decor_eaux", f"shallow bioluminescent alien sea, glowing kelp forests underwater and radiant coral near the surface, {STYLE_DECOR}", 400, 300, False),
    ("decor_rivage", f"vast alien plains meeting a rocky shoreline, distant silhouettes of giant wandering megafauna, dusk sky, {STYLE_DECOR}", 400, 300, False),
    ("decor_tribal", f"alien plains at night lit by scattered cold fluorescent campfires, distant tribal silhouettes, {STYLE_DECOR}", 400, 300, False),
    ("decor_village", f"cluster of living alien huts grown from glowing plants around carved totem poles, dusk light, {STYLE_DECOR}", 400, 300, False),
    ("decor_cite", f"organic fluorescent alien city of spire towers woven with vegetation, glowing night skyline, {STYLE_DECOR}", 400, 300, False),
    ("decor_orbite", f"view of a whole alien planet from low orbit, glowing city lights scattered across continents, thin atmosphere glow, {STYLE_DECOR}", 400, 300, False),
    ("decor_portail", f"an alien planet bathed in radiant divine light, a giant ring-shaped portal opening above it in space, {STYLE_DECOR}", 400, 300, False),
    ("decor_systeme", f"view of an alien star system from space, several planets connected by faint glowing travel trails of seed-ships, {STYLE_DECOR}", 400, 300, False),
    ("decor_stellaire", f"a constellation map of stars connected by glowing threads of light in deep space, {STYLE_DECOR}", 400, 300, False),
    ("decor_galactique", f"a vast spiral galaxy seen from above, glowing spiral arms of stars against deep space, {STYLE_DECOR}", 400, 300, False),
]


def gen_one(asset):
    aid, desc, w, h, transparent = asset
    path = os.path.join(OUT, f"{aid}.png")
    if os.path.exists(path):
        return aid, "skip"
    body = {
        "description": desc,
        "image_size": {"width": w, "height": h},
        "no_background": transparent,
    }
    data = json.dumps(body).encode()
    for attempt in range(6):
        req = urllib.request.Request(
            API,
            data=data,
            headers={
                "Authorization": f"Bearer {TOKEN}",
                "Content-Type": "application/json",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                out = json.loads(r.read())
            b64 = out["image"]["base64"]
            with open(path, "wb") as f:
                f.write(base64.b64decode(b64))
            return aid, "ok"
        except urllib.error.HTTPError as e:
            if e.code == 429:
                time.sleep(8 * (attempt + 1))
                continue
            return aid, f"HTTP {e.code}: {e.read()[:200]}"
        except Exception:  # noqa: BLE001
            time.sleep(4)
    return aid, "echec apres retries"


def main():
    if not TOKEN:
        sys.exit("PIXELLAB_TOKEN manquant")
    os.makedirs(OUT, exist_ok=True)
    with ThreadPoolExecutor(max_workers=4) as ex:
        futures = [ex.submit(gen_one, a) for a in ASSETS]
        for fut in as_completed(futures):
            aid, status = fut.result()
            print(f"{aid}: {status}", flush=True)


if __name__ == "__main__":
    main()
