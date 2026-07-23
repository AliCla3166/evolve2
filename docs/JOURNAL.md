# EVOLVE v2 — Journal de bord technique

## 2026-07-23 — Phase 0 : fondations
- Création du repo `AliCla3166/evolve2` (via Chrome d'Ali).
- Scaffold Next.js 15 + TypeScript + Tailwind 4 (App Router, src-dir, Turbopack).
- Intégration des 76 assets pixel art (`public/assets/` : 12 bâtiments × 5 niveaux, 11 ressources, 5 stades d'enveloppe + manifest.json).
- Intégration `src/data/economy_config.json` (économie calibrée 90 j, source de vérité du tuning) + scripts Python dans `tools/economy/`.
- Écran titre placeholder : palette charte, noyau pulsant, plancton dérivant.
- Décisions verrouillées : backend Firebase (réutilisation du projet v1), repo `evolve2`, rendu Canvas 2D natif + React DOM, PixelLab API pour les nouveaux assets.
- Prochaine étape : push initial, connexion Vercel, puis Phase 1 (kit UI + 20 portraits).
