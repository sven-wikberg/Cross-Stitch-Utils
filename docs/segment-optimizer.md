# Moteur 5 : raccordements de plusieurs segments

Ce moteur ameliore un parcours complet existant. Il ne reconstruit pas les
blocs, ne remplace aucun autre moteur et ne lance pas la recherche de relais.
Le meilleur parcours compatible de la couleur est son point de depart.

## Recherche

1. Reorienter le fil, puis compresser temporairement le parcours en suites de
   liaisons unitaires sans coupe. La partie verrouillee reste exclue.
2. Classer les raccordements par cout reel decroissant, coupes comprises.
   Les liaisons de longueur racine de deux restent candidates elles aussi.
3. Choisir de 6 a 10 morceaux proches du raccordement ou de ses passages
   voisins. Trois operateurs alternent : segments entiers, petites portions
   de segments (1, 2, 4, 8 ou 16 diagonales), portions avec leurs diagonales
   correspondantes. Leurs frequences s'adaptent aux gains et au temps de calcul.
4. Reorganiser conjointement ces morceaux, dont les longueurs peuvent etre
   differentes. Les intervalles non selectionnes conservent leur ordre entre
   les emplacements disponibles. Les morceaux ne sont pas inverses : leur
   ordre interne est preserve, mais les sens de couture restent libres.
5. Une programmation dynamique par sous-ensembles choisit l'ordre et les sens
   des raccordements ensemble. Les matrices de transfert evaluent aussi tous
   les sens possibles dans les intervalles non deplaces. On ne valide pas une
   suite de petits mouvements : on compare directement le resultat combine.
6. Construire et verifier le parcours complet seulement pour les propositions
   prometteuses. Publier uniquement les ameliorations strictes du score reel.
   Recalculer les voisins apres un changement du parcours de travail.

La recherche reprend donc les longs trajets couteux sans figer definitivement
les longues suites de deplacements deja courts. Un segment peut ne contenir
qu'une diagonale. Ce n'est pas une recherche exhaustive du pattern entier.

## Dependances et score

Une diagonale inferieure doit preceder la superieure de sa croix, meme quand
elles se trouvent dans deux morceaux distincts, ou dans un intervalle laisse
en place. Les dependances entre morceaux et les emplacements admissibles sont
calcules avant chaque reparation. Le prefixe verrouille conserve ordre et sens.
Les coupes imposees suivent leur diagonale d'arrivee.

Les raccordements entre le meme trou restent interdits, meme apres une coupe.
Le score est la distance euclidienne entre trous, plus trois fois le seuil
pour chaque coupe, y compris la distance du deplacement apres coupe. Les
decimales restent dans tous les calculs. La longueur du fil devant est fixe.

Sans perturbation, la reparation est exacte parmi les permutations des morceaux
selectionnes dans les emplacements choisis, et tous leurs sens possibles.
Elle n'est pas exacte parmi tous les decoupages, inversions ou entrelacements.
Chaque reparation a une limite de 1,5 seconde ; une reparation interrompue ne
retourne aucun candidat partiellement examine.

Au plateau, de faibles perturbations peuvent proposer une autre combinaison
et une petite degradation temporaire du parcours de travail. Une acceptation
probabiliste limite ces essais, avec retours reguliers au meilleur parcours.
Ces essais ne sont jamais affiches comme meilleur chemin ni sauvegardes.

## Interface et sauvegardes

Le bouton `Moteur 5 : raccordements` est disponible avec un parcours complet.
Le budget commun des moteurs 2 a 5 est de 1 minute, 10 minutes ou 1 heure,
preparation comprise. Une derniere passe globale sur les sens est toujours
effectuee, meme si le budget de recherche vient de se terminer.

Le suivi affiche le raccordement examine, le nombre de segments mobiles, les
diagonales concernees et les reorganisations testees. Le rang porte sur le
parcours de travail courant et peut repartir apres un gain. Il ne represente
pas un pourcentage de proximite avec l'optimum.

Les gains, surbrillances, courbe, suivi automatique optionnel, comparaison,
arret, annulation et restauration du meilleur utilisent les mecanismes communs.
Les messages sont limites a environ un toutes les 150 ms ; le dessin reste
regroupe toutes les 750 ms. Les formats et fichiers de sauvegarde ne changent pas.

## Verification

- `node --test tests/segment-optimizer.test.js` : oracles exhaustifs, croisements
  de dependances, segments de longueurs differentes, plateau des mouvements
  simples, contraintes, delai, validite et monotonie des meilleurs parcours.
- `node tests/planner-segments.test.js` avec Playwright : vrai worker, gains,
  rendu desktop/mobile, arret, annulation, meilleur parcours et rechargement.
- `BENCHMARK_ENGINES=segments` active ce moteur dans
  `tests/points-quality-benchmark.js` ; les donnees sources ne sont jamais ecrites.

Mesure de controle, 22 novembre 2026 : Marine Cryptids DMC 3810, 20 801 croix /
41 602 diagonales, seuil 10, graine 31, budget 60 secondes. Le parcours sauvegarde
a 43 696,02948 atteint 43 680,99951, avec 20 ameliorations publiees et 16 coupes
inchangees. 2 160 reparations ont ete testees en 60,22 secondes, derniere passe
comprise. Ce resultat est un exemple mesure, pas une garantie de gain futur.
