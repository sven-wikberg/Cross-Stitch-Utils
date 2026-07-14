# Direction application

## Cible

Le projet vise principalement des PC. Les outils doivent etre faciles a ouvrir, utiliser et fermer, sans demander a l'utilisateur de lancer des commandes dans un terminal au quotidien.

## Experience souhaitee

- Une application unique qui regroupe les outils.
- Un ecran principal avec la liste des outils disponibles.
- Chaque outil doit pouvoir etre ouvert depuis le menu principal.
- Les outils doivent sauvegarder ou exporter leurs resultats de facon comprehensible.
- L'application doit rester utilisable hors ligne.

## Approche recommandee

Commencer par une application web locale est le chemin le plus souple :

- rapide a developper ;
- facile a tester dans un navigateur ;
- compatible avec plusieurs PC ;
- transformable plus tard en application desktop avec un emballage comme Tauri ou Electron.

## Evolution possible

1. Prototype web local.
2. Ajout des premiers outils utiles.
3. Sauvegarde locale des projets.
4. Export PDF ou image si necessaire.
5. Emballage en application Windows installable ou portable.

## Premier outil recommande

Le calculateur de taille de toile est un bon premier outil, parce qu'il est simple, utile, et permet de definir les bases de l'interface :

- largeur et hauteur en points ;
- count de la toile ;
- marge autour du motif ;
- resultat en centimetres et pouces.

