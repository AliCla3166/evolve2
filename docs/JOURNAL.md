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
