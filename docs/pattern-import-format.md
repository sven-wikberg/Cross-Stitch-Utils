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
- Informations sur le PDF source.
- Dimensions de la grille.
- Liste des couleurs.
- Saisie ou correction de la grille.
- Validation et export JSON.
