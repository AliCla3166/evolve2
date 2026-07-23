# EVOLVE v2 — Plan de construction complet

*Rédigé le 23/07/2026 — document de référence pour toutes les sessions de travail. Copie maîtresse sur Notion, liée depuis la page "Initialisation Evolve".*

---

## 1. Vision

EVOLVE v2 est le remake complet du prototype v1 (`AliCla3166/evolve-game`, vanilla JS mono-fichier) en une vraie web app Next.js avec une direction artistique pixel art organique assumée. Le cœur ne change pas : **tes bonnes habitudes du réel financent une civilisation qui évolue de la cellule au divin**. La mise à jour quotidienne des habitudes donne des Points d'énergie, la ressource-mère qui alimente tout le reste.

L'expérience visée pour l'Âge 1 (Cellule) : un jeu de gestion à la OGame — base cellulaire vivante et animée, bâtiments à améliorer avec des timers réels, économie multi-ressources, unités de défense contre les pathogènes, expéditions pour ressources uniques, pêche qui rapporte des cartes d'unités, événements aléatoires — avec une progression **très lente et très jalonnée** calibrée sur **~3 mois de jeu** avant l'ascension vers l'Âge 2 (être multicellulaire).

### Piliers

1. **Le réel d'abord** : rien n'avance vraiment sans les Points d'énergie des habitudes quotidiennes. Le jeu est un compagnon de discipline, pas un piège à temps.
2. **Lenteur savoureuse** : timers réels croissants, paliers nombreux, chaque déblocage est un événement. Jamais de mur frustrant : il y a toujours *quelque chose* à faire (pêche, expéditions, événements).
3. **DA organique cohérente** : tout l'écran est vivant — la base pulse, la membrane ondule, les menus sont des tissus cellulaires. Pixel art semi-réaliste top-down, palette de la charte graphique existante.
4. **Multi-device** : téléphone + 3 PC, sauvegarde cloud, reprise instantanée partout.

---

## 2. Acquis réutilisables (rien ne part de zéro)

| Acquis | Source | Réutilisation en v2 |
|---|---|---|
| Système d'habitudes (5 habitudes : calories, pas, Magic Focus, chantier ALILOU, rituels) avec barème PB/jour | v1 `index.html` (HABITS) | Repris quasi tel quel, rebaptisé Points d'énergie, UI refaite |
| Mini-jeu de pêche "La Mare" complet (repérage paillettes + barre de tension, 6 raretés Commune→Mythique, jetons) | v1 `index.html` (fishing, ~l.2417+) | Gameplay porté en React/Canvas, **les prises deviennent des cartes d'unités** |
| Couche EMPIRE (files de construction à timers réels, expéditions à retour différé) | v1 `expansion.js` | Logique de référence pour le moteur v2 (réécrite propre en TS) |
| Age of War (défense en ligne 3 unités × 5 stades, vagues, boss "Le Mégaphage") | v1 `expansion.js` | **Hors scope v2.0** — réservé au futur mini-jeu du Bastion-Défense (grisé "à venir") |
| Thèmes par âge (guerre, pêche multi-âges, musée) | v1 `expansion.js` | Base narrative pour les âges futurs |
| Sauvegarde cloud Firebase (Google sign-in + Firestore) déjà configurée et en prod | v1 `index.html` | **Décision proposée : garder Firebase** (voir §3) |
| Économie calibrée 90 jours : 9 bâtiments, coûts/temps/production/stockage, simulation validée (+3,2 % vs cible) | `economy_config.json` + scripts Python | Source de données directe du moteur v2 |
| 76 PNG pixel art (12 bâtiments × 5 niveaux via 5 états, 11 ressources, 5 stades d'enveloppe) + manifest | Projet Claude Design + `/root/evolve/assets/` | Intégrés tels quels dans le repo |
| Charte graphique (palette, styles, prompts, nomenclature `age01_cell_*`) | Projet Claude Design | Guide toute la production d'assets UI |
| PixelLab API (token fourni par Ali, testé OK — portrait test réussi) | api.pixellab.ai | Génération de tous les nouveaux assets |

---

## 3. Décisions techniques

| Sujet | Décision | Pourquoi |
|---|---|---|
| Framework | Next.js 15 + TypeScript + Tailwind, App Router, PWA (installable sur téléphone) | Cible confirmée GitHub + Vercel ; PWA = icône sur l'écran d'accueil du téléphone |
| Rendu de la base | Canvas 2D natif pour la scène cellulaire (enveloppe animée, bâtiments, particules), React DOM pour tous les menus/panneaux | Pixel-perfect facile (`image-rendering: pixelated`), léger sur mobile, pas de dépendance lourde |
| État du jeu | Store central (Zustand) + moteur de tick découplé (timestamps réels → production offline exacte) | Les timers OGame reposent sur des dates absolues, pas sur l'onglet ouvert |
| Sauvegarde | **Firebase (Google sign-in + Firestore) — révision de la réponse "Supabase"** : ton prototype v1 l'utilise déjà, le projet Firebase existe, l'auth Google marche sur tes 4 devices, zéro configuration nouvelle. Supabase reste possible si tu y tiens (à trancher, voir §9). Architecture en adaptateur : localStorage toujours actif en cache local, backend cloud branchable. | Le plus court chemin vers la sync multi-device fiable |
| Données d'équilibrage | `economy_config.json` embarqué dans le repo, jamais de valeurs en dur dans le code | Tout le tuning reste modifiable sans toucher au code (Excel → JSON → commit) |
| Repo | Nouveau repo GitHub dédié (proposition : `evolve2`), la v1 reste intacte et jouable | Historique propre, pas de risque pour ta sauvegarde v1 |
| Déploiement | Vercel connecté au repo (config via ton Chrome, une seule fois), chaque push = déploiement | Extension Chrome vérifiée fonctionnelle aujourd'hui |
| Assets | Génération PixelLab (API pixflux/bitforge) + post-traitement local (contrôle palette, transparence, découpe) ; nomenclature de la charte | Même outil que les 76 assets existants = cohérence maximale |

---

## 4. Direction artistique — production d'assets (PixelLab)

Tout respecte la charte : palette bioluminescente sur fond sombre, accents cyan `#6df6ff` / vert `#a6ff3d` / magenta `#ff54d6`, nomenclature `age01_cell_ui_[element]_[etat]_v001.png`.

### 4.1 Kit UI organique

| Élément | Détail | Quantité estimée |
|---|---|---|
| Panneaux membrane (9-slice) | 3 variantes : panneau standard, panneau "noyau" (header renforcé), tooltip | 3 |
| Boutons organiques | 3 tailles × 4 états (normal, survol, pressé, désactivé) — aspect vésicule/tissu | 12 |
| Barres & jauges | Barre de ressource (cadre + remplissage), jauge de construction, jauge de tension pêche, barre d'XP/âge | 8 |
| Icônes de navigation | Base, Habitudes, Mare, Noyau/Unités, Recherche/Mutation, Rapports, Paramètres | 7 |
| Cadres de cartes d'unités | 6 raretés (lueur graduée) + dos de carte + cadre vide de slot | 8 |
| Overlays d'état bâtiment | "À venir" (voile + cadenas organique), "En construction" (cocon/échafaudage organique), halo d'amélioration disponible | 3 |
| Fond d'écran | Océan primordial (grand fond animable par parallaxe légère) + variante floutée pour menus | 2 |
| Divers | Curseur, séparateurs, puces de notification, pictos +/−, coche de validation d'habitude | ~8 |

### 4.2 Les 20 portraits de créatures (création de perso)

64×64, plan rapproché de la gueule, créatures alien originales et mystiques, fond sombre uni pour découpe. 20 concepts distincts (préparés en grille de prompts) : abyssal à yeux multiples, méduse à voiles lumineux, crustacé cristallin, larve stellaire, céphalopode rêveur, prédateur cilié, symbiote double, spore éveillée, poisson-lanterne ancestral, amibe royale, trilobite chromé, hydre naissante, ver bioluminescent, diatomée-joyau, embryon cosmique, radiolaire architecte, planaire aux deux visages, colonie-visage, archée des failles, germe divin. Le portrait test généré aujourd'hui valide le style.

### 4.3 Animations

Priorité au **rendu vivant à moindre coût** : pulsation des bâtiments (scale/glow sinusoïdal en code), ondulation de l'enveloppe (déformation douce), particules dérivantes (plancton lumineux), transitions de panneaux (dépliement membrane), flash organique au clic, flux de ressources animé vers le HUD lors des collectes. Si besoin de sprites animés image par image (ex. Noyau qui respire), l'API PixelLab d'animation par squelette est disponible en seconde passe.

---

## 5. Game design v2.0 — périmètre exact

### 5.1 Écran titre & création de personnage
Logo EVOLVE pixel art, fond océan primordial animé. Première partie : choix du portrait parmi les 20, nom de l'organisme, puis micro-tutoriel intégré (3 étapes guidées : marquer une habitude → lancer une construction → voir le timer). Connexion Google proposée dès le titre (ou "jouer en local" → sync plus tard).

### 5.2 La base cellulaire (écran principal)
Scène Canvas : enveloppe à 5 stades (sprite selon nombre de bâtiments construits), les 12 bâtiments sur leurs sockets, pulsation permanente, plancton en particules. Clic/tap sur un bâtiment → panneau d'amélioration (niveau actuel, production, coûts avec état "affordable ou pas", temps de construction, bouton améliorer). **Bastion-Défense, Bastion-Raid et Centre Pêche/Collection : présents mais grisés avec overlay "À venir"** (le mini-jeu de pêche v2.0 vit dans le menu "Mare", le bâtiment dédié n'arrive qu'avec son système d'amélioration plus tard). File de construction : **1 slot** (levier de pacing n°1), file visible en HUD avec timer.

### 5.3 Économie
Directement depuis `economy_config.json` : 8 ressources produites + Points d'énergie (habitudes) + Points d'âge (progression) ; caps de stockage tirés par Noyau/Réservoir ; production offline calculée aux timestamps. HUD de ressources compact (mobile first) avec tooltips détaillés.

### 5.4 Habitudes → Points d'énergie
Les 5 habitudes de la v1, saisie quotidienne (avec la même logique anti-triche de la v1 : un jour = une saisie). Les PB deviennent des **Points d'énergie** injectés dans l'économie (achat de boosts, accélérations partielles, jetons de pêche). Streaks récompensés par paliers (7/30/90 jours).

### 5.5 Le Noyau : unités, défense, expéditions
Le Noyau est le hub militaire. On y **recrute des unités** (coût en ressources + énergie) de 3 rôles : défense (garnison permanente), exploration (envoyées en expédition), assaut (versions offensives, utiles aux expéditions risquées). Le **menu d'envoi** propose en rotation 3 à 5 destinations générées (durée, risque, récompenses possibles : ressources uniques, fragments de carte, boosts) — on compose son escouade, elle part avec un timer réel, le **rapport d'expédition** tombe au retour. Les **pathogènes** attaquent périodiquement (fréquence basse, annoncée) : résolution automatique par comparaison puissance défensive vs vague, avec rapport et pertes légères — le tower defense jouable reste pour le futur Bastion-Défense.

### 5.6 La Mare primordiale : pêche → cartes d'unités
Gameplay v1 porté (paillettes + barre de tension, 6 raretés, jetons achetés en énergie). Nouveauté : chaque prise donne une **carte d'unité** (12 espèces × raretés). Les doublons montent le niveau de la carte (progression lente type gacha soft, sans monnaie réelle). Les cartes s'assignent comme unités de défense ou d'expédition — c'est la passerelle entre la pêche et la couche militaire.

### 5.7 Événements aléatoires
Pool d'événements tirés 1 à 3 fois par jour réel : courant nutritif (+ressources), spore rare (mini-choix risque/récompense), mutation spontanée (réduction de timer), banc de plancton (bonus de pêche limité), alerte pathogène (pré-annonce d'attaque). Toujours positifs ou à choix — jamais punitifs sans contre-jeu.

### 5.8 Progression, paliers, ascension
Points d'âge gagnés par constructions, expéditions, collections, streaks. Nombreux paliers intermédiaires (jalons visibles avec récompenses). À ~90 jours de jeu régulier : l'ascension vers l'Âge 2 se débloque (écran de transition, teaser multicellulaire, conservation musée/héritage comme prévu dans expansion.js).

---

## 6. Découpage en phases

Chaque phase se termine par : build vert + déploiement Vercel + mise à jour de la page Notion "Initialisation Evolve" (état, décisions, point de reprise exact). Une phase = une à deux sessions de travail.

| Phase | Contenu | Livrable vérifiable |
|---|---|---|
| **0. Fondations** | Repo GitHub (via ton Chrome), scaffold Next.js+TS+Tailwind+PWA, intégration des 76 assets + `economy_config.json`, pipeline Vercel, structure de dossiers, PLAN.md dans le repo | URL Vercel qui affiche un écran-titre placeholder avec un asset réel |
| **1. Kit UI & DA** | Génération PixelLab du kit UI complet (§4.1) + 20 portraits (§4.2), post-traitement, intégration (sprites + composants React de base : Panel, Button, Gauge, Card) | Storybook-like page `/ui` montrant tous les composants habillés |
| **2. Moteur de jeu** | Store + tick engine, économie branchée sur le JSON (production, caps, coûts), file de construction à timers réels, production offline, sauvegarde locale + Firebase, système d'habitudes complet | Partie jouable en HUD nu : habitudes → énergie, construire, produire, fermer/rouvrir l'onglet sans perte |
| **3. Base vivante** | Scène Canvas (enveloppe 5 stades, 12 bâtiments, animations, particules), panneaux de bâtiments, overlays "à venir"/construction, HUD ressources mobile-first | La base complète cliquable, belle et animée, sur téléphone et PC |
| **4. Perso & onboarding** | Écran titre, création de perso (20 portraits), tutoriel 3 étapes, écran de connexion/sync | Nouveau joueur guidé de zéro jusqu'à sa première construction |
| **5. Couche militaire** | Recrutement au Noyau, expéditions (génération de destinations, escouades, timers, rapports), attaques de pathogènes, événements aléatoires | Boucle complète : recruter → envoyer → rapport → récompenses uniques ; premier pathogène repoussé |
| **6. La Mare & les cartes** | Port du mini-jeu de pêche, système de cartes (12 espèces × 6 raretés, doublons/niveaux), collection, assignation défense/expédition | Pêcher une carte Rare et l'envoyer en expédition |
| **7. Équilibrage 90 jours** | Extension du simulateur Python (unités, expéditions, pêche, événements), recalibrage `economy_config.json` v2, paliers/jalons finaux | Simulation montrant ~90 j ±10 % pour l'ascension, courbe de déblocages sans trou d'ennui |
| **8. Polish & release** | Sons discrets (option), vibrations mobile légères, réglages, page "à propos", icônes PWA, passe perfs (poids assets, 60 fps mobile), QA multi-device | v2.0 en prod sur Vercel, installée sur ton téléphone, doc à jour |

**Ordre choisi à dessein** : la DA (phase 1) vient tôt parce que tu veux une identité visuelle forte — tout ce qui se construit ensuite est directement habillé, jamais de "placeholder art" à refaire.

---

## 7. Protocole de reprise entre sessions

La page Notion **"Initialisation Evolve"** reste l'unique point d'entrée : chaque fin de phase (ou interruption) y inscrit l'état exact — phase en cours, dernier commit, URL Vercel, décisions prises, prochaine action précise, blocages. Le repo contient en miroir `docs/JOURNAL.md` (journal de bord technique) et ce plan (`PLAN.md`). Une session future lit la page Notion → clone le repo → reprend au point exact.

---

## 8. Risques et parades

| Risque | Parade |
|---|---|
| Crédits PixelLab épuisés en cours de production | Produire par lots priorisés (UI kit d'abord, portraits ensuite) ; fallback : génération via mon outil d'images + quantification palette |
| Incohérence DA entre nouveaux et anciens assets | Prompts dérivés de la charte + post-traitement palette systématique + revue visuelle par lot |
| Scope creep (le jeu est ambitieux) | Le périmètre v2.0 du §5 est fermé ; tout le reste (tower defense, raid, bâtiment pêche, âge 2) est explicitement "à venir" |
| Équilibrage de la nouvelle boucle (cartes, expéditions) non validé | Phase 7 dédiée : le simulateur Python est étendu avant tout réglage à la main |
| Poids des assets sur mobile | Sprites ≤256×256, atlas regroupés, chargement paresseux, budget < 3 Mo au premier chargement |
| Session interrompue en plein milieu | Protocole §7 : commits fréquents + Notion à jour à chaque étape significative |

---

## 9. Ce qu'il me reste à te demander

1. **Backend** : je propose de **garder Firebase** (déjà en prod dans ta v1, zéro setup) au lieu de Supabase — d'accord ?
2. **Nom du repo** : `evolve2` te va, ou tu préfères un autre nom ?
3. **Rien d'autre** : PixelLab testé et fonctionnel, extension Chrome connectée, tous les matériaux (assets, économie, prototype v1) sont en ma possession.
