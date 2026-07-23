"""
Genere economy_config.json a partir de model.py (source de verite unique).
Ce fichier est concu pour etre charge directement par le code du jeu.
"""
import json
from model import (
    TOTAL_DAYS, TOTAL_HOURS, N_PARALLEL_BUILD_SLOTS, TIME_RATIO, PROD_RATIO,
    COST_RATIO, COST_SCALE, STARTING_STOCK, BASE_CAP,
    TIME_BUDGET_HOURS, BUILDING_META, OUT_OF_SCOPE_BUILDINGS,
    TIME_PER_LEVEL, PRODUCTION_PER_LEVEL, COST_PER_LEVEL, COST_RECIPES,
    RESOURCES_META, _paid_levels, storage_cap,
)
from simulate import run_simulation, PRODUCIBLE_RESOURCES

def build_config():
    sim = run_simulation(verbose=False)

    buildings = {}
    for b, meta in BUILDING_META.items():
        paid_levels = _paid_levels(b)
        levels_out = {}
        for lvl in range(1, 6):
            entry = {
                "unlocked_at_start": (b == "noyau" and lvl == 1),
            }
            if lvl in paid_levels:
                entry["build_time_hours"] = round(TIME_PER_LEVEL[b][lvl], 2)
                entry["cost"] = COST_PER_LEVEL[b][lvl]
            else:
                entry["build_time_hours"] = 0
                entry["cost"] = {}
            if b in PRODUCTION_PER_LEVEL:
                entry["production_per_hour"] = {
                    meta.get("resource", "vitalite"): round(PRODUCTION_PER_LEVEL[b][lvl], 3)
                }
            levels_out[str(lvl)] = entry

        buildings[b] = {
            "name": meta["name"],
            "family": meta["family"],
            "role": meta["role"],
            "designed": True,
            "total_time_budget_hours": TIME_BUDGET_HOURS[b],
            "cost_recipe_resources": list(COST_RECIPES[b].keys()),
            "sprite_levels": {
                str(lvl): f"assets/buildings/{b}/niveau{lvl}.png" for lvl in range(1, 6)
            },
            "levels": levels_out,
        }

    for b, meta in OUT_OF_SCOPE_BUILDINGS.items():
        buildings[b] = {
            "name": meta["name"],
            "family": meta["family"],
            "role": "minigame_gate",
            "designed": False,
            "note": meta["note"],
            "sprite_levels": {
                str(lvl): f"assets/buildings/{b}/niveau{lvl}.png" for lvl in range(1, 6)
            },
            "levels": {},
        }

    storage = {
        "formula": "cap(resource) = BASE_CAP * (1 + 0.5*(noyau_level-1) + 0.5*(biomasse_level-1))",
        "base_cap": BASE_CAP,
        "applies_to": PRODUCIBLE_RESOURCES,
        "note": "Le plafond de stockage global (partage par les 6 ressources productibles) croit avec le niveau du Noyau ET du Producteur de biomasse (fiction etablie). Si la biomasse n'est pas encore construite (niveau 0), seul le bonus du Noyau s'applique.",
        "table_noyau_x_biomasse": {
            f"noyau{n}_biomasse{b}": storage_cap(n, b)
            for n in range(1, 6) for b in range(0, 6)
        },
    }

    pacing_validation = {
        "strategy_simulated": "greedy_fastest_upgrade_first (le joueur construit toujours la prochaine amelioration la moins longue disponible ; file de construction a 1 slot)",
        "target_days": TOTAL_DAYS,
        "target_hours": TOTAL_HOURS,
        "simulated_total_hours": round(sim["elapsed_hours"], 1),
        "simulated_total_days": round(sim["elapsed_days"], 1),
        "construction_hours": round(sim["build_hours"], 1),
        "resource_wait_hours": round(sim["wait_hours"], 1),
        "resource_wait_pct_of_total": round(sim["wait_pct"], 1),
        "deviation_vs_target_pct": round((sim["elapsed_hours"] / TOTAL_HOURS - 1) * 100, 1),
        "conclusion": "Le temps de construction est le levier de pacing dominant (>96% du temps total) ; les couts en ressources ne bloquent la progression que marginalement (~3% de temps d'attente supplementaire) lorsque le joueur alterne les batiments de facon equilibree.",
    }

    config = {
        "$comment": "Modele economique complet et modifiable de l'Age 1 'Cellule' d'EVOLVE. Genere par economy/export_json.py a partir de economy/model.py (source de verite). Perimetre : 9 batiments (hors mini-jeux Peche/Bastion-Defense/Bastion-Raid, marques designed:false). Pour retoucher le calibrage : modifier les constantes en tete de model.py (TIME_BUDGET_HOURS, TIME_RATIO, PROD_RATIO, COST_RATIO, COST_SCALE, STARTING_STOCK, BASE_CAP) puis relancer 'python3 export_json.py'.",
        "age": "age01_cellule",
        "global_params": {
            "total_target_days": TOTAL_DAYS,
            "total_target_hours": TOTAL_HOURS,
            "n_parallel_build_slots": N_PARALLEL_BUILD_SLOTS,
            "time_ratio_per_level": TIME_RATIO,
            "production_ratio_per_level": PROD_RATIO,
            "cost_ratio_per_level": COST_RATIO,
            "cost_scale": COST_SCALE,
            "starting_stock_per_producible_resource": STARTING_STOCK,
            "base_storage_cap": BASE_CAP,
        },
        "buildings": buildings,
        "resources": RESOURCES_META,
        "storage": storage,
        "pacing_validation": pacing_validation,
        "envelope_stages_ref": "cf. assets/manifest.json -> envelope_stages (trigger = nombre de batiments construits, inchange par ce document)",
        "related_docs": {
            "charte_graphique": "Charte Graphique - Age 1 Cellulaire.dc.html",
            "assets_manifest": "assets/manifest.json",
            "background_lore_notion": "https://app.notion.com/p/3a6e0615d7f281b4b3abd2499c50727c",
            "conception_technique_notion": "https://app.notion.com/p/3a6e0615d7f281529b83e2fcb70fcdf2",
        },
    }
    return config

if __name__ == "__main__":
    cfg = build_config()
    with open("economy_config.json", "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)
    print("economy_config.json ecrit.")
    print(json.dumps(cfg["pacing_validation"], ensure_ascii=False, indent=2))
