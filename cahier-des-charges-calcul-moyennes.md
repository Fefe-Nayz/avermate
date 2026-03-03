# Cahier des charges — Calcul des moyennes

## 1) Objectif
Définir précisément les règles de calcul des moyennes par matière dans une arborescence de matières et sous-matières.

Le document couvre :
- le calcul de la moyenne d’une matière,
- le traitement des matières de type **display/catégorie**,
- le calcul de la moyenne générale,
- les hypothèses actuelles de données.

---

## 2) Définitions

- **Matière** : nœud de l’arborescence (peut avoir des notes, des sous-matières, ou les deux selon les règles de version).
- **Sous-matière** : matière enfant d’une matière parent.
- **Matière display / catégorie** : matière dont la moyenne est uniquement d’affichage.
- **Note** : valeur notée avec un coefficient de note.
- **Coefficient matière** : poids d’une matière dans la moyenne de son parent.

### 2.1 Notation
- Note normalisée : `note.value / note.outOf`
- Coefficient de note par défaut : `1` si absent
- Coefficient matière par défaut : `1` si absent

---

## 3) Règles fonctionnelles

## 3.1 Calcul d’une matière (règle générale)
La moyenne d’une matière est calculée selon **un seul mode** :

1. **Moyenne pondérée des sous-matières** (si la matière possède des sous-matières pertinentes), ou
2. **Moyenne pondérée des notes** (si la matière est feuille).

> Dans la version actuelle, une matière qui possède des sous-matières n’a pas de notes, et une matière display n’a pas de notes.

## 3.2 Règle display/catégorie
- Une matière display peut avoir une moyenne calculée pour l’interface (valeur visuelle).
- Cette moyenne display **ne doit jamais être utilisée telle quelle** dans le calcul d’un parent.
- Lorsqu’un parent contient une matière display, le calcul du parent doit **ignorer le nœud display** et **remonter ses descendants non-display**.

Conséquence :
- Le display sert de regroupement visuel uniquement.
- Le parent hérite du contenu réel (matières non-display) situé sous ce display.

## 3.3 Pondération
- Les moyennes de notes sont pondérées par les coefficients des notes.
- Les moyennes entre matières sont pondérées par les coefficients des matières.
- Si un coefficient est absent, la valeur par défaut est `1`.

## 3.4 Cas sans données
- Si aucune note exploitable n’existe dans le périmètre de calcul (ou somme des coefficients = 0), la moyenne est `null` (non calculable).

---

## 4) Règles de calcul détaillées

## 4.1 Feuille (matière sans sous-matière)
La moyenne d’une matière feuille est :

$$
M_{feuille} = \frac{\sum (n_i \times c_i)}{\sum c_i}
$$

avec :
- $n_i = \frac{value_i}{outOf_i}$,
- $c_i$ le coefficient de la note,
- puis conversion de l’échelle normalisée vers la note finale (ex. sur 20).

## 4.2 Matière avec sous-matières
La moyenne d’une matière parent est :

$$
M_{parent} = \frac{\sum (M_{enfant\_pertinent} \times C_{enfant})}{\sum C_{enfant}}
$$

où :
- `enfant_pertinent` = matière non-display directement enfant, ou descendants non-display d’un enfant display,
- $C_{enfant}$ = coefficient matière.

## 4.3 Matière display
La moyenne d’une matière display est calculée de la même manière qu’un parent classique **pour affichage seulement**.
Cette valeur ne doit pas être reprise comme contribution directe dans un calcul parent.

---

## 5) Exemple normatif

Arborescence :

- A (display)
  - B
    - C
    - D
  - J

- E
  - F (display)
    - G
    - H
  - I

Règles attendues :

- `H`, `G`, `C`, `D`, `J`, `I` : moyenne pondérée de leurs notes.
- `F` : moyenne pondérée de `G` et `H` (visuel).
- `B` : moyenne pondérée de `C` et `D`.
- `A` : moyenne pondérée de `B` et `J` (visuel).
- `E` : moyenne pondérée de `G`, `H` et `I` (on ignore `F` comme nœud display et on remonte ses enfants).
- **Moyenne générale** : moyenne pondérée de `E`, `J`, `B` (et non `A`).

---

## 6) Contraintes actuelles (version en cours)

1. Une matière display n’a pas de notes.
2. Une matière ayant des sous-matières n’a pas de notes.
3. Le calcul ne doit pas doubler une contribution (pas de double comptage via parent + descendant).

---

## 7) Critères d’acceptation

Le comportement est conforme si :

1. Les feuilles calculent leurs moyennes à partir des notes pondérées.
2. Les parents non-display calculent une moyenne pondérée de matières non-display pertinentes.
3. Les nœuds display n’influencent pas directement le parent, seuls leurs descendants non-display remontent.
4. L’exemple normatif produit exactement :
   - `E` basé sur `G`, `H`, `I`,
   - moyenne générale basée sur `E`, `J`, `B`.
5. Si aucun coefficient utile n’existe, la moyenne retournée est `null`.

---

## 8) Hors périmètre (pour l’instant)

- Mélange « notes + sous-matières » sur une même matière.
- Règles spécifiques de priorité si ce mélange est autorisé plus tard.
- Arrondis d’affichage (nombre de décimales, méthode d’arrondi), à préciser par le produit/UI.
