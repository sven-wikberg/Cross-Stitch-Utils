# Cross Stitch Utils

Un projet pour regrouper plusieurs petits outils utiles aux projets de cross stitch.

## Objectif

L'idee est de construire une boite a outils personnelle, synchronisee avec GitHub, afin de pouvoir continuer le travail depuis plusieurs machines avec Codex, par exemple un PC principal et un laptop.

Les outils doivent rester faciles a utiliser au quotidien : ouvrir l'application, utiliser l'outil voulu, puis fermer simplement. La cible principale est un usage sur PC.

## Outils envisages

- Convertisseur d'image en grille de points.
- Gestionnaire de palettes et correspondances de fils.
- Estimateur de taille de toile selon le count et les marges.
- Calculateur de quantite de fil.
- Generateur de fiches projet imprimables.
- Suivi d'avancement d'un motif.

## Organisation proposee

- Chaque outil a sa propre page HTML.
- Les outils ne doivent jamais dependre les uns des autres.
- La page `index.html` sert uniquement de boite a outils pour ouvrir les pages dediees.
- `docs/` : notes, idees, decisions de conception.
- `src/` : code des outils.
- `data/` : donnees locales non sensibles utiles au projet.
- `exports/` : fichiers generes a ignorer ou versionner selon le besoin.

## Ouvrir l'application

Ouvrir `index.html` dans un navigateur sur PC, puis choisir l'outil voulu.

La version hebergee est publiee par GitHub Pages a chaque modification du site sur `main` :

`https://sven-wikberg.github.io/Cross-Stitch-Utils/`

L'outil 1, `Importer un pattern`, est disponible dans `import-pattern.html`.

L'outil 2, `Definir les chemins`, est disponible dans `plan-paths.html`.

L'outil 3, `Suivre la broderie`, est disponible dans `stitch-progress.html`.

## Pattern de test

[`data/examples/grands-ilots.pattern.json`](data/examples/grands-ilots.pattern.json) se charge directement dans l'outil 2. La grille mesure 120 x 110 cases et contient 3 259 croix d'une seule couleur, DMC 310, sans chemin precalcule. [Apercu du motif](data/examples/grands-ilots.png).

Les neuf ilots, de gauche a droite puis de haut en bas : U (268 croix), damier (313), rectangle plein (1 008), cadre (252), deux blocs relies par un pont (426), peigne (312), diagonale (25), serpentin (342) et losange (313). Le damier et la diagonale forment chacun un ilot naturel par les coins, mais chaque case y constitue un bloc orthogonal distinct pour l'optimisation. Les espaces entre formes permettent aussi de tester les liaisons et les coupes.

## Synchronisation de la progression

L'outil 3 conserve une seule progression active dans `data/progress-state.json`. Le pattern et ses chemins, immuables, sont conserves une fois dans `data/patterns/<sha256>.json`. Les synchronisations suivantes ne transmettent que la petite progression et les reglages de vue. Les anciens fichiers `builtin-progress.js` et les sauvegardes JSON completes restent lisibles.

Sur chaque PC utilise pour enregistrer la progression, creer un jeton personnel fin limite au depot `Cross-Stitch-Utils`, avec la permission `Contents: Read and write`, puis le saisir dans `Connexion GitHub`.

Le jeton reste uniquement dans le stockage local du navigateur. Il ne doit jamais etre ajoute aux fichiers du depot. Le bouton `Synchroniser sur GitHub` cree un commit; `Charger la sauvegarde synchronisee` recupere la derniere version du depot.

La synchronisation automatique est facultative (toutes les 30 secondes si la progression a change). Si un autre PC a modifie la sauvegarde, aucune version n'est ecrasee automatiquement : choisir la version GitHub ou confirmer l'envoi de la version locale. `Historique` permet de restaurer l'une des 15 dernieres versions synchronisees. Les modifications de progression seules ne redeploient pas le site; elles sont lues directement via l'API GitHub.

Les brouillons des outils 2 et 3 utilisent IndexedDB, avec migration du stockage local precedent. Fermer puis rouvrir l'outil 3 restaure la couleur, la progression, le zoom et la position de vue. Une sauvegarde locale reste propre au navigateur et au PC : exporter un JSON ou synchroniser avant de changer de machine. Hors ligne, reprendre le brouillon local; la sauvegarde historique incluse dans le site peut etre plus ancienne.

## Commandes de travail

- Outil 1 : en verification, regler l'opacite de l'image source et le zoom commun. Dans les associations, `Corriger les groupes` permet de fusionner deux groupes ou de separer les cases cochees. La couleur du groupe cible est conservee a la fusion; un groupe separe reste a classer. Les autres associations et corrections de cases sont conservees.
- Outil 2 : `Optimiser les blocs` construit puis ameliore le chemin; `Optimiser toutes les couleurs` traite la file en arriere-plan. Le delai sans amelioration est global pour la couleur (1 minute par defaut) et ne commence qu'apres la preparation des configurations. Arreter conserve le meilleur parcours complet disponible, ou la construction partielle si aucun parcours complet n'existe encore. Le depart impose, les premieres diagonales verrouillees et les coupes manuelles sont propres a chaque couleur. `Restaurer le meilleur chemin` permet de retrouver le meilleur parcours complet conserve avant ou pendant les essais.
- Les chemins exportent `settings.cutThreshold` et, pour chaque couleur, `forcedCuts` et `constraints`. Le score de l'outil 2 compte la distance de tous les deplacements entre diagonales, meme apres une coupe, plus trois fois le seuil pour chaque coupe. Les anciens chemins sans reglage utilisent le seuil de 10 cases.
- Outil 3 : `Vue rapprochee` affiche la zone autour de la diagonale a broder et les huit suivantes. Elle suit automatiquement l'avancement, sans agrandir le canvas du pattern entier. `Vue d'ensemble` revient au pattern complet; `Plein ecran` est independant. `Annuler` et `Retablir` gardent les 100 dernieres actions. Le mode de correction par clic choisit la diagonale la plus proche du curseur. Espace valide une diagonale; maintenir la touche ne valide pas plusieurs diagonales.

Les trois outils restent independants : aucun brouillon n'est partage entre eux. Le passage de l'un a l'autre se fait toujours par un fichier JSON explicite.

## Chemins de fil et compatibilite

Le pattern de l'outil 1 reste en version 1, avec une couleur par case. Les chemins de l'outil 2 passent en version 2 (`stitchUnit: "diagonal"`). Chaque entree de `paths[].points` contient `x`, `y`, `diagonal` (`lower` pour /, `upper` pour \\), `direction` (1 de gauche a droite, -1 de droite a gauche), et eventuellement `cutBefore: true`. Les coordonnees des trous se deduisent des coins de la case.

Deux contraintes sont obligatoires, meme en presence d'une coupe : la diagonale / precede la diagonale \\ de sa case; le trou de sortie d'une diagonale ne peut pas etre le trou d'entree de la suivante. Les croix peuvent etre entrelacees dans le chemin. Les traits pleins representent l'endroit, les traits fins pointilles le dos, et les coupes sont rouges. La diagonale courante a une entree carree et une sortie flechee; les coins sont aussi nommes dans son statut.

Un bloc est une composante maximale de cases reliees par un cote, sans limite de taille. Une case isolee orthogonalement est un bloc, meme si elle touche d'autres cases par les coins. Les anciens ilots naturels (cotes et coins) restent disponibles comme indicateur, mais ne contraignent plus l'ordre de parcours : tous les blocs d'une couleur peuvent etre reordonnes ensemble.

Dans chaque bloc, un parcours en profondeur brode la diagonale / a l'aller, explore les enfants, puis brode la diagonale \\ au retour. Les sens sont choisis ensemble par programmation dynamique avec une contrainte stricte : chaque liaison interne au dos doit mesurer exactement 1. Une direction localement possible peut etre refusee si elle empeche le retour entre deux branches. La pile d'exploration est iterative, sans limite liee a la recursion JavaScript.

L'entree et la sortie peuvent etre differentes. Le moteur essaie un pre-parcours de croix completes reliees diagonalement jusqu'a la future case de sortie, puis un aller-retour orthogonal depuis cette case. Il rejette un pre-parcours qui ne rejoint pas la sortie ou qui deconnecte une partie des cases restantes. Pour chaque bloc, il prepare jusqu'a huit cases candidates d'entree/sortie, choisies d'apres les blocs voisins, les extremites et le parcours deja connu. Il conserve aussi les configurations du parcours initial et d'un ancien parcours compatible.

Pour chaque ordre de blocs teste, une programmation dynamique choisit ensemble les entrees, sorties et sens parmi ces configurations. Elle tient compte du raccordement precedent et du suivant, avec les distances reelles entre trous, sans autoriser deux diagonales consecutives a utiliser le meme trou de transition. La recherche deplace, echange et inverse des sequences de blocs, avec des relances perturbees pour sortir des minima locaux. Jusqu'a sept blocs libres, tous les ordres sont testes dans la limite du delai sans amelioration.

Le critere principal est le score reel, puis le nombre de coupes et la distance. Les retours dans les anciens ilots ne sont plus prioritaires. Seul un nouveau meilleur resultat relance le delai sans amelioration; une relance aleatoire ou un changement de bloc ne le remet pas a zero. Le suivi affiche la preparation des blocs, les essais, les relances, les ameliorations, le temps ecoule, le delai sans gain et le score total. Le meilleur parcours complet reste affiche pendant la recherche; l'export reste bloque si le parcours est incomplet.

Les raccordements ameliores sont mis en evidence en bleu, avec les anciens liens en gris pointille pendant environ 1,4 seconde. Une coupe modifiee conserve son trait rouge au centre de la surbrillance. Le gain depuis le dernier parcours affiche et la variation des coupes apparaissent au-dessus de la grille. Les diagonales et les trajets internes aux blocs sont plus epais. Les apercus rapides sont regroupes toutes les 750 ms, sans pause dans le moteur de calcul; l'arret et la fin du calcul appliquent immediatement le dernier resultat. Une couche canvas separee s'efface sans redessiner le pattern, deplacer la vue ni modifier les fichiers exportes.

Le debut verrouille reste inchange. Une seule croix ouverte en fin de prefixe peut servir de racine du parcours; les autres configurations de prefixe sont conservees et les diagonales restantes sont raccordees sans enfreindre les contraintes. Les distances de 1 sont garanties dans les blocs nouvellement construits, pas dans les liaisons entre blocs ni dans un prefixe impose. Les fichiers et la progression de l'outil 3 ne sont jamais modifies par la generation.

Le choix de l'ordre et des configurations candidates reste heuristique : il ne garantit pas l'optimum global. La programmation dynamique est exacte pour un ordre donne, parmi les configurations preparees. Le moteur actif est `src/block-optimizer-worker.js`, qui reutilise la construction unitaire de `src/orthogonal-path-worker.js`. L'ancien `src/diagonal-optimizer-worker.js` et ses tests restent comme reference mais ne sont plus charges par l'outil 2. Les formats d'import/export restent inchanges.

Les anciens chemins sont convertis sans changer l'ordre des cases, avec les deux diagonales de chaque ancienne case consecutives. Les sauvegardes completes passent en version 2; l'etat compact synchronise passe en version 3. `stitchedByDmc` compte alors des diagonales, jamais des croix. A la migration, chaque ancienne croix brodee devient deux diagonales brodees : la meme case reste terminee, la prochaine case reste la meme, et les compteurs d'annulation sont convertis aussi. Les croix terminees et commencees sont comptees separement dans l'interface.

Avant de remplacer un ancien etat local IndexedDB, sa copie est gardee sous `migration-backup:<ancien patternId>` dans la meme base; l'ancien pattern immuable reste present. Les donnees legacy de localStorage sont copiees avant suppression. Les fichiers de sauvegarde du depot ne sont pas reecrits par cette mise a jour. La prochaine synchronisation explicite (ou automatique si activee) stockera un nouveau pattern immuable et la nouvelle progression, avec la protection habituelle contre les conflits. Mettre a jour la page sur chaque PC avant d'utiliser les nouveaux fichiers.

## Verification

```powershell
node tests/path-optimizer.test.js
node tests/orthogonal-path.test.js
node tests/block-optimizer.test.js
node tests/path-visuals.test.js
node tests/github-sync.test.js
node tests/upgrades.test.js
node tests/stitch-model.test.js
node tests/path-zones.test.js
node tests/path-orientation.test.js
node tests/zone-optimization.test.js
node tests/zone-timing.test.js
node tests/spatial-candidates.test.js
node tests/workflows.test.js
node tests/session-view.test.js
```

Les tests navigateur necessitent Playwright et utilisent Edge en mode headless par defaut (`BROWSER_CHANNEL` permet de choisir un autre canal). Ils travaillent dans des navigateurs isoles et simulent GitHub, sans modifier la vraie sauvegarde. Les captures sont placees dans `exports/verification/`. `REAL_PATTERN_TEST=1` ajoute l'import, la reprise et l'optimisation sur le gros fichier inclus au depot. `orthogonal-path.test.js` verifie les distances unitaires, toutes les petites formes connexes d'une grille 3 x 3, les entrees/sorties distinctes, les contraintes et les grands groupes. `block-optimizer.test.js` verifie le choix conjoint des configurations, les contraintes, le delai global et la conservation du meilleur resultat. Les tests des anciens moteurs et de leurs delais restent disponibles comme reference. Les couts de raccordement sont conserves dans un cache borne, sans matrice de distances entre toutes les diagonales.

## Direction technique

Le projet devrait evoluer vers une application avec interface graphique plutot qu'une suite de scripts. Une bonne approche est de commencer avec une application web locale simple, puis de pouvoir la transformer plus tard en application desktop Windows si besoin.

Objectifs d'usage :

- Lancement simple depuis un PC.
- Interface claire avec un menu d'outils.
- Aucun besoin de terminal pour utiliser les outils une fois l'application prete.
- Donnees sauvegardees localement dans des fichiers faciles a versionner ou exporter.
- Code synchronise via GitHub pour continuer le developpement depuis plusieurs machines.

## Travailler depuis plusieurs machines

1. Creer un depot GitHub pour ce projet.
2. Lier ce dossier local au depot distant.
3. Pousser les changements depuis cette machine.
4. Sur une autre machine, cloner le depot GitHub.
5. Avant de travailler, faire `git pull`.
6. Apres chaque session utile, faire `git add`, `git commit`, puis `git push`.

## Commandes Git utiles

```powershell
git status
git add .
git commit -m "Describe the change"
git push
git pull
```
