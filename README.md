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

## Synchronisation de la progression

L'outil 3 conserve une seule progression active dans `data/progress-state.json`. Le pattern et ses chemins, immuables, sont conserves une fois dans `data/patterns/<sha256>.json`. Les synchronisations suivantes ne transmettent que la petite progression et les reglages de vue. Les anciens fichiers `builtin-progress.js` et les sauvegardes JSON completes restent lisibles.

Sur chaque PC utilise pour enregistrer la progression, creer un jeton personnel fin limite au depot `Cross-Stitch-Utils`, avec la permission `Contents: Read and write`, puis le saisir dans `Connexion GitHub`.

Le jeton reste uniquement dans le stockage local du navigateur. Il ne doit jamais etre ajoute aux fichiers du depot. Le bouton `Synchroniser sur GitHub` cree un commit; `Charger la sauvegarde synchronisee` recupere la derniere version du depot.

La synchronisation automatique est facultative (toutes les 30 secondes si la progression a change). Si un autre PC a modifie la sauvegarde, aucune version n'est ecrasee automatiquement : choisir la version GitHub ou confirmer l'envoi de la version locale. `Historique` permet de restaurer l'une des 15 dernieres versions synchronisees. Les modifications de progression seules ne redeploient pas le site; elles sont lues directement via l'API GitHub.

Les brouillons des outils 2 et 3 utilisent IndexedDB, avec migration du stockage local precedent. Fermer puis rouvrir l'outil 3 restaure la couleur, la progression, le zoom et la position de vue. Une sauvegarde locale reste propre au navigateur et au PC : exporter un JSON ou synchroniser avant de changer de machine. Hors ligne, reprendre le brouillon local; la sauvegarde historique incluse dans le site peut etre plus ancienne.

## Commandes de travail

- Outil 1 : en verification, regler l'opacite de l'image source et le zoom commun. Dans les associations, `Corriger les groupes` permet de fusionner deux groupes ou de separer les cases cochees. La couleur du groupe cible est conservee a la fusion; un groupe separe reste a classer. Les autres associations et corrections de cases sont conservees.
- Outil 2 : `Optimiser toutes les couleurs` traite la file en arriere-plan. Arreter conserve les meilleurs chemins; reprendre continue avec la couleur interrompue. Le depart impose, les premieres diagonales verrouillees et les coupes manuelles sont propres a chaque couleur. Une coupe imposee reste attachee a l'entree de la diagonale choisie pendant la recherche.
- Les chemins exportent `settings.cutThreshold` et, pour chaque couleur, `forcedCuts` et `constraints`. Le score de l'outil 2 compte la distance de tous les deplacements entre diagonales, meme apres une coupe, plus trois fois le seuil pour chaque coupe. Les anciens chemins sans reglage utilisent le seuil de 10 cases.
- Outil 3 : `Vue rapprochee` affiche la zone autour de la diagonale a broder et les huit suivantes. Elle suit automatiquement l'avancement, sans agrandir le canvas du pattern entier. `Vue d'ensemble` revient au pattern complet; `Plein ecran` est independant. `Annuler` et `Retablir` gardent les 100 dernieres actions. Le mode de correction par clic choisit la diagonale la plus proche du curseur. Espace valide une diagonale; maintenir la touche ne valide pas plusieurs diagonales.

Les trois outils restent independants : aucun brouillon n'est partage entre eux. Le passage de l'un a l'autre se fait toujours par un fichier JSON explicite.

## Chemins de fil et compatibilite

Le pattern de l'outil 1 reste en version 1, avec une couleur par case. Les chemins de l'outil 2 passent en version 2 (`stitchUnit: "diagonal"`). Chaque entree de `paths[].points` contient `x`, `y`, `diagonal` (`lower` pour /, `upper` pour \\), `direction` (1 de gauche a droite, -1 de droite a gauche), et eventuellement `cutBefore: true`. Les coordonnees des trous se deduisent des coins de la case.

Deux contraintes sont obligatoires, meme en presence d'une coupe : la diagonale / precede la diagonale \\ de sa case; le trou de sortie d'une diagonale ne peut pas etre le trou d'entree de la suivante. Les croix peuvent etre entrelacees dans le chemin. Les traits pleins representent l'endroit, les traits fins pointilles le dos, et les coupes sont rouges. La diagonale courante a une entree carree et une sortie flechee; les coins sont aussi nommes dans son statut.

Le moteur construit des zones naturelles : toutes les cases d'une couleur reliees par un cote ou un coin appartiennent au meme ilot, sans limite de taille et sans decoupage aux reperes des dizaines. Deux ilots qui ne se touchent pas restent separes, meme si leur ecart est inferieur a la distance de coupe. Il termine les diagonales d'une zone avant de la quitter et choisit la prochaine zone selon la distance reelle entre trous, meme si une coupe est necessaire. Les ameliorations locales restent dans leur zone. Un debut verrouille est toujours conserve, meme s'il imposait deja des retours : seule la suite libre est regroupee. Un index spatial accelere la recherche dans les grands ilots sans les subdiviser.

Le meilleur chemin est choisi d'abord selon le nombre de retours de zone, puis selon le score distance + effort des coupes. Le score peut donc augmenter si cela supprime des allers-retours. La memoire du meilleur chemin et l'affichage utilisent exactement le meme critere que le Worker. Les anciens chemins restent charges, mais les anciens scores initiaux et bilans de calcul sont remis a zero une seule fois lors du changement de critere. La progression de l'outil 3 n'est pas modifiee.

La recherche optimise les zones une par une, dans l'ordre du chemin. Le temps sans amelioration est proportionnel a la partie non verrouillee : par defaut 1 minute pour 500 croix (1 000 diagonales), avec un minimum de 5 secondes et un maximum de 10 minutes par zone. La formule est `min(600000, max(5000, referenceMs * diagonalesLibres / 1000))`. Le reglage de l'interface represente le temps de reference pour 500 croix; les bornes restent fixes. Une diagonale libre compte comme une demi-croix; les zones entierement verrouillees sont ignorees. Chaque nouveau meilleur score remet le compteur de la zone a zero : ce delai n'est donc pas une duree totale maximale. L'ancien reglage par zone est remplace une seule fois par la reference d'une minute, sans effacer les chemins, contraintes ou scores initiaux.

Dans la zone courante, le moteur utilise des deplacements locaux de diagonales et plusieurs departs gloutons avec precedence. Les autres zones gardent leur ordre. Chaque essai est evalue avec les meilleurs sens possibles sur tout le chemin (programmation dynamique), y compris les liaisons avec les zones voisines et les coupes : un gain seulement local ne suffit pas. Les resumes des portions inchangees sont reutilises. Seul le meilleur parcours est affiche et conserve; les essais moins bons ne le remplacent pas.

Le suivi affiche la zone courante, les zones terminees, le nombre de croix a optimiser, le delai calcule pour cette zone, son score avant/apres avec ses liaisons d'entree et de sortie, le temps sans gain et le score total. Le bandeau au-dessus de la grille reprend aussi sa taille et son compteur sans gain face au delai. Les scores locaux ne s'additionnent pas, car une liaison peut appartenir aux deux zones voisines. La zone active est encadree sur la grille; la barre globale avance au passage d'une zone a la suivante. Apres les zones, une passe bornee optimise leurs liaisons en deplacant des zones entieres, puis une derniere passe globale optimise toujours les sens. L'arret manuel conserve le meilleur chemin recu et finalise aussi ses sens. Les sens du debut verrouille et les coupes imposees restent proteges.

Terminer les zones peut demander davantage de coupes qu'un parcours qui y revient plusieurs fois. La longueur sur l'endroit est constante. Ce moteur heuristique fonctionne dans un Worker et ne garantit pas l'optimum global. La progression de broderie et les formats des fichiers ne sont pas modifies par cette recherche.

Les anciens chemins sont convertis sans changer l'ordre des cases, avec les deux diagonales de chaque ancienne case consecutives. Les sauvegardes completes passent en version 2; l'etat compact synchronise passe en version 3. `stitchedByDmc` compte alors des diagonales, jamais des croix. A la migration, chaque ancienne croix brodee devient deux diagonales brodees : la meme case reste terminee, la prochaine case reste la meme, et les compteurs d'annulation sont convertis aussi. Les croix terminees et commencees sont comptees separement dans l'interface.

Avant de remplacer un ancien etat local IndexedDB, sa copie est gardee sous `migration-backup:<ancien patternId>` dans la meme base; l'ancien pattern immuable reste present. Les donnees legacy de localStorage sont copiees avant suppression. Les fichiers de sauvegarde du depot ne sont pas reecrits par cette mise a jour. La prochaine synchronisation explicite (ou automatique si activee) stockera un nouveau pattern immuable et la nouvelle progression, avec la protection habituelle contre les conflits. Mettre a jour la page sur chaque PC avant d'utiliser les nouveaux fichiers.

## Verification

```powershell
node tests/path-optimizer.test.js
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

Les tests de parcours necessitent Playwright et utilisent Edge en mode headless par defaut (`BROWSER_CHANNEL` permet de choisir un autre canal). Ils travaillent dans des navigateurs isoles et simulent GitHub, sans modifier la vraie sauvegarde. Les captures sont placees dans `exports/verification/`. `REAL_PATTERN_TEST=1` ajoute l'import et la reprise du gros fichier inclus au depot. Les tests unitaires du moteur utilisent une horloge controlee pour verifier les vrais delais proportionnels sans attendre plusieurs minutes; les tests navigateur utilisent l'horloge reelle. Le nouveau moteur de diagonales utilise un index spatial et ne construit pas de matrice de distances quadratique.

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
