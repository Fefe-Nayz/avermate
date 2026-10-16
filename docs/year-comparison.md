# Comparaison d’années

Implémentation sur `codex/year-comparison`, issue de `origin/main` (`81bce8b4`). Le travail sur `rewrite` n’est pas modifié.

## Utilisation

1. Sélectionner l’année à consulter avec le sélecteur habituel.
2. Cliquer sur **Comparer** sous la navigation (visible à partir de deux années).
3. Choisir l’année de référence et vérifier les correspondances proposées pour les matières et les périodes. Les noms et chemins hiérarchiques non ambigus sont proposés automatiquement. Les périodes peuvent également être proposées par ordre quand leurs structures concordent.
4. Associer manuellement les matières renommées, ou conserver **Sans correspondance**. Chaque matière/période de référence ne peut être utilisée qu’une fois.
5. **Enregistrer et comparer** active les écarts sur la vue d’ensemble, le tableau des notes, le détail des matières et les graphiques (évolution générale, radar, évolution de matière, moyenne historique dans le graphique des notes).
6. **Arrêter** masque la comparaison ; **Reprendre** la réactive sans refaire la configuration.

Les associations sont enregistrées en base, par utilisateur et paire orientée d’années. Le choix du mode, de l’année de référence et du périmètre est conservé dans ce navigateur, séparément pour chaque compte et année consultée. Chaque appareil retrouve les correspondances enregistrées après sélection de la même paire.

## Règles de calcul

- **Au même stade** : la référence s’arrête au même nombre de jours calendaires depuis le début de l’année/période. Les périodes cumulatives commencent à la première période incluse. Les changements d’heure et années bissextiles sont traités en jours calendaires.
- **Période de référence complète** : les moyennes de référence des cartes, du tableau et du radar utilisent toute la période disponible. Les courbes d’évolution gardent leur alignement chronologique sur l’intervalle visible de l’année consultée ; elles ne projettent pas de notes futures.
- Le mode historique existant déplace également la date de comparaison, de façon relative pour l’autre année.
- Les deux années conservent leurs matières, hiérarchies et coefficients : la moyenne générale porte sur leur programme respectif. Les associations servent aux comparaisons par matière, sans modifier les notes ou coefficients.
- Les calculs réutilisent `average()` et sont normalisés sur 20. Les cartes/tableaux convertissent l’affichage au barème de l’année consultée ; les graphiques restent sur 20. Les écarts sont exprimés en points, et non en pourcentages.
- Aucune note, zéro réel et absence de correspondance restent distincts. Une référence manquante ne devient jamais un zéro dans le radar.
- En mode comparaison, cartes/tableaux/graphiques limitent les notes à la date du jour ou à la date historique, au plus tard à la fin de la période/année. Une note de rattrapage datée après cette borne peut donc être visible en mode normal et exclue de la comparaison. Les notes antérieures au début mais explicitement rattachées à la période restent incluses comme dans le calcul existant.
- Les moyennes personnalisées ne sont pas associées automatiquement ni comparées dans cette version ; leurs graphiques restent disponibles normalement.

## Données et déploiement

Migration : `apps/api/drizzle/0006_year_comparisons.sql`. Le démarrage Docker de l’API exécute déjà les migrations. Pour une API locale, lancer `bun run db:migrate` depuis `apps/api`, avec sa configuration habituelle, avant de démarrer.

API : `GET` et `PUT /api/comparisons/:yearId/:referenceYearId`, avec `{ subjectMap, periodMap }`. Les identifiants doivent appartenir aux deux années du compte authentifié ; les années doivent être distinctes. `null` conserve une exclusion explicite. La période synthétique `full-year` est implicite et n’est pas envoyée. Les références supprimées sont nettoyées, et supprimer une année ou un compte supprime ses configurations.

## Vérification du 16 octobre 2026

- Client : `bun test` — **33 tests réussis**, dont 14 cas dédiés à la comparaison.
- API : `bun test src/routes/comparisons.test.ts` — **8 tests d’intégration réussis**, avec les vraies migrations sur une base en mémoire.
- Client : `bunx tsc --noEmit` et `bun run build` réussis.
- Parcours navigateur local avec compte fictif et API de correspondances réelle : association manuelle de Physique à Physique appliquée, sauvegarde, navigation entre vues, détail matière, conservation de la configuration après rechargement et retour à la paire enregistrée, arrêt/reprise.
- Largeur mobile simulée de 390 px : aucun débordement horizontal dans le panneau ; commande d’enregistrement accessible en bas du panneau défilant. Aucun test sur téléphone physique.
- Valeurs contrôlées : générale **15 / 20 contre 11,75** (+3,25 points), mathématiques **15 contre 11,5** (+3,5), physique **14 contre 11** (+3), anglais **17 contre 14** (+3). Les notes de référence sont stockées sur 100.
- ESLint ne démarre pas correctement avec la combinaison existante ESLint 10 / eslint-plugin-react (`contextOrFilename.getFilename`). Le contrôle API signale les alias internes non résolus du paquet tiers `@limitable/ratelimit` ; aucune erreur des fichiers de la fonctionnalité.
- Les captures d’écran du navigateur intégré ont expiré ; la validation interactive repose sur le DOM, les valeurs rendues et les mesures de géométrie, sans preuve visuelle par capture.

La fonctionnalité n’est pas publiée en production. Une démonstration locale est disponible pendant cette session sur `http://localhost:3105/dashboard`, avec des données fictives et une base en mémoire réinitialisée au redémarrage.
