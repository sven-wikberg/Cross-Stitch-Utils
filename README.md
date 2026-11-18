# Cross Stitch Utils

Un projet pour regrouper plusieurs petits outils utiles aux projets de cross stitch.

## Objectif

L'idee est de construire une boite a outils personnelle, synchronisee avec GitHub, afin de pouvoir continuer le travail depuis plusieurs machines avec Codex, par exemple un PC principal et un laptop.

Les outils doivent rester faciles a utiliser au quotidien : ouvrir l'application, utiliser l'outil voulu, puis fermer simplement. La cible principale est un usage sur PC.

La [feuille de route de l'outil 2](ROADMAP.md) regroupe les ameliorations prevues et leur avancement.

Dans l'outil 2, Vider et Reset demandent confirmation. Les fleches Annuler/Retablir de l'en-tete (Ctrl+Z, Ctrl+Maj+Z ou Ctrl+Y hors champs de saisie) agissent sur des operations entieres : un glisser, une optimisation par couleur, une modification de contraintes, une distance de coupe, un effacement ou une restauration. L'historique persiste dans IndexedDB apres rechargement, y compris pour annuler un Reset ou une operation interrompue au dernier etat sauvegarde. Il conserve au plus 50 operations et environ 16 Mio par pile, sauf la derniere operation qui reste toujours disponible. Charger un nouveau fichier commence un nouvel historique.

Le meilleur chemin est conserve a part : Vider ou annuler une optimisation ne le supprime pas. Restaurer le meilleur chemin restaure aussi ses contraintes, avec confirmation si elles remplacent les contraintes actuelles. Ces protections sont locales au navigateur ; elles ne sont pas ajoutees aux exports, ne synchronisent pas l'historique entre machines et ne modifient jamais la progression de l'outil 3.

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

L'entree et la sortie peuvent etre differentes. Le moteur essaie un pre-parcours de croix completes reliees diagonalement jusqu'a la future case de sortie, puis un aller-retour orthogonal depuis cette case. Il rejette un pre-parcours qui ne rejoint pas la sortie ou qui deconnecte une partie des cases restantes. Pour chaque bloc, il prepare jusqu'a huit cases candidates de base, choisies d'apres les blocs voisins, les extremites et le parcours deja connu. Il conserve aussi les configurations du parcours initial et d'un ancien parcours compatible.

Les contacts diagonaux entre blocs et les cases alignees avec une case vide entre elles sont reperes explicitement. Toutes leurs cases de contact sont ajoutees aux candidats, sans la limite des huit cases de base. Chaque contact d'un bloc libre est teste avec une entree et une sortie sur cette meme case. Les combinaisons d'entrees/sorties distinctes sont toutes essayees pour les petits ensembles (jusqu'a 16 cases candidates); pour les grandes frontieres, elles sont echantillonnees avec des candidats de base proches et eloignes. Les directions, le prefixe verrouille, les coupes imposees et les trajets internes unitaires restent verifies pour chaque configuration.

Pour chaque ordre de blocs teste, une programmation dynamique choisit ensemble les entrees, sorties et sens parmi ces configurations. Elle tient compte du raccordement precedent et du suivant, avec les distances reelles entre trous, sans autoriser deux diagonales consecutives a utiliser le meme trou de transition. La recherche deplace, echange et inverse des sequences de blocs, avec des relances perturbees pour sortir des minima locaux. Jusqu'a sept blocs libres, tous les ordres sont testes dans la limite du delai sans amelioration.

Les voisinages prioritaires sont ensuite verifies entre les trous des entrees et sorties effectivement realisables, a une distance exactement egale a 1, sans coupe imposee a l'entree. Les petits parcours essaient ces voisins en premier dans l'enumeration; les grands essaient un ordre initial favorisant ces contacts et consacrent trois essais sur quatre a les rapprocher lorsqu'ils ne sont pas deja consecutifs. Les autres mouvements et relances restent disponibles. Cette priorite ne modifie jamais le score : un parcours localement seduisant est rejete si son resultat global est moins bon. Les grandes matrices internes sont stockees sous forme creuse, et les raccordements qui depassent le budget du cache sont calcules sans allocation quadratique supplementaire.

Une passe locale peut ensuite inserer un petit bloc orthogonal de 1 a 16 croix au milieu d'un bloc strictement plus grand. Le petit bloc doit etre complet et parcouru d'un seul tenant : tous ses demi-points sont deplaces ensemble, en conservant leur ordre et leurs contraintes de distance interne. Un bloc deja interrompu par d'autres parcours n'est pas deplace comme un tout. La passe essaie les emplacements proches des contacts diagonaux ou separes par une case vide, sans changer l'ordre des diagonales du bloc central ni broder deux fois la meme diagonale. Le score porte sur tout le parcours : nouveaux raccordements, liaison laissee a l'ancien emplacement, coupes et choix conjoint de tous les sens. Des matrices de transfert par segments permettent d'evaluer chaque insertion en temps logarithmique apres une preparation lineaire; le parcours complet n'est reconstruit que pour un gain potentiel. Les candidats sont tries par cout des raccordements, sans favoriser artificiellement les blocs les plus courts. Seules les baisses strictes du score sont acceptees. La passe recommence apres un gain, dans le meme delai global sans amelioration, puis la recherche des ordres de blocs continue. Les emplacements et la taille des blocs ne sont pas explores exhaustivement.

Le suivi existant affiche la phase d'insertion de petits blocs, le score global et les raccordements modifies. Un bloc peut desormais apparaitre en plusieurs morceaux dans le chemin. Un ancien parcours entrelace valide reste candidat lors d'une relance, meme s'il ne peut plus etre represente par une simple permutation des blocs. Un bloc dont une seule diagonale est deja verrouillee est entierement protege de ces deplacements; le point de depart et les coupes manuelles restent respectes.

La recherche combine aussi les deux operations avant de comparer au meilleur global. Plusieurs ordres intermediaires prometteurs recoivent leur propre descente par insertions, meme si leur score brut ne bat pas encore le meilleur parcours. La selection se compare au meilleur ordre de blocs brut, pas au score deja ameliore par entrelacement. Ces essais sont dedupliques et bornes : jusqu'a 256 insertions examinees et six deplacements acceptes par descente exploratoire. Sur les grands ensembles, les essais non ameliorants de l'ordre courant sont echantillonnes. Une insertion locale peut ameliorer un candidat encore moins bon que le meilleur global, mais celui-ci n'est ni affiche ni sauvegarde. Seul un gain global valide modifie le resultat visible et relance le delai sans amelioration.

Une petite reserve interne conserve de deux a six parcours distincts selon leur taille. Les relances peuvent repartir directement de ces parcours entrelaces, deplacer temporairement un petit bloc, puis ameliorer ce nouvel essai. La perturbation est limitee a un choix parmi 16 emplacements admissibles, apres au plus 128 examens, et reste soumise au delai global. Les ordres de premiere apparition des blocs alimentent egalement la recherche des permutations, sans remplacer le parcours entrelace conserve. La reserve n'est ni exportee ni enregistree dans le brouillon. Les calculs d'orientation, les coupes imposees et le prefixe verrouille sont verifies avant toute acceptation globale. Les insertions inutiles sont sautees quand le score atteint deja la borne minimale d'une unite par liaison au dos.

Le critere principal est le score reel, puis le nombre de coupes et la distance. Les retours dans les anciens ilots ne sont plus prioritaires. Seul un nouveau meilleur resultat relance le delai sans amelioration; une relance aleatoire ou un changement de bloc ne le remet pas a zero. Le suivi affiche la preparation des blocs, les essais, les relances, les ameliorations, le temps ecoule, le delai sans gain et le score total. Le meilleur parcours complet reste affiche pendant la recherche; l'export reste bloque si le parcours est incomplet.

L'interface conserve le score total, le score initial, le gain total et les coupes dans la colonne de gauche. Le volet Details, ferme par defaut, regroupe les distances, les diagonales, les essais, les relances, le temps ecoule et le bilan par couleur. Retours de zone n'est plus un indicateur affiche. Pendant la preparation, la barre compte les blocs construits puis prepares ; pendant la recherche, elle mesure uniquement le delai sans amelioration, en temps ecoule sur temps limite. Elle disparait a l'arret et ne represente jamais un pourcentage de qualite. Le bloc courant et son nombre de croix ne sont visibles que pendant leur construction. Les commandes de diagonale, sens, depart, verrouillage et coupes restent dans Edition manuelle, repliee par defaut ; le resume signale les reglages actifs sans les modifier. Le Dernier gain au-dessus de la grille est distinct du Gain total depuis le score initial. Les algorithmes, scores, sauvegardes et exports ne changent pas avec cette simplification.

Les raccordements ameliores sont mis en evidence en bleu, avec les anciens liens en gris pointille, jusqu'a la prochaine amelioration. La derniere surbrillance reste visible a l'arret du calcul; changer de couleur, modifier le chemin ou relancer la recherche l'efface. Une coupe modifiee conserve son trait rouge au centre de la surbrillance. Le gain depuis le dernier parcours affiche et la variation des coupes apparaissent au-dessus de la grille. Les diagonales et les trajets internes aux blocs sont plus epais; les liaisons entre blocs utilisent un trait fonce plus marque avec un contour clair. Les coupes restent fines, rouges et pointillees. Les apercus rapides sont regroupes toutes les 750 ms, sans pause dans le moteur de calcul; l'arret et la fin du calcul appliquent immediatement le dernier resultat. Une couche canvas separee conserve la surbrillance sans animation continue, sans deplacer la vue ni modifier les fichiers exportes.

La couleur selectionnee utilise une couleur de travail commune et reglable au-dessus de la grille, avec fond clair et diagonales contrastees. Ce choix est conserve localement dans le navigateur, sans modifier la palette DMC ni les fichiers exportes. Les anciennes zones orange ont ete supprimees : plus de couche canvas, de pulsation CSS, de calcul de regions d'essais ni de transport de ces regions depuis le worker. Les bornes de blocs necessaires a l'algorithme restent presentes. La courbe du meilleur score conserve au plus 240 echantillons de la recherche courante; elle n'est pas exportee. Le dernier gain bleu reste visible.

### Relais au plateau

Au plateau, le moteur global lance une recherche de relais avant de s'arreter. Les liaisons au dos de longueur superieure a la diagonale d'une case sont examinees par cout decroissant, coupes comprises. Un index spatial cherche jusqu'a 64 diagonales dont un trou passe a moins de 2,5 cases du segment. Pour chacune, le moteur teste le deplacement d'une seule diagonale entre les deux extremites, ainsi que son echange avec l'une des extremites. La case n'est jamais dupliquee : son ancien raccordement est repare et inclus dans le score.

Des matrices de segments reevaluent tous les sens pour chaque ordre candidat, avec les directions verrouillees. Le parcours complet n'est reconstruit que pour un gain potentiel ; precedences, trous de transition, coupes imposees et score global sont alors verifies. Seules les baisses strictes du score sont retenues. Apres un relais, la recherche habituelle reprend avec un nouveau delai sans amelioration, puis une nouvelle passe de relais commence au prochain plateau. Une passe sans gain termine le calcul. Chaque passe est bornee a 15 secondes au maximum (ou au delai choisi s'il est plus court, avec un minimum technique de 250 ms) ; elle peut donc s'arreter avant d'examiner tous les candidats. Le moteur reste heuristique, pas exhaustif.

Le suivi affiche `Recherche de relais`, le numero de passe et les liaisons examinees. Les raccordements modifies et les diagonales relais retenues restent en bleu jusqu'au prochain gain, sans deplacer la vue. `Details` indique le nombre de relais retenus. Arreter conserve le meilleur parcours complet, y compris pendant cette passe.

`Derniere liaison amelioree` affiche le rang et le total de la liste au moment du dernier relais accepte (par exemple `45 / 76`), avec la longueur du raccordement avant ce gain. Le rang suit le cout decroissant, coupes comprises ; l'infobulle precise la passe. Cette valeur reste fixe pendant les recherches et passes suivantes, meme si leur liste change, jusqu'au prochain relais accepte. Elle reste visible a l'arret mais est reinitialisee au lancement d'une nouvelle recherche. Ce suivi n'est pas ajoute aux sauvegardes ni aux exports.

### Examiner un parcours

La grille de l'outil 2 utilise maintenant un canvas limite a la taille de sa fenetre, independamment du zoom. La molette et les boutons loupe changent l'echelle ; le trou sous le curseur reste fixe tant que les limites de la grille le permettent. La main permet de deplacer la vue, y compris pendant le calcul et en mode Avant. Le bouton de cadrage revient a la vue complete. Le bouton cible cadre explicitement les derniers raccordements ameliores ; aucun gain ne deplace automatiquement la vue. Les regles restent visibles en haut et a gauche, et leur espacement s'adapte quand la grille devient trop petite.

La miniature montre le pattern et le rectangle de la portion visible ; cliquer dessus recentre la vue sans changer son zoom. Le survol d'un raccordement affiche son numero, sa longueur reelle entre trous, ses coordonnees et son statut de coupe. Le crayon conserve le trace manuel par glisser, avec les memes coordonnees et le meme historique meme apres zoom et deplacement. Le bouton central de la souris ou Alt + glisser permet aussi de deplacer la vue. En mode main, deux doigts permettent le zoom tactile. Lorsque le canvas a le focus, les fleches deplacent la vue, +/- changent le zoom et Home revient a la vue complete.

Avant / Apres compare le parcours complet present au debut de la derniere recherche pour cette couleur avec le meilleur parcours courant. Si aucun parcours complet n'existait, Avant est capture des que le moteur fournit sa premiere solution complete. Le cadrage est strictement commun aux deux vues ; les nouvelles ameliorations ne changent pas le dessin Avant. Cette vue est en lecture seule pour le trace et les contraintes. Le score affiche avec la comparaison est celui de cette reference, distinct du score initial historique de la colonne gauche. Les references de comparaison restent en memoire pour la session, par couleur : elles ne sont pas exportees, n'alourdissent pas la sauvegarde et disparaissent au rechargement, au changement de projet ou apres une edition/annulation. Une nouvelle recherche remplace la reference de sa couleur.

Les icones sont distribuees localement depuis Lucide (`assets/icons/`, licences ISC et MIT incluses) ; ces commandes fonctionnent aussi depuis `file://`, sans acces reseau.

Le debut verrouille reste inchange. Une seule croix ouverte en fin de prefixe peut servir de racine du parcours; les autres configurations de prefixe sont conservees et les diagonales restantes sont raccordees sans enfreindre les contraintes. Les distances de 1 sont garanties dans les portions de blocs nouvellement construites et non modifiees, pas dans les raccordements d'insertion, les liaisons entre blocs ni dans un prefixe impose. Les fichiers et la progression de l'outil 3 ne sont jamais modifies par la generation.

Le choix de l'ordre et des configurations candidates reste heuristique : il ne garantit pas l'optimum global. La programmation dynamique est exacte pour un ordre donne, parmi les configurations preparees. Le moteur global est `src/block-optimizer-worker.js`, qui reutilise la construction unitaire de `src/orthogonal-path-worker.js`. Les anciens moteurs par cases et par zones, la recherche rectangulaire et leurs commandes ont ete retires. Les formats d'import/export restent inchanges.

Les anciens chemins sont convertis sans changer l'ordre des cases, avec les deux diagonales de chaque ancienne case consecutives. Les sauvegardes completes passent en version 2; l'etat compact synchronise passe en version 3. `stitchedByDmc` compte alors des diagonales, jamais des croix. A la migration, chaque ancienne croix brodee devient deux diagonales brodees : la meme case reste terminee, la prochaine case reste la meme, et les compteurs d'annulation sont convertis aussi. Les croix terminees et commencees sont comptees separement dans l'interface.

Avant de remplacer un ancien etat local IndexedDB, sa copie est gardee sous `migration-backup:<ancien patternId>` dans la meme base; l'ancien pattern immuable reste present. Les donnees legacy de localStorage sont copiees avant suppression. Les fichiers de sauvegarde du depot ne sont pas reecrits par cette mise a jour. La prochaine synchronisation explicite (ou automatique si activee) stockera un nouveau pattern immuable et la nouvelle progression, avec la protection habituelle contre les conflits. Mettre a jour la page sur chaque PC avant d'utiliser les nouveaux fichiers.

## Verification

```powershell
node tests/path-optimizer.test.js
node tests/orthogonal-path.test.js
node tests/block-optimizer.test.js
node tests/path-visuals.test.js
node --test tests/path-viewport.test.js
node tests/github-sync.test.js
node tests/upgrades.test.js
node tests/stitch-model.test.js
node tests/path-zones.test.js
node tests/path-orientation.test.js
node tests/spatial-candidates.test.js
node --test tests/relay-search.test.js
node tests/planner-relay.test.js
node tests/workflows.test.js
node --test tests/path-edit-history.test.js
node tests/planner-safety.test.js
node tests/planner-inspection.test.js
node tests/session-view.test.js
```

Les tests navigateur necessitent Playwright et utilisent Edge en mode headless par defaut (`BROWSER_CHANNEL` permet de choisir un autre canal). Ils travaillent dans des navigateurs isoles et simulent GitHub, sans modifier la vraie sauvegarde. Les captures sont placees dans `exports/verification/`. `REAL_PATTERN_TEST=1` ajoute l'import, la reprise et l'optimisation sur le gros fichier inclus au depot. `orthogonal-path.test.js` verifie les distances unitaires, toutes les petites formes connexes d'une grille 3 x 3, les entrees/sorties distinctes, les contraintes et les grands groupes. `block-optimizer.test.js` verifie le choix conjoint des configurations, les contraintes, le delai global et la conservation du meilleur resultat. Les couts de raccordement sont conserves dans un cache borne, sans matrice de distances entre toutes les diagonales.

Les verifications utiles des anciens moteurs ciblent maintenant le moteur actif : `path-optimizer.test.js` execute la source exacte du worker navigateur, `path-orientation.test.js` compare les sens du fil et couvre les gains masques par des orientations fixes, et `spatial-candidates.test.js` controle l'index spatial de la construction orthogonale. Les tests des anciens delais par zone ont ete retires ; les tests du delai global, de son redemarrage uniquement apres un vrai gain et de l'arret restent dans `block-optimizer.test.js` et les tests navigateur. Les migrations, les contraintes legacy, les conflits de synchronisation et l'integrite de la vraie sauvegarde restent testes. Cette suite fonctionnelle est distincte du benchmark de qualite ci-dessous.

### Comparaison de qualite

`node tests/path-quality-benchmark.js` compare le moteur courant a celui du commit `ffe7428` (priorite 2), charge depuis Git sans modifier les fichiers. Six fixtures fixes et les graines 31, 73 et 101 sont utilisees. L'horloge injectee compte ses appels : ce budget logique rend les parcours et scores reproductibles, mais ne represente ni des millisecondes reelles ni une quantite identique de travail CPU. Le temps reel, preparation comprise, est mesure separement. Le rapport JSON est genere dans `exports/verification/path-quality.json`.

Mesure du 18 novembre 2026, graine 31, budget logique propre a chaque fixture :

| Cas | Score avant | Score apres | Coupes avant/apres | Temps reel avant/apres |
| --- | ---: | ---: | ---: | ---: |
| Ordre intermediaire, 14 croix | 33,657 | 32,472 | 0 / 0 | 5,1 / 6,6 ms |
| Combinaison et coupes, 13 croix, seuil 3 | 61,819 | 49,389 | 3 / 2 | 4,6 / 11,9 ms |
| Relances entrelacees, 23 croix | 60,612 | 59,848 | 0 / 0 | 15,8 / 29,1 ms |
| Passerelle deja optimale, 12 croix | 23 | 23 | 0 / 0 | 0,8 / 0,8 ms |
| Petits blocs, 30 croix | 59 | 59 | 0 / 0 | 2,4 / 2,2 ms |
| Grands ilots, 3259 croix | 6893,754 | 6893,754 | 6 / 6 | 1177,2 / 1159 ms |

Les graines 73 et 101 ne donnent pas de gain sur la fixture de relances avec ce court budget logique. Les trois premieres fixtures ciblent des faiblesses connues, les autres sont des controles : ce tableau ne garantit pas un gain sur tous les patterns. Les temps varient selon la machine et l'echauffement du moteur JavaScript.

Pour un delai d'inactivite reel, lancer `$env:BENCHMARK_WALL_MS="500"; node tests/path-quality-benchmark.js` dans PowerShell. Cette variante n'est pas deterministe et produit `path-quality-wall.json`. Lors de la verification, le cas des coupes reste a 49,389 contre 61,819, et les relances atteignent 57,868 contre 60,612 pour les trois graines. Le nouveau moteur peut durer plus longtemps parce qu'un vrai gain relance le delai ; ce n'est pas une limite de temps total. La validite, les liaisons unitaires et le score recalcule sont verifies pour chaque resultat, separement des tests fonctionnels.

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
