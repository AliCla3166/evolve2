"""
Phase 7 -- Simulation COMPLETE 90 jours (economie + militaire + Mare + evenements).

Contrairement a simulate.py (validation pure de l'economie des batiments, joueur
24/7), ce simulateur lit les TROIS configs livrees dans le jeu (source de verite :
src/data/*.json) et simule un joueur REALISTE par sessions quotidiennes :

  - habitudes -> energie creditee chaque matin (selon l'archetype) ;
  - a chaque session : lancer le meilleur chantier (glouton temps-le-plus-court,
    strategie validee par simulate.py), envoyer des expeditions, recruter si la
    prochaine vague menace, acheter des jetons et pecher ;
  - vagues de pathogenes, evenements aleatoires, cartes assignees automatiquement.

Metriques de sortie (par archetype, moyenne sur N graines) :
  - jour "tout Nv3" et jour "tout Nv5" (proxy d'ascension -- cible ~90 j +/-10 %) ;
  - part du revenu total venant des expeditions/evenements (cible <= ~30 %) ;
  - taux de vagues repoussees, cartes collectionnees, mythiques pechees.

Usage : python3 simulate_full.py [--seeds 30]
"""
import json
import random
import argparse
from pathlib import Path

DATA = Path(__file__).resolve().parents[2] / "src" / "data"
ECO = json.loads((DATA / "economy_config.json").read_text())
MIL = json.loads((DATA / "military_config.json").read_text())
MARE = json.loads((DATA / "mare_config.json").read_text())

PRODUCIBLE = ["adn", "proteine", "biomasse", "enzyme", "lipide", "signaux"]
DESIGNED = [b for b, cfg in ECO["buildings"].items() if cfg["designed"]]
UNITS = list(MIL["units"].keys())
RAR = MARE["rarities"]

# ---------------------------------------------------------------- archetypes
ARCHETYPES = {
    # energie/jour moyenne, heures de session, jetons max/jour
    "assidu":      {"energy": 85, "sessions": [8, 13, 18, 22], "jetons": 3},
    "regulier":    {"energy": 65, "sessions": [8, 20],          "jetons": 2},
    "dilettante":  {"energy": 40, "sessions": [20],             "jetons": 1},
}

# ---------------------------------------------------------------- helpers eco
def lvl_cfg(b, lvl):
    return ECO["buildings"][b]["levels"].get(str(lvl))

def storage_cap(levels):
    base = ECO["storage"]["base_cap"]
    noyau = max(1, levels["noyau"])
    biomasse = max(1, levels.get("biomasse", 0))
    return base * (1 + 0.5 * (noyau - 1) + 0.5 * (biomasse - 1))

def production_per_hour(levels):
    out = {r: 0.0 for r in PRODUCIBLE}
    out["vitalite"] = 0.0
    for b, lvl in levels.items():
        if lvl <= 0:
            continue
        prod = (lvl_cfg(b, lvl) or {}).get("production_per_hour", {})
        for r, v in prod.items():
            out[r] = out.get(r, 0.0) + v
    return out

# ---------------------------------------------------------------- militaire
def success_chance(exp_power, atk_power, difficulty, risk):
    s = MIL["expeditions"]["success"]
    risk_eff = risk * (1 - min(0.5, atk_power / max(1, difficulty)))
    p = s["base"] + s["ratio_weight"] * min(1.0, exp_power / max(1, difficulty)) - s["risk_weight"] * risk_eff
    return min(s["max"], max(s["min"], p))

def wave_power(day):
    p = MIL["pathogens"]
    growth = min(p["wave_power_growth_cap"], p["wave_power_growth_per_day"] * day)
    return p["wave_power_base"] * (1 + growth)

# ---------------------------------------------------------------- cartes
def card_level(count):
    return max(1, sum(1 for t in MARE["level_thresholds"] if count >= t))

def card_mult(entry):
    return RAR[entry["best"]]["power_mult"] * (1 + MARE["level_power_bonus"] * (card_level(entry["count"]) - 1))

def cards_bonus(collection, species_by_id, role_key, top_n):
    powers = sorted(
        (sp[role_key] * card_mult(e) for sid, e in collection.items() for sp in [species_by_id[sid]]),
        reverse=True,
    )
    return sum(powers[:top_n])

# ---------------------------------------------------------------- simulation
def simulate(archetype, seed, max_days=150, verbose=False):
    rng = random.Random(seed)
    arch = ARCHETYPES[archetype]
    species_by_id = {s["id"]: s for s in MARE["species"]}

    levels = {b: (1 if b == "noyau" else 0) for b in ECO["buildings"]}
    stock = {r: float(ECO["global_params"]["starting_stock_per_producible_resource"]) for r in PRODUCIBLE}
    stock["vitalite"] = 0.0
    energie = 0.0
    units = {u: 0 for u in UNITS}
    build_end = None          # (fin_h, batiment, niveau)
    expeditions = []          # [(fin_h, exp_power, atk_power, difficulty, risk, tier, squad)]
    collection = {}
    fragments = 0
    next_wave_h = MIL["pathogens"]["first_attack_delay_h"]
    next_event_h = rng.uniform(*MIL["events"]["interval_h"])
    income = {"production": 0.0, "expeditions": 0.0, "evenements": 0.0}
    stats = {"waves": 0, "waves_won": 0, "catches": 0, "mythiques": 0, "exp_sent": 0, "exp_ok": 0,
             "day_all3": None, "day_all5": None}

    def deployed():
        d = {u: 0 for u in UNITS}
        for e in expeditions:
            for u in UNITS:
                d[u] += e[6].get(u, 0)
        return d

    def defense_power():
        dep = deployed()
        p = MIL["pathogens"]
        return ((units["garde"] - dep["garde"]) * MIL["units"]["garde"]["power_def"]
                + levels["membrane"] * p["defense_membrane_bonus_per_level"]
                + max(1, levels["noyau"]) * p["defense_noyau_bonus_per_level"]
                + cards_bonus(collection, species_by_id, "power_def", MARE["assign_slots"]["defense"]))

    def add_stock(res, amount, source):
        if res == "energie":
            nonlocal energie
            energie = min(9999, energie + amount)
            return
        if res not in stock:
            return
        cap = storage_cap(levels) if res in PRODUCIBLE else float("inf")
        gained = min(cap, stock[res] + amount) - stock[res]
        stock[res] += gained
        income[source] += max(0.0, gained)

    def affordable(cost):
        return all((stock.get(r, energie if r == "energie" else 0) if r != "energie" else energie) >= v
                   for r, v in cost.items())

    def pay(cost):
        nonlocal energie
        for r, v in cost.items():
            if r == "energie":
                energie -= v
            else:
                stock[r] -= v

    def next_build_choice():
        # Glouton REALISTE : parmi les ameliorations dont le cout tient sous le
        # cap de stockage (sinon injouable tant que le cap n'a pas grandi),
        # prendre la moins longue AFFORDABLE maintenant ; sinon attendre la
        # moins longue atteignable. Decouverte de design validee : a "tout Nv4",
        # seul le Noyau Nv5 tient sous le cap -> le jeu force "le Noyau d'abord".
        cap = storage_cap(levels)
        affordable_now, reachable = None, None
        for b in DESIGNED:
            nxt = levels[b] + 1
            cfg = lvl_cfg(b, nxt)
            if not cfg:
                continue
            cost = cfg["cost"]
            if any(v > cap for r, v in cost.items() if r in PRODUCIBLE):
                continue  # au-dela du cap : injouable pour l'instant
            key = cfg["build_time_hours"]
            if affordable(cost) and (affordable_now is None or key < affordable_now[0]):
                affordable_now = (key, b, nxt, cfg)
            if reachable is None or key < reachable[0]:
                reachable = (key, b, nxt, cfg)
        return affordable_now or reachable

    def try_recruit(u):
        cap = MIL["unit_cap"]["base"] + MIL["unit_cap"]["per_noyau_level"] * max(1, levels["noyau"])
        if sum(units.values()) >= cap:
            return False
        cost = MIL["units"][u]["cost"]
        if not affordable(cost):
            return False
        pay(cost)
        units[u] += 1
        return True

    def fish_once():
        nonlocal fragments
        # rarete de la paillette (poids), quality moyenne : 5% echappee, 75% q2, 20% q3
        weights = [r["weight"] for r in RAR]
        rar = rng.choices(range(len(RAR)), weights=weights)[0]
        q = rng.choices([0, 2, 3], weights=[5, 75, 20])[0]
        if q == 0:
            return
        if rng.random() < MARE["tension"]["quality_luck"][min(q, 3)]:
            rar = min(len(RAR) - 1, rar + 1)
        sid = rng.choice(list(species_by_id))
        e = collection.setdefault(sid, {"count": 0, "best": 0})
        e["count"] += 1
        e["best"] = max(e["best"], rar)
        stats["catches"] += 1
        if rar == 5:
            stats["mythiques"] += 1

    hours_per_step = 1.0
    h = 0.0
    while h < max_days * 24:
        day = h / 24.0
        hour_of_day = h % 24

        # ---- production continue
        rate = production_per_hour(levels)
        for r, v in rate.items():
            if r == "vitalite":
                stock["vitalite"] += v * hours_per_step
            else:
                add_stock(r, v * hours_per_step, "production")

        # ---- fin de chantier
        if build_end and build_end[0] <= h:
            levels[build_end[1]] = build_end[2]
            build_end = None

        # ---- retours d'expeditions
        done = [e for e in expeditions if e[0] <= h]
        if done:
            expeditions[:] = [e for e in expeditions if e[0] > h]
            for _, expp, atkp, diff, risk, tier, squad in done:
                p = success_chance(expp + cards_bonus(collection, species_by_id, "power_exp", MARE["assign_slots"]["expedition"]),
                                   atkp, diff, risk)
                ok = rng.random() < p
                stats["exp_ok"] += 1 if ok else 0
                hours = rng.uniform(*MIL["expeditions"]["reward_hours_by_tier"][str(tier)])
                total_rate = sum(v for r, v in rate.items() if r != "vitalite")
                budget = max(40, hours * total_rate) * (1 if ok else MIL["expeditions"]["failure_reward_ratio"])
                # reparti sur 2-3 ressources au hasard
                targets = rng.sample(PRODUCIBLE, k=min(3, len(PRODUCIBLE)))
                for r in targets:
                    add_stock(r, budget / len(targets), "expeditions")
                if ok:
                    fragments_gain = rng.randint(0, 2 + tier)
                    nonlocal_frag = fragments_gain  # lisibilite
                    fragments += nonlocal_frag
                else:
                    losses = 0
                    for u in UNITS:
                        if losses >= MIL["expeditions"]["max_losses_per_expedition"]:
                            break
                        if squad.get(u, 0) > 0 and rng.random() < risk * MIL["expeditions"]["failure_loss_chance_per_risk"]:
                            units[u] = max(0, units[u] - 1)
                            losses += 1

        # ---- vague de pathogenes
        if h >= next_wave_h:
            wp = wave_power(day) * (1 + rng.uniform(-MIL["pathogens"]["wave_variance"], MIL["pathogens"]["wave_variance"]))
            stats["waves"] += 1
            if defense_power() >= wp:
                stats["waves_won"] += 1
                for r, v in MIL["pathogens"]["victory_reward"].items():
                    add_stock(r, v, "evenements")
            else:
                for r in PRODUCIBLE:
                    stock[r] *= (1 - MIL["pathogens"]["defeat_resource_loss_ratio"])
                if units["garde"] > 0:
                    units["garde"] -= MIL["pathogens"]["defeat_unit_loss"]
            next_wave_h = h + rng.uniform(*MIL["pathogens"]["interval_h"])

        # ---- evenement aleatoire (auto, valeur moyenne)
        if h >= next_event_h:
            ev = rng.choices(MIL["events"]["pool"], weights=[e["weight"] for e in MIL["events"]["pool"]])[0]
            total_rate = sum(v for r, v in rate.items() if r != "vitalite")
            if ev["id"] == "courant_nutritif":
                hrs = rng.uniform(*ev["production_hours"])
                for r in PRODUCIBLE:
                    add_stock(r, rate.get(r, 0) * hrs, "evenements")
            elif ev["id"] == "banc_plancton":
                hrs = rng.uniform(*ev["biomasse_hours"])
                add_stock("biomasse", max(30, rate.get("biomasse", 0) * hrs), "evenements")
            elif ev["id"] == "mutation_spontanee" and build_end:
                remaining = build_end[0] - h
                build_end = (h + remaining * (1 - rng.uniform(*ev["build_time_reduction"])), build_end[1], build_end[2])
            elif ev["id"] == "spore_rare" and rng.random() < 0.5:
                add_stock("adn", max(25, rate.get("adn", 0) * rng.uniform(6, 10)), "evenements")
                add_stock("signaux", max(25, rate.get("signaux", 0) * rng.uniform(4, 8)), "evenements")
            next_event_h = h + rng.uniform(*MIL["events"]["interval_h"])

        # ---- session de jeu ?
        if abs(hour_of_day - arch["sessions"][0]) < 0.5:
            energie = min(9999, energie + arch["energy"])  # habitudes du matin

        if any(abs(hour_of_day - s) < 0.5 for s in arch["sessions"]):
            # 1) chantier (glouton)
            if build_end is None:
                choice = next_build_choice()
                if choice and affordable(choice[3]["cost"]):
                    pay(choice[3]["cost"])
                    build_end = (h + choice[3]["build_time_hours"], choice[1], choice[2])
            # 2) defense : recruter des gardes si la prochaine vague menace
            while defense_power() < wave_power(day) * 1.25 and try_recruit("garde"):
                pass
            # 3) escouade d'expedition : viser 3 sondes + 1 phage disponibles
            dep = deployed()
            if units["sonde"] - dep["sonde"] < 3:
                try_recruit("sonde")
            if units["phage"] - dep["phage"] < 1:
                try_recruit("phage")
            # 4) expeditions : remplir les slots libres avec la meilleure offre jouable
            while len(expeditions) < MIL["expeditions"]["max_concurrent"]:
                avail_s = units["sonde"] - deployed()["sonde"]
                avail_p = units["phage"] - deployed()["phage"]
                if avail_s <= 0:
                    break
                squad = {"sonde": min(3, avail_s), "phage": min(1, avail_p)}
                expp = squad["sonde"] * MIL["units"]["sonde"]["power_exp"] + squad.get("phage", 0) * MIL["units"]["phage"]["power_exp"]
                atkp = squad["sonde"] * MIL["units"]["sonde"]["power_atk"] + squad.get("phage", 0) * MIL["units"]["phage"]["power_atk"]
                # offre du jour : tirage d'un template, meilleur tier jouable a >=60 %
                best = None
                for t in rng.sample(MIL["expeditions"]["destinations"], k=4):
                    diff = rng.uniform(*t["difficulty"])
                    risk = rng.uniform(*t["risk"])
                    p = success_chance(expp + cards_bonus(collection, species_by_id, "power_exp", 3), atkp, diff, risk)
                    if p >= 0.6 and (best is None or t["tier"] > best[0]):
                        best = (t["tier"], diff, risk, rng.uniform(*t["duration_h"]))
                if not best:
                    break
                expeditions.append((h + best[3], expp, atkp, best[1], best[2], best[0], squad))
                stats["exp_sent"] += 1
            # 5) peche : jetons du jour si l'energie le permet (reserve 80)
            per_session = max(1, arch["jetons"] // len(arch["sessions"]))
            for _ in range(per_session):
                if energie >= MARE["jetons"]["cost_energie"] + 80:
                    energie -= MARE["jetons"]["cost_energie"]
                    fish_once()
            # fragments -> cartes
            while fragments >= MARE["fragments_per_card"]:
                fragments -= MARE["fragments_per_card"]
                rar = max(MARE["fragment_card_rarity_floor"],
                          rng.choices(range(len(RAR)), weights=[r["weight"] for r in RAR])[0])
                sid = rng.choice(list(species_by_id))
                e = collection.setdefault(sid, {"count": 0, "best": 0})
                e["count"] += 1
                e["best"] = max(e["best"], rar)

        # ---- jalons
        if stats["day_all3"] is None and all(levels[b] >= 3 for b in DESIGNED):
            stats["day_all3"] = day
        if stats["day_all5"] is None and all(levels[b] >= 5 for b in DESIGNED):
            stats["day_all5"] = day
            break

        h += hours_per_step

    total_income = sum(income.values()) or 1.0
    return {
        "day_all3": stats["day_all3"], "day_all5": stats["day_all5"],
        "share_exp": income["expeditions"] / total_income,
        "share_evt": income["evenements"] / total_income,
        "waves": stats["waves"], "waves_won": stats["waves_won"],
        "catches": stats["catches"], "mythiques": stats["mythiques"],
        "species": len(collection),
        "exp_sent": stats["exp_sent"],
    }

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seeds", type=int, default=30)
    args = ap.parse_args()
    for arch in ARCHETYPES:
        runs = [simulate(arch, seed) for seed in range(args.seeds)]
        def avg(k, none_val=150.0):
            vals = [(r[k] if r[k] is not None else none_val) for r in runs]
            return sum(vals) / len(vals)
        finished = sum(1 for r in runs if r["day_all5"] is not None)
        print(f"== {arch} ({args.seeds} graines) ==")
        print(f"  tout Nv3 : j{avg('day_all3'):6.1f}   tout Nv5 : j{avg('day_all5'):6.1f}   (finis avant j150 : {finished}/{len(runs)})")
        print(f"  part revenu expeditions {avg('share_exp')*100:5.1f} %   evenements {avg('share_evt')*100:4.1f} %")
        print(f"  vagues {avg('waves'):4.1f} dont repoussees {avg('waves_won'):4.1f}   peches {avg('catches'):5.1f}   mythiques {avg('mythiques'):4.2f}   especes {avg('species'):4.1f}   expeditions {avg('exp_sent'):5.1f}")

if __name__ == "__main__":
    main()
