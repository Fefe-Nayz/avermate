# Vérification locale du registre — 30 août 2026

Ce compte rendu décrit les vérifications du working tree, pas une certification
de production ni une exécution de fournisseurs payants. Voir le
[guide opérateur](operator-guide.md) pour l'activation progressive et
l'[inventaire](inventory.md) pour le périmètre et les limites conservées.

## Résultats

| Vérification                                                                    | Résultat                  |
| ------------------------------------------------------------------------------- | ------------------------- |
| TypeScript serveur, Web, Node et contrats                                       | Réussi                    |
| Build du serveur Bun                                                            | Réussi                    |
| Installation avec lockfile figé et sans scripts d'installation                  | Réussie, aucun changement |
| Registre, adapters, migration 0069, catalogue assistant et frontière des outils | 114 tests réussis         |
| Suite complète Node                                                             | 126 tests réussis         |
| Suite des contrats                                                              | 75 tests réussis          |
| Réglages Web, navigation et extraction des traductions                          | 22 tests réussis          |
| ESLint des surfaces Web modifiées                                               | Réussi                    |
| Vérification des espaces du diff                                                | Réussie                   |

Les totaux ci-dessus se recouvrent : ce ne sont pas des tests uniques à
additionner. Les tests d'adapters utilisent des transports ou modèles contrôlés,
même lorsqu'ils traversent les vrais plugins et exécuteurs.

Six tests supplémentaires du streaming Node passent également. Ils traversent
le véritable invoker du registre, l'exécuteur Core, le plugin Node, un transport
contrôlé, l'exécuteur Node qui vérifie le grant signé et le bridge de langage.
Les enveloppes du transport sont converties en événements de chat : texte,
usage et fin. Le rejeu ne régénère pas la réponse ; une interruption après une
sortie partielle ne devient jamais un succès persisté. Les magasins de données
de ce test restent simulés en mémoire.

## Suite serveur globale : réserve explicite

La commande déclarée par le package, `bun run test`, a terminé avec **1 177
réussites, 1 test ignoré et 21 échecs**, sur 1 199 tests. Le premier échec est un
`SQLITE_BUSY` pendant le test de gel concurrent des snapshots dans
`core-conversation-store.test.ts`. Les autres échecs appartiennent à cette même
suite, dont la base reste ensuite verrouillée.

La relance isolée de **ce fichier complet**, avec les mêmes options
`--parallel=1 --timeout=30000`, donne **29 réussites, aucun échec**, sans
modification du code des conversations. Cela indique une instabilité de
concurrence à investiguer, pas une résolution démontrée. La suite globale ne doit
donc pas être annoncée verte.

## Vérifications non réalisées

- Pas de validation visuelle interactive de `/settings/processing` : la session
  n'a pas pu démarrer le serveur API de test. Les tests Web couvrent les modèles
  d'interface, les contrats de composition et le véritable extracteur SWC de
  traductions, pas l'apparence dans un navigateur.
- Pas d'appel live payant, ni de preuve d'exécution sur un Node externe réel.
- Pas de nouveau gate Docker Compose, air-gap, restauration ou isolation.
- Le lint personnalisé produit encore des avertissements ; seul ESLint ciblé
  est annoncé réussi, pas un dépôt intégralement exempt d'avertissements.

Les sept familles migrées restent **legacy par défaut**. Les chemins registry
sont activables séparément ; les tests n'ont changé ni les flags de déploiement,
ni les connexions réelles, ni les données de l'utilisateur. Le retrait du legacy
reste soumis à la release de compatibilité prévue par la phase 14 de l'audit.
