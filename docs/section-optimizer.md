# Moteur 4 : retouches locales

M4 ameliore le meilleur chemin existant sans reconstruire toute la couleur.
Il conserve sa place dans le cycle automatique, apres M3 et avant M5, et reste
disponible seul. Les formats, la progression et les fichiers de sauvegarde ne
changent pas. Sa cle interne `sections` et le message worker `point-sections`
restent stables pour la reprise des lots, l'annulation et le suivi des gains.

## Principe

Les raccordements dont le cout reel depasse 1 sont classes du plus couteux au
moins couteux, coupes comprises. Autour de chacun, M4 examine des portions
consecutives de 16, 32, 64 et 128 diagonales, sans entrer dans le prefixe
verrouille. Une portion peut contenir des croix entieres et des demi-croix dont
l'autre diagonale se trouve ailleurs dans le parcours.

Les cases de la portion sont ordonnees par leur premiere apparition, puis cet
ordre est aussi essaye a l'envers. Les suites orthogonales consecutives forment
les sous-sections locales. Pour chacune, le constructeur propose des croix
consecutives, des demi-croix avec retour et plusieurs entrees/sorties. Les
diagonales absentes de la portion sont retirees avant evaluation : aucune
demi-croix exterieure ne peut etre ajoutee, supprimee ou deplacee.

Pour chaque ordre interne, une programmation dynamique optimise les sens en
conservant toutes les orientations d'extremites realisables. Une seconde choisit
conjointement les variantes des sous-sections. Elle inclut le raccordement depuis
l'action precedente et vers la suivante, avec leurs directions et leurs coupes
exactement fixes. Le choix est exact parmi les variantes produites, pas parmi
tous les parcours possibles.

Le cout compare comprend les distances entre trous, les deplacements apres
coupe et la penalite de trois fois le seuil par coupe. Les distances nulles
restent interdites, meme avec coupe. Les drapeaux `cutBefore`, le depart impose
et le prefixe verrouille sont conserves. Les demi-croix inferieures precedent
toujours les superieures, y compris quand une croix traverse une frontiere de
portion.

## Acceptation et passes

Une portion n'est proposee que si son cout, raccordements compris, baisse.
Avant acceptation, le parcours complet est reconstruit, valide puis mesure.
Seul un gain global strict superieur a `1e-8` remplace le meilleur chemin. Les
autres actions restent identiques pendant cette retouche. Les candidats
incomplets, invalides, egaux ou moins bons ne sont jamais publies.

Chaque passe reexamine le meilleur chemin courant. Les raccordements sont
reclasses entre les passes ; les portions sont successivement centrees puis
decalees vers un tiers et deux tiers de leur longueur. Les passes suivantes
elargissent les variantes d'entree/sortie. Une passe finale globale sur les sens,
commune au fonctionnement precedent, peut encore ameliorer les directions sans
changer l'ordre des diagonales ni les contraintes.

Le delai commun sans amelioration commence apres la validation, la construction
d'un premier chemin si necessaire et le classement initial des raccordements.
Les retouches suivantes font partie du calcul chronometre. Seule une amelioration
globale relance le delai, y compris une amelioration de la passe finale sur les
sens. La borne minimale, un parcours entierement verrouille ou l'absence de
raccordement editable permettent un arret anticipe. L'API conserve aussi
`totalLimitMs`, preparation comprise, pour les tests et benchmarks.

## Suivi et protection

Le worker transmet toutes les 250 ms environ la liaison courante, la taille de
la portion, les portions analysees, les variantes et les raccordements testes.
Les gains publies utilisent la courbe M4, les surbrillances, le suivi automatique
du zoom, l'annulation et la restauration du meilleur chemin existants. Aucun
rectangle de zone ni deplacement de vue supplementaire n'est ajoute.

Arreter conserve le dernier meilleur chemin publie. Le cycle automatique et
les brouillons existants reprennent M4 depuis ce meilleur chemin. Les anciennes
mesures M4 restent conservees ; le remplacement n'efface pas leur historique.
Aucun fichier de progression n'est lu ou ecrit par le moteur.

## Pourquoi remplacer l'ancien M4

L'ancien moteur reprojetait toute la couleur en cases, puis terminait chaque
sous-section avant de passer a la suivante. Il pouvait perdre les entrelacements
utiles du chemin courant. Sur le fichier `42905.json`, DMC 3810 (20 801 croix),
un essai de 60 secondes a acheve 38 reconstructions : la meilleure valait
46 282,52, contre 42 905,82 pour le chemin conserve. Le moteur calculait bien,
mais son espace de solutions etait trop restrictif sur ce parcours.

Le remplacement local atteint 42 902,57 en 60 secondes sur le meme fichier,
soit un gain de 3,25. Ce resultat ponctuel ne prouve pas une superiorite generale
ni l'optimalite du resultat. Le fichier source et la progression restent intacts.

## Verification

- `node --test tests/section-optimizer.test.js tests/optimizer-setup.test.js` :
  raccordements fixes, comparaison exhaustive de la programmation dynamique,
  demi-croix ouvertes, coupes, prefixe, gains globaux, delais et immutabilite.
- `node tests/planner-sections.test.js` : vrai worker, suivi et courbe,
  arret, annulation, restauration du meilleur, rechargement et vues PC/mobile.
- `BENCHMARK_ENGINES=sections` avec `tests/points-quality-benchmark.js` :
  mesure sur fichiers reels sans modifier les patterns ni la progression.
