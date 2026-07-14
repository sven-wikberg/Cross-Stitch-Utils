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
- Dimensions de la grille.
- Informations sur le PDF source.
- Saisie ou correction de la grille.
- Validation et export JSON.

## Etape 2 : couleurs DMC

L'utilisateur recopie les codes DMC du PDF dans une liste de couleurs.
Cette etape devient accessible seulement quand le nom du projet est valide.
Le code est verifie dans `data/dmc-colors.json`, puis la couleur est ajoutee au pattern avec ses informations de reference.

```json
{
  "id": "dmc-310",
  "brand": "DMC",
  "series": "Mouliné Spécial",
  "dmc": "310",
  "hex": "#6A6B6D"
}
```

Les symboles du pattern seront relies aux couleurs dans une etape separee, plus tard.

## Etape 3 : dimensions de la grille

L'utilisateur saisit les dimensions totales du pattern en points. Ces dimensions representent toute la grille finale, meme si le PDF est decoupe sur plusieurs pages.

```json
{
  "grid": {
    "width": 120,
    "height": 180,
    "cells": []
  }
}
```

Si les dimensions changent plus tard, les cases deja importees devront etre verifiees ou reconstruites.
