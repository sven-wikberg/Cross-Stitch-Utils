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
Cette etape doit etre validee avant de passer aux couleurs.

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

L'utilisateur recopie les codes DMC du PDF dans une liste de couleurs.
Cette etape devient accessible seulement quand le nom du projet est valide.

```json
{
  "id": "dmc-310",
  "dmc": "310"
}
```

Les symboles du pattern seront relies aux couleurs dans une etape separee, plus tard.
