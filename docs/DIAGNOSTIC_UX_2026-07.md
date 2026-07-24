# Evolve2 — Diagnostic UX & rétention

**Date :** 24 juillet 2026 · **Périmètre :** le jeu tel qu'il est réellement codé (branche `main`, commit `86d8c95`), pas tel qu'il est planifié.
**Méthode :** lecture exhaustive de `src/`, des quatre fichiers de configuration (`economy_config.json`, `military_config.json`, `mare_config.json`, `bastion_config.json`), de `PLAN.md` et de `docs/JOURNAL.md`. Chaque constat ci-dessous est rattaché à un fichier et à une valeur numérique vérifiée. Quand j'écris « absent du code », c'est vérifié par recherche exhaustive, pas supposé.

---

## Préambule : la tension à assumer

Le pilier n°1 de `PLAN.md` dit ceci, noir sur blanc : *« Le jeu est un compagnon de discipline, pas un piège à temps. »* Tu me demandes un regard de concepteur de jeux mobiles addictifs. Les deux ne sont pas incompatibles, mais ils imposent une règle : **l'addictivité doit servir le rituel réel, jamais le remplacer.** Concrètement, dans tout ce qui suit, je refuse deux familles de leviers pourtant classiques — le grind au tap (tap-to-collect industriel, boutons à marteler) et la monétisation d'impatience (pubs récompensées, `rubis`, boosts payants). Ce que je vise à la place, c'est la **qualité du retour** : que le joueur revienne parce qu'il y a un rendez-vous, qu'il trouve quelque chose en arrivant, et qu'il reparte avec une raison de revenir demain.

Il y a une deuxième tension, celle-là non assumée : le pilier n°2 promet *« jamais de mur frustrant : il y a toujours quelque chose à faire »*. Le code ne tient pas cette promesse. J'y viens tout de suite.

---

## 1. Ce que le jeu réussit déjà, et qu'il ne faut surtout pas casser

Avant les problèmes, ce qui est solide, parce que ça conditionne les pistes.

Le **concept d'énergie externe** est le meilleur atout du projet. L'énergie n'a aucune source in-game (`habits.ts` : calories, pas, mf, alilou, rituels — journée parfaite = 95 ⚡, `ENERGY_CAP = 9999`), et c'est ce qui rend le jeu unique : on ne peut pas tricher avec sa vie. C'est une proposition que 99 % des jeux idle n'ont pas et qui vaut mieux que n'importe quelle boucle de rétention artificielle. Tout le reste doit être conçu pour mettre *ça* en valeur.

La **base cellulaire est vivante** et c'est rare pour un idle : `CellScene.tsx` fait tourner du plancton dérivant (`10 + built * 2` particules), un battement de noyau (`HEARTBEAT_MS = 2800`), un halo lime pulsé sur les bâtiments payables, un arc de progression de chantier, et surtout la **mue de membrane** (`MOLT_MS = 900`, 26 particules de burst, zoom-punch, flash radial) déclenchée aux seuils `STAGE_MIN_BUILT = [0, 1, 4, 8, 11]`. C'est le plus beau moment du jeu, et il est involontaire — j'y reviens en piste 3.

L'**architecture technique est saine** : configs comme source unique de vérité, zéro nombre de balance en dur, tick à timestamps réels offline-safe, PRNG seedé, migrations versionnées jusqu'à `SAVE_VERSION = 7`. Ça veut dire que quasiment toutes les pistes ci-dessous se règlent par du JSON plus un composant, pas par une refonte.

---

## 2. Le diagnostic : cinq fractures

### Fracture 1 — La session tient en deux minutes, et le jeu ne le sait pas

J'ai inventorié toutes les actions disponibles à un instant donné : saisir les habitudes du jour (~30 s, une fois par jour), lancer un chantier (`n_parallel_build_slots: 1`, donc **un seul**, quelques secondes), envoyer une expédition (`max_concurrent: 2`), recruter (borné par `unit_cap = 6 + 3 × niveau_noyau` et par l'énergie), pêcher, résoudre un événement s'il y en a un en attente, lire les rapports. Vidé, tout ça prend **entre 40 secondes et 2 minutes**. Après quoi il ne reste plus qu'à attendre : prochaine expédition dans 2 à 12 h, prochain événement dans 8 à 24 h (`events.interval_h: [8, 24]`), prochaine vague dans 36 à 84 h (`pathogens.interval_h: [36, 84]`), prochain chantier dans 1,65 h à **227,6 h** (`mutation` niveau 5 : 9,5 jours pour une seule amélioration, pendant lesquels rien d'autre ne peut être construit).

La seule activité extensible est la pêche, et voici le calcul qui me gêne le plus dans tout le projet : un jeton coûte 30 ⚡ (`mare_config.json`, `jetons.cost_energie`), une journée réelle parfaite rapporte 95 ⚡, une prise dure 5 à 10 secondes. **La récompense d'une journée de discipline impeccable, c'est donc environ trente secondes de jeu.** Pour un titre dont la thèse est « tes bonnes habitudes financent une civilisation », le taux de change est démoralisant.

### Fracture 2 — Le jeu ne rappelle jamais le joueur, et ne l'accueille jamais

`public/sw.js` fait 36 lignes et ne contient aucun listener `push` ni `notificationclick` ; l'API `Notification` n'apparaît nulle part dans `src/`. **Aucune notification, d'aucune sorte.** Un jeu dont les événements les plus intéressants arrivent à 8, 24, 48 et 84 heures d'intervalle, et qui ne prévient jamais, laisse littéralement toute sa rétention sur la table.

Symétriquement, il n'y a **aucun écran de retour**. `applyTick()` applique le rattrapage hors-ligne en un seul gros tick, silencieusement, et `next.lastTick = now`. Le joueur revient après deux jours, ses barres ont bougé, personne ne lui dit ce qui s'est passé. Pire : `produce()` écrête à `resourceCap` (`if (current >= cap) continue`), donc **toute la production au-delà du plafond est perdue sans un mot**. Au départ le cap est 600 et le stock 260 : dès le premier bâtiment producteur de niveau 1 (10/h), la ressource sature en **34 heures**. Un joueur qui revient tous les deux jours perd en permanence une part de sa production et n'en est jamais informé — il ne peut donc pas apprendre à améliorer son Noyau ou sa Biomasse pour y remédier. C'est de la frustration invisible, la pire espèce.

### Fracture 3 — La colonne vertébrale de progression prévue au plan n'est pas codée

`PLAN.md` §5.8 décrit précisément : *« Points d'âge gagnés par constructions, expéditions, collections, streaks. Nombreux paliers intermédiaires (jalons visibles avec récompenses). »* Dans le code, `age` est déclaré dans `economy_config.json` en `"kind": "hors_perimetre"` et **n'est jamais lu ni écrit nulle part**. Il n'existe aucun système de quêtes, d'objectifs, de succès ou de jalons — vérifié par recherche exhaustive.

Résultat concret : le `TutorialCoach` guide sur 3 étapes (`TUTORIAL_DONE = 3`), disparaît définitivement, et à partir de là le **seul** signal directionnel permanent à l'écran est le halo lime « coût payable » de `CellScene.tsx`. Ce halo dit « tu peux te le payer », jamais « tu devrais ». Les vrais objectifs du jeu sont invisibles : les seuils de mue `[0, 1, 4, 8, 11]` ne sont annoncés nulle part alors que c'est la plus belle récompense visuelle ; `total_target_days: 90` n'est jamais affiché ; la capstone `mutation` est décrite comme « ton objectif final sur cette cellule » dans `buildingInfo.ts`, mais uniquement si on ouvre sa fiche — et elle coûte 78 vitalité alors que le Noyau niveau 1 en produit 2,0/h, soit **39 heures avant qu'elle soit seulement achetable**.

### Fracture 4 — Les moments de récompense sont muets

Le jeu **n'a aucun son** : ni `new Audio`, ni `AudioContext`, ni fichier audio dans `public/`, ni dépendance. Zéro.

Et le trou de feedback le plus coûteux est celui-ci — voici l'intégralité de ce qui se passe quand un chantier se termine, dans `tick.ts` :

```ts
next.buildings[task.buildingId] = task.targetLevel;
next.buildQueue = null;
```

Aucun rapport, aucune modale, aucun toast, aucune vibration, aucun son. L'action dans laquelle le joueur investit le plus (jusqu'à 9,5 jours d'attente réelle) se conclut par… un badge de niveau qui change sur le canvas. En regard, gagner une ressource ne produit rien non plus : la barre s'anime sur `duration-300` et c'est tout — pas de nombre flottant, pas de toast (`grep floating|toast` : 0 résultat).

Même le seul moment scénarisé du jeu, `CardReveal.tsx`, est plat : les **six** raretés partagent exactement le même keyframe `card-reveal` de 0,45 s, sans temps d'attente, sans dos de carte, sans retournement, sans montée en tension. Les deux seules différenciations sont la couleur du `drop-shadow` et un motif de vibration **binaire** au seuil `rarity >= 3` — une légendaire (1 chance sur 28) et une rare (1 sur 6,6) vibrent à l'identique. Le jeu contient un gacha soft et n'en tire aucune émotion.

### Fracture 5 — 97 % du jeu est de l'attente sans décision

Le fichier de calibrage est explicite, `economy_config.json` → `pacing_validation` : `construction_hours: 2160.0`, `resource_wait_hours: 69.7`, `resource_wait_pct_of_total: 3.1`. Autrement dit, sur 90 jours, le joueur n'attend **jamais** ses ressources : il attend uniquement des timers, avec un seul slot de chantier, sans aucun moyen de les accélérer.

C'est la configuration la plus défavorable pour un jeu de gestion, parce qu'elle vide les décisions de leur enjeu : il n'y a jamais d'arbitrage « je construis A ou B avec des ressources rares », seulement « je construis dans l'ordre, une chose à la fois, pendant trois mois ». Et surtout, `PLAN.md` §5.4 prévoyait la parade — l'énergie devait servir aux *« achat de boosts, accélérations partielles, jetons de pêche »*. Les accélérations partielles **ne sont pas codées** : l'énergie n'a que deux puits, le recrutement (25 à 40 ⚡, plafonné par `unit_cap`) et les jetons (30 ⚡). Une fois l'effectif au maximum, l'énergie n'achète plus que des jetons de pêche et s'accumule sans emploi jusqu'à `ENERGY_CAP = 9999`.

Ces cinq fractures se répondent : la session est courte parce qu'il n'y a rien à décider, le joueur ne revient pas parce que rien ne l'appelle, et quand il revient rien ne le félicite ni ne lui indique où aller.

---

## 3. Les dix pistes, classées

Classement par rapport impact / effort. Les quatre premières changent la nature du jeu ; les quatre suivantes changent sa sensation ; les deux dernières corrigent des fuites.

---

### Piste 1 — « Pendant ton absence » : l'écran de retour

**Impact : très élevé · Effort : faible (½ journée)**

**Constat.** `applyTick()` connaît déjà exactement le delta hors-ligne — il le calcule — mais le jette. Aucun récapitulatif, aucun bonus de retour, aucune mention de la production perdue au plafond.

**Ce que je ferais.** Faire retourner à `applyTick` un `OfflineSummary` (durée d'absence, gains par ressource, chantiers terminés, expéditions rentrées, vagues auto-résolues, événements manqués, **et surtout : ressources perdues faute de stockage**). Le stocker dans un champ non persisté du store, et l'afficher au montage de `play/page.tsx` dans une modale si l'absence dépasse ~20 minutes.

Le détail qui compte : la ligne « 🚫 412 biomasse perdues — stockage plein depuis 9 h · améliore ton Noyau ou ta Biomasse ». Elle transforme une frustration invisible en objectif clair, et elle donne d'un coup un sens à la moitié de l'arbre de construction. C'est, à mon avis, la modification la plus rentable du lot.

**Fichiers.** `src/lib/game/tick.ts` (retourner le résumé, tracer l'écrêtage dans `produce()`), `src/lib/game/store.ts`, nouveau `src/components/game/WelcomeBackModal.tsx`.

---

### Piste 2 — Les notifications : le seul mécanisme qui ramène un joueur mobile

**Impact : très élevé · Effort : moyen (1 à 2 jours)**

**Constat.** Rien. `sw.js` ne gère que le cache d'assets. Or le jeu est déjà une PWA installable (`manifest.ts`, `start_url: "/play"`, `InstallPrompt.tsx`), donc le web push fonctionne en installé sur Android comme sur iOS 16.4+.

**Ce que je ferais.** Quatre déclencheurs seulement, choisis pour ne jamais harceler :

Le **rappel d'habitudes** à une heure choisie par le joueur dans les Réglages — c'est le seul qui sert directement le pilier n°1, et il devrait être proposé en premier, formulé comme un service (« je te rappelle de noter ta journée ») et non comme un appât. Le **chantier terminé**, qui est aujourd'hui l'événement le plus invisible du jeu. La **vague imminente**, à 2 h de `nextAttackAt`, puisque `WaveWarning` ne s'affiche que dans les 12 dernières heures et uniquement si l'app est ouverte. L'**événement à choix qui expire** (`choice_expiry_h: 24`), le seul contenu réellement périssable.

Demander la permission au bon moment : pas au premier lancement, mais juste après la première fin de chantier, quand le joueur vient de comprendre ce qu'il rate.

**Fichiers.** `public/sw.js` (listeners `push` / `notificationclick`), nouveau `src/lib/notifications.ts`, `SettingsPanel.tsx` (opt-in par catégorie + heure du rappel), et une petite route serveur ou l'API `showTrigger` selon le support visé.

---

### Piste 3 — Les Points d'âge et les jalons visibles (dette du `PLAN.md` §5.8)

**Impact : très élevé · Effort : moyen (2 jours)**

**Constat.** Le plan les prévoit, `economy_config.json` déclare `age`, le code ne les lit jamais. Le joueur n'a aucun sens de sa progression globale, aucun objectif après l'étape 3 du tutoriel, et les seuls jalons réellement gratifiants du jeu — les mues de membrane aux seuils `[0, 1, 4, 8, 11]` — arrivent par surprise au lieu d'être désirés.

**Ce que je ferais.** Un nouveau `src/data/milestones_config.json` (même philosophie que les autres : zéro valeur en dur) décrivant une vingtaine de jalons, chacun avec une condition dérivée de l'état, une récompense modeste et un libellé. Puis un **bandeau d'objectif permanent** sous le HUD, qui affiche en permanence le prochain jalon atteignable, avec une barre de progression : « 4/8 bâtiments — ta membrane va muer », « 12/62 espèces recensées », « Vitalité 41/78 — la Mutation approche ».

Deux effets d'un coup : le joueur sait enfin quoi faire ensuite, et la mue — qui est déjà la plus belle animation du projet — devient un objectif qu'on poursuit plutôt qu'un accident heureux. C'est aussi le bon endroit pour annoncer l'ascension vers l'Âge 2 et donner un horizon aux 90 jours.

**Fichiers.** Nouveaux `src/data/milestones_config.json` + `src/lib/game/milestones.ts` + `src/components/game/ObjectiveStrip.tsx` ; `store.ts` (champ `agePoints`, jalons réclamés, migration `SAVE_VERSION` 8) ; `play/page.tsx`.

---

### Piste 4 — L'énergie doit acheter du temps (dette du `PLAN.md` §5.4)

**Impact : très élevé · Effort : moyen, mais demande de rejouer le simulateur de balance**

**Constat.** 96,9 % du temps de jeu est du timer de construction, il n'existe qu'un seul slot, et l'énergie — la monnaie qui représente la discipline réelle du joueur — n'a aucune prise dessus. C'est la fracture 5, et c'est aussi la réponse au taux de change humiliant de la fracture 1.

**Ce que je ferais.** Rétablir l'« accélération partielle » prévue au plan : un bouton dans `BuildingSheet.tsx` qui convertit de l'énergie en heures de chantier, à un taux **dégressif et plafonné** — par exemple au plus 25 % du temps restant du chantier en cours, avec un coût en ⚡ proportionnel aux heures rachetées. Toutes les valeurs dans `economy_config.json`, comme le reste.

Ce que ça change, en une phrase : **une journée réelle impeccable fait avancer visiblement la civilisation le jour même**, ce qui est exactement la promesse de la page titre. Ça donne aussi à l'énergie excédentaire un emploi durable une fois `unit_cap` atteint, et ça crée le premier arbitrage intéressant du jeu — accélérer, pêcher, ou recruter.

Le plafond à 25 % est essentiel : il préserve la « lenteur savoureuse » du pilier 2 et interdit qu'un joueur discipliné compresse les 90 jours. À valider en rejouant le simulateur Phase 7 (`tools/`), qui donne aujourd'hui `simulated_total_days: 92.9`.

**Fichiers.** `src/data/economy_config.json` (nouveau bloc `energy_boost`), `src/lib/game/economy.ts`, `store.ts` (action `boostBuild`), `BuildingSheet.tsx`, `QueueBanner.tsx`.

---

### Piste 5 — Célébrer la fin de chantier

**Impact : élevé · Effort : faible (½ journée)**

**Constat.** Deux lignes dans `tick.ts`, aucun feedback. C'est le plus gros trou de gratification du jeu : le joueur attend jusqu'à 9,5 jours et il ne se passe rien.

**Ce que je ferais.** Trois choses, dans l'ordre d'importance. **Un rapport** dans `ReportsPanel` — le système existe déjà (`pushReport`, `reports_cap: 40`, badge de non-lus dans la nav), il suffit d'en émettre un, et ça règle aussi le cas du joueur absent. **Une modale de complétion** au retour dans l'app : le sprite du bâtiment à son nouveau niveau, l'ancien et le nouveau débit (« Enzyme 10/h → 18/h »), une vibration, et un bouton « Enchaîner » qui ouvre directement la fiche du prochain bâtiment recommandé — ce dernier point est ce qui transforme une fin de session en début de session. **Un flash sur la scène**, en réutilisant le burst de particules déjà écrit pour la mue dans `CellScene.tsx` : le code est là, il ne sert qu'aux 4 seuils de membrane.

**Fichiers.** `src/lib/game/tick.ts`, `src/lib/game/military.ts` (helper `pushReport`), nouveau `BuildCompleteModal.tsx`, `CellScene.tsx`.

---

### Piste 6 — Faire du rituel quotidien un vrai rendez-vous

**Impact : élevé · Effort : faible à moyen**

**Constat.** `HabitsPanel.tsx` est aujourd'hui le plus austère des six panneaux, alors que c'est le cœur du concept : cinq champs, un total, terminé. La série n'a que **trois paliers en 90 jours** (`STREAK_MILESTONES` : 7 → +50 ⚡, 30 → +200 ⚡, 90 → +500 ⚡), donc entre le jour 8 et le jour 29, la régularité ne rapporte strictement rien de plus. Et une entrée n'est modifiable que le jour même (`habits.ts`, `dayKey`) : oublier de saisir à 23 h 59 après trois semaines de série détruit la série sans recours.

**Ce que je ferais.** Rendre la série **visible en permanence** (badge dans le HUD, pas seulement dans le panneau), rapprocher les paliers (hebdomadaires plutôt que 7/30/90, avec des récompenses croissantes), et **célébrer la journée parfaite** — 95 ⚡ mérite mieux qu'un total qui s'incrémente : une animation dédiée, la mue du jour, quelque chose.

Ajouter surtout un **filet de sécurité** : un « jour de grâce » par mois, ou la possibilité de rattraper la veille jusqu'à midi. Ce n'est pas de la complaisance — dans un jeu de discipline, une série cassée par oubli technique est la première cause d'abandon, et une seconde chance rare et explicite renforce l'engagement au lieu de le diluer. Enfin, un **historique visuel** (grille façon calendrier de contributions, 90 cases) donne au joueur la preuve tangible de sa constance, ce qui est le vrai produit du jeu.

**Fichiers.** `src/lib/game/habits.ts` (paliers, grâce), `HabitsPanel.tsx`, `Hud.tsx`, `store.ts` (migration).

---

### Piste 7 — Rendre le tirage de carte désirable

**Impact : moyen à élevé · Effort : faible (1 journée), fort rendement émotionnel**

**Constat.** Une seule animation de 0,45 s pour six raretés, aucune montée en tension, deux motifs de vibration pour six niveaux, et la vibration n'existe pas du tout sur iOS (`navigator.vibrate` absent de Safari — `prefs.ts` le documente).

**Ce que je ferais.** Une révélation **graduée par rareté**, en pur CSS et canvas, sans nouvel asset : écran qui s'assombrit, halo dont la couleur monte en intensité pendant un délai proportionnel à la rareté (0,3 s pour une commune, jusqu'à 1,8 s pour une mythique), puis apparition avec une intensité différenciée — secousse d'écran et gerbe de particules pour les raretés 4+, rien de plus qu'aujourd'hui pour une commune. Six motifs de vibration au lieu de deux. Et un vrai **teasing de quasi-réussite** : la couleur du halo peut monter jusqu'à « légendaire » avant de retomber sur « rare », ce qui est le ressort psychologique le plus efficace de tout le genre gacha — et parfaitement inoffensif ici, puisqu'il n'y a aucune monnaie réelle.

Petit point connexe : `rollSpecies` tire **uniformément parmi 62 espèces** alors que `PLAN.md` §5.6 en prévoyait 12. Avec 3 jetons par jour, compléter la collection est hors d'atteinte et la grille reste désespérément vide. Soit resserrer le pool initial et en débloquer par paliers, soit afficher la collection par familles pour que la progression soit lisible.

**Fichiers.** `CardReveal.tsx`, `globals.css`, `prefs.ts` (motifs), `mare_config.json`.

---

### Piste 8 — Le son : une dimension entière manquante

**Impact : moyen à élevé · Effort : faible techniquement, le coût est dans les samples**

**Constat.** Zéro audio, sous aucune forme. C'est ce qui creuse le plus l'écart entre la qualité visuelle du jeu et sa qualité perçue.

**Ce que je ferais.** Dix samples suffisent : tap d'interface, ouverture de panneau, lancement de chantier, **fin de chantier** (le plus important), collecte, révélation de carte en trois variantes selon la rareté, début de vague, victoire, défaite. Une nappe d'ambiance sous-marine très discrète, coupée par défaut, en option.

Techniquement : un petit `src/lib/audio.ts` sur WebAudio, samples préchargés et décodés une fois, contexte débloqué au premier tap (contrainte iOS), respect du mode silencieux, et un interrupteur dans `SettingsPanel.tsx` à côté de celui des vibrations — qui existe déjà et fournit le modèle exact (`prefs.ts`).

Une palette pixel art organique appelle un design sonore organique : bulles, membranes, pulsations. C'est probablement le meilleur rapport « impression de finition / lignes de code » de toute la liste.

---

### Piste 9 — Ouvrir un second chantier, et donner de la matière à la session courte

**Impact : moyen à élevé · Effort : moyen, recalibrage nécessaire**

**Constat.** `n_parallel_build_slots: 1` est une constante qui n'évolue jamais. Combinée aux 3,1 % d'attente de ressources, elle garantit qu'il n'y a jamais de choix à faire.

**Ce que je ferais.** Un **deuxième slot de chantier**, débloqué à un jalon fort (Noyau niveau 3, ou la première Mutation), et le présenter comme une récompense majeure — c'est exactement le genre de déblocage que la piste 3 doit annoncer à l'avance. Deux slots créent immédiatement de la stratégie (un chantier long en fond + un court en parallèle) et doublent la matière disponible à chaque session, sans changer la durée totale si on ajuste les temps.

Dans le même mouvement, deux irritants faciles : les bâtiments `peche` et `raid` sont grisés au milieu de la scène principale et **ne mènent nulle part** (`buildingInfo.ts` renvoie vers les onglets MARE et NOYAU) — mieux vaut, tant que les mini-jeux n'existent pas, que le tap ouvre directement le panneau correspondant plutôt qu'une fiche vide. Et les 4 destinations d'expédition quotidiennes (`daily_slots: 4`, `max_concurrent: 2`) ne sont jamais annoncées comme renouvelées : un badge « nouvelles destinations » sur l'onglet NOYAU au changement de jour donnerait une raison de plus d'ouvrir l'app.

**Fichiers.** `economy_config.json`, `store.ts` (`buildQueue` → tableau, migration), `QueueBanner.tsx`, `BuildingSheet.tsx`, `CellScene.tsx`, `NoyauHub.tsx`, et le simulateur de `tools/`.

---

### Piste 10 — Découvrabilité et ergonomie mobile : les fuites

**Impact : moyen, mais coût très faible · Effort : faible**

Un ensemble de corrections indépendantes, toutes vérifiées dans le code.

**Le Bastion n'existe pas dans la navigation.** Le plus gros morceau de contenu jouable du projet — celui qu'on vient d'intégrer — n'est accessible que par un tap sur un bâtiment grisé de la scène puis « ⚔️ JOUER », ou par le `WaveWarning` qui ne s'affiche que dans les 12 dernières heures avant l'attaque. Il lui faut une entrée dans la nav basse, avec un badge quand une vague est jouable (la fenêtre `lead_window_h: 96` la rend disponible bien plus souvent que le joueur ne le croit).

**La monnaie de combat n'est nulle part.** `combat` a sa couleur dans `Hud.tsx` (`#ffcf4d`) mais n'est jamais rendue. À afficher dans le HUD dès qu'elle dépasse 0, sinon la boutique du Bastion reste une économie fantôme.

**Le plafond de stockage est invisible sur mobile.** `Hud.tsx` n'affiche que la valeur ; le cap n'est présent que dans l'attribut natif `title=`, qui ne s'ouvre qu'au survol souris. Sur téléphone, le joueur ne peut littéralement pas savoir qu'il sature. À afficher en `valeur / cap`, avec la barre qui vire à l'orange à l'approche du plafond.

**Les cibles tactiles.** Les six libellés de la nav basse sont en `text-[8px]` ; le code compte 96 usages de `text-[10px]` et 19 de `text-[9px]`. Les slots du champ de bataille font environ 20 px de diamètre après mise à l'échelle (`r: 18` × ~0,54 sur un écran de 380 px), les boutons 🛡️/⚔️ de la collection ~22 px de haut, le lien « retirer » du Bastion ~11 px. Le seuil recommandé est 44 px ; seules les paillettes de la Mare (44 × 44) et les bâtiments de la scène (ø ≥ 52) le respectent.

**Le zoom est bloqué.** `layout.tsx` exporte `maximumScale: 1`, ce qui interdit le pinch-to-zoom — sur des textes de 8 à 10 px, c'est un vrai problème d'accessibilité, et ce n'est plus nécessaire sur les navigateurs modernes.

**Les zones sûres ne sont pas gérées.** Aucune occurrence de `safe-area-inset`, `env(` ou `viewportFit: "cover"`, alors que `layout.tsx` déclare `statusBarStyle: "black-translucent"` — le contenu passe donc sous la barre d'état iOS, et la nav `fixed bottom-0` tombe dans la zone du home indicator. Les `pb-24` disséminés sont des compensations fixes, pas une solution.

**Le bouton retour Android quitte le jeu.** Aucun `popstate` : quand un overlay est ouvert, le retour système ferme la PWA au lieu de fermer le panneau. C'est le réflexe n°1 d'un utilisateur Android.

**Divers :** pas de verrouillage du scroll d'arrière-plan sous les overlays, pas de `prefers-reduced-motion`, pas de gestion du clavier virtuel sur les champs d'habitudes, et une police système monospace (aucun `@font-face`, aucun `next/font`) qui rend un texte différent sur chaque plateforme sous des sprites pixel art — une vraie police bitmap unifierait l'ensemble d'un coup.

---

## 4. Si tu ne fais que trois choses

**L'écran de retour (piste 1)** — une demi-journée, et ça règle d'un coup l'accueil, la lisibilité de la production hors-ligne et la frustration invisible du plafond de stockage.

**Les notifications (piste 2)** — c'est la seule chose qui détermine si un joueur mobile revient. Et le rappel d'habitudes est le seul levier de rétention qui sert directement le pilier n°1 au lieu de le trahir.

**L'énergie qui achète du temps (piste 4)** — parce qu'aujourd'hui une journée réelle parfaite vaut trente secondes de jeu, et que c'est le seul chiffre de tout ce diagnostic qui contredit frontalement la promesse affichée sur l'écran titre.

Les pistes 3, 5 et 6 viennent juste derrière et se complètent bien : jalons visibles, célébration de fin de chantier, rituel quotidien musclé. Les pistes 7 à 10 sont du polissage à haut rendement, à faire en continu.
