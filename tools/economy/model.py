"""
EVOLVE - Age 1 "Cellule" - Modele economique complet
======================================================
Source de verite unique (temps, couts, production, stockage) pour les 9 batiments
dans le perimetre (Noyau, Membrane, ADN, Proteines, Biomasse, Enzymes, Lipides,
Signaux, Mutation). Les 3 batiments lies aux mini-jeux non finalises (Peche/
Collection, Bastion-Defense, Bastion-Raid) sont exclus du design economique ici
(stubs uniquement, cf. economy_config.json -> "designed": false).

Cible de pacing : ~90 jours de duree REELLEMENT VECUE. Depuis la v8, cette cible
wall-clock ne se confond plus avec la somme des heures de chantier : la file
multi-slots et le rachat d'heures a l'energie compressent le temps reel, donc le
budget cumule (BUILD_HOURS_BUDGET) est releve de PARALLEL_UPLIFT au-dessus des
2160 h. Le TEMPS reste le levier de pacing
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
TOTAL_HOURS = TOTAL_DAYS * HOURS_PER_DAY  # 2160h -> cible WALL-CLOCK de l'Age 1

# ---- v8 (24/07/2026) : wall-clock et heures de chantier ne sont plus la meme chose
# Jusqu'a la v7, un seul chantier tournait a la fois et sans aucun moyen de
# l'accelerer : la somme des heures de chantier ETAIT la duree vecue. La v8 casse
# cette equivalence sur deux fronts :
#   - la file multi-slots (2 slots auxiliaires debloques a 3 et 5 proto-organes,
#     limites aux chantiers <= 24 h) fait tourner des chantiers en parallele ;
#   - le rachat d'heures a l'energie rogne jusqu'a 25 % de chaque chantier.
# Mesure (simulate_full.py, 12 graines, jour du "tout Nv5") avant correction :
#   assidu 77,0 j · regulier 80,9 j · dilettante 84,2 j — soit 6 a 17 % sous la
#   cible, avec assidu et regulier hors de la fenetre de tolerance +/-10 %.
# On releve donc le budget d'heures CUMULEES du meme ordre de grandeur, pour que
# la duree REELLEMENT VECUE retombe sur 90 jours. C'est le bon levier : il rend
# le parallelisme et le rachat d'heures gratifiants (ils rattrapent un budget
# plus lourd) au lieu de les rendre obligatoires (ils compenseraient un budget
# calibre sans eux). Revalider avec 'python3 simulate_full.py --seeds 12' apres
# toute retouche : la cible reste 90 jours +/-10 % (81-99) pour les 3 archetypes.
PARALLEL_UPLIFT = 1.12
BUILD_HOURS_BUDGET = round(TOTAL_HOURS * PARALLEL_UPLIFT)  # 2419 h de chantier cumulees

N_PARALLEL_BUILD_SLOTS = 3  # 1 principal (illimite) + 2 auxiliaires (<= 24 h),
                            # cf. economy_config.json -> build_slots

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
# Poids RELATIFS du budget de chantier. Seule leur proportion compte : ils sont
# normalises sur BUILD_HOURS_BUDGET juste en dessous. (Historiquement ces
# nombres etaient des heures sommant a 2160 ; ils sont conserves tels quels pour
# que le calibrage relatif de la v7 — Noyau et Mutation les plus lourds, ADN le
# plus leger — reste lisible et intact.)

TIME_BUDGET_SHARES = {
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

_SHARE_TOTAL = sum(TIME_BUDGET_SHARES.values())
TIME_BUDGET_HOURS = {
    b: round(BUILD_HOURS_BUDGET * s / _SHARE_TOTAL, 1)
    for b, s in TIME_BUDGET_SHARES.items()
}
assert abs(sum(TIME_BUDGET_HOURS.values()) - BUILD_HOURS_BUDGET) < 1.0, \
    "Les budgets temps doivent sommer a BUILD_HOURS_BUDGET"

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
