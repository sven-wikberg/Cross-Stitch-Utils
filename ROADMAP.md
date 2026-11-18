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
- [x] Zones examinees initialement affichees, puis retirees a la priorite 4 sur demande.
- [x] Distinction entre ameliorations retenues et coupes ; les essais orange ne sont plus affiches.
- [x] Courbe du meilleur score pendant le calcul.
- [x] Affichage fluide, sans redessiner toute la grille pour chaque essai.
- [x] Verification sur grands patterns, petits ecrans, arret et relance.

## Priorite 1 : proteger le travail

Statut : termine. Historique local persistant, par operation et par couleur affectee.

- [x] Confirmation pour Vider et Reset.
- [x] Vrai historique d'annulation des operations, pas seulement retrait de la derniere diagonale.
- [x] Recuperation du meilleur chemin apres une suppression accidentelle.
- [x] Tests de suppression, annulation, rechargement et restauration.

Annuler/Retablir est disponible dans l'en-tete, y compris apres Reset.
Un glisser ou une optimisation forme une seule operation. Le meilleur chemin
reste separe de l'historique et Vider ne le supprime plus. Les contraintes
associees sont conservees ; leur remplacement lors d'une restauration est confirme.
L'historique est borne a 50 operations et environ 16 Mio par pile, avec au moins
la derniere operation conservee. Charger un nouveau fichier commence un nouvel historique.

## Priorite 2 : clarifier l'interface

Statut : termine, sans changement du moteur de calcul ni des formats de fichiers.

- [x] Retirer Retours de zone des indicateurs principaux : un retour peut maintenant etre benefique.
- [x] Afficher Bloc en construction et Croix du bloc seulement pendant la phase pertinente.
- [x] Reduire les repetitions du score et de l'etat du calcul.
- [x] Deplacer Essais, Relances et Distance apres coupe dans un volet Details.
- [x] Replier les reglages manuels de diagonale et de sens lorsqu'ils ne servent pas.
- [x] Distinguer progression de preparation et delai sans amelioration ; ne pas suggerer un pourcentage de qualite.

Le score principal reste visible. Details et Edition manuelle sont replies par
defaut ; les reglages actifs restent signales dans le resume. La barre compte les
blocs pendant la preparation, puis le temps sans amelioration pendant la recherche.
Elle disparait a l'arret. Gain total et Dernier gain sont distingues.

## Priorite 3 : mieux combiner les optimisations

Statut : termine. Recherche combinee, sans modification des formats ni des sauvegardes.

- [x] Essayer les insertions sur plusieurs bons ordres intermediaires, meme avant qu'ils battent le meilleur global.
- [x] Continuer a n'afficher et conserver que les meilleurs resultats globaux valides.
- [x] Mieux reutiliser les parcours entrelaces pour les essais suivants.
- [x] Comparer score, coupes et temps sur des fixtures fixes et des executions reproductibles.

Les descentes intermediaires et la reserve interne sont bornees. Les relances
peuvent perturber un parcours entrelace sans l'aplatir. Aucun essai moins bon ne
remplace le resultat visible ni ne relance le delai global. Les prefixe, sens,
coupes imposees et regles de broderie restent verifies.

Le benchmark separe `tests/path-quality-benchmark.js` compare six fixtures sur
trois graines au moteur de la priorite 2. Le README documente les budgets logiques,
les mesures de temps reel et leurs limites. Tests unitaires et navigateur verifies,
y compris le pattern de 41602 diagonales, sans toucher a la progression de l'outil 3.

## Priorite 4 : examiner les parcours plus facilement

Statut : termine. Inspection independante du chemin et de ses sauvegardes.

- [x] Zoom de grille, deplacement et retour a la vue complete.
- [x] Bascule avant/apres avec cadrage identique.
- [x] Faciliter l'inspection d'un raccordement ou d'une coupe sans perdre la vue generale.
- [x] Retirer les zones orange et les calculs/transports dedies a leur affichage.

Molette, boutons de zoom, main, miniature cliquable, raccourcis clavier et zoom
tactile sont disponibles. Le canvas reste borne a sa fenetre ; le zoom n'alloue
pas une image geante. Les gains bleus restent affiches, avec un cadrage explicite
du dernier gain. Le survol indique la distance entre trous et les coupes.

Avant est le parcours au debut de la derniere recherche (ou sa premiere solution
complete). Cette reference est locale a la session et n'est pas exportee ; un
rechargement ou une edition l'efface. Apres reste le parcours courant, meme si
Avant est affiche pendant le calcul. Le zoom et le deplacement sont communs.
Tests du cadrage, du trace zoome, de la comparaison en cours de calcul, du tactile
et des formats PC/mobile/grand ecran, sans modification de la progression.

## Entretien

- [x] Retirer du code charge les anciens algorithmes sans point d'entree dans l'interface.
- [x] Conserver les calculs partages, les migrations et les tests utiles.
- [x] Garder une suite de tests de validite et une suite distincte de comparaison de qualite.

Entretien termine : anciens moteurs par cases et par zones retires, fonctions
inaccessibles de l'outil 2 supprimees. Les tests utiles ciblent maintenant le
moteur actif, ses orientations, son index spatial et son worker. Les anciennes
regles de delai par zone sont remplacees par les tests du delai global actuel.
74 tests fonctionnels, les parcours navigateur et le benchmark de qualite sont
valides. Sauvegardes et patterns associes verifies identiques octet par octet.

## Recherche par zone retiree

La selection rectangulaire, l'optimisation locale et leur moteur ont ete retires
a la demande de l'utilisateur. L'optimisation globale, les relais au plateau,
le zoom, le deplacement et la comparaison avant/apres restent disponibles.

## Relais au plateau

- [x] Cibler les longues liaisons au dos et leurs diagonales voisines.
- [x] Tester deplacements et permutations, meme pour une seule diagonale.
- [x] Reevaluer les sens et tous les raccordements, y compris l'ancien emplacement.
- [x] Reprendre la recherche apres un gain strict du score global.
- [x] Conserver les contraintes et le prefixe verrouille.
- [x] Afficher la passe, son avancement, les relais retenus et leur surbrillance.
- [x] Verifier contre une enumeration des sens et sur des plateaux reproductibles.

## Ordre propose

Recherche plus visuelle, priorites 1 a 4 et entretien cible du code termines.

Chaque chantier doit etre valide separement avant de passer au suivant.
