# Feuille de route - Outil 2

## Principes a conserver

- Outils independants, echanges uniquement par fichiers explicites.
- Sauvegarde et progression de l'outil 3 jamais modifiees par une optimisation.
- Diagonale / avant diagonale \\, et pas de transition dans le meme trou.
- Meilleur chemin valide toujours conserve, avec score initial, gain et coupes.
- Surbrillance des raccordements ameliores, sans deplacement automatique de la vue.

## Chantier actuel : recherche plus visuelle

Statut : termine, verifie sur ordinateur, mobile et grand pattern.

- [x] Couleur de travail commune a toutes les couleurs DMC, reglable et memorisee localement.
- [x] Palette DMC et fichiers exportes inchanges.
- [x] Zones reellement examinees visibles pendant la preparation et la recherche.
- [x] Distinction entre essais en cours, ameliorations retenues et coupes.
- [x] Courbe du meilleur score pendant le calcul.
- [x] Affichage fluide, sans redessiner toute la grille pour chaque essai.
- [x] Verification sur grands patterns, petits ecrans, arret et relance.

## Priorite 1 : proteger le travail

- [ ] Confirmation pour Vider et Reset.
- [ ] Vrai historique d'annulation des operations, pas seulement retrait de la derniere diagonale.
- [ ] Recuperation du meilleur chemin apres une suppression accidentelle.
- [ ] Tests de suppression, annulation, rechargement et restauration.

## Priorite 2 : clarifier l'interface

- [ ] Retirer Retours de zone des indicateurs principaux : un retour peut maintenant etre benefique.
- [ ] Afficher Bloc en construction et Croix du bloc seulement pendant la phase pertinente.
- [ ] Reduire les repetitions du score et de l'etat du calcul.
- [ ] Deplacer Essais, Relances et Distance apres coupe dans un volet Details.
- [ ] Replier les reglages manuels de diagonale et de sens lorsqu'ils ne servent pas.
- [ ] Distinguer progression de preparation et delai sans amelioration ; ne pas suggerer un pourcentage de qualite.

## Priorite 3 : mieux combiner les optimisations

- [ ] Essayer les insertions sur plusieurs bons ordres intermediaires, meme avant qu'ils battent le meilleur global.
- [ ] Continuer a n'afficher et conserver que les meilleurs resultats globaux valides.
- [ ] Mieux reutiliser les parcours entrelaces pour les essais suivants.
- [ ] Comparer score, coupes et temps sur des fixtures fixes et des executions reproductibles.

## Priorite 4 : examiner les parcours plus facilement

- [ ] Zoom de grille, deplacement et retour a la vue complete.
- [ ] Bascule avant/apres avec cadrage identique.
- [ ] Faciliter l'inspection d'un raccordement ou d'une coupe sans perdre la vue generale.

## Entretien

- [ ] Retirer du code charge les anciens algorithmes sans point d'entree dans l'interface.
- [ ] Conserver les calculs partages, les migrations et les tests utiles.
- [ ] Garder une suite de tests de validite et une suite distincte de comparaison de qualite.

## Ordre propose

Recherche plus visuelle (demande actuelle), puis protection du travail,
allegement de l'interface, combinaison des optimisations et inspection detaillee.

Chaque chantier doit etre valide separement avant de passer au suivant.
