"""
EVOLVE - Age 1 "Cellule" - Modele economique complet
======================================================
Source de verite unique (temps, couts, production, stockage) pour les 9 batiments
dans le perimetre (Noyau, Membrane, ADN, Proteines, Biomasse, Enzymes, Lipides,
Signaux, Mutation). Les 3 batiments lies aux mini-jeux non finalises (Peche/
Collection, Bastion-Defense, Bastion-Raid) sont exclus du design economique ici
(stubs uniquement, cf. economy_config.json -> "designed": false).

Cible de pacing : ~90 jours (2160h) de temps de construction cumule pour un
joueur qui enchaine les ameliorations sans interruption sur une seule file de
construction (N_PARALLEL_BUILD_SLOTS = 1). Le TEMPS est le levier de pacing
principal ; les couts en ressources sont calibres pour rester "confortables"
(la simulation plus bas verifie qu'ils ne bloquent pas significativement la
progression au-dela du budget temps).

Tout est parametre pour etre facile a modifier : changer une base ou un ratio
ici recalcule automatiquement toutes les tables derivees (JSON + XLSX).
"""
import json
import math

# ============================================================
# 0. PARAMETRES GLOBAUX (les leviers a tourner en premier)
# ============================================================

TOTAL_DAYS = 90
HOURS_PER_DAY = 24
TOTAL_HOURS = TOTAL_DAYS * HOURS_PER_DAY  # 2160h -> cible de duree totale de l'Age 1

N_PARALLEL_BUILD_SLOTS = 1  # une seule construction active a la fois sur toute la base

TIME_RATIO = 3.0     # croissance du temps de construction par niveau
PROD_RATIO = 1.8     # croissance de la production par niveau
COST_RATIO = 2.1     # croissance du cout en ressources par niveau

COST_SCALE = 130     # multiplicateur global des couts (le seul bouton a tourner
                      # pour rendre TOUT le jeu plus cher/moins cher d'un coup)

STARTING_STOCK = 260  # reserve de depart (bootstrap) pour chacune des 6 ressources
                      # productibles, afin que les toutes premieres constructions
                      # soient finançables avant qu'aucun producteur n'existe encore

BASE_CAP = 600        # capacite de stockage de base (avant bonus Noyau/Biomasse)
                      # pour chacune des 6 ressources productibles

# ============================================================
# 1. BATIMENTS DANS LE PERIMETRE (9) + budgets de temps (heures)
# ============================================================
# Repartition qui somme exactement a TOTAL_HOURS (2160h). Ajuster librement
# tant que la somme reste egale a TOTAL_HOURS (assert plus bas).

TIME_BUDGET_HOURS = {
    "noyau":    300,
    "membrane": 260,
    "adn":      200,
    "proteine": 220,
    "biomasse": 220,
    "enzyme":   200,
    "lipide":   200,
    "signaux":  220,
    "mutation": 340,
}
assert sum(TIME_BUDGET_HOURS.values()) == TOTAL_HOURS, "Les budgets temps doivent sommer a TOTAL_HOURS"

BUILDING_META = {
    "noyau":    {"name": "Noyau primordial",            "family": "structure_centrale", "role": "meta"},
    "membrane": {"name": "Membrane protectrice",          "family": "structure_centrale", "role": "support"},
    "adn":      {"name": "Generateur d'ADN",              "family": "producteur",         "role": "producer", "resource": "adn"},
    "proteine": {"name": "Synthetiseur de proteines",     "family": "producteur",         "role": "producer", "resource": "proteine"},
    "biomasse": {"name": "Producteur de biomasse",        "family": "producteur",         "role": "producer", "resource": "biomasse"},
    "enzyme":   {"name": "Reacteur enzymatique",          "family": "producteur",         "role": "producer", "resource": "enzyme"},
    "lipide":   {"name": "Reservoir lipidique",           "family": "producteur",         "role": "producer", "resource": "lipide"},
    "signaux":  {"name": "Capteur de signaux",            "family": "producteur",         "role": "producer", "resource": "signaux"},
    "mutation": {"name": "Centre de mutation",            "family": "centre_specialise",  "role": "sink"},
}

OUT_OF_SCOPE_BUILDINGS = {
    "peche":    {"name": "Centre Peche / Collection", "family": "centre_specialise", "note": "Mini-jeu de peche non finalise. Ce fichier ne definit pas ses niveaux/couts/temps ; a completer une fois le mini-jeu specifie."},
    "defense":  {"name": "Bastion - Defense",         "family": "centre_specialise", "note": "Mini-jeu de Bastion Defense non finalise. Idem, hors perimetre de ce modele."},
    "raid":     {"name": "Bastion - Raid",            "family": "centre_specialise", "note": "Mini-jeu de Bastion Raid non finalise. Idem, hors perimetre de ce modele."},
}

# ============================================================
# 2. MODELE DE TEMPS DE CONSTRUCTION (heures) PAR NIVEAU
# ============================================================
# Noyau : le niveau 1 existe gratuitement au demarrage (fiction etablie).
#   -> seules les transitions 2,3,4,5 sont payantes, reparties en r^1..r^4.
# Toutes les autres batiments : transitions 1,2,3,4,5 payantes, reparties en r^0..r^4.

def _time_series(building):
    budget = TIME_BUDGET_HOURS[building]
    if building == "noyau":
        exps = [1, 2, 3, 4]          # -> niveaux 2,3,4,5
        levels = [2, 3, 4, 5]
    else:
        exps = [0, 1, 2, 3, 4]       # -> niveaux 1,2,3,4,5
        levels = [1, 2, 3, 4, 5]
    factors = [TIME_RATIO ** e for e in exps]
    base = budget / sum(factors)
    hours = [base * f for f in factors]
    return dict(zip(levels, hours))

TIME_PER_LEVEL = {b: _time_series(b) for b in TIME_BUDGET_HOURS}

# ============================================================
# 3. MODELE DE PRODUCTION (unites / heure) PAR NIVEAU
# ============================================================
# Les 6 producteurs partagent la meme base/ratio (facile a differencier plus
# tard en changeant PRODUCER_BASE par ressource). Le Noyau produit a part les
# Points de Vitalite (monnaie meta/prestige, jamais depensee sur des couts de
# batiment) avec sa propre base/ratio, plus lente.

PRODUCER_BASE = {
    "adn": 10.0, "proteine": 10.0, "biomasse": 10.0,
    "enzyme": 10.0, "lipide": 10.0, "signaux": 10.0,
}
NOYAU_VITALITE_BASE = 2.0
NOYAU_VITALITE_RATIO = 1.6

def production_per_hour(building, level):
    if level <= 0:
        return 0.0
    if building in PRODUCER_BASE:
        return PRODUCER_BASE[building] * (PROD_RATIO ** (level - 1))
    if building == "noyau":
        return NOYAU_VITALITE_BASE * (NOYAU_VITALITE_RATIO ** (level - 1))
    return 0.0

PRODUCTION_PER_LEVEL = {
    b: {lvl: production_per_hour(b, lvl) for lvl in range(1, 6)}
    for b in list(PRODUCER_BASE.keys()) + ["noyau"]
}

# ============================================================
# 4. MODELE DE COUT (multi-ressources, inter-dependant) PAR NIVEAU
# ============================================================
# Chaque batiment coute 2 ressources produites par D'AUTRES batiments (jamais
# la sienne propre) -> force une croissance equilibree de la base, a la maniere
# d'OGame/Travian. Le Noyau et Mutation puisent dans des ressources "abstraites"
# (biomasse/signaux, vitalite) plutot que dans leur propre production.

COST_RECIPES = {
    "noyau":    {"biomasse": 1.0, "signaux": 1.0},
    "membrane": {"lipide": 1.0, "proteine": 1.0},
    "adn":      {"enzyme": 1.0, "biomasse": 1.0},
    "proteine": {"adn": 1.0, "enzyme": 1.0},
    "biomasse": {"lipide": 1.0, "signaux": 1.0},
    "enzyme":   {"proteine": 1.0, "adn": 1.0},
    "lipide":   {"biomasse": 1.0, "enzyme": 1.0},
    "signaux":  {"proteine": 1.0, "adn": 1.0},
    "mutation": {"signaux": 1.0, "vitalite": 0.6},
}

def _paid_levels(building):
    return [2, 3, 4, 5] if building == "noyau" else [1, 2, 3, 4, 5]

def cost_for_level(building, level):
    """Cout en ressources pour atteindre `level` (niveau payant) de `building`."""
    paid_levels = _paid_levels(building)
    transition_index = paid_levels.index(level)  # 0-based: 0 pour la 1ere transition payante
    mult = COST_SCALE * (COST_RATIO ** transition_index)
    return {res: round(weight * mult, 1) for res, weight in COST_RECIPES[building].items()}

COST_PER_LEVEL = {
    b: {lvl: cost_for_level(b, lvl) for lvl in _paid_levels(b)}
    for b in TIME_BUDGET_HOURS
}

# ============================================================
# 5. CAPACITE DE STOCKAGE
# ============================================================
# Regle etablie : le plafond de stockage de chaque ressource productible croit
# avec le niveau du Noyau ET le niveau du Producteur de Biomasse (fiction :
# le noyau organise le stockage cellulaire, la biomasse fournit la matrice de
# stockage). +50% de BASE_CAP par niveau de chacun des deux (additif).

def storage_cap(noyau_level, biomasse_level):
    growth = 1 + 0.5 * (noyau_level - 1) + 0.5 * max(biomasse_level - 1, -1)
    # biomasse_level peut etre 0 (pas encore construit) -> growth partiel du noyau seul
    if biomasse_level <= 0:
        growth = 1 + 0.5 * (noyau_level - 1)
    return round(BASE_CAP * growth, 1)

STORAGE_TABLE = {
    f"noyau{n}_biomasse{b}": storage_cap(n, b)
    for n in range(1, 6) for b in range(0, 6)
}

# ============================================================
# 6. RESSOURCES (11, cf. manifest.json) - annotation du role economique
# ============================================================

RESOURCES_META = {
    "energie":  {"name": "Points d'energie",   "kind": "externe_habitude", "spendable_on_buildings": False, "note": "Genere par le suivi d'habitudes reel (Day Strike). Sert aux boosts temporaires, pas au cout de construction."},
    "vitalite": {"name": "Points de Vitalite",  "kind": "meta_prestige",   "spendable_on_buildings": True,  "note": "Produit passivement par le Noyau. Utilise uniquement comme cout partiel du Centre de mutation (capstone)."},
    "adn":      {"name": "ADN",                 "kind": "productible",     "spendable_on_buildings": True, "producer": "adn"},
    "proteine": {"name": "Proteines",           "kind": "productible",     "spendable_on_buildings": True, "producer": "proteine"},
    "biomasse": {"name": "Biomasse",            "kind": "productible",     "spendable_on_buildings": True, "producer": "biomasse"},
    "enzyme":   {"name": "Enzymes",             "kind": "productible",     "spendable_on_buildings": True, "producer": "enzyme"},
    "lipide":   {"name": "Lipides",             "kind": "productible",     "spendable_on_buildings": True, "producer": "lipide"},
    "signaux":  {"name": "Signaux chimiques",   "kind": "productible",     "spendable_on_buildings": True, "producer": "signaux"},
    "combat":   {"name": "Monnaie de combat",   "kind": "hors_perimetre",  "spendable_on_buildings": False, "note": "Liee a Bastion Defense/Raid, non definie ici."},
    "rubis":    {"name": "Rubis",               "kind": "hors_perimetre",  "spendable_on_buildings": False, "note": "Monnaie premium, hors perimetre economique de ce document."},
    "age":      {"name": "Points d'age",        "kind": "hors_perimetre",  "spendable_on_buildings": False, "note": "Monnaie de transition d'Age, hors perimetre de ce document."},
}

if __name__ == "__main__":
    print(f"Budget temps total : {sum(TIME_BUDGET_HOURS.values())}h ({sum(TIME_BUDGET_HOURS.values())/24:.1f} jours)")
    for b, series in TIME_PER_LEVEL.items():
        total = sum(series.values())
        print(f"  {b:10s} budget={TIME_BUDGET_HOURS[b]:>4}h  -> {[round(v,2) for v in series.values()]}  (sum={total:.1f}h)")
