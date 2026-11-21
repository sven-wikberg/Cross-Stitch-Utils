# Moteur 4 : parcours par sous-sections

Ce moteur reste independant des moteurs existants. Il reutilise la recherche
par cases de `src/point-order-search.js`, puis traduit ses ordres en parcours
de fil dans `src/section-optimizer-worker.js`. Les formats, les sauvegardes et
la file classique des couleurs ne changent pas.

## Decoupage

Une sous-section est une suite consecutive du chemin par points dont chaque
pas est orthogonal et adjacent. Un saut ou une liaison diagonale commence une
autre sous-section. Les sous-sections ne sont donc pas des composantes
geographiques : une meme composante du dessin peut etre visitee en plusieurs
morceaux, dans l'ordre du parcours par cases.

Les croix deja terminees dans le prefixe verrouille sont exclues. Une croix
partiellement brodee devient une sous-section d'une seule diagonale superieure.
Le prefixe conserve exactement ses diagonales, directions et coupes.

## Traversees et raccordements

Chaque sous-section propose des croix consecutives, des demi-croix avec retour
et plusieurs traversees du constructeur orthogonal existant. Les entrees et
sorties candidates incluent les extremites du parcours par cases, des cases
proches des sous-sections voisines et des points echantillonnes au fil des
passes. On en conserve au plus trois de chaque cote au debut, puis quatre.
Une paire que le constructeur ne sait pas realiser est ignoree, jamais supposee
resolue. Les parcours orthogonaux marques unitaires doivent effectivement
avoir une distance de 1 entre trous pour chaque liaison interne.

Pour chaque ordre interne, les deux sens de chaque diagonale sont optimises
avec toutes les combinaisons possibles de sens d'entree et de sortie. Deux
variantes aux memes diagonales et sens d'extremites sont interchangeables pour
la suite : seule celle dont le cout interne est le plus bas est conservee.
Les directions sont stockees dans des tableaux compacts, sans recopier toutes
les diagonales pour chaque variante.

Une programmation dynamique choisit ensuite une variante par sous-section,
dans l'ordre impose, en comptant les couts internes, le raccordement depuis le
prefixe et toutes les liaisons suivantes. Le choix est exact parmi les variantes
generees, pas parmi tous les parcours possibles. Les transitions de longueur
nulle sont interdites, meme avec coupe. Le score reste celui des autres moteurs :
distance euclidienne entre trous, distance apres coupe comprise, plus trois fois
le seuil par coupe.

## Budget et affinement

Le budget total (1 minute, 10 minutes ou 1 heure) inclut la preparation. Environ
65 % sert a la recherche par cases avec conversions intermediaires cadencees.
Les quatre ordres convertis les plus prometteurs selon leur score reel sont
gardes pour l'affinement : nouvelles entrees/sorties et essais de coupures au
milieu de sous-sections. Une coupure de sous-section est un changement de
decoupage de calcul, pas une coupe de fil imposee. Une frontiere supplementaire
ne rejoint la base de travail que si le score de cet ordre s'ameliore.

L'ordre des sous-sections reste fixe pour chaque ordre de cases essaye. Il n'y
a pas de phase de permutations libres des diagonales dans ce moteur. Une passe
globale finale optimise encore leurs sens. La qualite du parcours par points
reste un guide, jamais un critere pour remplacer un meilleur parcours de fil.

Chaque conversion est bornee et abandonnee si elle ne peut pas etre achevee
dans son budget. Seuls les parcours complets, valides et strictement meilleurs
que le meilleur score reel sont publies. Un meilleur parcours preexistant reste
intact, meme s'il ne correspond pas au decoupage du moteur 4.

## Suivi et tests

Le Web Worker publie la phase, la sous-section en cours, le nombre de variantes
et de raccordements testes, le score total et le temps restant. Les surbrillances,
le suivi automatique, la comparaison, l'annulation et la restauration du meilleur
chemin utilisent le fonctionnement commun de l'outil 2.

- `node --test tests/section-optimizer.test.js` : decoupage, borne unitaire,
  comparaison exhaustive des combinaisons, prefixes ouverts, coupes, delais,
  absence de regression et immutabilite des donnees d'entree.
- `node tests/planner-sections.test.js` : vrai worker, feedback, arret,
  recuperation du meilleur chemin, persistance isolee et affichage PC/mobile.
- `BENCHMARK_ENGINES=sections` avec `tests/points-quality-benchmark.js` :
  comparaison a budget egal, sans modifier les fichiers dans `data/`.

## Mesures initiales

Essais d'une minute le 21 novembre 2026, DMC 3810 de Marine Cryptids,
20 801 croix, graine 31 : depuis le parcours a 49 830,33, le moteur atteint
45 269,53 (31 conversions completes, 4 ameliorations publiees, environ 60,15 s).
Depuis le parcours deja optimise a 43 696,03, un autre essai conserve ce score
sans amelioration. Les fichiers source et la progression restent inchanges.
Ces essais ne prouvent pas une superiorite generale; aucun calcul d'une heure
n'a ete effectue pour cette premiere validation.
