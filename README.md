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

Les neuf ilots, de gauche a droite puis de haut en bas : U (268 croix), damier (313), rectangle plein (1 008), cadre (252), deux blocs relies par un pont (426), peigne (312), diagonale (25), serpentin (342) et losange (313). Le damier et la diagonale sont chacun une seule zone, car les cases qui se touchent par un coin sont adjacentes. Les espaces entre formes permettent aussi de tester les liaisons et les coupes.

## Synchronisation de la progression

L'outil 3 conserve une seule progression active dans `data/progress-state.json`. Le pattern et ses chemins, immuables, sont conserves une fois dans `data/patterns/<sha256>.json`. Les synchronisations suivantes ne transmettent que la petite progression et les reglages de vue. Les anciens fichiers `builtin-progress.js` et les sauvegardes JSON completes restent lisibles.

Sur chaque PC utilise pour enregistrer la progression, creer un jeton personnel fin limite au depot `Cross-Stitch-Utils`, avec la permission `Contents: Read and write`, puis le saisir dans `Connexion GitHub`.

Le jeton reste uniquement dans le stockage local du navigateur. Il ne doit jamais etre ajoute aux fichiers du depot. Le bouton `Synchroniser sur GitHub` cree un commit; `Charger la sauvegarde synchronisee` recupere la derniere version du depot.

La synchronisation automatique est facultative (toutes les 30 secondes si la progression a change). Si un autre PC a modifie la sauvegarde, aucune version n'est ecrasee automatiquement : choisir la version GitHub ou confirmer l'envoi de la version locale. `Historique` permet de restaurer l'une des 15 dernieres versions synchronisees. Les modifications de progression seules ne redeploient pas le site; elles sont lues directement via l'API GitHub.

Les brouillons des outils 2 et 3 utilisent IndexedDB, avec migration du stockage local precedent. Fermer puis rouvrir l'outil 3 restaure la couleur, la progression, le zoom et la position de vue. Une sauvegarde locale reste propre au navigateur et au PC : exporter un JSON ou synchroniser avant de changer de machine. Hors ligne, reprendre le brouillon local; la sauvegarde historique incluse dans le site peut etre plus ancienne.

## Commandes de travail

- Outil 1 : en verification, regler l'opacite de l'image source et le zoom commun. Dans les associations, `Corriger les groupes` permet de fusionner deux groupes ou de separer les cases cochees. La couleur du groupe cible est conservee a la fusion; un groupe separe reste a classer. Les autres associations et corrections de cases sont conservees.
- Outil 2 : `Parcours par retours` construit un nouveau chemin; `Generer toutes les couleurs` traite la file en arriere-plan. Arreter conserve le parcours construit, meme incomplet; reprendre reconstruit la couleur interrompue. Le depart impose, les premieres diagonales verrouillees et les coupes manuelles sont propres a chaque couleur. `Restaurer le meilleur chemin` permet de retrouver le meilleur parcours complet conserve avant ou pendant les essais.
- Les chemins exportent `settings.cutThreshold` et, pour chaque couleur, `forcedCuts` et `constraints`. Le score de l'outil 2 compte la distance de tous les deplacements entre diagonales, meme apres une coupe, plus trois fois le seuil pour chaque coupe. Les anciens chemins sans reglage utilisent le seuil de 10 cases.
- Outil 3 : `Vue rapprochee` affiche la zone autour de la diagonale a broder et les huit suivantes. Elle suit automatiquement l'avancement, sans agrandir le canvas du pattern entier. `Vue d'ensemble` revient au pattern complet; `Plein ecran` est independant. `Annuler` et `Retablir` gardent les 100 dernieres actions. Le mode de correction par clic choisit la diagonale la plus proche du curseur. Espace valide une diagonale; maintenir la touche ne valide pas plusieurs diagonales.

Les trois outils restent independants : aucun brouillon n'est partage entre eux. Le passage de l'un a l'autre se fait toujours par un fichier JSON explicite.

## Chemins de fil et compatibilite

Le pattern de l'outil 1 reste en version 1, avec une couleur par case. Les chemins de l'outil 2 passent en version 2 (`stitchUnit: "diagonal"`). Chaque entree de `paths[].points` contient `x`, `y`, `diagonal` (`lower` pour /, `upper` pour \\), `direction` (1 de gauche a droite, -1 de droite a gauche), et eventuellement `cutBefore: true`. Les coordonnees des trous se deduisent des coins de la case.

Deux contraintes sont obligatoires, meme en presence d'une coupe : la diagonale / precede la diagonale \\ de sa case; le trou de sortie d'une diagonale ne peut pas etre le trou d'entree de la suivante. Les croix peuvent etre entrelacees dans le chemin. Les traits pleins representent l'endroit, les traits fins pointilles le dos, et les coupes sont rouges. La diagonale courante a une entree carree et une sortie flechee; les coins sont aussi nommes dans son statut.

Les ilots naturels restent les composantes reliees par un cote ou un coin, sans limite de taille. Le nouveau moteur les subdivise en groupes orthogonaux : seules les cases reliees par un cote appartiennent au meme groupe. Il termine un ilot naturel avant de passer au suivant. Les groupes relies uniquement par des coins sont pour l'instant raccordes par proximite entre trous; ils ne beneficient pas encore d'une strategie speciale de parcours diagonal.

Dans chaque groupe, un parcours en profondeur brode la diagonale / a l'aller, explore les enfants, puis brode la diagonale \\ au retour. Les sens sont choisis ensemble par programmation dynamique avec une contrainte stricte : chaque liaison interne au dos doit mesurer exactement 1. Une direction localement possible peut etre refusee si elle empeche le retour entre deux branches. La pile d'exploration est iterative, sans limite liee a la recursion JavaScript.

L'entree et la sortie peuvent etre differentes. Le moteur essaie un pre-parcours de croix completes reliees diagonalement jusqu'a la future case de sortie, puis un aller-retour orthogonal depuis cette case. Il rejette un pre-parcours qui ne rejoint pas la sortie ou qui deconnecte une partie des cases restantes. Les entrees et sorties candidates sont selectionnees d'apres les liaisons avec le groupe precedent et les groupes encore a parcourir. Une derniere passe choisit les sens sur tout le chemin sans jamais relacher les liaisons internes de longueur 1.

Il s'agit d'une construction finie et deterministe, sans 2-opt ni relances aleatoires ni attente d'un delai sans amelioration. Les anciens reglages de temps restent dans les brouillons pour compatibilite mais ne sont pas utilises par ce moteur. Le suivi affiche le groupe courant, les groupes termines, les paires entree/sortie testees, le temps ecoule et le score total. Le parcours se dessine au fil de sa construction. L'export reste bloque tant que toutes les diagonales ne sont pas presentes.

Le nouveau parcours est affiche meme si un ancien chemin avait un meilleur score, afin de pouvoir tester cette methode. La memoire du meilleur chemin reste separee et restaurable; elle compare d'abord les retours dans les ilots naturels, puis le score et les coupes. Le debut verrouille reste inchange. Une seule croix ouverte en fin de prefixe peut servir de racine du parcours; les autres configurations de prefixe sont conservees et les diagonales restantes sont raccordees sans enfreindre les contraintes. Les fichiers et la progression de l'outil 3 ne sont jamais modifies par la generation.

Les distances de 1 sont garanties dans les groupes nouvellement construits, pas dans les liaisons entre groupes ni dans un prefixe impose. Le choix des entrees/sorties et de l'ordre des groupes reste heuristique : cette premiere version ne garantit pas l'optimum global. Le moteur actif est `src/orthogonal-path-worker.js`; l'ancien `src/diagonal-optimizer-worker.js` et ses tests sont conserves comme reference mais ne sont plus charges par l'outil 2. Les formats d'import/export restent inchanges.

Les anciens chemins sont convertis sans changer l'ordre des cases, avec les deux diagonales de chaque ancienne case consecutives. Les sauvegardes completes passent en version 2; l'etat compact synchronise passe en version 3. `stitchedByDmc` compte alors des diagonales, jamais des croix. A la migration, chaque ancienne croix brodee devient deux diagonales brodees : la meme case reste terminee, la prochaine case reste la meme, et les compteurs d'annulation sont convertis aussi. Les croix terminees et commencees sont comptees separement dans l'interface.

Avant de remplacer un ancien etat local IndexedDB, sa copie est gardee sous `migration-backup:<ancien patternId>` dans la meme base; l'ancien pattern immuable reste present. Les donnees legacy de localStorage sont copiees avant suppression. Les fichiers de sauvegarde du depot ne sont pas reecrits par cette mise a jour. La prochaine synchronisation explicite (ou automatique si activee) stockera un nouveau pattern immuable et la nouvelle progression, avec la protection habituelle contre les conflits. Mettre a jour la page sur chaque PC avant d'utiliser les nouveaux fichiers.

## Verification

```powershell
node tests/path-optimizer.test.js
node tests/orthogonal-path.test.js
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

Les tests navigateur necessitent Playwright et utilisent Edge en mode headless par defaut (`BROWSER_CHANNEL` permet de choisir un autre canal). Ils travaillent dans des navigateurs isoles et simulent GitHub, sans modifier la vraie sauvegarde. Les captures sont placees dans `exports/verification/`. `REAL_PATTERN_TEST=1` ajoute l'import, la reprise et la construction sur le gros fichier inclus au depot. `orthogonal-path.test.js` verifie les distances unitaires, toutes les petites formes connexes d'une grille 3 x 3, les entrees/sorties distinctes, les contraintes et les grands groupes. Les tests des anciens moteurs et de leurs delais restent disponibles comme reference. Le moteur actif utilise un index spatial, sans matrice de distances quadratique.

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
