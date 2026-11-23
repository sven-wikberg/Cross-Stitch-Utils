# Boucle 1 : reinsertion de chaines

Anciennement nommee moteur 6, cette boucle reprend le meilleur parcours complet
compatible de la couleur. Elle deplace une suite de diagonales ailleurs dans
l'ordre du parcours, sans changer son ordre interne. Contrairement au moteur 5,
la chaine n'a pas a prendre la place d'un autre segment selectionne.
L'interface distingue les moteurs 1 a 5,
les boucles 1 (chaines) et 2 (relais), et la recherche LNS approfondie de 1 heure.
Cette derniere reste separee et n'est jamais automatisee.

## Voisinages explores

- Les raccordements de cout superieur a 1 sont classes par cout decroissant,
  coupes comprises. Les petits deplacements de longueur racine de deux sont
  examines aussi, pas seulement les grands sauts.
- Autour de chaque raccordement, les tailles 2, 4, 8, 16, 32, 64, 128, 256,
  512 et 1024 sont essayees avant et apres la liaison.
- S'ajoutent les suites unitaires entieres, les portions jusqu'a la prochaine
  coupe ou a la fin (jusqu'a 4096 diagonales), et les petites portions fermees
  qui contiennent les deux diagonales de toutes leurs croix (limite 4096).
  Une suite unitaire peut ne contenir qu'une diagonale.
- Les destinations comprennent les positions proches du debut ou de la fin
  de la chaine, les limites legales imposees par les demi-croix, les coupes,
  le debut de la partie modifiable et la fin du parcours.

Les voisins geometriques sont cherches dans les bins de 8 cases autour des
extremites (deux bins dans chaque direction). Les voisins impossibles sont
elimines avant de retenir les 128 diagonales les plus proches. Les positions
avant et apres ces diagonales sont candidates ; les limites legales et les
coupes ne consomment pas ce quota. Cette selection reste heuristique.

## Evaluation et contraintes

Les bornes de reinsertion sont calculees avec les diagonales correspondantes
situees hors de la chaine. Le prefixe verrouille ne bouge pas. Les matrices de
transfert du moteur 5 evaluent le score global, en optimisant conjointement
les sens dans la chaine, le trou laisse a son ancien emplacement et le reste
du parcours. Le moteur ne lance pas la recherche du moteur 5 : il reutilise
seulement son contexte et ses fonctions de calcul.

Le meilleur emplacement teste est retenu pour chaque chaine. Un gain strict
est ensuite materialise et valide sur le parcours complet avant publication.
On accepte le premier gain trouve entre les chaines, pas necessairement le
meilleur de tous les voisinages du pattern.

Apres un petit gain, les raccordements de rang voisin sont prioritaires pour
exploiter les situations repetitives. Un gain superieur a 5 relance le parcours
par les raccordements les plus couteux. Les index sont toujours reconstruits
apres un deplacement ; aucun ancien indice n'est reutilise sur un nouveau chemin.

La diagonale inferieure reste avant la superieure, les transitions entre le
meme trou restent interdites meme avec coupe, les sens verrouilles et les
coupes imposees sont preserves. Le score inclut la distance euclidienne au dos
et apres coupe, plus trois fois le seuil par coupe. Les decimales sont conservees.

## Stabilite et suivi

Le bouton `Boucle 1 : reinsertion de chaines` necessite un parcours complet.
L'interface transmet `untilStable: true`, sans `totalLimitMs` : aucun minuteur
fixe ni delai d'inactivite n'arrete la recherche. Le selecteur commun aux moteurs
1 a 5 ne limite donc pas cette boucle. Les balayages se repetent jusqu'a un tour
complet sans gain strict du score global reel (epsilon `1e-8`) dans les voisinages
examines ; une orientation qui apporte encore un gain relance la recherche.
Un arret pendant l'examen des positions abandonne le meilleur candidat
provisoire de cette chaine. La derniere orientation globale est toujours faite
a la fin normale du calcul.

L'API accepte encore `totalLimitMs` lorsque `untilStable` est absent ou faux,
pour les tests et benchmarks a budget fixe. Une fin anticipee sans gain reste
possible dans ce mode ; l'orientation finale peut depasser le budget de recherche.
Les mesures historiques ci-dessous, dont l'essai plafonne a deux minutes,
conservent leurs conditions d'origine et ne decrivent pas un minuteur de l'interface.

Le suivi affiche le raccordement courant, la taille de la chaine, les positions
testees et le nombre de chaines ameliorees. Le rang se rapporte au parcours
courant : ce n'est pas un indicateur de proximite avec l'optimum. Les gains,
surbrillances persistantes, courbe, suivi automatique optionnel, comparaison,
arret, annulation et restauration du meilleur utilisent les mecanismes communs.

Les relais restent une commande distincte, `Boucle 2 : relais`. Les deux boucles
peuvent etre lancees seules ou dans le [cycle automatique](../README.md#cycle-automatique).
`Optimiser la couleur actuelle` et `Optimiser toutes les couleurs` executent la
meme sequence : moteurs 1, 2, 3, 4, 5, puis boucles 1 et 2. Toutes les couleurs
sont traitees par nombre total de points croissant. Chaque boucle est relancee
tant qu'une passe apporte un gain global strict ; ensuite, un gain superieur a
`1e-8` sur le cycle complet relance les sept phases au moteur 1. La couleur est
terminee seulement apres un cycle complet sans gain strict, sans garantie
d'optimalite globale. La LNS de 1 heure n'entre jamais dans cette sequence.

La pause et le rechargement conservent la phase, la passe et le cycle. La phase
interrompue repart du meilleur parcours compatible, pas de l'etat interne du
worker. Un ancien brouillon de planification incompatible redemarre au moteur 1
depuis le meilleur chemin, sans le supprimer. Chaque phase reste annulable.
Les formats et fichiers de sauvegarde ainsi que la progression de l'outil 3
restent inchanges ; seuls des meilleurs parcours valides sont publies.

## Verification

- `node --test tests/chain-optimizer.test.js` : bornes comparees a la validation
  exhaustive de petits parcours, sens et score global, demi-croix ouvertes,
  coupes, prefixes, voisins admissibles, longues chaines, arret et non-regression.
- `node --test tests/path-optimizer.test.js` : source exacte du worker navigateur.
- `node tests/planner-chains.test.js` avec Playwright : requete `untilStable`
  sans budget total, suivi reel, desktop/mobile, arret, annulation, restauration
  et relance depuis le meilleur historique, fin naturelle sur un petit parcours.
- `BENCHMARK_ENGINES=chains` dans `tests/points-quality-benchmark.js` ;
  `BENCHMARK_PATTERN_FILE` charge un JSON local en lecture seule.

Le prototype a ete teste sur Marine Cryptids DMC 3810, 20 801 croix /
41 602 diagonales, seuil 10. Il a amene le score de 43 335,70570 a 43 107,09192,
avec 14 coupes au lieu de 15 et 90 reinsertions acceptees. Une passe separee de
relais a ensuite atteint 43 106,07872. Ces mesures ne garantissent ni le meme
gain sur un autre parcours ni un optimum global.

Le 23 novembre 2026, le moteur integre a reproduit le score 43 107,09192 et les
90 gains en 99,55 secondes, avec un budget maximal de deux minutes. Il a termine
apres son tour sans gain. Le fichier d'entree et les sauvegardes sont restes
strictement identiques ; les trois autres couleurs n'ont pas ete optimisees.
