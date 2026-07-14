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
  "partsExpected": 0,
  "parts": [],
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
  "partsExpected": 0,
  "parts": [],
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
- Morceaux du pattern.
- Grille vide.
- Decoupage des cellules.
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

## Etape 4 : morceaux du pattern

L'utilisateur indique d'abord combien de sous-parties composent le pattern. L'outil nomme ensuite automatiquement les morceaux `Part 1`, `Part 2`, `Part 3`, etc.

```json
{
  "partsExpected": 4
}
```

Chaque morceau indique son image source, sa position dans la grille globale, et sa taille en points.

```json
{
  "id": "part-1",
  "name": "Page 1",
  "imageName": "page-1.png",
  "imageSource": "file",
  "imageDataUrl": "",
  "startX": 0,
  "startY": 0,
  "width": 60,
  "height": 80
}
```

La validation verifie que les morceaux couvrent exactement les dimensions globales :

- aucun morceau ne doit depasser de la grille ;
- les morceaux ne doivent pas se chevaucher ;
- la somme des surfaces doit etre egale a `grid.width * grid.height` ;
- la couverture reelle doit remplir toute la grille.

L'analyse automatique des images sera ajoutee plus tard, une fois ce decoupage fiable.

`imageSource` vaut `file` pour une image choisie depuis le disque, ou `clipboard` pour une image collee depuis le presse-papier. `imageDataUrl` contient l'image quand elle est disponible pour permettre une analyse locale plus tard.

## Etape 5 : grille vide

Une fois les morceaux valides, l'outil genere une cellule vide pour chaque point du pattern. Chaque cellule connait sa position globale et le morceau dont elle provient.

```json
{
  "x": 0,
  "y": 0,
  "partId": "part-1",
  "symbol": null,
  "dmc": null
}
```

Cette etape ne lit pas encore les symboles dans l'image. Elle prepare seulement la structure uniforme qui sera remplie plus tard.

## Etape 6 : decoupage des cellules

Les images fournies pour les morceaux sont considerees comme contenant uniquement la grille, sans marges, sans numerotation, sans legende et sans titre.

L'outil decoupe chaque image en fonction de la taille du morceau :

- largeur d'une cellule = largeur de l'image / `part.width` ;
- hauteur d'une cellule = hauteur de l'image / `part.height`.

Chaque cellule recoit ensuite une signature visuelle compacte qui servira plus tard a regrouper les symboles similaires.

```json
{
  "x": 0,
  "y": 0,
  "partId": "part-1",
  "symbol": null,
  "dmc": null,
  "sampleSignature": "ff00aa55ff00aa55",
  "sampleMean": "#F4F4F4",
  "sampleSource": "image-slice"
}
```

Cette signature n'est pas le symbole final. Elle est seulement une aide pour la prochaine etape de reconnaissance ou de regroupement manuel.
