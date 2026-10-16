# Comparaison d’années

Implémentation sur `codex/year-comparison`, issue de `origin/main` (`81bce8b4`). Le travail sur `rewrite` n’est pas modifié.

## Utilisation

1. Sélectionner l’année à consulter avec le sélecteur habituel.
2. Cliquer sur le bouton **Comparer les années** (icône de deux flèches) à côté du sélecteur d’année, visible à partir de deux années. Aucun bandeau de comparaison n’est ajouté à la page.
3. Choisir l’année de référence et le périmètre. Déplier **Matières**, **Moyennes personnalisées** ou **Périodes** pour vérifier les correspondances. Les noms et chemins hiérarchiques non ambigus sont proposés automatiquement pour une nouvelle paire. Les périodes peuvent également être proposées par ordre quand leurs structures concordent.
4. Associer manuellement les éléments renommés, ou conserver **Sans correspondance**. Chaque élément de référence ne peut être utilisé qu’une fois dans son type de correspondance. Les configurations enregistrées avant l’ajout des moyennes personnalisées restent sans association pour celles-ci jusqu’à une sauvegarde explicite.
5. **Comparer** active les écarts sur la vue d’ensemble, le tableau des notes, le détail des matières et les graphiques (évolution générale, radar, évolution de matière, moyenne historique dans le graphique des notes). Le bouton dans l’en-tête indique la comparaison active et son infobulle précise l’année.
6. Rouvrir la fenêtre pour **Désactiver** la comparaison, changer le périmètre ou **Enregistrer** des ajustements. Après désactivation, **Comparer** réutilise les correspondances mémorisées. Les brouillons sont conservés si l’on change d’année de référence dans la même fenêtre ; fermer sans enregistrer les abandonne.

La configuration reprend les composants du projet : formulaire React Hook Form / shadcn, Select, Accordion, Button et Credenza (Dialog sur ordinateur, Drawer sur mobile). Sur ordinateur, le tableau affiche les deux moyennes et l’écart en trois colonnes alignées, avec les années nommées en en-tête. Le rendu mobile existant et les cartes gardent leurs badges. Les contrôles d’enregistrement restent accessibles pendant le défilement des correspondances.

Les associations sont enregistrées en base, par utilisateur et paire orientée d’années. Le choix du mode, de l’année de référence et du périmètre est conservé dans ce navigateur, séparément pour chaque compte et année consultée. Chaque appareil retrouve les correspondances enregistrées après sélection de la même paire.

## Règles de calcul

- **Au même stade** : la référence s’arrête au même nombre de jours calendaires depuis le début de l’année/période. Les périodes cumulatives commencent à la première période incluse. Les changements d’heure et années bissextiles sont traités en jours calendaires.
- **Période de référence complète** : les moyennes de référence des cartes, du tableau et du radar utilisent toute la période disponible. Les courbes d’évolution gardent leur alignement chronologique sur l’intervalle visible de l’année consultée ; elles ne projettent pas de notes futures.
- Le mode historique existant déplace également la date de comparaison, de façon relative pour l’autre année.
- Les deux années conservent leurs matières, hiérarchies et coefficients : la moyenne générale porte sur leur programme respectif. Les associations servent aux comparaisons par matière, sans modifier les notes ou coefficients.
- Les calculs réutilisent `average()` et sont normalisés sur 20. Les cartes/tableaux convertissent l’affichage au barème de l’année consultée ; les graphiques restent sur 20. Les écarts sont exprimés en points, et non en pourcentages.
- Aucune note, zéro réel et absence de correspondance restent distincts. Une référence manquante ne devient jamais un zéro dans le radar.
- En mode comparaison, cartes/tableaux/graphiques limitent les notes à la date du jour ou à la date historique, au plus tard à la fin de la période/année. Une note de rattrapage datée après cette borne peut donc être visible en mode normal et exclue de la comparaison. Les notes antérieures au début mais explicitement rattachées à la période restent incluses comme dans le calcul existant.
- Les moyennes personnalisées associées sont comparées dans le tableau et leur détail (carte et graphiques Moyenne/Notes). Chaque côté utilise sa propre formule, ses coefficients et ses choix d’inclusion des sous-matières, après filtrage des notes par période et date. Aucune association matière par matière n’est nécessaire à leur calcul. Une référence absente ou exclue reste vide ; un zéro réel est conservé.

## Données et déploiement

Migrations : `0006_year_comparisons.sql` puis `0007_year_comparison_custom_averages.sql` dans `apps/api/drizzle`. La seconde ajoute une colonne sans modifier les correspondances existantes. Le démarrage Docker de l’API exécute déjà les migrations. Pour une API locale, lancer `bun run db:migrate` depuis `apps/api`, avec sa configuration habituelle, avant de démarrer.

API : `GET` et `PUT /api/comparisons/:yearId/:referenceYearId`, avec `{ subjectMap, periodMap, customAverageMap }`. Pour les anciens clients, omettre `customAverageMap` conserve sa valeur ; un objet vide l’efface explicitement. Les identifiants doivent appartenir aux deux années du compte authentifié ; les années doivent être distinctes. `null` conserve une exclusion explicite. La période synthétique `full-year` est implicite et n’est pas envoyée. Les références supprimées sont nettoyées, et supprimer une année ou un compte supprime ses configurations.

## Vérification du 16 octobre 2026

- Client : `bun test` — **39 tests réussis**, dont 20 cas dédiés à la comparaison.
- API : `bun test src/routes/comparisons.test.ts` — **14 tests d’intégration réussis**, dont la migration d’une configuration existante, avec les vraies migrations sur une base en mémoire.
- Client : `bunx tsc --noEmit` réussi après ajout des moyennes personnalisées. Le build de production avait été vérifié avant cet ajout.
- Parcours navigateur local avec compte fictif et API de correspondances réelle : association manuelle de Physique à Physique appliquée, sauvegarde, navigation entre vues, détail matière, conservation de la configuration après rechargement et retour à la paire enregistrée, arrêt/reprise.
- Largeur mobile simulée de 390 px : aucun débordement horizontal dans le panneau ; commande d’enregistrement accessible en bas du panneau défilant. Aucun test sur téléphone physique.
- Valeurs contrôlées : générale **15 / 20 contre 11,75** (+3,25 points), mathématiques **15 contre 11,5** (+3,5), physique **14 contre 11** (+3), anglais **17 contre 14** (+3). Les notes de référence sont stockées sur 100.
- Moyenne personnalisée « Bloc scientifique » : association enregistrée par l’interface, API relue, tableau et détail vérifiés à **14,67 contre 11,33** (+3,33), courbe de référence présente dans les onglets Moyenne et Notes. Les tests couvrent aussi des coefficients et inclusions différents entre les années.
- ESLint ne démarre pas correctement avec la combinaison existante ESLint 10 / eslint-plugin-react (`contextOrFilename.getFilename`). Le contrôle API signale les alias internes non résolus du paquet tiers `@limitable/ratelimit` ; aucune erreur des fichiers de la fonctionnalité.
- Après refonte de l’interface : captures d’écran inspectées sur ordinateur et à 390 px, sélecteurs shadcn et correspondances vérifiés, activation/désactivation et changement de périmètre enregistrés, brouillon conservé après un aller-retour entre deux années. Le formulaire mobile étendu reste entre y=16 et y=844, avec son bouton d’enregistrement à y=791–827 et un corps défilant ; largeur du document 390 px. Contrôle TypeScript client réussi après refonte.

La fonctionnalité n’est pas publiée en production. Une démonstration locale est disponible pendant cette session sur `http://localhost:3105/dashboard`, avec des données fictives et une base en mémoire réinitialisée au redémarrage.
