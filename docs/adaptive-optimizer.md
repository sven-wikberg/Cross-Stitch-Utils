# Moteur 5 : recherche adaptative

Ce moteur reste independant du mode blocs et du mode approfondi existants. Il
reutilise leur modele de couture et leurs primitives verifiees, mais recherche
directement un ordre de diagonales : les blocs ne sont pas des contraintes
permanentes. Il ne change aucun format de pattern, chemin ou progression.
Il se lance seul ou comme cinquieme phase du [cycle automatique commun](../README.md#cycle-automatique),
apres le moteur 4 (sous-sections) et avant le moteur 6 (LNS). L'interface distingue
trois categories : les six moteurs, les deux boucles et la recherche LNS
approfondie de 1 heure (moteur 6) ; seule cette derniere est exclue du cycle automatique.

## Les six etapes

1. **Constructions initiales.** Le chemin charge est toujours candidat. Quatre
   constructions utilisent les composantes strictement orthogonales, avec des
   ordres et des entrees differents. Une courte recherche du moteur blocs fournit
   un candidat supplementaire (duree indicative de 10 % du delai d'inactivite
   choisi, plafonnee a 5 secondes ; en mode API a budget fixe, cette part est
   calculee sur le budget total). Sa preparation peut depasser cette part et
   reste soumise a l'echeance de recherche courante. Ces departs sont compares
   avec le meme score ; seul le meilleur est publie.
2. **Sens optimises conjointement.** Chaque ordre evalue prend en compte les deux
   sens de toutes les diagonales, y compris celles hors du voisinage modifie.
   Des matrices de transfert 2 x 2 representent les fragments inchanges. Une
   programmation dynamique reconstruit les sens du candidat complet. Une derniere
   passe globale est toujours effectuee a la fin.
3. **Destruction et reinsertion libre.** Entre 6 et 40 diagonales sont retirees
   autour de liaisons couteuses, dans un voisinage spatial, dans un fragment du
   chemin ou par dispersion. Elles peuvent revenir ailleurs que dans leurs
   anciens emplacements. Les insertions examinent les voisins proches, les
   limites autorisees par les precedences et quelques positions aleatoires.
   Une reparation gloutonne ou regret-2 choisit les insertions. Les emplacements
   candidats restent bornes, ils ne sont pas examines exhaustivement.
4. **Choix adaptatif des operateurs.** Les quatre destructions et trois
   reparations ont des poids actualises selon les gains et le temps depense.
   Un poids plancher maintient l'exploration. L'algorithme n'attend pas un plateau
   de plusieurs secondes avant de changer de voisinage.
5. **Reparation exacte locale.** Une programmation dynamique par sous-ensembles
   trouve le meilleur ordre et les meilleurs sens dans une fenetre d'au plus
   12 diagonales. L'ordre exterieur reste fixe, mais ses sens sont libres. Les
   precedences et raccordements avec l'exterieur sont inclus dans le calcul.
   La reparation n'est dite exacte que si elle finit; une interruption ne publie
   rien. Cette exactitude locale ne prouve pas l'optimalite du pattern entier.
6. **Diversification protegee.** Un recuit simule peut accepter un parcours de
   travail moins bon. Une petite reserve de meilleurs chemins sert aux relances.
   Le parcours visible et sauvegarde est distinct : il ne change que pour une
   baisse stricte du score global, apres validation complete.

## Regles et objectif

- Chaque diagonale apparait une seule fois; `/` precede `\` pour chaque croix.
- Le trou de sortie ne peut pas etre celui d'entree suivant, meme avec une coupe.
- Le depart, le prefixe verrouille et les coupes imposees restent respectes.
- Score = somme des distances euclidiennes entre trous, y compris apres une
  coupe, plus `3 * seuil` par coupe. Les decimales ne sont pas arrondies pendant
  les calculs. Une coupe automatique intervient si la distance depasse le seuil.
- Dans l'interface, le selecteur commun aux moteurs 1 a 6, `Arret sans amelioration`,
  propose 10 secondes, 30 secondes, 1 minute par defaut, 2 minutes,
  5 minutes ou 10 minutes. Seul un gain strict du meilleur score global reel,
  superieur a `1e-8`, relance ce delai ; ni une diversification ni un gain local
  sur un parcours moins bon ne le remettent a zero. Il n'y a pas de plafond de
  temps total. Arreter conserve le dernier meilleur parcours recu par l'interface.

L'interface transmet `stopAfterInactivity: true` et `stagnationLimitMs`, sans
`totalLimitMs`. L'API conserve le mode a budget total `totalLimitMs` lorsque
`stopAfterInactivity` est absent ou faux, notamment pour les tests et benchmarks.
Ce budget inclut la preparation ; des operations indivisibles et l'orientation
finale peuvent le depasser legerement. Les mesures historiques ci-dessous
utilisent ce mode a budget fixe, pas le delai d'inactivite de l'interface.

Pour N croix, `2N - 1` est une borne inferieure : chaque transition valide entre
trous distincts de la grille mesure au moins une unite. Atteindre cette borne
certifie l'optimalite pour ce modele. Pour des ilots eloignes ou des contraintes
imposees, elle peut etre tres optimiste. L'ecart affiche n'est donc pas une
estimation du gain encore disponible, ni un pourcentage de qualite garanti.

## Verification

- `node --test tests/adaptive-optimizer.test.js` : oracle exhaustif sur petites
  fenetres, sens et frontieres libres, insertions hors emplacement, contraintes,
  interruption, conservation du meilleur, borne unitaire et 2 000 croix.
- `node tests/planner-adaptive.test.js` (Playwright) : vrai Web Worker, selecteur
  d'inactivite commun, absence de budget total dans la requete de l'interface,
  suivi visuel, arret, annuler/retablir, conservation du meilleur, rechargement,
  ecrans PC et mobile. Le profil navigateur est isole.
- `node tests/adaptive-quality-benchmark.js` : comparaison blocs / approfondi /
  adaptatif, meme chemin initial et meme budget mural. `BENCHMARK_MS` regle le
  budget par moteur; `BENCHMARK_SEEDS` les graines. `BENCHMARK_LARGE=1` ajoute
  une couleur de 3 809 croix du pattern local en lecture seule;
  `BENCHMARK_ONLY_LARGE=1` ne teste que celle-ci. Resultats dans
  `exports/verification/`, jamais dans les sauvegardes.

Les resultats dependent du motif, de la machine, du budget et du hasard. Un
nouveau moteur n'est pas garanti meilleur que les autres pour chaque cas. Une
heure disponible permet d'explorer plus, pas de certifier l'optimum general.

Verification du 20 novembre 2026 sur cette machine : sur 3 809 croix avec
10 secondes par moteur, le moteur adaptatif atteint 9 379,95 et 9 396,05 pour
deux graines, contre 9 381,84 et 9 371,48 pour le moteur approfondi. Le gagnant
varie donc selon l'essai. Un test de charge d'une minute sur 20 801 croix passe
de 49 830,33 a 48 853,36, avec 169 reconstructions et 16 gains publies, en
60,18 secondes. Les parcours ont tous ete revalides et aucune sauvegarde n'a
ete reecrite. Il ne s'agit pas d'un benchmark d'une heure.

## Fondements

- Biedl, Horton, Lopez-Ortiz, [Cross-Stitching Using Little Thread](https://cs.uwaterloo.ca/~alopez-o/files/CULT_2005.pdf) : difficulte du probleme general et constructions optimales pour les regions orthogonales.
- Caruso et Caruso, [Combinatoire du point de croix](https://arxiv.org/abs/1001.4268) : distinction entre connexite orthogonale et diagonale.
- Pisinger et Ropke, [A general heuristic for vehicle routing problems](https://doi.org/10.1016/j.cor.2005.09.012) : recherche adaptative a grands voisinages. L'application aux diagonales et les operateurs presentes ici sont une adaptation au projet, pas un resultat de performance garanti par cet article.
