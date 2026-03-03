# Cahier des charges — Moyennes personnalisées

## 1) Objectif
Permettre à l’utilisateur de créer des **moyennes personnalisées** en sélectionnant un ensemble de matières, avec :
- un **coefficient personnalisé** optionnel par matière,
- un choix **inclure / ne pas inclure les sous-matières**.

Le calcul doit rester cohérent avec les règles générales de calcul des moyennes.

---

## 2) Périmètre fonctionnel

## 2.1 Création / édition d’une moyenne personnalisée
Une moyenne personnalisée contient :
- `name` : nom de la moyenne personnalisée,
- `subjects[]` : liste des matières sélectionnées,
  - `id` : identifiant matière,
  - `customCoefficient` : nombre optionnel (`null` si non défini),
  - `includeChildren` : booléen (défaut `true`),
- `isMainAverage` : afficher sur la page principale (booléen).

## 2.2 Règles de validation
- `name` requis, longueur 1 à 64.
- `subjects` requis à la création, minimum 1 matière.
- `customCoefficient` optionnel, bornes : 1 à 1000.
- La matière doit exister.
- La matière doit appartenir à l’utilisateur authentifié.
- La matière doit appartenir à la même année (`yearId`) que la moyenne.

---

## 3) Règles de calcul métier

## 3.1 Principe général
Le calcul d’une moyenne personnalisée reprend les règles du calcul général, avec une différence :
- si un `customCoefficient` est défini pour une matière incluse, ce coefficient **remplace** le coefficient matière standard pour la contribution concernée.

## 3.2 Inclusion d’une matière
Une matière est incluse dans la moyenne personnalisée si :
1. elle est explicitement présente dans `subjects[]`, ou
2. un de ses ancêtres est présent dans `subjects[]` avec `includeChildren = true`.

## 3.3 Règle `includeChildren`
Pour une matière sélectionnée :
- `includeChildren = true` : ses descendants peuvent participer au calcul selon les règles d’héritage d’inclusion.
- `includeChildren = false` : ses sous-matières/descendants **ne participent pas** via cette sélection.

Exigence explicite :
- Si les sous-matières ne sont pas incluses, elles ne jouent **aucun rôle** dans le calcul de cette matière dans la moyenne personnalisée.

## 3.4 Règles display/catégorie
- Une matière `display/catégorie` reste un nœud visuel.
- Sa moyenne peut être affichée mais ne doit pas être prise comme contribution directe d’un parent.
- Le calcul remonte les descendants non-display pertinents selon les règles d’inclusion custom.

## 3.5 Coefficients
- Coefficient matière custom prioritaire :
  - si `customCoefficient` est défini, utiliser cette valeur,
  - sinon utiliser le coefficient matière standard.
- Coefficients de notes inchangés (règles générales).

## 3.6 Cas non calculable
- Si la somme des coefficients utiles est 0, la moyenne retournée est `null`.
- Si une matière incluse n’a aucune note exploitable dans son périmètre effectif (ex: `includeChildren=false` et pas de notes directes), sa contribution est ignorée (ou `null` au niveau matière).

---

## 4) Algorithme attendu (fonctionnel)
1. Construire la configuration custom (`subjectId -> { customCoefficient, includeChildren }`).
2. Déterminer le périmètre de matières incluses (inclusion directe + héritée via ancêtre avec `includeChildren=true`).
3. Calculer les moyennes matière selon les règles générales (notes pondérées ou sous-matières pondérées).
4. Appliquer les coefficients custom lorsqu’ils existent.
5. Agréger en moyenne finale pondérée.
6. Retourner `null` si aucun coefficient exploitable.

---

## 5) Exemple normatif

Configuration :
- Matière `Mathématiques - Écrit` sélectionnée, `customCoefficient = 1`, `includeChildren = false`.
- Matière `Physique-Chimie - Écrit` sélectionnée, `customCoefficient = 1`, `includeChildren = false`.

Effet attendu :
- Seules ces matières contribuent directement.
- Leurs sous-matières ne contribuent pas via cette moyenne custom.
- Le calcul final est une moyenne pondérée de ces contributions avec les coefficients personnalisés fournis (ici 1 et 1).

---

## 6) Contraintes de version (actuelles)
- Les matières display n’ont pas de notes.
- Les matières avec sous-matières n’ont pas de notes.

Conséquence :
- Sélectionner une matière parent avec `includeChildren=false` peut la rendre non calculable (pas de notes directes), donc sans contribution effective.

---

## 7) Critères d’acceptation
1. Un utilisateur peut créer/modifier/supprimer une moyenne personnalisée.
2. Une moyenne personnalisée contient une liste de matières avec `customCoefficient` optionnel et `includeChildren`.
3. `includeChildren=false` exclut totalement les descendants de la contribution de la matière sélectionnée.
4. `customCoefficient` remplace le coefficient matière standard quand il est renseigné.
5. Les contrôles d’appartenance utilisateur et d’année sont appliqués.
6. Le résultat respecte les règles display/catégorie identiques au calcul général.
7. En absence de données calculables, le résultat est `null`.

---

## 8) Hors périmètre
- Règles d’arrondi d’affichage (nombre de décimales, stratégie d’arrondi).
- Priorisation avancée en cas de conflits de sélection (ex: parent+enfant avec options divergentes), au-delà des règles d’inclusion définies ci-dessus.
