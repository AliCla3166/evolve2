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

Usage : python3 simulate_full.py [--seeds 30] [--write]

--write reporte les resultats dans src/data/economy_config.json sous
pacing_validation.multi_system_validation. C'est CE bloc qui fait foi pour la
cible de 90 jours +/-10 % ; le bloc parent (simulate.py) ne mesure que le socle
mono-slot. export_json.py preserve ce sous-bloc lors d'une regeneration.
"""
import json
import random
import argparse
from pathlib import Path

DATA = Path(__file__).resolve().parents[2] / "src" / "data"
ECO = json.loads((DATA / "economy_config.json").read_text())
MIL = json.loads((DATA / "military_config.json").read_text())
MARE = json.loads((DATA / "mare_config.json").read_text())
HAB = json.loads((DATA / "habits_config.json").read_text())

PRODUCIBLE = ["adn", "proteine", "biomasse", "enzyme", "lipide", "signaux"]
DESIGNED = [b for b, cfg in ECO["buildings"].items() if cfg["designed"]]
UNITS = list(MIL["units"].keys())
RAR = MARE["rarities"]

# ---------------------------------------------------------------- archetypes
ARCHETYPES = {
    # energie/jour moyenne, heures de session, jetons max/jour, 1 oubli tous les N jours
    "assidu":      {"energy": 85, "sessions": [8, 13, 18, 22], "jetons": 3, "miss_every": 0},
    "regulier":    {"energy": 65, "sessions": [8, 20],          "jetons": 2, "miss_every": 12},
    "dilettante":  {"energy": 40, "sessions": [20],             "jetons": 1, "miss_every": 4},
}
# "miss_every" = un jour sans AUCUNE habitude validee, tous les N jours en moyenne
# (0 = jamais). C'est ce qui casse la serie. Il ne retire PAS l'energie du jour :
# arch["energy"] est deja une MOYENNE qui inclut les mauvais jours -- la deduire
# une seconde fois compterait l'oubli deux fois et fausserait la comparaison.

# ---------------------------------------------------------------- serie (piste 6)
# La table de paliers vit dans src/data/habits_config.json : le jeu (habits.ts) et
# ce simulateur lisent LE MEME fichier, donc le TS et le Python ne peuvent pas
# diverger. La table "legacy" ci-dessous est celle d'avant la piste 6 : elle sert
# de reference honnete (--streak legacy) pour verifier que le passage aux paliers
# hebdomadaires ne DEPLACE PAS le pacing -- il change la cadence, pas la duree.
STREAK_GRACE = HAB["streak"]["grace"]
LEGACY_TIERS = [{"days": 7, "energy": 50}, {"days": 30, "energy": 200}, {"days": 90, "energy": 500}]
STREAK_TABLE = HAB["streak"]["tiers"]

# ---------------------------------------------------------------- helpers eco
def lvl_cfg(b, lvl):
    return ECO["buildings"][b]["levels"].get(str(lvl))

def storage_cap(levels):
    base = ECO["storage"]["base_cap"]
    noyau = max(1, levels["noyau"])
    biomasse = max(1, levels.get("biomasse", 0))
    return base * (1 + 0.5 * (noyau - 1) + 0.5 * (biomasse - 1))

# ---------------------------------------------------------------- slots (v8)
BUILD_SLOTS = ECO["build_slots"]

def built_organs(levels):
    """Proto-organes construits (tout batiment >= Nv1, Noyau exclu)."""
    return sum(1 for b, l in levels.items() if b != "noyau" and l > 0)

def unlocked_slots(levels):
    n = 1
    built = built_organs(levels)
    for aux in BUILD_SLOTS["aux"]:
        if built >= aux.get("requires_built", 10**9):
            n += 1
    return n

def slot_max_hours(i):
    if i <= 0:
        return BUILD_SLOTS["main"].get("max_hours")
    aux = BUILD_SLOTS["aux"][i - 1] if i - 1 < len(BUILD_SLOTS["aux"]) else BUILD_SLOTS["main"]
    return aux.get("max_hours")

def find_free_slot(levels, builds, hours):
    """Miroir exact de economy.ts findFreeSlot : le slot principal sert EN DERNIER,
    pour qu'un chantier court n'occupe pas le seul slot capable des gros chantiers."""
    busy = {t["slot"] for t in builds}
    for i in range(unlocked_slots(levels) - 1, -1, -1):
        if i in busy:
            continue
        mh = slot_max_hours(i)
        if mh is None or hours <= mh:
            return i
    return -1

# ------------------------------------------------------- rachat d'heures (v8)
BOOST = ECO["energy_boost"]

def boost_quote(t, h):
    """Miroir exact de economy.ts boostQuote, en heures au lieu de ms.
    Retourne (heures_rachetees, cout_energie) ou None."""
    total = max(1e-6, (t["fin"] - t["debut"]) + t["boosted_h"])
    allowance = total * BOOST["max_ratio_per_task"]
    used = min(t["boosted_h"], allowance)
    left = allowance - used
    remaining = t["fin"] - h
    if remaining <= 0 or left <= 0:
        return None
    hours = min(total * BOOST["step_ratio"], left, remaining)
    if hours < BOOST["min_step_minutes"] / 60.0:
        return None
    mult = 1 + BOOST["cost_growth_at_cap"] * (used / allowance)
    cost = max(1, -(-(hours * BOOST["energy_per_hour"] * mult) // 1))  # ceil
    return hours, cost

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
    builds = []               # file multi-slots : [{fin, bat, niv, slot, total_h, boosted_h}]
    expeditions = []          # [(fin_h, exp_power, atk_power, difficulty, risk, tier, squad)]
    collection = {}
    fragments = 0
    next_wave_h = MIL["pathogens"]["first_attack_delay_h"]
    next_event_h = rng.uniform(*MIL["events"]["interval_h"])
    income = {"production": 0.0, "expeditions": 0.0, "evenements": 0.0}
    stats = {"waves": 0, "waves_won": 0, "catches": 0, "mythiques": 0, "exp_sent": 0, "exp_ok": 0,
             "day_all3": None, "day_all5": None, "boost_h": 0.0, "boost_energy": 0.0,
             "streak_energy": 0.0, "streak_max": 0, "streak_breaks": 0, "grace_used": 0}

    # Serie d'habitudes : c'est elle qui frappe monnaie via les paliers.
    streak = 0
    streak_awards = set()
    grace_window = -1  # index de fenetre de 30 j ou le jour de grace a deja servi

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
        # v8 : on ecarte les batiments deja en chantier (les niveaux sont
        # sequentiels) et ceux pour lesquels aucun slot compatible n'est libre.
        cap = storage_cap(levels)
        busy_b = {t["bat"] for t in builds}
        affordable_now, reachable = None, None
        for b in DESIGNED:
            if b in busy_b:
                continue
            nxt = levels[b] + 1
            cfg = lvl_cfg(b, nxt)
            if not cfg:
                continue
            cost = cfg["cost"]
            if any(v > cap for r, v in cost.items() if r in PRODUCIBLE):
                continue  # au-dela du cap : injouable pour l'instant
            key = cfg["build_time_hours"]
            if find_free_slot(levels, builds, key) < 0:
                continue  # aucun slot ouvert n'accepte un chantier de cette duree
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
        if rng.random() < MARE["fishing"]["quality_luck"][min(q, 3)]:
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

        # ---- fins de chantier (file multi-slots)
        for t in [t for t in builds if t["fin"] <= h]:
            levels[t["bat"]] = t["niv"]
        builds[:] = [t for t in builds if t["fin"] > h]

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
            elif ev["id"] == "mutation_spontanee" and builds:
                # Miroir de speedUpLongestBuild : le chantier au reste le plus long.
                t = max(builds, key=lambda t: t["fin"] - h)
                t["fin"] = h + (t["fin"] - h) * (1 - rng.uniform(*ev["build_time_reduction"]))
            elif ev["id"] == "spore_rare" and rng.random() < 0.5:
                add_stock("adn", max(25, rate.get("adn", 0) * rng.uniform(6, 10)), "evenements")
                add_stock("signaux", max(25, rate.get("signaux", 0) * rng.uniform(4, 8)), "evenements")
            next_event_h = h + rng.uniform(*MIL["events"]["interval_h"])

        # ---- session de jeu ?
        if abs(hour_of_day - arch["sessions"][0]) < 0.5:
            energie = min(9999, energie + arch["energy"])  # habitudes du matin

            # ---- serie : le jour tient-il ? (miroir exact de computeStreak +
            #      settleStreakTiers cote TS, y compris la re-ouverture des paliers
            #      apres une rupture -- un palier retombe redevient gagnable.)
            day_i = int(h // 24)
            miss = arch["miss_every"] > 0 and rng.random() < 1.0 / arch["miss_every"]
            if miss and streak > 0 and STREAK_GRACE["per_month"] > 0:
                window = day_i // 30
                if grace_window != window:
                    # Jour repare : la chaine tient, mais il ne rapporte rien.
                    grace_window = window
                    stats["grace_used"] += 1
                    miss = False
            if miss:
                streak = 0
                streak_awards.clear()
                stats["streak_breaks"] += 1
            else:
                streak += 1
                stats["streak_max"] = max(stats["streak_max"], streak)
                for t in STREAK_TABLE:
                    if streak >= t["days"] and t["days"] not in streak_awards:
                        streak_awards.add(t["days"])
                        energie = min(9999, energie + t["energy"])
                        stats["streak_energy"] += t["energy"]

        if any(abs(hour_of_day - s) < 0.5 for s in arch["sessions"]):
            # 1) chantiers (glouton) : on remplit TOUS les slots libres compatibles
            while len(builds) < unlocked_slots(levels):
                choice = next_build_choice()
                if not choice or not affordable(choice[3]["cost"]):
                    break
                hours = choice[3]["build_time_hours"]
                slot = find_free_slot(levels, builds, hours)
                if slot < 0:
                    break
                pay(choice[3]["cost"])
                builds.append({"debut": h, "fin": h + hours, "bat": choice[1], "niv": choice[2],
                               "slot": slot, "boosted_h": 0.0})
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
            # 6) rachat d'heures : l'energie EXCEDENTAIRE (au-dela de la reserve de
            #    peche) part sur le chantier au reste le plus long. C'est l'arbitrage
            #    voulu par le design : accelerer OU pecher OU recruter, pas les trois.
            reserve = MARE["jetons"]["cost_energie"] + 80
            while builds:
                t = max(builds, key=lambda t: t["fin"] - h)
                q = boost_quote(t, h)
                if not q or energie - q[1] < reserve:
                    break
                energie -= q[1]
                t["fin"] -= q[0]
                t["boosted_h"] += q[0]
                stats["boost_h"] += q[0]
                stats["boost_energy"] += q[1]
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
        "boost_h": stats["boost_h"], "boost_energy": stats["boost_energy"],
        "streak_energy": stats["streak_energy"], "streak_max": stats["streak_max"],
        "streak_breaks": stats["streak_breaks"], "grace_used": stats["grace_used"],
    }

# Cible de pacing : 90 jours de duree vecue, tolerance +/-10 %.
TARGET_DAYS = ECO["global_params"]["total_target_days"]
TOLERANCE = 0.10


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seeds", type=int, default=30)
    ap.add_argument("--write", action="store_true",
                    help="reporte les resultats dans economy_config.json")
    ap.add_argument("--streak", choices=["config", "legacy", "none"], default="config",
                    help="table de paliers de serie : celle du jeu (config), celle "
                         "d'avant la piste 6 (legacy), ou aucune (none)")
    args = ap.parse_args()

    global STREAK_TABLE
    STREAK_TABLE = {"config": HAB["streak"]["tiers"], "legacy": LEGACY_TIERS, "none": []}[args.streak]
    total_streak = sum(t["energy"] for t in STREAK_TABLE)
    print(f"Paliers de serie : {args.streak} ({len(STREAK_TABLE)} paliers, "
          f"{total_streak} energie sur une serie parfaite)\n")

    report = {}
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
        print(f"  rachat d'heures : {avg('boost_h'):6.1f} h pour {avg('boost_energy'):7.0f} energie")
        print(f"  serie : max {avg('streak_max'):5.1f} j   paliers {avg('streak_energy'):6.0f} energie   "
              f"ruptures {avg('streak_breaks'):4.1f}   graces {avg('grace_used'):4.1f}")
        report[arch] = {
            "day_all3": round(avg("day_all3"), 1),
            "day_all5": round(avg("day_all5"), 1),
            "runs_finished": f"{finished}/{len(runs)}",
            "expedition_income_pct": round(avg("share_exp") * 100, 1),
            "boost_hours_bought": round(avg("boost_h"), 1),
            "boost_energy_spent": round(avg("boost_energy")),
            "streak_max_days": round(avg("streak_max"), 1),
            "streak_energy_earned": round(avg("streak_energy")),
            "streak_breaks": round(avg("streak_breaks"), 1),
            "grace_days_used": round(avg("grace_used"), 1),
        }

    lo, hi = TARGET_DAYS * (1 - TOLERANCE), TARGET_DAYS * (1 + TOLERANCE)
    out_of_band = [a for a, r in report.items() if not (lo <= r["day_all5"] <= hi)]
    print(f"\nFenetre cible : {lo:.0f}-{hi:.0f} j  ->  " +
          ("TOUS DANS LA CIBLE" if not out_of_band else f"HORS CIBLE : {out_of_band}"))

    if args.write:
        path = DATA / "economy_config.json"
        cfg = json.loads(path.read_text(encoding="utf-8"))
        cfg["pacing_validation"]["multi_system_validation"] = {
            "$comment": ("Duree REELLEMENT VECUE, mesuree par tools/economy/simulate_full.py "
                         f"({args.seeds} graines par archetype). Simule les habitudes, la serie "
                         "et son jour de grace, la file multi-slots, le rachat d'heures a "
                         "l'energie, la peche, les expeditions, les vagues et les evenements. "
                         "C'est ce bloc qui valide la cible de "
                         f"{TARGET_DAYS} jours +/-{TOLERANCE*100:.0f} % ; le bloc parent ne mesure "
                         "que le socle mono-slot. Regenerer avec 'python3 simulate_full.py "
                         f"--seeds {args.seeds} --write' apres toute retouche du calibrage."),
            "seeds": args.seeds,
            "streak_table": args.streak,
            "target_days": TARGET_DAYS,
            "tolerance_pct": round(TOLERANCE * 100),
            "accepted_band_days": [round(lo, 1), round(hi, 1)],
            "all_archetypes_in_band": not out_of_band,
            "by_archetype": report,
        }
        path.write_text(json.dumps(cfg, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"{path} mis a jour (pacing_validation.multi_system_validation).")


if __name__ == "__main__":
    main()
