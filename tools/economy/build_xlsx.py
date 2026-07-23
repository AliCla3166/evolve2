# -*- coding: utf-8 -*-
"""
Construit economy_balance.xlsx : classeur de calibrage complet et modifiable
pour l'economie de l'Age 1 "Cellule" d'EVOLVE.

Feuilles :
  1. Params        - tous les leviers de calibrage (cellules bleues = a modifier)
  2. Batiments      - metadonnees + recettes de cout des 9 batiments dans le perimetre
  3. Niveaux        - table detaillee temps/cout/production par batiment x niveau (formules)
  4. Stockage       - matrice des plafonds de stockage (Noyau x Biomasse)
  5. Ressources     - les 11 ressources et leur role economique
  6. Simulation     - trace de validation du pacing (~90 jours cible)
  7. Methodologie   - notes de conception, comment retoucher le modele

Toutes les valeurs derivees sont des FORMULES Excel referencant la feuille
Params (jamais de resultat Python code en dur), a l'exception de la colonne
"attente ressource" et "temps ecoule cumule" de la feuille Simulation, qui
sont le resultat emergent d'une simulation sequentielle (ordre de construction
glouton) impossible a exprimer comme formule Excel simple : cette feuille
porte une note explicite indiquant qu'il faut relancer
`python3 simulate.py` puis `python3 build_xlsx.py` apres toute modification
de Params pour la remettre a jour.
"""
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation

from model import (
    TOTAL_DAYS, HOURS_PER_DAY, TOTAL_HOURS, N_PARALLEL_BUILD_SLOTS,
    TIME_RATIO, PROD_RATIO, COST_RATIO, COST_SCALE, STARTING_STOCK, BASE_CAP,
    NOYAU_VITALITE_BASE, NOYAU_VITALITE_RATIO, PRODUCER_BASE,
    TIME_BUDGET_HOURS, BUILDING_META, OUT_OF_SCOPE_BUILDINGS, COST_RECIPES,
    RESOURCES_META,
)
from simulate import run_simulation, PRODUCIBLE_RESOURCES

FONT_NAME = "Arial"
BLUE = Font(name=FONT_NAME, color="0000FF")
BLACK = Font(name=FONT_NAME, color="000000")
BOLD = Font(name=FONT_NAME, bold=True)
BOLD_WHITE = Font(name=FONT_NAME, bold=True, color="FFFFFF")
ITALIC_GREY = Font(name=FONT_NAME, italic=True, color="777777")
TITLE_FILL = PatternFill("solid", fgColor="1B2A4A")
HEADER_FILL = PatternFill("solid", fgColor="2E4272")
ASSUMPTION_FILL = PatternFill("solid", fgColor="FFF2CC")
OOS_FILL = PatternFill("solid", fgColor="EDEDED")
THIN = Side(style="thin", color="CCCCCC")
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)

BUILDING_ORDER = list(TIME_BUDGET_HOURS.keys())  # noyau, membrane, adn, proteine, biomasse, enzyme, lipide, signaux, mutation
PRODUCERS_ORDER = list(PRODUCER_BASE.keys())

wb = Workbook()


def style_title(ws, text, span, row=1):
    ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=span)
    c = ws.cell(row=row, column=1, value=text)
    c.font = BOLD_WHITE
    c.fill = TITLE_FILL
    c.alignment = Alignment(horizontal="left", vertical="center")
    ws.row_dimensions[row].height = 22


def style_header_row(ws, row, ncols):
    for col in range(1, ncols + 1):
        c = ws.cell(row=row, column=col)
        c.font = BOLD_WHITE
        c.fill = HEADER_FILL
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        c.border = BORDER


def autosize(ws, widths):
    for i, w in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(i)].width = w


# ============================================================
# 1. PARAMS
# ============================================================
ws = wb.active
ws.title = "Params"
style_title(ws, "EVOLVE - Age 1 Cellule - Parametres de calibrage (modifier les cellules bleues)", 3)

rows = [
    ("Jours cibles (duree totale visee de l'Age 1)", TOTAL_DAYS, "TOTAL_DAYS"),
    ("Heures par jour", HOURS_PER_DAY, "HOURS_PER_DAY"),
    ("Heures cibles totales", "=B4*B5", "TOTAL_HOURS (formule = jours x 24)"),
    ("Slots de construction en parallele", N_PARALLEL_BUILD_SLOTS, "N_PARALLEL_BUILD_SLOTS (1 = une seule file globale)"),
    ("Ratio de croissance du TEMPS par niveau", TIME_RATIO, "TIME_RATIO"),
    ("Ratio de croissance de la PRODUCTION par niveau", PROD_RATIO, "PROD_RATIO"),
    ("Ratio de croissance du COUT par niveau", COST_RATIO, "COST_RATIO"),
    ("Echelle globale des couts (multiplicateur unique)", COST_SCALE, "COST_SCALE - le bouton principal pour rendre tout plus cher/moins cher"),
    ("Stock de depart par ressource productible (bootstrap)", STARTING_STOCK, "STARTING_STOCK"),
    ("Capacite de stockage de base (avant bonus Noyau/Biomasse)", BASE_CAP, "BASE_CAP"),
    ("Production de base des 6 producteurs a niveau 1 (u/h)", PRODUCER_BASE["adn"], "PRODUCER_BASE (uniforme, a differencier par ressource si besoin)"),
    ("Vitalite - production de base du Noyau a niveau 1 (u/h)", NOYAU_VITALITE_BASE, "NOYAU_VITALITE_BASE"),
    ("Vitalite - ratio de croissance par niveau du Noyau", NOYAU_VITALITE_RATIO, "NOYAU_VITALITE_RATIO"),
]
r = 3
ws.cell(row=r, column=1, value="Parametre").font = BOLD
ws.cell(row=r, column=2, value="Valeur").font = BOLD
ws.cell(row=r, column=3, value="Nom / note").font = BOLD
style_header_row(ws, r, 3)
r += 1
PARAM_ROWS = {}
for label, val, note in rows:
    ws.cell(row=r, column=1, value=label).font = BLACK
    cell = ws.cell(row=r, column=2, value=val)
    if isinstance(val, str) and val.startswith("="):
        cell.font = BLACK
    else:
        cell.font = BLUE
        cell.fill = ASSUMPTION_FILL
    ws.cell(row=r, column=3, value=note).font = ITALIC_GREY
    PARAM_ROWS[note.split(" ")[0].rstrip("(")] = r
    r += 1

# Table des budgets temps par batiment (ligne = batiment ; doit sommer a TOTAL_HOURS)
r += 1
ws.cell(row=r, column=1, value="Budgets temps par batiment (h) - doit sommer a Heures cibles totales").font = BOLD
r += 1
hdr_row_budget = r
ws.cell(row=r, column=1, value="Batiment")
ws.cell(row=r, column=2, value="Budget temps (h)")
ws.cell(row=r, column=3, value="% du budget total")
style_header_row(ws, r, 3)
r += 1
BUDGET_FIRST_ROW = r
for b in BUILDING_ORDER:
    ws.cell(row=r, column=1, value=BUILDING_META[b]["name"]).font = BLACK
    c = ws.cell(row=r, column=2, value=TIME_BUDGET_HOURS[b])
    c.font = BLUE
    c.fill = ASSUMPTION_FILL
    ws.cell(row=r, column=3, value=f"=B{r}/$B$6").number_format = "0.0%"
    r += 1
BUDGET_LAST_ROW = r - 1
ws.cell(row=r, column=1, value="Somme").font = BOLD
ws.cell(row=r, column=2, value=f"=SUM(B{BUDGET_FIRST_ROW}:B{BUDGET_LAST_ROW})").font = BOLD
r += 1
ws.cell(row=r, column=1, value="Ecart vs Heures cibles totales (doit = 0)").font = BOLD
ws.cell(row=r, column=2, value=f"=B{r-1}-B6").font = BOLD

autosize(ws, [46, 14, 62])
ws.freeze_panes = "A4"

# Defined names (plages nommees) pour des formules lisibles dans les autres feuilles
defn = wb.defined_names
def add_name(name, ref):
    from openpyxl.workbook.defined_name import DefinedName
    defn[name] = DefinedName(name, attr_text=ref)

add_name("TOTAL_DAYS", "Params!$B$4")
add_name("HOURS_PER_DAY", "Params!$B$5")
add_name("TOTAL_HOURS", "Params!$B$6")
add_name("N_SLOTS", "Params!$B$7")
add_name("R_TEMPS", "Params!$B$8")
add_name("R_PROD", "Params!$B$9")
add_name("R_COUT", "Params!$B$10")
add_name("COST_SCALE_N", "Params!$B$11")
add_name("START_STOCK", "Params!$B$12")
add_name("BASE_CAP_N", "Params!$B$13")
add_name("PROD_BASE", "Params!$B$14")
add_name("VIT_BASE", "Params!$B$15")
add_name("VIT_RATIO", "Params!$B$16")

# ============================================================
# 2. BATIMENTS
# ============================================================
ws2 = wb.create_sheet("Batiments")
style_title(ws2, "Batiments dans le perimetre (9) - metadonnees et recettes de cout", 11)
headers = ["id", "Nom", "Famille", "Role", "Budget temps (h)", "Somme facteurs temps",
           "Ressource cout A", "Poids A", "Ressource cout B", "Poids B", "Ressource produite"]
hr = 3
for i, h in enumerate(headers, start=1):
    ws2.cell(row=hr, column=i, value=h)
style_header_row(ws2, hr, len(headers))

row0 = hr + 1
BAT_ROW = {}
for i, b in enumerate(BUILDING_ORDER):
    rr = row0 + i
    BAT_ROW[b] = rr
    meta = BUILDING_META[b]
    recipe = list(COST_RECIPES[b].items())
    ws2.cell(row=rr, column=1, value=b).font = BLACK
    ws2.cell(row=rr, column=2, value=meta["name"])
    ws2.cell(row=rr, column=3, value=meta["family"])
    ws2.cell(row=rr, column=4, value=meta["role"])
    ws2.cell(row=rr, column=5, value=f'=INDEX(Params!$B${BUDGET_FIRST_ROW}:$B${BUDGET_LAST_ROW},MATCH(B{rr},Params!$A${BUDGET_FIRST_ROW}:$A${BUDGET_LAST_ROW},0))')
    ws2.cell(row=rr, column=6, value=f'=IF(A{rr}="noyau",R_TEMPS^1+R_TEMPS^2+R_TEMPS^3+R_TEMPS^4,R_TEMPS^0+R_TEMPS^1+R_TEMPS^2+R_TEMPS^3+R_TEMPS^4)')
    ws2.cell(row=rr, column=7, value=recipe[0][0])
    ws2.cell(row=rr, column=8, value=recipe[0][1]).font = BLUE
    ws2.cell(row=rr, column=9, value=recipe[1][0])
    ws2.cell(row=rr, column=10, value=recipe[1][1]).font = BLUE
    ws2.cell(row=rr, column=11, value=meta.get("resource", "vitalite" if b == "noyau" else ""))
    for col in range(1, 12):
        ws2.cell(row=rr, column=col).border = BORDER

oos_row0 = row0 + len(BUILDING_ORDER) + 1
ws2.cell(row=oos_row0 - 1, column=1, value="Hors perimetre (mini-jeux non finalises - structure seulement)").font = BOLD
for i, (b, meta) in enumerate(OUT_OF_SCOPE_BUILDINGS.items()):
    rr = oos_row0 + i
    ws2.cell(row=rr, column=1, value=b).font = ITALIC_GREY
    ws2.cell(row=rr, column=2, value=meta["name"]).font = ITALIC_GREY
    ws2.cell(row=rr, column=3, value=meta["family"]).font = ITALIC_GREY
    ws2.cell(row=rr, column=4, value="minigame_gate (non designe)").font = ITALIC_GREY
    ws2.cell(row=rr, column=11, value=meta["note"]).font = ITALIC_GREY
    for col in range(1, 12):
        ws2.cell(row=rr, column=col).fill = OOS_FILL

autosize(ws2, [10, 26, 18, 14, 14, 16, 15, 8, 15, 8, 18])
ws2.freeze_panes = "A4"

# ============================================================
# 3. NIVEAUX (table detaillee temps/cout/production)
# ============================================================
ws3 = wb.create_sheet("Niveaux")
style_title(ws3, "Temps de construction, cout et production par batiment x niveau (formules -> Params/Batiments)", 11)
headers3 = ["Batiment", "Niveau", "Payant ?", "Index transition (cout)", "Temps construction (h)",
            "Temps cumule (h)", "Production / h", "Ressource cout A", "Cout A", "Ressource cout B", "Cout B"]
hr3 = 3
for i, h in enumerate(headers3, start=1):
    ws3.cell(row=hr3, column=i, value=h)
style_header_row(ws3, hr3, len(headers3))

row = hr3 + 1
first_data_row = row
for b in BUILDING_ORDER:
    bat_row = BAT_ROW[b]
    for lvl in range(1, 6):
        rr = row
        ws3.cell(row=rr, column=1, value=f'=Batiments!$A${bat_row}')
        ws3.cell(row=rr, column=2, value=lvl)
        ws3.cell(row=rr, column=3, value=f'=NOT(AND(A{rr}="noyau",B{rr}=1))')
        ws3.cell(row=rr, column=4, value=f'=IF(A{rr}="noyau",B{rr}-2,B{rr}-1)')
        # Exposant temps = Niveau-1 dans les deux cas (contrairement a l'index de
        # transition D utilise pour le cout, qui est decale de -1 pour le Noyau
        # puisque son niveau 1 est gratuit). Verifie contre model.py::_time_series.
        ws3.cell(row=rr, column=5,
                 value=f'=IF(C{rr}=FALSE,0,(Batiments!$E${bat_row}/Batiments!$F${bat_row})*R_TEMPS^(B{rr}-1))')
        first_row_this_building = row - (lvl - 1)
        ws3.cell(row=rr, column=6, value=f'=SUMIFS($E${first_row_this_building}:$E{rr},$A${first_row_this_building}:$A{rr},A{rr})')
        ws3.cell(row=rr, column=7,
                 value=f'=IF(A{rr}="noyau",VIT_BASE*VIT_RATIO^(B{rr}-1),IF(Batiments!$K${bat_row}<>"",PROD_BASE*R_PROD^(B{rr}-1),""))')
        ws3.cell(row=rr, column=8, value=f'=Batiments!$G${bat_row}')
        ws3.cell(row=rr, column=9, value=f'=IF(C{rr}=FALSE,0,COST_SCALE_N*R_COUT^D{rr}*Batiments!$H${bat_row})')
        ws3.cell(row=rr, column=10, value=f'=Batiments!$I${bat_row}')
        ws3.cell(row=rr, column=11, value=f'=IF(C{rr}=FALSE,0,COST_SCALE_N*R_COUT^D{rr}*Batiments!$J${bat_row})')
        for col in range(1, 12):
            ws3.cell(row=rr, column=col).border = BORDER
        for col in (5, 6, 7, 9, 11):
            ws3.cell(row=rr, column=col).number_format = "#,##0.0"
        row += 1
    row += 0  # pas de ligne vide entre batiments pour garder les SUMIFS contigus

autosize(ws3, [14, 8, 9, 12, 18, 14, 13, 15, 12, 15, 12])
ws3.freeze_panes = f"A{first_data_row}"

# ============================================================
# 4. STOCKAGE
# ============================================================
ws4 = wb.create_sheet("Stockage")
style_title(ws4, "Plafond de stockage (par ressource productible) selon niveau Noyau x niveau Biomasse", 8)
ws4.cell(row=3, column=1, value="Formule : cap = BASE_CAP * (1 + 0.5*(Noyau-1) + 0.5*(Biomasse-1)) ; si Biomasse=0, seul le bonus du Noyau s'applique").font = ITALIC_GREY
hdrrow = 4
ws4.cell(row=hdrrow, column=1, value="Niveau Noyau \\ Niveau Biomasse")
for j, blvl in enumerate(range(0, 6), start=2):
    ws4.cell(row=hdrrow, column=j, value=blvl)
style_header_row(ws4, hdrrow, 7)
for i, nlvl in enumerate(range(1, 6), start=hdrrow + 1):
    ws4.cell(row=i, column=1, value=nlvl).font = BOLD
    for j, blvl in enumerate(range(0, 6), start=2):
        col_letter = get_column_letter(j)
        b_ref = f"{col_letter}${hdrrow}"
        n_ref = f"$A{i}"
        formula = f'=IF({b_ref}=0,BASE_CAP_N*(1+0.5*({n_ref}-1)),BASE_CAP_N*(1+0.5*({n_ref}-1)+0.5*({b_ref}-1)))'
        c = ws4.cell(row=i, column=j, value=formula)
        c.number_format = "#,##0"
        c.border = BORDER
autosize(ws4, [28, 10, 10, 10, 10, 10, 10])

# ============================================================
# 5. RESSOURCES
# ============================================================
ws5 = wb.create_sheet("Ressources")
style_title(ws5, "Les 11 ressources d'EVOLVE - role dans l'economie de l'Age 1", 6)
headers5 = ["id", "Nom", "Type", "Depensable sur constructions ?", "Producteur (batiment)", "Note"]
hr5 = 3
for i, h in enumerate(headers5, start=1):
    ws5.cell(row=hr5, column=i, value=h)
style_header_row(ws5, hr5, len(headers5))
for i, (rid, meta) in enumerate(RESOURCES_META.items(), start=hr5 + 1):
    ws5.cell(row=i, column=1, value=rid)
    ws5.cell(row=i, column=2, value=meta["name"])
    ws5.cell(row=i, column=3, value=meta["kind"])
    ws5.cell(row=i, column=4, value="Oui" if meta.get("spendable_on_buildings") else "Non")
    ws5.cell(row=i, column=5, value=meta.get("producer", ""))
    ws5.cell(row=i, column=6, value=meta.get("note", "")).alignment = Alignment(wrap_text=True)
    for col in range(1, 7):
        ws5.cell(row=i, column=col).border = BORDER
    if meta["kind"] == "hors_perimetre":
        for col in range(1, 7):
            ws5.cell(row=i, column=col).fill = OOS_FILL
autosize(ws5, [10, 20, 16, 14, 18, 60])

# ============================================================
# 6. SIMULATION (trace de validation du pacing)
# ============================================================
sim = run_simulation(verbose=False)
ws6 = wb.create_sheet("Simulation")
style_title(ws6, "Simulation de validation du pacing (strategie : batiment le plus rapide en premier)", 7, row=1)
note = ("NOTE : les colonnes Temps et Cout ci-dessous sont des FORMULES qui pointent vers la feuille "
        "Niveaux (elles se mettent a jour si vous changez Params). Les colonnes 'Attente ressource' et "
        "'Temps ecoule cumule' sont le resultat EMERGENT d'une simulation sequentielle (ordre de "
        "construction glouton, file a 1 slot) : elles ne peuvent pas etre exprimees comme simples formules "
        "Excel. Apres toute modification de Params, relancer 'python3 simulate.py && python3 build_xlsx.py' "
        "pour regenerer cette trace figee.")
ws6.merge_cells(start_row=2, start_column=1, end_row=2, end_column=7)
c = ws6.cell(row=2, column=1, value=note)
c.font = ITALIC_GREY
c.alignment = Alignment(wrap_text=True, vertical="top")
ws6.row_dimensions[2].height = 45

summary_row = 4
labels = ["Cible (jours)", "Cible (heures)", "Simule (heures)", "Simule (jours)",
          "dont attente ressource (h)", "attente ressource (% du total)", "ecart vs cible (%)"]
values = [
    "=TOTAL_DAYS", "=TOTAL_HOURS", round(sim["elapsed_hours"], 1), round(sim["elapsed_days"], 2),
    round(sim["wait_hours"], 1), round(sim["wait_pct"], 2) / 100, round((sim["elapsed_hours"] / (TOTAL_DAYS * HOURS_PER_DAY) - 1), 4)
]
for i, lab in enumerate(labels):
    ws6.cell(row=summary_row, column=i + 1, value=lab).font = BOLD
for i, val in enumerate(values):
    cell = ws6.cell(row=summary_row + 1, column=i + 1, value=val)
    if i in (5, 6):
        cell.number_format = "0.0%"

hdrrow6 = summary_row + 3
headers6 = ["Etape", "Batiment", "Niveau", "Temps construction (h)", "Attente ressource (h)", "Temps ecoule cumule (h)", "Cout (detail)"]
for i, h in enumerate(headers6, start=1):
    ws6.cell(row=hdrrow6, column=i, value=h)
style_header_row(ws6, hdrrow6, len(headers6))

for i, step in enumerate(sim["steps"], start=hdrrow6 + 1):
    b = step["building"]
    lvl = step["level"]
    niv_row = first_data_row + BUILDING_ORDER.index(b) * 5 + (lvl - 1)
    ws6.cell(row=i, column=1, value=step["step"])
    ws6.cell(row=i, column=2, value=BUILDING_META[b]["name"])
    ws6.cell(row=i, column=3, value=lvl)
    ws6.cell(row=i, column=4, value=f"=Niveaux!$E${niv_row}").number_format = "#,##0.0"
    ws6.cell(row=i, column=5, value=step["wait_hours"]).number_format = "#,##0.0"
    ws6.cell(row=i, column=6, value=step["elapsed_after_hours"]).number_format = "#,##0.0"
    cost_str = ", ".join(f"{k}: {v}" for k, v in step["cost"].items())
    ws6.cell(row=i, column=7, value=cost_str)
    for col in range(1, 8):
        ws6.cell(row=i, column=col).border = BORDER

autosize(ws6, [8, 24, 9, 20, 18, 20, 34])
ws6.freeze_panes = f"A{hdrrow6+1}"

# ============================================================
# 7. METHODOLOGIE
# ============================================================
ws7 = wb.create_sheet("Methodologie")
style_title(ws7, "Methodologie de conception - Age 1 Cellule", 2)
notes = [
    ("Objectif de pacing", "Le temps de construction (feuille Niveaux, colonne E) est le levier PRINCIPAL de la duree de l'Age 1, calibre pour sommer a ~2160h (90 jours) sur les 9 batiments dans le perimetre, en file de construction unique (1 slot). Les couts en ressources sont volontairement calibres pour rester secondaires : la simulation (feuille Simulation) montre qu'ils n'ajoutent qu'environ 3% de temps d'attente supplementaire avec une strategie de jeu equilibree."),
    ("Pourquoi le Noyau a un traitement special", "Le Noyau primordial existe gratuitement des le debut du jeu (niveau 1 acquis, fiction etablie). Seules ses transitions vers les niveaux 2 a 5 sont payantes en temps et en ressources."),
    ("Reseau de dependances croisees", "Chaque batiment coute 2 ressources produites par d'AUTRES batiments (jamais la sienne propre), a la maniere d'OGame/Travian : Generateur d'ADN <- Enzymes+Biomasse ; Synthetiseur de proteines <- ADN+Enzymes ; Producteur de biomasse <- Lipides+Signaux ; Reacteur enzymatique <- Proteines+ADN ; Reservoir lipidique <- Biomasse+Enzymes ; Capteur de signaux <- Proteines+ADN ; Membrane protectrice <- Lipides+Proteines ; Noyau <- Biomasse+Signaux ; Centre de mutation <- Signaux+Vitalite. Cela force une progression equilibree plutot qu'un rush d'un seul batiment."),
    ("Points de Vitalite", "Produits passivement par le Noyau, ce sont une monnaie meta/prestige : jamais depensee comme cout de construction normal, sauf comme composant partiel (poids 0.6) du cout du Centre de mutation, qui est le batiment capstone de fin d'Age."),
    ("Points d'energie", "Generes par le suivi d'habitudes reel du joueur (mecanique Day Strike). Ils servent aux boosts temporaires (accelerer une construction, booster une production), pas au cout de construction de base - non modelises dans ce fichier."),
    ("Stockage", "Le plafond de stockage des 6 ressources productibles augmente avec le niveau du Noyau ET celui du Producteur de biomasse (fiction etablie : le noyau organise le stockage cellulaire, la biomasse fournit la matrice de stockage). Voir feuille Stockage pour la matrice complete."),
    ("Hors perimetre volontaire", "Centre Peche/Collection, Bastion-Defense et Bastion-Raid ne sont PAS economiquement definis ici (mini-jeux non finalises). Ils apparaissent en feuille Batiments comme entrees structurelles (designed=false) pour que le fichier reste navigable et complet, a completer plus tard sans casser la structure."),
    ("Comment retoucher le calibrage", "1) Modifier les cellules bleues de la feuille Params (budgets temps, ratios, echelle des couts, stock de depart, etc.). 2) Si vous changez profondement la logique (nouvelle ressource, nouveau batiment, nouvelle regle de stockage), modifier plutot economy/model.py (source de verite Python) puis relancer economy/export_json.py (JSON pour le code) et economy/build_xlsx.py (ce classeur). 3) Toujours relancer economy/simulate.py apres un changement de Params pour verifier que le total reste proche de 90 jours et que le pourcentage d'attente ressource reste faible (<15% environ)."),
    ("Fichiers lies", "economy_config.json (config machine-lisible pour le code, meme donnees que ce classeur) ; economy/model.py, simulate.py, export_json.py, build_xlsx.py (scripts source) ; Charte Graphique - Age 1 Cellulaire.dc.html (DA/etats visuels) ; assets/manifest.json (chemins des sprites) ; pages Notion 'Background narratif' et 'Conception technique - Base vivante evolutive'."),
]
r = 3
for title, body in notes:
    ws7.cell(row=r, column=1, value=title).font = BOLD
    r += 1
    ws7.merge_cells(start_row=r, start_column=1, end_row=r, end_column=2)
    c = ws7.cell(row=r, column=1, value=body)
    c.alignment = Alignment(wrap_text=True, vertical="top")
    ws7.row_dimensions[r].height = max(30, 15 * (len(body) // 100 + 1))
    r += 2
autosize(ws7, [100, 20])

wb.save("economy_balance.xlsx")
print("economy_balance.xlsx ecrit.")
