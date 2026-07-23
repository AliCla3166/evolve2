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
