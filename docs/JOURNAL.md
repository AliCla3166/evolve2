# EVOLVE v2 — Journal de bord technique

## 2026-07-23 — Phase 0 : fondations
- Création du repo `AliCla3166/evolve2` (via Chrome d'Ali).
- Scaffold Next.js 15 + TypeScript + Tailwind 4 (App Router, src-dir, Turbopack).
- Intégration des 76 assets pixel art (`public/assets/` : 12 bâtiments × 5 niveaux, 11 ressources, 5 stades d'enveloppe + manifest.json).
- Intégration `src/data/economy_config.json` (économie calibrée 90 j, source de vérité du tuning) + scripts Python dans `tools/economy/`.
- Écran titre placeholder : palette charte, noyau pulsant, plancton dérivant.
- Décisions verrouillées : backend Firebase (réutilisation du projet v1), repo `evolve2`, rendu Canvas 2D natif + React DOM, PixelLab API pour les nouveaux assets.
- Prochaine étape : push initial, connexion Vercel, puis Phase 1 (kit UI + 20 portraits).

## 2026-07-23 — Phase 0 clôturée + début Phase 1
- Push initial réussi (PAT fine-grained "evolve2-claude-push", expire 22/08/2026).
- Vercel connecté : https://evolve2-nine.vercel.app (déploiement auto sur push main). Statut : Ready.
- Phase 1 démarrée : 20 portraits alien 64×64 générés via PixelLab (`tools/gen_portraits.py`, idempotent, concurrence 4, gestion 429) → `public/assets/portraits/age01_cell_portrait_*_v001.png`.
- Reste Phase 1 : kit UI organique (panneaux 9-slice, boutons, jauges, icônes, cadres de cartes, overlays, fonds), composants React de base, page /ui de revue.

## 2026-07-23 — Phase 1 : kit UI complet + page /ui
- 33 assets UI générés (`tools/gen_ui_kit.py`) dans `public/assets/ui/` : panneaux 9-slice, boutons 4 états, barres/jauges, 7 icônes nav, 8 cadres de cartes, 3 overlays, divers, fond océan.
- ⚠️ Crédits PixelLab épuisés (HTTP 402) en fin de batch : `btn_pressed`, `panel_noyau`, `plus_minus` sont des dérivés locaux PIL (placeholders corrects) — à régénérer via PixelLab quand les crédits seront rechargés.
- Composants React : `src/components/ui/Pixel.tsx` (Panel 9-slice, PixelButton, ResourceBar, CardFrame 6 raretés, NavIcon) + états CSS boutons dans globals.css.
- Page de revue `/ui` : tous les composants habillés + grille des 20 portraits + cadres de cartes avec portraits.
- Build vert. Reste Phase 1 : rien de bloquant — passer Phase 2 (moteur : store, tick, économie JSON, habitudes, sauvegarde).

## 2026-07-23 - Preparation Phase 2
- Backend confirme : Firebase, reutilisation du projet v1 evolve-game-ebc60 (auth Google + Firestore). La config cliente est dans le index.html du repo public v1 evolve-game (bloc FIREBASE_CONFIG, vers la ligne 3548) - en Phase 2, injecter via variables NEXT_PUBLIC_FIREBASE_* (Vercel + .env.local), pas de cle en dur dans ce repo.
- Les mises a jour de la page Notion Initialisation Evolve sont suspendues (choix d'Ali en session) - le point de reprise de reference est CE journal, versionne dans le repo.

## 2026-07-23 — Phase 2 : moteur de jeu + page /play jouable
- Moteur `src/lib/game/` (pur, testé par smoke tests) :
  - `types.ts` : GameState complet (ressources, niveaux, file 1 slot, habitudes+historique, streaks, profil, saveVersion).
  - `economy.ts` : lecture typée de `economy_config.json` (source de vérité, zéro tuning en dur) — coûts, temps, production/h, caps de stockage (formule noyau×biomasse vérifiée contre la table du JSON), canAfford, stocks/niveaux de départ (260/productible, noyau Nv1).
  - `tick.ts` : moteur à timestamps réels — production plafonnée aux caps, fin de chantier avec production découpée avant/après (rattrapage offline exact en un seul gros tick au chargement), resynchro sans production si horloge en arrière.
  - `habits.ts` : les 5 habitudes v1 (calories 80–100% +10 ⚡ · pas +1/1000 cap 15 · Magic Focus +3×10 · ALILOU +5×3 · rituels +5×5, max 95 ⚡/j), clé YYYY-MM-DD locale modifiable le jour même, streaks stricts (consécutifs) avec jalons 7/30/90 j → +50/+200/+500 ⚡ (constantes commentées), cap énergie 9999.
  - `store.ts` : Zustand + persist localStorage `evolve2_save_v1` (version 1, migration no-op, skipHydration + réhydratation client), actions startUpgrade (1 slot strict, débit des coûts), collectTick (interval 1 s), updateHabitToday (delta d'énergie à l'édition, aller-retour jalon neutre), createProfile.
- UI : page `/play` mobile-first (fond océan) — HUD sticky de ResourceBars compactes avec tooltips, bannière de file avec timer live, panneau Habitudes du jour (+/−, valider, ⚡ et streak visibles), 12 bâtiments (sprite par niveau, production, coût vert/rouge selon payable, bouton AMÉLIORER/CONSTRUIRE, timer chantier ; peche/defense/raid grisés + overlay locked "À venir"). Création de profil simple (20 portraits + nom) si aucun profil. Écran titre : vrai bouton COMMENCER → /play (bug "rien n'est cliquable" corrigé).
- Composants Pixel.tsx : ajouts non cassants (ResourceBar `width`/`title`, PixelButton `href` via Link).
- `npm run build` + eslint verts (règle react-hooks/purity : le "now" de rendu vient de `lastTick` du store, pas de Date.now() en rendu). Dépendance ajoutée : zustand.
- Point de reprise suivant — Phase 3 : scène Canvas de la base vivante (rendu 2D natif de la cellule, bâtiments posés dans le diorama, enveloppe par stades).

## 2026-07-23 — Phase 3 : la base vivante (scène Canvas)
- Implémentation fidèle de la page Notion "Conception technique — Base vivante évolutive & animée" : scène en couches (fond cytoplasme → enveloppe → plancton → bâtiments → Noyau → VFX), enveloppe par PALIERS discrets, vie pilotée en code au-dessus de sprites fixes.
- `src/lib/game/scene.ts` (pur) : seuils de stades copiés du manifest (0 / 1-3 / 4-7 / 8-10 / 11-12 organes construits, Noyau exclu), table de sockets normalisés (producteurs à gauche, centres spécialisés à droite, Membrane en haut — règle de la Charte), écartement des sockets par stade, phase d'animation stable par bâtiment (hash de l'id), métronome global `HEARTBEAT_MS` (le battement du Noyau).
- `src/components/game/CellScene.tsx` : Canvas 2D natif, boucle rAF autonome (lit le store via `getState()`, zéro re-render React), DPR ≤2, `imageSmoothingEnabled=false`. Flottement sinusoïdal + dérive en rotation à phase aléatoire par bâtiment, pulsation du Noyau avec halo (métronome des autres pulsations), plancton dérivant (densité ∝ organes construits), ghost désaturés (variante grayscale précalculée par pixel, pas de ctx.filter → compat Safari), overlays verrou/chantier + arc de progression + vibration, halo lime "amélioration payable" (file libre + coût couvert), badge de niveau coloré par accent du manifest. Mue entre stades : flash radial + burst de particules + zoom-punch + crossfade d'enveloppe + glissement des bâtiments vers leurs nouveaux sockets (écartement interpolé). Tap → hit-test sur les zones du dernier rendu.
- `src/components/game/BuildingSheet.tsx` : bottom sheet (voile + animation sheet-up) ouvert au tap — niveau, production actuelle → prochaine, coûts payable/pas (avec stock), temps, bouton CONSTRUIRE/AMÉLIORER, états chantier (barre live sur `lastTick`) / niveau max / verrouillé "À venir". Fond opaque forcé (le remplissage du panneau membrane est semi-transparent).
- `BuildingList.tsx` supprimé : le panneau au tap remplace la liste (décision actée dans la page Notion d'init). /play = HUD sticky + file + scène + habitudes.
- Vérification Playwright (Chromium préinstallé, sauvegardes seedées en localStorage) : stade 1 nu + chantier membrane, stade 3 dense avec badges/verrous, panneau ADN, débit des coûts, mue réelle 3→4 à la FIN du chantier du 8e organe (screenshots mobile 390px + desktop 1280px). Build + eslint verts.
- Reste connu : mue seulement à la hausse (pas de régression de stade possible en v2.0), assets PixelLab placeholders de la Phase 1 toujours à régénérer (crédits), Firebase toujours non branché (prévu avec l'écran de connexion).
- Point de reprise suivant — Phase 4 : perso & onboarding (écran titre soigné, création de perso avec les 20 portraits, tutoriel 3 étapes, connexion Google/sync Firebase).

## 2026-07-23 — Lisibilité de la scène + Phase 4 : perso & onboarding
- **Lisibilité** (retour d'Ali : "pas lisible") : socles sombres circulaires sous chaque bâtiment avec liseré à la couleur d'accent, noms courts sous chacun des 12 bâtiments (pills opaques, `label` ajouté aux SOCKETS), voile intérieur qui repousse l'enveloppe en arrière-plan, badges de niveau agrandis et maintenus À L'INTÉRIEUR de leur socle (zéro collision), labels/badges dessinés en 2e passe au-dessus de tous les sprites, arc gauche aéré (Protéines/Biomasse écartés), tailles de texte du panneau bâtiment et des barres remontées d'un cran. Vérifié par screenshots : plus aucun chevauchement.
- **Phase 4** :
  - Écran titre refait en client : lit la sauvegarde locale — COMMENCER (nouveau) ou CONTINUER avec aperçu portrait+nom ; mention honnête "Sauvegarde locale sur cet appareil · sync cloud à venir".
  - Création de personnage soignée : aperçu en grand dans un CardFrame avec le nom d'espèce des 20 créatures (fiction de la charte), bouton 🎲 de suggestion de nom (pool tournant, déterministe).
  - Micro-tutoriel 3 étapes (`TutorialCoach`) : 1) valider une habitude → 2) lancer une construction → 3) comprendre le timer (bouton COMPRIS). Auto-avance en OBSERVANT l'état du jeu (l'état est la validation), `tutorialStep` persisté, monotone.
  - Sauvegarde : SAVE_VERSION 2 (clé localStorage inchangée) — migration v1→v2 : les sauvegardes existantes reçoivent tutorialStep=TERMINÉ (leurs joueurs connaissent le jeu). `freshGameState` démarre à 0.
- Vérification Playwright complète : titre neuf/continuer, création (portrait+dé), tutoriel étapes 1→2 (auto-avance après habitude validée) et 3 (chantier + COMPRIS), scène lisible, panneau. Build + eslint verts.
- **Hors périmètre de cette passe** : branchement Firebase réel (auth Google + Firestore). Décision inchangée (réutiliser le projet v1 `evolve-game-ebc60`, config via `NEXT_PUBLIC_FIREBASE_*` sur Vercel — variables à créer avec Ali). L'écran titre affiche le statut local en attendant.
- Point de reprise suivant — au choix : **Phase 5** (couche militaire : recrutement au Noyau, expéditions, pathogènes, événements) ou **branchement Firebase** (nécessite Ali pour les variables Vercel + config du projet v1).
