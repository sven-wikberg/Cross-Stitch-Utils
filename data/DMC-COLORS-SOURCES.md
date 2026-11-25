# Nuancier DMC pour ecran

Mis a jour le 25 novembre 2026.

Les 482 codes deja presents dans le projet sont conserves, avec leur marque et
serie. Seules leurs valeurs `hex` ont ete remplacees. Les anciens echantillonnages
des images comportaient des erreurs de correspondance, notamment pour 3811,
B5200 et 3865. Cette palette ne pretend pas couvrir toutes les gammes DMC.

## Source et attribution

Color data: craft-color-codes by MakeBead (https://makebead.com).

- [Depot et attribution](https://github.com/makebead/craft-color-codes).
- [Donnees DMC utilisees](https://github.com/makebead/craft-color-codes/blob/ad05b93987c6ecc249c2b7940d621923f06c7cad/data/json/dmc-floss.json).
- [Methode et provenance](https://github.com/makebead/craft-color-codes/blob/ad05b93987c6ecc249c2b7940d621923f06c7cad/SOURCES.md#dmc-six-strand-embroidery-floss-moulin%C3%A9-sp%C3%A9cial-art-117--dmc-floss).
- [Licence des donnees annoncee par MakeBead](https://github.com/makebead/craft-color-codes/blob/ad05b93987c6ecc249c2b7940d621923f06c7cad/LICENSE-DATA.md) : [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

Version figee : `ad05b93987c6ecc249c2b7940d621923f06c7cad`.
Adaptations : selection des 482 codes existants parmi les 489 de la source,
conservation des codes en majuscules et adaptation des champs au format du projet.
Les valeurs hexadecimales sont reprises sans alteration. Les sept codes de la
source absents de notre nuancier ne sont pas ajoutes dans cette correction.

MakeBead qualifie la palette de recoupee entre sources, pas de mesure physique.
Sa licence couvre sa compilation et ses corrections ; sa notice distingue les
valeurs amont, dont les conditions ne sont pas toutes explicites. Les informations
de provenance sont conservees ici pour ne pas presenter ces valeurs comme un
nuancier officiel DMC ou comme des mesures sur echevettes.

## Limites

Un ecran ne reproduit pas exactement le fil : eclairage, brillance, toile et
calibrage de l'ecran changent la perception. Pour une comparaison materielle,
utiliser un nuancier physique ou les fils sous le meme eclairage.

La [liste officielle DMC](https://www.dmc.com/media/color_charts/DMC_Embroidery_Floss_Numerical_List_2021.pdf)
classe 3810 en turquoise fonce et 3811 en turquoise tres clair. Ici, leurs
representations sont respectivement `#488E9A` et `#BCE3E6`. B5200 devient
`#FFFFFF`, BLANC `#FCFBF8` et 3865 `#F9F7F1`.

## Utilisation dans les outils

- L'outil 1 utilise la palette actualisee pour ses choix et ses nouveaux exports.
- Les outils 2 et 3 resolvent la teinte d'affichage par code DMC, meme si un ancien
  fichier contient un mauvais `hex`. Ils ne reecrivent pas le pattern importe.
- Les chemins, symboles, compteurs, historiques, scores et empreintes de sauvegarde
  ne changent pas du fait de cette correction d'affichage.
- Les codes inconnus et les autres marques/series conservent leur `hex` importe.
- Les cases non brodees restent volontairement attenuees. La couleur de travail
  choisie dans l'outil 2 reste independante du nuancier reel.

`dmc-colors.js` est l'enveloppe navigateur du JSON, sans telechargement externe.
Les deux fichiers doivent rester identiques ; le test `tests/dmc-palette.test.js`
verifie leur concordance, l'unicite des codes et plusieurs familles de teintes.
