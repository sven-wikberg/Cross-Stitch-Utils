# Source

Chaque outil garde sa page, son controleur et son stockage independants.

- `app.js` et `group-operations.js` : import du pattern, decoupage et association des couleurs.
- `path-planner.js` : interface de planification, edition et suivi du calcul.
- `block-optimizer-worker.js` : moteur d'optimisation actif et unique point d'entree du worker.
- `orthogonal-path-worker.js` : construction des blocs, retours unitaires, orientations et index spatial utilises par ce moteur.
- `path-visuals.js`, `path-viewport.js`, `path-edit-history.js` : rendu, inspection et historique de l'outil 2.
- `stitch-progress.js` : suivi de la broderie dans l'outil 3.
- `stitch-model.js` : geometrie du fil, validation et migrations des anciens formats. A conserver independamment des changements d'algorithme.
- `path-settings.js` : validation des reglages legacy, couverte par les tests de compatibilite.
- `path-planner-store.js`, `progress-store.js`, `github-sync.js` : stockage et synchronisation, distincts des moteurs de calcul.

Les tests fonctionnels sont dans `tests/`. Le benchmark de qualite est separe dans
`tests/path-quality-benchmark.js`. Les fichiers de progression de `data/` ne sont
pas des fixtures a regenerer : les tests les lisent sans les modifier.

