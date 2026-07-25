# Phase 9 — La Dérive : sorties manuelles, carte de foyers, Bilan du soir

*Document de conception + plan d'exécution. `PLAN.md` (vision) reste figé ; le suivi
d'avancement ira dans `docs/JOURNAL.md` comme pour toutes les phases précédentes.*

---

## 1. Le problème, tel qu'il est codé aujourd'hui

Trois constats, vérifiés dans le dépôt et pas de mémoire.

**Les vagues sont enfermées dans un calendrier.** `military_config.json → pathogens.interval_h`
vaut `[36, 84]` heures, avec un premier assaut à 48 h. Le commentaire de
`bastion_config.json → wave.$comment_lead` assume explicitement le verrou : *« jouer en avance
ne fait qu'avancer les vagues dans le temps sans en créer : le total sur 90 jours reste celui du
calendrier. »* La fenêtre de jeu manuel (`lead_window_h: 96`) permet d'anticiper une ou deux
vagues, puis plus rien. Le mini-jeu le mieux fini du projet est jouable environ deux fois par
semaine. C'est exactement ce que tu décris.

**La journée n'a pas de moments courts.** Entre deux chantiers (qui durent des heures à des
jours), une session de cinq minutes ne propose que : regarder une barre de progression, peut-être
lancer une expédition, peut-être pêcher si on a 30 ⚡. Rien qui se termine dans la session.

**Le Bilan du soir n'est pas un moment.** Les habitudes créditent de l'énergie en silence
(jusqu'à 95 ⚡/jour) et cette énergie n'a que deux débouchés : des jetons de pêche et
l'accélération de chantier plafonnée à 25 % par tâche. La meilleure journée réelle de ta vie ne
débloque rien de spectaculaire dans le jeu.

**Ce qui est déjà là et qu'on ne refait pas** : un moteur de tower-defense complet et pur
(`bastion/engine.ts`, 619 lignes), 62 espèces avec portraits et stats de combat, une monnaie
`combat` simulée, une Boutique Bastion à sept lignes d'amélioration, un système d'expéditions à
retour différé, un PRNG déterministe seedé, et un cap d'énergie à 9 999. Toute la plomberie
existe. Il manque une **structure de temps**.

---

## 2. Ce que Grow Castle fait bien, et ce qu'on en prend

J'ai fait dépouiller le jeu (wiki coréen NamuWiki, Fandom, guides). Cinq idées sont directement
transposables ; deux le sont mal et je les écarte.

**On prend :**

*Un seul nombre gouverne tout.* Dans Grow Castle, le numéro de vague est à la fois la barre de
progression, la note de difficulté de chaque nœud de la carte, le score du classement et la
source de points de compétence. Le joueur regarde n'importe quel contenu et sait instantanément
s'il peut le tenter, sans une ligne d'explication.

*Perdre est gratuit — et rapporte quand même.* Une vague perdue ne coûte rien et paie l'or
récolté avant la défaite. Farmer une vague qu'on ne peut pas battre est une stratégie légitime.
Résultat : le joueur appuie toujours sur le bouton. C'est ce qui autorise le jeu à être
brutalement lent sans jamais être punitif.

*Accélérer est un pari, pas un confort.* Le « Wave Skip » payant fait aussi apparaître deux à
quatre boss gonflés. On gagne : on saute les vagues **et** on touche +20 % d'or. On perd : les
gemmes sont parties. Mieux encore, la relique « Corne du Diable » se décline en +1 à +4 et
multiplie les stats ennemies de 40 % à 200 % — **le joueur choisit lui-même son multiplicateur de
difficulté**, gratuitement, en échange d'un butin qui monte plus vite que le danger.

*La carte EST l'économie.* Chaque colonie conquise paie de l'or à la minute, pour toujours, se
développe sur treize niveaux, accorde un bonus de stats permanent à toute l'armée, et débloque
parfois un héros. Ce n'est pas du contenu à côté de l'économie : c'est l'économie.

*Cinq horloges à cinq fréquences.* Colonies à la minute, mineurs en continu, kills par vague,
salaire de guilde par jour, saison par semaine. Quel que soit l'intervalle de retour du joueur —
trois minutes, huit heures, une semaine — quelque chose a mûri. C'est ça, le déclencheur de
retour, et ça ne demande aucune notification.

**On écarte :** le PvP et les classements (Evolve est un jeu solo lié à ta vie réelle, pas une
course), et l'absence totale de limite quotidienne (Grow Castle ne bride jamais le joueur ;
Evolve doit rester lent — chez nous, le frein s'appelle l'énergie, et l'énergie vient de tes
habitudes réelles. C'est le cœur du projet, pas un détail).

---

## 3. Le système proposé

### 3.1 Le Palier — un seul nombre pour tout

`waveCount` devient le **Palier**, affiché partout. Chaque foyer de la carte, chaque antre,
chaque faille porte une étiquette « Palier 14 ». Tu regardes un point, tu sais si c'est à ta
portée. Aucune autre échelle de difficulté n'existe dans le jeu.

### 3.2 Les Sorties — la vague se lance quand tu veux

Le verrou calendaire saute. Deux chemins coexistent, volontairement interchangeables :

**L'assaut planifié** (existant, inchangé) reste le filet de sécurité. Si tu ne joues pas, les
pathogènes attaquent quand même à leur rythme et `resolvePathogenWave` tranche hors-ligne. Pilier
n° 1 du `PLAN.md` — jamais de mur frustrant — préservé tel quel.

**La sortie** (nouveau) se lance d'un bouton, à n'importe quel moment. Trois sorties gratuites
par jour calendaire. Au-delà, chaque sortie coûte de l'énergie, avec un coût qui grimpe dans la
même journée : 12 ⚡, puis 19, 31, 49, 79… La courbe s'auto-limite (une journée parfaite vaut
95 ⚡, un jeton de pêche en coûte 30) sans qu'aucune porte ne se ferme jamais. Un plafond dur à
douze sorties/jour existe uniquement comme garde-fou anti-boucle.

**Perdre une sortie est gratuit.** Aucune perte de ressources, aucune garnison tombée — c'est le
chemin auto qui garde les pénalités. Tu encaisses la monnaie de combat proportionnelle aux
éliminations réalisées avant la chute. Tu peux donc t'attaquer à un foyer trop dur juste pour
voir, et repartir avec quelque chose.

### 3.3 Le Péril — tu choisis ta difficulté, gratuitement

Avant chaque sortie, un curseur **Péril 0 → 4**. Il gonfle les PV et les dégâts ennemis
(×1 / ×1,4 / ×1,8 / ×2,3 / ×3) et ajoute des boss (0 / 0 / +1 / +1 / +2). En échange le butin
monte **plus vite que le danger** (×1 / ×1,35 / ×1,8 / ×2,4 / ×3,2). C'est gratuit : le seul prix
est le risque. C'est la réponse « boosts de loot » — et c'est le meilleur mécanisme de Grow
Castle, transposé tel quel.

### 3.4 Les Préparatifs — l'énergie achète de la puissance ponctuelle

Optionnels, avant la sortie, payés en ⚡ : **Butin enrichi** (+25 % de récolte), **Renfort**
(une vague de réapparition de troupes en plus), **Salve enzymatique** (dégâts de zone
instantanés, une fois). Ils se cumulent avec le Péril. Trois lignes, tout en config.

### 3.5 La Dérive — la carte des foyers

Nouveau panneau, accessible depuis la tuile **Bastion-Raid** de la base (bâtiment déjà présent
dans `economy_config.json`, `designed: false`, jamais utilisé — on l'active comme porte d'entrée,
exactement comme `defense` ouvre le Bastion). Une carte des eaux autour de la cellule, en
quatre secteurs qui s'ouvrent aux Paliers 0, 8, 20 et 40. Vingt-huit foyers, chacun étiqueté d'un
Palier. Six natures :

**Foyer infectieux** — une sortie contre une vague thématique. Le battre **capture** le point.

**Gisement** — une fois capturé, produit une ressource en continu, hors-ligne compris. Se
développe sur cinq niveaux payés dans sa propre ressource. Volontairement modeste : l'ensemble
du territoire plafonne autour d'un tiers de la production de la base, pour que la courbe 90 jours
calibrée reste la colonne vertébrale et que la carte reste un complément, pas un contournement.

**Site d'expédition** — une destination fixe, meilleure que les offres aléatoires du jour,
disponible en permanence une fois capturée. Réutilise le moteur d'expéditions existant.

**Antre** — un boss. Coûte une Percée ou une grosse somme d'énergie. Lâche des fragments de
carte, une carte garantie, et beaucoup de monnaie de combat.

**Vestige** — capture unique, bonus global permanent : +1 emplacement de tourelle, +8 % de
dégâts au Bastion, +5 % de production globale, +1 sortie gratuite par jour… Ce sont les vraies
récompenses de long terme, celles qui font que la carte compte.

**Faille** — rejouable à l'infini, se cale sur ton Palier courant. Le robinet de fin d'Âge.

### 3.6 Le Bilan du soir — le moment de la journée

Le panneau Habitudes gagne une cérémonie de clôture. Valider le Bilan :

- crédite l'énergie du jour (existant) ;
- **offre deux sorties gratuites supplémentaires** pour demain — les trois de base se
  réinitialisent de toute façon chaque jour, le Bilan est une carotte, jamais un bâton ;
- accorde une **Percée** si la journée pèse au moins 40 ⚡ ; les paliers de série en accordent en
  bonus. Stock maximum : cinq.

Le Bilan se valide à partir de 17 h, et jusqu'à 5 h le lendemain matin pour la veille : un coucher
à une heure du matin ne doit pas coûter le rendez-vous.

Une **Percée** est le grand levier. Elle s'échange contre l'un de ces trois choix :

**Vague de Percée** — une sortie à ton Palier +5, Péril forcé à 3, butin ×3, fragments garantis.
C'est le « d'un coup, faire passer un cap ».

**Poussée de croissance** — la base produit d'un coup six heures de toutes ses ressources.

**Assaut d'Antre** — l'accès aux boss de la carte.

> **Correction apportée à l'implémentation.** Ce choix s'appelait « Poussée de chantier » (douze
> heures de chantier offertes) dans la première rédaction de ce plan. Vérification faite contre
> `economy_config.json → pacing_validation`, c'était intenable : plus de 96 % des 90 jours sont du
> **temps de chantier**, le chemin critique pèse environ 2 216 h, et offrir ne serait-ce que 4 h par
> jour en retirerait 360 h, soit 15 % de l'Âge — l'archétype « assidu » (82,7 j) sortirait de la
> bande acceptée 81–99 j. L'attente de *ressources*, elle, ne pèse que 2,6 % du temps total : offrir
> des heures de **production** est donc généreux au ressenti et rigoureusement neutre au pacing.
> C'est la règle qui gouverne tout ce chantier : les nouveaux systèmes ne touchent jamais au
> chemin critique des 90 jours.

C'est l'articulation exacte que tu décris : la journée se joue en petites touches, le soir
débloque le coup d'éclat.

### 3.7 Moins de base, plus de carte

Les six producteurs, le Noyau et la Membrane sont le squelette calibré sur 90 jours
(`tools/economy/model.py` → `simulate_full.py`, validation `pacing_validation`). Les couper
invaliderait la calibration et la refaire coûterait plus qu'elle ne rapporterait. Ce n'est donc
pas le nombre de bâtiments qu'on réduit, c'est **la part d'attention de la base** :

- L'onglet **NOYAU** disparaît de la barre de navigation. Le recrutement rejoint la fiche du
  bâtiment Noyau, et les expéditions déménagent sur la carte, où elles ont toujours eu leur
  place. La barre garde sept onglets ; **DÉRIVE** prend la place libérée.
- Deux des trois bâtiments « À venir » de la base (`defense`, `raid`) deviennent des portes vers
  du contenu réel. Il n'en reste qu'un.
- La base redevient ce qu'elle doit être : trois gestes (encaisser, mettre un chantier en file,
  repartir). Tout le reste du jeu vit sur la carte et au Bastion.

### 3.8 Pourquoi ça reste lent

L'économie 90 jours n'est pas touchée d'une virgule. Le revenu du territoire est plafonné en
proportion de la production de base. Le vrai frein n'est pas une porte mais un prix : **l'énergie,
et l'énergie vient de tes habitudes réelles**. Une journée molle donne trois sorties ; une journée
excellente en donne six ou sept plus une Percée. Le jeu accélère exactement au rythme où ta vie
accélère. C'est le concept du projet, appliqué là où il manquait.

---

## 4. Plan d'exécution

Sept étapes, chacune close par `npx tsc --noEmit` + `npm run lint`, et `npm run build` aux
étapes 3, 5 et 7. Aucun nombre d'équilibrage ni aucun texte joueur en dur dans le TypeScript —
règle du projet, sans exception.

**Étape 1 — Données.** ✅ Nouveau `src/data/territoire_config.json` : 4 secteurs, **29 foyers**
(9 gisements, 7 vestiges, 4 caches, 4 sites d'expédition, 4 antres, 1 abîme sans fin), paliers 1 à
65, formules de revenu auto-indexées sur la production, développement des gisements, bonus des
vestiges, multiplicateurs des antres. Bloc `sorties` ajouté à `bastion_config.json` (quota
gratuit, courbe de coût 12/19/31/49/79 ⚡, table de Péril à cinq crans, trois préparatifs). Bloc
`bilan` ajouté à `habits_config.json` (horaires du rendez-vous, seuil de Percée, stock max,
sorties bonus, les trois options de Percée).

**Étape 2 — Moteur pur.** `src/lib/game/territoire.ts` (état des foyers, accumulation de revenu
hors-ligne, capture, développement, agrégation des bonus globaux) et
`src/lib/game/bastion/sorties.ts` (quota du jour, coût, Péril, préparatifs, résolution d'une
sortie). Deux modules purs, testables sans rendu.

**Étape 3 — État et migration.** `types.ts` gagne `territoire` et `bilan` ; `store.ts` passe
`SAVE_VERSION` de 11 à 12 avec sa branche de migration (territoire vierge, compteurs du jour à
zéro, aucun foyer capturé) et les nouvelles actions. `military.ts` : `resolveLiveWave` se
dédouble proprement en chemin planifié (pénalités, repousse `nextAttackAt`) et chemin sortie
(gratuit à l'échec, ne touche pas au calendrier).

**Étape 4 — Revenu et bonus.** Branchement de l'accumulation du territoire dans `tick.ts`, des
bonus globaux dans `economy.ts` et dans les stats du Bastion. Rattrapage hors-ligne correct et
borné.

**Étape 5 — La Dérive.** `TerritoirePanel.tsx` + rendu Canvas de la carte, sur le patron déjà
éprouvé de `CellScene.tsx` (cache d'images au niveau module, `requestAnimationFrame`, pas de
`Date.now()` au rendu).

**Étape 6 — Sorties et Bilan dans l'UI.** Lanceur de sortie et écran de Préparatifs dans
`BastionPanel.tsx` ; cérémonie du Bilan et dépense des Percées dans `HabitsPanel.tsx` ;
refonte de la navigation dans `play/page.tsx` (NOYAU → DÉRIVE, recrutement replié dans la fiche
du Noyau).

**Étape 7 — Vérification.** `tsc`, `lint`, `build`, puis parcours Playwright dans le **slot dev**
couvrant : trois sorties gratuites puis une payée en énergie, une sortie perdue qui ne coûte
rien, un Péril 3 qui gonfle butin et danger, la capture d'un gisement suivie de son revenu
hors-ligne, un vestige qui applique bien son bonus, un Bilan qui accorde une Percée, une Vague de
Percée, et la non-régression du chemin auto (une vague ignorée s'auto-résout comme avant).
Capture d'écran de la carte. Entrée datée dans `docs/JOURNAL.md`.
