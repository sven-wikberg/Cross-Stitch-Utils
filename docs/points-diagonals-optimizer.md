# Moteur 3 : points puis diagonales

Le moteur 3 garde les modes blocs, approfondi et adaptatif. Il reprend le coeur
de l'optimiseur par cases du commit `078f36f`, anterieur au modele a diagonales,
dans `src/point-order-search.js`. Le nouveau worker, les compteurs et la
conversion sont dans `src/points-diagonals-worker.js`. Aucune sauvegarde ni
aucun format d'export ne change.

## Recherche par cases

Le moteur genere plusieurs ordres de cases : chemin existant projete sur les
cases, serpents, ordre de Morton, composantes connexes et plus proche voisin
depuis plusieurs points de depart. Il les ameliore par 2-opt, deplacements de
chaines de 1 a 3 cases, changements d'extremites, raccordements des chaines
separees par des coupes et relances perturbees. Les distances sont calculees a
la demande, sans matrice quadratique globale.

La distance entre centres des cases guide cette premiere recherche. Une coupe
y ajoute trois fois le seuil a la distance (l'ancien moteur ne comptait pas la
distance apres coupe). Ce score de travail n'est jamais le score affiche,
exporte, ni le critere de remplacement du meilleur parcours de fil.

## Conversion en fil

Des ordres sont regulierement convertis en parcours complets de diagonales.
La conversion essaie trois constructions : croix consecutives, demi-croix avec
retours selon les contacts orthogonaux/diagonaux, puis recherche en faisceau.
Cette derniere conserve jusqu'a huit etats a chaque diagonale. Chaque etat
choisit d'ouvrir la prochaine croix ou de terminer la derniere croix encore
ouverte, et teste les deux sens. Une pile persistante permet des retours longs
sans copier tout le chemin a chaque essai.

L'ordre d'ouverture suit l'ordre des cases; les fermetures du faisceau suivent
une pile, pas toutes les permutations possibles. C'est une conversion
heuristique, pas une preuve d'optimalite. Le prefixe verrouille, meme avec
plusieurs croix ouvertes, reste exactement en place. Chaque construction
complete recoit ensuite une optimisation globale des sens.

Les conversions sont echantillonnees pour laisser du temps a la recherche par
cases. Les doublons recents sont evites. Les compteurs distinguent les ordres
proposes, les ordres effectivement convertis et les parcours de fil testes.

## Affinement et protections

Environ 65 % du budget total est reserve a la recherche par cases et aux
conversions intermediaires; le reste sert aux diagonales. La derniere conversion
peut empieter legerement sur la seconde partie, sans depasser le budget total
hors operations finales indivisibles.

L'affinement repart du meilleur parcours reel disponible, pas obligatoirement
d'une nouvelle conversion : reinsertions libres et reparations exactes de
petites fenetres. Ces operations peuvent casser la
structure en pile de la conversion. Une derniere passe globale sur les sens
est toujours faite avant de terminer.

La recherche geometrique de relais est maintenant separee de ce moteur et se
lance avec le bouton `Optimiser tous les relais`, sur le meilleur chemin obtenu.

Chaque candidat doit respecter les regles communes : `/` avant `\`, aucune
diagonale dupliquee/manquante, aucun trou de sortie identique au trou d'entree
suivant, depart/prefixe verrouilles et coupes imposees preserves. Le score reel
est exactement celui des autres moteurs : distances euclidiennes entre trous,
y compris apres coupe, plus trois fois le seuil par coupe. Seule une baisse
stricte de ce score remplace le meilleur resultat. Un chemin deja meilleur
reste donc intact, meme si la recherche par points prefere un autre ordre.

## Interface et verification

Le bouton `Moteur 3 : points puis diagonales` utilise le selecteur commun
`Budget moteurs 2, 3 et 4` : 1 minute, 10 minutes ou 1 heure. Ce budget est total,
preparation comprise, et non un delai sans amelioration. Le moteur est dans un
Web Worker. Le score reel, le temps restant, les phases, les compteurs et les
raccordements ameliores restent visibles. Arreter, annuler/retablir, restaurer
le meilleur chemin et la comparaison avant/apres gardent leur fonctionnement.
La file automatique des couleurs continue d'utiliser le mode blocs.

Tests :

- `node --test tests/points-diagonals.test.js` : comparaison du faisceau a un
  oracle exhaustif sur petits cas, longues demi-croix ouvertes, prefixes,
  coupes, budgets, permutations et score reel monotone.
- `node tests/planner-points.test.js` (Playwright) : vrai worker, budget,
  suivi visuel PC/mobile, arret, meilleur chemin, annuler/retablir et reprise.
- `node tests/points-quality-benchmark.js` : comparaison des moteurs 2 et 3
  a budget et fichier initial identiques. Les variables `BENCHMARK_MS`,
  `BENCHMARK_SEEDS`, `BENCHMARK_ENGINES`, `BENCHMARK_LARGE`, `BENCHMARK_COLOR`
  reglent les essais. `BENCHMARK_PATTERN_REF` permet de lire un fichier via
  `git show` sans toucher aux sauvegardes locales. Rapports generes dans
  `exports/verification/`, jamais dans `data/`.

Essais d'une minute le 21 novembre 2026 sur 20 801 croix : depuis l'ancien
parcours a 49 830,33, un essai atteint 46 938,88; depuis le meilleur fichier
enregistre a 43 696,03, un autre atteint 43 687,47. Le second essai confirme
la conservation et l'affinement de l'incumbent, pas la capacite de reconstruire
ce parcours depuis zero. Les gains varient avec le budget, le motif et le
hasard. Aucun essai complet d'une heure n'a ete effectue lors de l'ajout.
