# Format d'import de pattern

Le premier outil produit progressivement un fichier JSON uniforme. Le PDF d'origine peut etre analyse ou recopie partiellement a la main selon ce qui est le plus fiable.

## Version initiale

```json
{
  "schemaVersion": 1,
  "project": {
    "name": ""
  },
  "colors": [],
  "grid": {
    "width": 0,
    "height": 0,
    "cells": []
  }
}
```

## Etape 1 : nom du projet

L'utilisateur saisit seulement le nom du projet. Cette valeur alimente `project.name`.

Exemple :

```json
{
  "schemaVersion": 1,
  "project": {
    "name": "Winter Cottage"
  },
  "colors": [],
  "grid": {
    "width": 0,
    "height": 0,
    "cells": []
  }
}
```

## Etapes prevues

- Nom du projet.
- Liste des couleurs DMC.
- Informations sur le PDF source.
- Dimensions de la grille.
- Saisie ou correction de la grille.
- Validation et export JSON.

## Etape 2 : couleurs DMC

L'utilisateur recopie la legende du PDF dans une liste de couleurs. Pour chaque couleur, on garde au minimum le symbole vu dans le pattern et le numero DMC.

```json
{
  "id": "dmc-310",
  "symbol": "X",
  "dmc": "310",
  "name": "Black"
}
```

Pour l'instant, le nom est optionnel. Une prochaine evolution pourra utiliser une base locale de couleurs DMC pour remplir automatiquement le nom et afficher un apercu approximatif de la couleur.
