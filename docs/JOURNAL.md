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
