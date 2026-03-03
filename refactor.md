# Plan de refactor Avermate

Date: 2026-03-03

## Objectif
Nettoyer le code pour améliorer la maintenabilité, réduire le risque de bugs en prod, et rendre les évolutions futures plus rapides/sûres.

## Résumé de l’audit

### 1) Bugs / risques fonctionnels concrets

- **Risque de régression sur le calcul de moyenne générale (spécification vs implémentation historique)**
  - Le chemin **actuel** de calcul global (via sujet virtuel global) est cohérent avec le cahier des charges.
  - Une ancienne fonction reste marquée bug (`calculateAverageForSubjects`) dans `apps/client/src/utils/average.ts` (double comptage possible sur matières non-display imbriquées).
  - Risque: divergence future si ce chemin est réutilisé/modifié sans garde-fous.
- **Incohérence de clé React Query (cache pas invalidé correctement)**
  - Lecture: `apps/client/src/hooks/use-grade.ts` utilise `queryKey: ["grades", gradeId]`
  - Invalidation: `apps/client/src/components/forms/update-grade-form.tsx` invalide `["grade", gradeId]`
  - Risque: données périmées après update.
- **Mutation involontaire de données potentiellement mises en cache**
  - `apps/client/src/hooks/use-active-year.ts` fait `years.sort(...)` (tri in-place)
  - Risque: effets de bord, ordre modifié globalement.
- **Mise à jour hiérarchique non transactionnelle**
  - `apps/api/src/routes/subjects.ts` (TODO `Use transactions`)
  - Risque: hiérarchie partiellement mise à jour si erreur au milieu.
- **Gestion d’erreurs incomplète sur créations critiques**
  - `apps/api/src/routes/years.ts` (TODO `Error Handling`)

### 2) Dette de conception / maintenabilité

- **Très forte duplication de logique d’auth/permissions dans les routes API**
  - Nombreuses répétitions de `if (!session)` + `EMAIL_NOT_VERIFIED` dans `apps/api/src/routes/*`
- **Types relâchés (`any`, cast, `ts-ignore`)**
  - Exemples: onboarding/forms/UI complexes et `year-review-story`.
- **Fichiers monolithiques**
  - `apps/client/src/components/year-review/year-review-story.tsx` (~2800+ lignes)
  - `apps/client/src/utils/average.ts` (~3000+ lignes)
  - `apps/client/src/components/ui/dropdrawer.tsx` (~1100+ lignes)
- **Mélange logique métier + UI + side effects** dans plusieurs formulaires (difficile à tester et à relire).

### 3) Qualité / standards

- `@ts-ignore` trouvé dans UI (`dropdrawer`) et `@ts-expect-error` dans `year-review-story`.
- Commentaire inapproprié trouvé dans `year-review-story.tsx` sur un `@ts-expect-error`.
- Plusieurs TODO techniques persistants dans des zones sensibles (transactions, bug moyenne, error handling).

### 4) Alignement au cahier des charges (calcul des moyennes)

- Le cahier des charges est présent dans `cahier-des-charges-calcul-moyennes.md`.
- Vérification effectuée:
  - Règle display/catégorie respectée par le chemin actuel (les nœuds display ne doivent pas contribuer directement au parent).
  - Moyenne générale attendue basée sur les nœuds non-display pertinents (exemple normatif: `E`, `J`, `B`, pas `A`).
  - Contrainte anti double-comptage explicitement présente dans le cahier.
- Manque actuel:
  - Pas de tests automatisés qui figent l’exemple normatif du cahier (risque de régression silencieuse).

---

## Priorisation

## P0 — Stabilisation bugs critiques (en premier)

1. Corriger la clé d’invalidation React Query pour les notes (`grades` vs `grade`).
2. Sécuriser le calcul de moyenne générale vis-à-vis du cahier:
  - neutraliser/supprimer la voie historique buggée (`calculateAverageForSubjects`) pour le global,
  - ajouter des tests de conformité (exemple normatif du cahier + cas anti double-comptage).
3. Éliminer le tri in-place dans `use-active-year.ts` (copie avant tri).
4. Encadrer l’update de hiérarchie des matières dans une transaction DB.
5. Ajouter une gestion d’erreurs homogène sur les endpoints `years` signalés.

**Critère de sortie P0**: moyenne générale conforme au cahier et couverte par tests, cache cohérent après mutation note, pas d’update partiel de hiérarchie.

## P1 — Réduction de la duplication côté API

1. Créer un middleware utilitaire `requireSessionAndVerifiedEmail`.
2. Remplacer les blocs répétitifs dans routes `grades/subjects/periods/years/averages/users`.
3. Standardiser les erreurs API (`code`, `message`, status).

**Critère de sortie P1**: suppression massive du boilerplate auth/email dans les handlers.

## P2 — Renforcement du typage et contrat de données

1. Remplacer `any` prioritaires (forms, onboarding, utils/error).
2. Supprimer `@ts-ignore` / `@ts-expect-error` via typage précis.
3. Créer types partagés pour payloads API (client+api) sur opérations critiques (grades, subjects, averages).

**Critère de sortie P2**: suppression des échappements TS dans zones critiques + DX améliorée.

## P3 — Découpage des fichiers monolithiques

1. Extraire la logique métier de `utils/average.ts` en modules:
   - `average-tree.ts`
   - `average-custom-config.ts`
   - `average-period.ts`
   - `average-compute.ts`
2. Découper `year-review-story.tsx` en:
   - composants de slides
   - hooks animation/timing
   - mapping de données/statistiques
3. Découper `dropdrawer.tsx` en primitives mobiles/desktop + logique partagée.

**Critère de sortie P3**: fichiers plus petits, responsabilités claires, meilleure testabilité.

---

## Plan d’exécution proposé (itératif)

### Sprint A (P0)
- Corriger cache key note.
- Corriger tri in-place `use-active-year`.
- Verrouiller la conformité moyenne générale (suppression voie legacy risquée + tests normatifs).
- Mettre transaction sur update de profondeur des matières.
- Compléter error handling routes years.

### Sprint B (P1 + début P2)
- Introduire middleware auth/email vérifié.
- Migrer progressivement les routes API.
- Commencer remplacement des `any` les plus risqués (forms notes/moyennes + onboarding).

### Sprint C (P2 avancé + P3)
- Finir retrait `ts-ignore` / `ts-expect-error`.
- Extraire `average.ts` en modules.
- Extraire `year-review-story` + `dropdrawer`.

---

## Stratégie de refactor (safe)

1. **Refactor par petites PRs** (1 problème = 1 lot).
2. **Pas de changement de comportement fonctionnel** hors bugfix ciblé.
3. **Validation après chaque lot**:
   - `check-types`
   - lint ciblé
   - tests/validation manuelle sur flux notes/matières/moyennes
4. **Feature flags non nécessaires** sauf si impact UX critique.

---

## Liste de tâches concrètes (backlog exécutable)

### API
- [ ] Créer middleware `requireSessionAndVerifiedEmail`.
- [ ] Appliquer middleware à `grades.ts`, `subjects.ts`, `periods.ts`, `years.ts`, `averages.ts`, `users.ts`.
- [ ] Transactionnaliser update profondeur descendants dans `subjects.ts`.
- [ ] Uniformiser error handling dans `years.ts`.

### Client
- [ ] Corriger query key `grade`/`grades`.
- [ ] Corriger mutation in-place dans `use-active-year.ts`.
- [ ] Éviter toute utilisation future de `calculateAverageForSubjects` pour le global (voie legacy buggée).
- [ ] Ajouter tests de conformité moyenne (règle display + exemple normatif `E`,`J`,`B` + anti double-comptage).
- [ ] Remplacer `any` prioritaires dans forms moyennes/notes.
- [ ] Supprimer `@ts-ignore` de `dropdrawer.tsx`.
- [ ] Supprimer `@ts-expect-error` de `year-review-story.tsx` + nettoyer le commentaire.

### Architecture
- [ ] Décomposer `average.ts`.
- [ ] Décomposer `year-review-story.tsx`.
- [ ] Décomposer `dropdrawer.tsx`.

---

## Définition de "Done"

- Aucun TODO critique restant dans les zones ciblées P0/P1.
- Plus d’incohérence de query keys sur les notes.
- Aucune opération hiérarchique non transactionnelle côté subjects.
- Calcul des moyennes conforme au cahier:
  - un nœud display n’est jamais compté directement dans son parent,
  - pas de double comptage parent+descendant,
  - l’exemple normatif (moyenne générale sur `E`,`J`,`B`) est validé par test.
- Réduction visible des `any`/échappements TS en zones critiques.
- Découpage des gros fichiers avec responsabilités explicites.
- Build/typecheck passent sur tout le monorepo.

---

## Ce que je vais faire ensuite

Je propose de démarrer immédiatement par **Sprint A (P0)** en premier:
1) bug cache note,
2) tri in-place active year,
3) bug moyenne globale,
4) transaction subjects,
5) error handling years.
