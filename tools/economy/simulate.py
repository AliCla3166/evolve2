"""
Simulation de validation du calibrage (temps vs couts).

Strategie du joueur simulee : "greedy plus-rapide-d'abord" -- a chaque etape,
on choisit parmi les 9 batiments non maxes la PROCHAINE amelioration dont le
temps de construction est le plus court, on attend si besoin d'accumuler les
ressources manquantes (la production continue meme quand aucune construction
n'est en cours ou pendant qu'une autre est en chantier -- seule la file de
construction est serialisee a 1 slot), puis on construit.

Objectif : verifier que le temps total reel (construction + attente ressource)
reste proche de BUILD_HOURS_BUDGET -- c'est-a-dire que les couts ne sont
PAS le facteur limitant. Un depassement de quelques % est acceptable (aucun
joueur ne joue de facon parfaitement optimale de toute facon) ; un depassement
massif indiquerait que COST_SCALE ou STARTING_STOCK doivent etre ajustes.
"""
from model import (
    TIME_BUDGET_HOURS, TIME_PER_LEVEL, _paid_levels, cost_for_level,
    production_per_hour, PRODUCER_BASE, BUILD_HOURS_BUDGET, STARTING_STOCK,
    COST_SCALE, storage_cap,
)

PRODUCIBLE_RESOURCES = ["adn", "proteine", "biomasse", "enzyme", "lipide", "signaux"]

def run_simulation(verbose=True):
    levels = {b: (1 if b == "noyau" else 0) for b in TIME_BUDGET_HOURS}
    stock = {r: float(STARTING_STOCK) for r in PRODUCIBLE_RESOURCES}
    stock["vitalite"] = 0.0
    elapsed = 0.0
    wait_total = 0.0
    build_total = 0.0
    log = []
    steps = []

    def current_rate(resource):
        # somme des taux de production de tous les batiments produisant `resource`
        total = 0.0
        for b in PRODUCER_BASE:
            from model import BUILDING_META
            if BUILDING_META[b].get("resource") == resource:
                total += production_per_hour(b, levels[b])
        return total

    def noyau_vitalite_rate():
        return production_per_hour("noyau", levels["noyau"])

    def advance(dt):
        nonlocal elapsed
        if dt <= 0:
            return
        for r in PRODUCIBLE_RESOURCES:
            stock[r] += current_rate(r) * dt
        stock["vitalite"] += noyau_vitalite_rate() * dt
        # plafonds de stockage (Noyau + Biomasse) appliques aux 6 ressources productibles
        cap = storage_cap(levels["noyau"], levels["biomasse"])
        for r in PRODUCIBLE_RESOURCES:
            if stock[r] > cap:
                stock[r] = cap
        elapsed += dt

    remaining = {b: 5 - levels[b] for b in levels}
    step = 0
    while any(remaining[b] > 0 for b in remaining):
        step += 1
        # candidats : prochain niveau de chaque batiment non maxe
        candidates = []
        for b in levels:
            if remaining[b] <= 0:
                continue
            next_level = levels[b] + 1
            paid = _paid_levels(b)
            if next_level not in paid:
                continue  # (cas noyau niveau1 deja acquis)
            t_needed = TIME_PER_LEVEL[b][next_level]
            candidates.append((t_needed, b, next_level))
        if not candidates:
            break
        candidates.sort(key=lambda x: x[0])
        t_needed, building, next_level = candidates[0]
        cost = cost_for_level(building, next_level)

        # calcule le temps d'attente necessaire pour accumuler les ressources manquantes
        wait_needed = 0.0
        for res, amount in cost.items():
            shortfall = amount - stock.get(res, 0.0)
            if shortfall > 0:
                rate = current_rate(res) if res in PRODUCIBLE_RESOURCES else noyau_vitalite_rate()
                if rate <= 0:
                    wait_needed = float("inf")
                    break
                wait_needed = max(wait_needed, shortfall / rate)

        if wait_needed == float("inf"):
            log.append(f"[BLOCAGE] {building} niv.{next_level} necessite {cost} mais aucun producteur actif.")
            # bootstrap de secours : force un stock minimal (ne devrait pas arriver
            # une fois STARTING_STOCK correctement calibre)
            for res, amount in cost.items():
                if stock.get(res, 0.0) < amount:
                    stock[res] = amount
            wait_needed = 0.0

        advance(wait_needed)
        wait_total += wait_needed

        for res, amount in cost.items():
            stock[res] -= amount

        advance(t_needed)
        build_total += t_needed
        levels[building] = next_level
        remaining[building] -= 1

        if verbose:
            log.append(
                f"t={elapsed:7.1f}h  construit {building:9s} -> niv.{next_level}  "
                f"(temps={t_needed:6.2f}h, attente={wait_needed:6.2f}h, cout={cost})"
            )

        steps.append({
            "step": step,
            "building": building,
            "level": next_level,
            "build_time_hours": round(t_needed, 2),
            "wait_hours": round(wait_needed, 2),
            "elapsed_after_hours": round(elapsed, 2),
            "cost": cost,
        })

    return {
        "elapsed_hours": elapsed,
        "elapsed_days": elapsed / 24,
        "build_hours": build_total,
        "wait_hours": wait_total,
        "wait_pct": 100 * wait_total / elapsed if elapsed else 0,
        "final_levels": levels,
        "final_stock": stock,
        "log": log,
        "steps": steps,
    }

if __name__ == "__main__":
    result = run_simulation()
    for line in result["log"]:
        print(line)
    print("\n=== RESULTAT ===")
    print(f"Temps total simule      : {result['elapsed_hours']:.1f}h ({result['elapsed_days']:.1f} jours)")
    print(f"  dont construction     : {result['build_hours']:.1f}h")
    print(f"  dont attente ressource: {result['wait_hours']:.1f}h ({result['wait_pct']:.1f}%)")
    print(f"Budget de chantier     : {BUILD_HOURS_BUDGET}h ({BUILD_HOURS_BUDGET/24:.1f} jours mono-slot)")
    print(f"Ecart vs budget        : {result['elapsed_hours'] - BUILD_HOURS_BUDGET:+.1f}h ({(result['elapsed_hours']/BUILD_HOURS_BUDGET-1)*100:+.1f}%)")
    print("(La duree wall-clock reellement vecue se mesure avec simulate_full.py.)")
    print(f"Niveaux finaux         : {result['final_levels']}")
    print(f"Stock final            : { {k: round(v,1) for k,v in result['final_stock'].items()} }")
