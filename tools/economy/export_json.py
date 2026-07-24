"""
Genere economy_config.json a partir de model.py (source de verite unique).
Ce fichier est concu pour etre charge directement par le code du jeu.

ATTENTION (24/07/2026) : depuis la v8, economy_config.json contient trois blocs
ECRITS A LA MAIN que model.py ne connait pas et ne saura jamais recalculer :
build_slots (file multi-slots), offline_report (rapport de retour) et
energy_boost (rachat d'heures a l'energie). Ils sont recopies TELS QUELS depuis
le fichier existant — ce script ne doit jamais les detruire silencieusement.
Si un bloc manque a l'arrivee, on echoue bruyamment plutot que d'ecrire un
config ampute que le jeu chargerait avec des `undefined` partout.
"""
import json
import os
from model import (
    TOTAL_DAYS, TOTAL_HOURS, BUILD_HOURS_BUDGET, PARALLEL_UPLIFT,
    N_PARALLEL_BUILD_SLOTS, TIME_RATIO, PROD_RATIO,
    COST_RATIO, COST_SCALE, STARTING_STOCK, BASE_CAP,
    TIME_BUDGET_HOURS, BUILDING_META, OUT_OF_SCOPE_BUILDINGS,
    TIME_PER_LEVEL, PRODUCTION_PER_LEVEL, COST_PER_LEVEL, COST_RECIPES,
    RESOURCES_META, _paid_levels, storage_cap,
)
from simulate import run_simulation, PRODUCIBLE_RESOURCES

# Cible de l'ecriture : le fichier reellement charge par le jeu.
HERE = os.path.dirname(os.path.abspath(__file__))
TARGET = os.path.normpath(os.path.join(HERE, "..", "..", "src", "data", "economy_config.json"))

# Blocs regles a la main, hors modele : preserves a l'identique.
HANDWRITTEN_BLOCKS = ("build_slots", "offline_report", "energy_boost")


def load_handwritten():
    """Relit les blocs manuels du config existant. Echoue si l'un manque."""
    with open(TARGET, encoding="utf-8") as f:
        current = json.load(f)
    missing = [k for k in HANDWRITTEN_BLOCKS if k not in current]
    if missing:
        raise SystemExit(
            f"ABANDON : blocs manuels absents de {TARGET} : {missing}.\n"
            "Regenerer maintenant les supprimerait definitivement. "
            "Restaure le fichier (git checkout) avant de relancer."
        )
    kept = {k: current[k] for k in HANDWRITTEN_BLOCKS}
    # Mesure wall-clock multi-systemes : produite par simulate_full.py --write,
    # pas par model.py. On la reporte telle quelle pour ne pas la perdre.
    kept["_multi_system"] = current.get("pacing_validation", {}).get("multi_system_validation")
    return kept


def build_config(handwritten=None):
    handwritten = dict(handwritten if handwritten is not None else load_handwritten())
    multi_system = handwritten.pop("_multi_system", None)
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
        "$comment": "Ce bloc mesure le SOCLE : simulate.py, un joueur greedy sur UNE seule file, sans habitudes, sans peche, sans rachat d'heures. Depuis la v8 ce n'est plus la duree que vivra un vrai joueur — la file multi-slots et le rachat d'heures a l'energie compressent le temps reel. Le budget de chantiers cumulees a donc ete releve de PARALLEL_UPLIFT (cf. model.py) au-dessus de la cible wall-clock de 90 jours : ce socle vise BUILD_HOURS_BUDGET, pas 2160 h. La duree reellement vecue est mesuree par simulate_full.py (multi-systemes, par archetype) et reportee dans multi_system_validation ci-dessous.",
        "strategy_simulated": "greedy_fastest_upgrade_first (le joueur construit toujours la prochaine amelioration la moins longue disponible ; file de construction a 1 slot, aucun autre systeme)",
        "target_days": TOTAL_DAYS,
        "target_hours": TOTAL_HOURS,
        "build_hours_budget": BUILD_HOURS_BUDGET,
        "parallel_uplift": PARALLEL_UPLIFT,
        "simulated_total_hours": round(sim["elapsed_hours"], 1),
        "simulated_total_days": round(sim["elapsed_days"], 1),
        "construction_hours": round(sim["build_hours"], 1),
        "resource_wait_hours": round(sim["wait_hours"], 1),
        "resource_wait_pct_of_total": round(sim["wait_pct"], 1),
        "deviation_vs_build_budget_pct": round((sim["elapsed_hours"] / BUILD_HOURS_BUDGET - 1) * 100, 1),
        "conclusion": "Le temps de construction est le levier de pacing dominant (>96% du temps total) ; les couts en ressources ne bloquent la progression que marginalement (~3% de temps d'attente supplementaire) lorsque le joueur alterne les batiments de facon equilibree.",
    }
    if multi_system is not None:
        pacing_validation["multi_system_validation"] = multi_system

    config = {
        "$comment": "Modele economique complet et modifiable de l'Age 1 'Cellule' d'EVOLVE. Genere par economy/export_json.py a partir de economy/model.py (source de verite). Perimetre : 9 batiments (hors mini-jeux Peche/Bastion-Defense/Bastion-Raid, marques designed:false). Pour retoucher le calibrage : modifier les constantes en tete de model.py (PARALLEL_UPLIFT, TIME_BUDGET_SHARES, TIME_RATIO, PROD_RATIO, COST_RATIO, COST_SCALE, STARTING_STOCK, BASE_CAP) puis relancer 'python3 export_json.py' — le script reecrit src/data/economy_config.json en preservant les blocs regles a la main (build_slots, offline_report, energy_boost). Toute modification du calibrage doit etre revalidee par 'python3 simulate_full.py --seeds 12'.",
        "age": "age01_cellule",
        "global_params": {
            "total_target_days": TOTAL_DAYS,
            "total_target_hours": TOTAL_HOURS,
            "build_hours_budget": BUILD_HOURS_BUDGET,
            "n_parallel_build_slots": N_PARALLEL_BUILD_SLOTS,
            "time_ratio_per_level": TIME_RATIO,
            "production_ratio_per_level": PROD_RATIO,
            "cost_ratio_per_level": COST_RATIO,
            "cost_scale": COST_SCALE,
            "starting_stock_per_producible_resource": STARTING_STOCK,
            "base_storage_cap": BASE_CAP,
        },
        **handwritten,
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
    with open(TARGET, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"{TARGET} ecrit (blocs manuels preserves : {', '.join(HANDWRITTEN_BLOCKS)}).")
    print(json.dumps(cfg["pacing_validation"], ensure_ascii=False, indent=2))
