#!/usr/bin/env python3
"""Source de verite de l'economie du mode Walachie.
Genere src/data/walachie_config.json puis simule un joueur en micro-sessions
(10 min toutes les 3 h) pour verifier le pacing : premiere Renaissance visee
entre 4 et 10 jours, aucun plateau > 48 h sans achat possible.
Usage : python3 tools/walachie/gen_config.py
"""
import json
import math
import os

HERE = os.path.dirname(__file__)
OUT = os.path.join(HERE, "..", "..", "src", "data", "walachie_config.json")

# ---- Leviers globaux ----
COST_RATIO = 1.15          # ratio de cout par achat d'un meme noeud (standard idle)
NODE_STEP = 4.2            # ecart de cout entre noeuds d'une meme ere
ERA_BASE0 = 12.0           # cout de base du premier noeud de l'ere 1
ERA_GROWTH = 10 ** 1.30   # ecart de cout entre eres (~x20 par ere)
PAYBACK0_S = 420.0         # retour sur investissement du 1er noeud (secondes)
PAYBACK_GROWTH = 1.45      # le payback s'allonge a chaque ere
UNLOCK_MULT = 1.7          # cout de percee d'une ere = base de l'ere x ce facteur
CLICK_PROD_SHARE = 0.05    # la pulsation vaut 5 % de la prod/s (le clic reste utile)
OFFLINE_CAP_H = 10.0       # production hors ligne plafonnee (extensible en meta)
ECLAT_DIV = 1.1e16         # diviseur de la formule d'Eclats a la Renaissance
ECLAT_POW = 0.55
CYCLE_PROD_BONUS = 0.25    # +25 % de prod par cycle accompli
SHINY_THRESHOLD = 100      # toutes les N unites d'un meme noeud, une creature brillante apparait
SHINY_MULT = 2.0           # cliquee, elle double la seve en stock (paillettes, pas une amelioration)

# (id, nom, icone, description, decor)
# Le decor est le fond peint plein-ecran de WalachieScene (tools/gen_walachie.py) :
# un seul tableau par groupe d'eres, pas de quadrillage de tuiles. La Divinite
# (fin de "ascension") N'EST PAS la fin du jeu : 3 eres reelles suivent, puis
# une queue procedurale infinie (voir TAIL plus bas) — "aucune progression ne
# se termine", meme la divinite se depasse.
ERAS = [
    ("protoplanete", "Protoplanète", "ere_protoplanete", "Un disque de poussière s'effondre. Walachie n'est encore qu'une braise.", "decor_espace"),
    ("ocean", "Océan de Sève", "ere_ocean", "Les geysers crachent une sève émeraude. Le monde apprend à couler.", "decor_primordial"),
    ("protovie", "Proto-vie", "ere_protovie", "Dans la sève, des membranes se referment sur elles-mêmes. Quelque chose insiste.", "decor_primordial"),
    ("flore", "Flore Radiante", "ere_flore", "La lumière devient nourriture. Les eaux s'allument la nuit.", "decor_eaux"),
    ("faune", "Faune Rampante", "ere_faune", "Les premières bêtes rampent entre les récifs lumineux.", "decor_eaux"),
    ("errants", "Grands Errants", "ere_errants", "Des colosses paisibles portent des forêts entières sur leur dos, sur la terre ferme.", "decor_rivage"),
    ("predateurs", "Prédateurs à Mâchoire", "ere_predateurs", "La mâchoire apparaît. Fine, rapide, terrifiante — et nécessaire.", "decor_rivage"),
    ("eveil", "L'Éveil", "ere_eveil", "Derrière les yeux d'un prédateur, une étincelle se demande pourquoi.", "decor_tribal"),
    ("tribus", "Tribus Walachiennes", "ere_tribus", "Les Walachiens chantent autour des totems d'os fluorescent.", "decor_village"),
    ("civilisation", "Civilisation Fluorescente", "ere_civilisation", "Des cités-jardins qui protègent la nature au lieu de la dévorer.", "decor_cite"),
    ("sentinelles", "Les Sentinelles", "ere_sentinelles", "Gardiens de la vie, ils veillent depuis l'orbite sur toute la planète.", "decor_orbite"),
    ("ascension", "Ascension", "ere_ascension", "Le Panthéon s'ouvre. La conscience de Walachie touche au divin — une marche, pas une fin.", "decor_portail"),
    ("essaimage", "Essaimage Interplanétaire", "ere_essaimage", "Des nefs-semences quittent Walachie pour ensemencer les mondes voisins du système.", "decor_systeme"),
    ("choeur_stellaire", "Chœur Stellaire", "ere_choeur", "Un réseau de Sentinelles veille désormais entre les étoiles de la constellation.", "decor_stellaire"),
    ("toile_galactique", "Toile Galactique", "ere_toile", "La galaxie entière porte la mémoire de Walachie, bras spiral après bras spiral.", "decor_galactique"),
]

# (id, ere, nom, sprite|None, description, comportement)
# comportement : "predateur" (chasse la proie la plus proche) / "proie" (fuit le
# predateur le plus proche, sinon erre) / "erre" (deplacement libre, aucune
# cible) / "orne" (immobile, ondule sur place — flore et structures).
NODES = [
    ("poussiere", "protoplanete", "Poussière d'accrétion", None, "Chaque grain qui tombe réchauffe le cœur du monde.", "orne"),
    ("geyser", "protoplanete", "Geysers de sève", None, "Les entrailles de Walachie remontent à la surface.", "orne"),
    ("cristaux", "protoplanete", "Cristaux germinaux", None, "Des réseaux minéraux qui copient leur propre forme.", "orne"),
    ("sporule", "ocean", "Sporules dérivantes", "faune_sporule", "Des cloches translucides portées par les courants de sève.", "proie"),
    ("filament", "ocean", "Filaments réplicateurs", None, "Les premières chaînes qui se recopient sans se lasser.", "orne"),
    ("mousse", "ocean", "Mousse radiante", "flore_spores", "Un tapis vivant qui respire au bord des geysers.", "orne"),
    ("protocellule", "protovie", "Proto-cellules", None, "Une membrane, un dedans, un dehors : la première frontière.", "orne"),
    ("colonie", "protovie", "Colonies symbiotiques", None, "Seules elles survivent, ensemble elles inventent.", "orne"),
    ("archee", "protovie", "Archées des abysses", None, "La vie qui prospère là où tout devrait mourir.", "orne"),
    ("helice", "flore", "Hélices photophages", "flore_helice", "Des spirales qui boivent la lumière des deux soleils.", "orne"),
    ("lanterne", "flore", "Lanternes de nuit", "flore_lanterne", "Elles fleurissent quand tout s'éteint.", "orne"),
    ("voile", "flore", "Voiles chantants", "flore_voile", "Des membranes dressées qui chantent avec le vent.", "orne"),
    ("arbrelum", "flore", "Arbres-lumière", "flore_arbrelum", "Les cathédrales végétales de Walachie.", "orne"),
    ("rampant", "faune", "Rampants segmentés", "faune_rampant", "Les premiers pas — enfin, les premières reptations.", "proie"),
    ("brouteur", "faune", "Brouteurs cuirassés", "faune_brouteur", "Six pattes, un dos blindé, un appétit d'ogre.", "proie"),
    ("meduse", "faune", "Méduses d'air", "faune_meduse", "Elles flottent entre les arbres comme des pensées lentes.", "proie"),
    ("errant", "errants", "Errants colossaux", "faune_errant", "Des montagnes qui marchent, couvertes de forêts.", "erre"),
    ("troupeau", "errants", "Grands troupeaux", "faune_brouteur", "La plaine entière se met en mouvement.", "proie"),
    ("corail", "errants", "Récifs terrestres", "flore_corail", "Le corail a quitté la sève pour conquérir la roche.", "orne"),
    ("predateur", "predateurs", "Chasseurs à mâchoire", "faune_predateur", "Fins, véloces, une mâchoire qui ne pardonne pas.", "predateur"),
    ("meute", "predateurs", "Meutes coordonnées", "faune_predateur", "Chasser à plusieurs demande de se parler.", "predateur"),
    ("alpha", "predateurs", "Alphas stratèges", "faune_predateur", "Ceux qui pensent la chasse avant de la courir.", "predateur"),
    ("primitif", "eveil", "Walachiens primitifs", "walachien_primitif", "La mâchoire s'est redressée. Elle porte une lance.", "erre"),
    ("feufroid", "eveil", "Feu froid", None, "Une flamme fluorescente qui éclaire sans brûler la forêt.", "orne"),
    ("langage", "eveil", "Langage clicté", None, "Des claquements de mâchoire qui deviennent des idées.", "orne"),
    ("tribal", "tribus", "Clans tribaux", "walachien_tribal", "Chaque clan protège une vallée comme on protège un enfant.", "erre"),
    ("totem", "tribus", "Totems d'os", "totem_fluo", "La mémoire des ancêtres gravée en runes lumineuses.", "orne"),
    ("hutte", "tribus", "Huttes vivantes", "hutte_fluo", "On ne coupe pas un arbre : on lui demande de devenir maison.", "orne"),
    ("cite", "civilisation", "Cités-jardins", "spire_fluo", "Des spires organiques où la ville EST la forêt.", "orne"),
    ("gardien", "civilisation", "Gardiens des biomes", "walachien_sentinelle", "Le premier serment : aucune espèce ne s'éteindra ici.", "erre"),
    ("archives", "civilisation", "Archives du vivant", None, "Le génome de chaque créature de Walachie, conservé à jamais.", "orne"),
    ("sentinelle", "sentinelles", "Sentinelles", "walachien_sentinelle", "L'armure fluorescente, le regard froid : la vie a ses soldats.", "erre"),
    ("flotte", "sentinelles", "Flottes de purge", None, "Elles traversent le vide pour juger les civilisations destructrices.", "orne"),
    ("ancien", "sentinelles", "Conseil des Anciens", "walachien_ancien", "Ceux qui décident quels mondes méritent d'être défendus.", "erre"),
    ("portail", "ascension", "Portail du Panthéon", "portail_divin", "Une porte vers ce qui regarde Walachie depuis toujours.", "orne"),
    ("conscience", "ascension", "Conscience planétaire", None, "Chaque créature devient une pensée d'un même esprit.", "orne"),
    ("divinite", "ascension", "Divinité de Walachie", "divinite", "L'esprit du monde ouvre les yeux — et rêve d'autres mondes.", "orne"),
    ("nef", "essaimage", "Nefs-semences", "nef_semence", "Des vaisseaux vivants qui portent la sève vers d'autres cieux.", "erre"),
    ("avantposte", "essaimage", "Avant-postes vivants", None, "Une première racine plantée sur un monde qui n'est pas Walachie.", "orne"),
    ("jardin_orbital", "essaimage", "Jardins orbitaux", None, "La sève pousse maintenant en apesanteur, entre les mondes.", "orne"),
    ("sentinelle_stellaire", "choeur_stellaire", "Sentinelles stellaires", "sentinelle_stellaire", "Elles ne dorment jamais : chaque étoile a besoin d'un gardien.", "predateur"),
    ("relais", "choeur_stellaire", "Relais de lumière", None, "Un message de vie, relayé d'étoile en étoile.", "orne"),
    ("choeur", "choeur_stellaire", "Chœur des étoiles", "choeur_etoiles", "Les Voiles chantaient le vent ; ceci chante le vide.", "erre"),
    ("toile", "toile_galactique", "Toile vivante", "toile_vivante", "Un seul organisme, à l'échelle d'une galaxie.", "orne"),
    ("spirale", "toile_galactique", "Bras spiraux ensemencés", None, "Chaque bras de la galaxie porte désormais une part de Walachie.", "orne"),
    ("coeur_galactique", "toile_galactique", "Cœur galactique", None, "Au centre, quelque chose qui ressemble à une mémoire.", "orne"),
]

# Au-dela de la Toile Galactique : queue procedurale infinie, jamais ecrite en
# JSON (aucune fin a stocker). Chaque "amas" suivant reutilise le decor et le
# sprite de la derniere ere reelle, et coute TAIL_GROWTH fois le precedent —
# la meme croissance que les eres reelles, pour que le rythme ne change pas.
TAIL_GROWTH = ERA_GROWTH

EVENTS = [
    ("pluie_spores", "Pluie de spores", "Des spores fécondes tombent des nuages : la sève coule à flots.", "prod_mult", 2.0, 600, 30),
    ("chant_monde", "Chant du monde", "Les Voiles chantent à l'unisson : Walachie vibre.", "prod_mult", 3.0, 240, 15),
    ("aurore", "Aurore fluorescente", "Le ciel s'embrase : chaque pulsation résonne cinq fois plus fort.", "click_mult", 5.0, 300, 25),
    ("migration", "Grande migration", "Un troupeau traverse tes terres et laisse la plaine plus riche.", "instant_min", 20.0, 0, 25),
    ("meteore", "Météore de vie", "Une pierre tombée d'ailleurs, gorgée de sève inconnue.", "instant_min", 45.0, 0, 5),
]

META = [
    ("meta_prod", "Mémoire du vivant", "La sève coule {pct} plus vite, pour toujours.", "prod_mult", 0.25, 1),
    ("meta_click", "Écho de la pulsation", "Chaque pulsation rapporte {pct} de plus, pour toujours.", "click_mult", 0.50, 1),
    ("meta_offline", "Rêve profond", "Le monde produit {h} h de plus en ton absence.", "offline_h", 2.0, 2),
    ("meta_events", "Monde bavard", "Les moments spontanés surviennent {pct} plus souvent.", "event_speed", 0.10, 2),
    ("meta_depart", "Graine ancestrale", "Chaque cycle commence avec une réserve de sève.", "start_seve", 10.0, 1),
]


def build():
    eras = []
    nodes = []
    for e, (eid, name, icon, desc, decor) in enumerate(ERAS):
        base = ERA_BASE0 * (ERA_GROWTH ** e)
        payback = PAYBACK0_S * (PAYBACK_GROWTH ** e)
        unlock = 0.0 if e == 0 else round(base * UNLOCK_MULT, 2)
        eras.append({
            "id": eid, "nom": name, "icone": icon, "desc": desc, "decor": decor,
            "unlock_cost": unlock,
            "$comment": "unlock = base de l'ere x %.1f ; payback des noeuds ~%ds" % (UNLOCK_MULT, payback),
        })
        js = [n for n in NODES if n[1] == eid]
        for j, (nid, _, nname, sprite, ndesc, comport) in enumerate(js):
            cost = base * (NODE_STEP ** j)
            prod = cost / payback
            nodes.append({
                "id": nid, "ere": eid, "nom": nname, "sprite": sprite, "desc": ndesc,
                "comportement": comport,
                "base_cost": round(cost, 2),
                "cost_ratio": COST_RATIO,
                "base_prod": round(prod, 4),
                "$comment": "payback initial %ds ; cout x%.2f par achat" % (payback, COST_RATIO),
            })
    cfg = {
        "$comment": "GENERE par tools/walachie/gen_config.py — ne pas editer a la main. Mode Walachie : clicker d'evolution inspire de Cell to Singularity, univers exoplanete Walachie.",
        "click": {
            "base": 1.0,
            "prod_share": CLICK_PROD_SHARE,
            "$comment": "pulsation = base + prod_share x prod/s : le clic reste ~5%% de l'idle a tout stade",
        },
        "offline": {"cap_hours": OFFLINE_CAP_H, "$comment": "plafond hors ligne, extensible via meta_offline"},
        "prestige": {
            "eclat_div": ECLAT_DIV,
            "eclat_pow": ECLAT_POW,
            "cycle_prod_bonus": CYCLE_PROD_BONUS,
            "min_eclats": 3,
            "$comment": "eclats = max(min, floor((seve totale du cycle / div)^pow)) ; premiere Renaissance ~5 eclats (simule)",
        },
        "events": {
            "interval_min_s": 1500,
            "interval_max_s": 4200,
            "retour_gift_min": 15,
            "$comment": "un moment spontane toutes les 25-70 min de jeu ouvert ; cadeau de retour = 15 min de prod si un evenement a ete manque hors ligne. Le hasard AJOUTE, jamais ne retire.",
            "pool": [
                {"id": i, "nom": n, "desc": d, "effet": t, "valeur": v, "duree_s": dur, "poids": w}
                for (i, n, d, t, v, dur, w) in EVENTS
            ],
        },
        "habit_bonus": {
            "bilan_prod_mult": 1.5,
            "streak_prod_per_day": 0.02,
            "streak_prod_cap": 0.6,
            "perfect_click_mult": 3.0,
            "$comment": "pont avec le jeu principal : Bilan du soir valide aujourd'hui -> prod x1.5 jusqu'a minuit ; serie -> +2%%/jour de prod plafonne a +60%% ; journee qui tient la serie -> pulsation x3. Lecture seule de la sauvegarde EVOLVE, rien n'est retire si les habitudes manquent.",
        },
        "meta": [
            {"id": i, "nom": n, "desc": d, "effet": t, "valeur": v, "cost_base": c, "cost_ratio": 2.0,
             "$comment": "cout en Eclats = cost_base x 2^niveau, sans dernier niveau"}
            for (i, n, d, t, v, c) in META
        ],
        "scene": {
            "world_w": 1280, "world_h": 960, "max_sprites_par_noeud": 8,
            "$comment": "l'ecosysteme affiche jusqu'a 8 individus par noeud possede — au-dela le nombre est ecrit, pas dessine",
        },
        "shiny": {
            "seuil": SHINY_THRESHOLD,
            "multiplicateur": SHINY_MULT,
            "$comment": (
                "toutes les %d unites d'un meme noeud possede, une creature brillante apparait "
                "dans l'ecosysteme (distincte des ameliorations meta, qui ne se valident qu'une "
                "fois) ; cliquee, elle explose en paillettes et multiplie la seve en stock par "
                "%.1f — un gros boost ponctuel a declencher au bon moment, jamais automatique."
            ) % (SHINY_THRESHOLD, SHINY_MULT),
        },
        "tail": {
            "growth": TAIL_GROWTH,
            "decor": eras[-1]["decor"],
            "icone": eras[-1]["icone"],
            "sprite": next((n["sprite"] for n in reversed(nodes) if n["sprite"]), None),
            "cost_ratio": nodes[-1]["cost_ratio"],
            "nom_pattern": "Au-delà — Amas {k}",
            "$comment": (
                "au-dela de la derniere ere reelle (%s), chaque amas suivant coute x%.1f "
                "le precedent et reutilise son decor/sprite — genere a la volee cote TS "
                "(src/lib/game/walachie/config.ts), jamais ecrit ici : aucune fin ne s'ecrit en JSON."
            ) % (eras[-1]["id"], TAIL_GROWTH),
        },
        "eras": eras,
        "nodes": nodes,
    }
    return cfg


def simulate(cfg, session_s=600, gap_s=3 * 3600, clicks_per_s=1.5, days_max=60):
    """Micro-sessions de 10 min toutes les 3 h, achat glouton du meilleur payback.
    Ne s'arrete PLUS a la Divinite (ce n'est qu'une marche) : continue jusqu'a
    days_max, en traversant les eres reelles post-Ascension puis la queue
    procedurale infinie (cfg["tail"]), pour verifier que le rythme ne casse pas
    apres la Divinite non plus."""
    nodes = cfg["nodes"]
    eras = cfg["eras"]
    tail = cfg["tail"]
    n_real = len(eras)
    last_node = nodes[-1]
    era_index = {e["id"]: i for i, e in enumerate(eras)}
    counts = {n["id"]: 0 for n in nodes}
    tail_counts: dict[int, int] = {}
    unlocked = 1
    seve = 0.0
    total = 0.0
    t = 0.0
    end = days_max * 86400
    div_at = None
    last_real_era_at = None
    tail_milestones: dict[int, float] = {}
    last_buy_t = 0.0
    worst_gap = 0.0

    def era_unlock_cost(i):
        if i < n_real:
            return eras[i]["unlock_cost"]
        k = i - n_real + 1
        return eras[-1]["unlock_cost"] * (tail["growth"] ** k)

    def virtual_node(k):
        g = tail["growth"] ** k
        return {"base_cost": last_node["base_cost"] * g, "base_prod": last_node["base_prod"] * g}

    def prod():
        p = sum(n["base_prod"] * counts[n["id"]] for n in nodes)
        for k, c in tail_counts.items():
            p += virtual_node(k)["base_prod"] * c
        return p

    def cost_real(n):
        return n["base_cost"] * (n["cost_ratio"] ** counts[n["id"]])

    def cost_virtual(k):
        return virtual_node(k)["base_cost"] * (tail["cost_ratio"] ** tail_counts.get(k, 0))

    while t < end:
        s_end = t + session_s
        while t < s_end:
            p = prod()
            click = (cfg["click"]["base"] + cfg["click"]["prod_share"] * p) * clicks_per_s
            gain = (p + click) * 10
            seve += gain
            total += gain
            t += 10
            # achats gloutons : percee d'ere (reelle ou virtuelle) puis meilleur ratio prod/cout
            bought = True
            while bought:
                bought = False
                nxt_cost = era_unlock_cost(unlocked)
                if seve >= nxt_cost:
                    seve -= nxt_cost
                    unlocked += 1
                    bought = True
                    continue
                best_ratio, best = 0.0, None  # best = ("real", node) | ("virtual", k)
                for n in nodes:
                    if era_index[n["ere"]] >= unlocked:
                        continue
                    c = cost_real(n)
                    if c <= seve and n["base_prod"] / c > best_ratio:
                        best_ratio, best = n["base_prod"] / c, ("real", n)
                if unlocked > n_real:
                    for k in range(1, unlocked - n_real + 1):
                        c = cost_virtual(k)
                        if c <= seve and virtual_node(k)["base_prod"] / c > best_ratio:
                            best_ratio, best = virtual_node(k)["base_prod"] / c, ("virtual", k)
                if best:
                    kind, obj = best
                    if kind == "real":
                        counts[obj["id"]] += 1
                        seve -= cost_real(obj) / obj["cost_ratio"]
                        if obj["id"] == "divinite" and div_at is None:
                            div_at = t
                        if obj["id"] == last_node["id"] and last_real_era_at is None:
                            last_real_era_at = t
                    else:
                        tail_counts[obj] = tail_counts.get(obj, 0) + 1
                        seve -= cost_virtual(obj) / tail["cost_ratio"]
                        tail_milestones.setdefault(obj, t)
                    worst_gap = max(worst_gap, t - last_buy_t)
                    last_buy_t = t
                    bought = True
        off = min(gap_s, cfg["offline"]["cap_hours"] * 3600)
        gain = prod() * off
        seve += gain
        total += gain
        t += gap_s

    eclats = max(cfg["prestige"]["min_eclats"], int((total / cfg["prestige"]["eclat_div"]) ** cfg["prestige"]["eclat_pow"])) if div_at else 0
    return {
        "div_at": div_at, "total": total, "eclats": eclats, "worst_gap": worst_gap,
        "last_real_era_at": last_real_era_at, "tail_milestones": tail_milestones,
    }


def main():
    cfg = build()
    r = simulate(cfg)
    if r["div_at"] is None:
        raise SystemExit("SIM: Divinite jamais atteinte — recalibrer")
    days = r["div_at"] / 86400
    print("SIM regulier (10 min / 3 h) : Divinite (marche, pas fin) J%.1f · pire attente globale %.1f h"
          % (days, r["worst_gap"] / 3600))
    if not (3.0 <= days <= 12.0):
        raise SystemExit("SIM: premiere Renaissance possible hors fenetre 3-12 j (%.1f j)" % days)
    if r["last_real_era_at"] is not None:
        print("  Toile Galactique (derniere ere reelle) : J%.1f" % (r["last_real_era_at"] / 86400))
    for k in sorted(r["tail_milestones"])[:3]:
        print("  Au-dela — Amas %d : J%.1f" % (k, r["tail_milestones"][k] / 86400))
    if r["worst_gap"] > 48 * 3600:
        raise SystemExit("SIM: plateau > 48 h detecte (avant ou apres la Divinite)")
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print("ecrit:", os.path.relpath(OUT))


if __name__ == "__main__":
    main()
