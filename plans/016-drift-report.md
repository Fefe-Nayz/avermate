# Plan 016 — inventaire de dérive Web / React Native

Analyse figée le 20 août 2026, avant extraction. La commande de dérive du
plan (`git diff --stat 46c966b..HEAD -- packages/core/src apps/web/src/lib
apps/mobile/lib docs/`) passe. Les extraits annoncés par le plan existent
toujours et leur structure reste extractible sans redesign.

## Périmètre et verdict global

- Le Web et React Native déclarent les mêmes 12 presets Studio et les mêmes
  7 palettes publiques.
- Les 9 couleurs réellement lues par l'adapter natif sont identiques à celles
  du Web. `#f3efdF` / `#f3efdf` est la seule différence textuelle; la couleur
  est identique après normalisation de casse.
- Le Web conserve des sémantiques CSS plus riches (32 tokens, 5 séries de
  graphique, textes secondaires et sidebar). React Native les projette vers
  une palette volontairement plus étroite.
- L'utilisateur a exclu React Native de cette livraison. Son adapter est donc
  inspecté ici mais reste strictement inchangé; sa migration vers Core est une
  phase différée explicite, pas une dérive corrigée en douce.

## Presets Studio

Pour chaque mode, « 9/9 » compare `background`, `foreground`, `surface`,
`muted`, `mutedForeground`, `primary`, `primaryForeground`, `secondary` et
`border`. Les métadonnées Web-only sont `label`, `description` et `badge`;
les données Web-only sont `secondaryForeground` et les cinq couleurs de
graphique.

| Preset            | Présence | Couleurs partagées    | Shape     | Différences                                              | Verdict                                    |
| ----------------- | -------- | --------------------- | --------- | -------------------------------------------------------- | ------------------------------------------ |
| `marshmallow`     | Web + RN | 9/9 clair, 9/9 sombre | identique | métadonnées + tokens riches Web-only                     | intentionnel (idiome plateforme)           |
| `vs-code`         | Web + RN | 9/9 clair, 9/9 sombre | identique | métadonnées + tokens riches Web-only                     | intentionnel (idiome plateforme)           |
| `spotify`         | Web + RN | 9/9 clair, 9/9 sombre | identique | métadonnées + tokens riches Web-only                     | intentionnel (idiome plateforme)           |
| `neo-brutalism`   | Web + RN | 9/9 clair, 9/9 sombre | identique | casse de `#f3efdF`; métadonnées + tokens riches Web-only | dérive textuelle sans effet + intentionnel |
| `caffeine`        | Web + RN | 9/9 clair, 9/9 sombre | identique | métadonnées + tokens riches Web-only                     | intentionnel (idiome plateforme)           |
| `material-design` | Web + RN | 9/9 clair, 9/9 sombre | identique | métadonnées + tokens riches Web-only                     | intentionnel (idiome plateforme)           |
| `modern-minimal`  | Web + RN | 9/9 clair, 9/9 sombre | identique | métadonnées + tokens riches Web-only                     | intentionnel (idiome plateforme)           |
| `nature`          | Web + RN | 9/9 clair, 9/9 sombre | identique | métadonnées + tokens riches Web-only                     | intentionnel (idiome plateforme)           |
| `pastel-dreams`   | Web + RN | 9/9 clair, 9/9 sombre | identique | métadonnées + tokens riches Web-only                     | intentionnel (idiome plateforme)           |
| `midnight-bloom`  | Web + RN | 9/9 clair, 9/9 sombre | identique | métadonnées + tokens riches Web-only                     | intentionnel (idiome plateforme)           |
| `claude`          | Web + RN | 9/9 clair, 9/9 sombre | identique | métadonnées + tokens riches Web-only                     | intentionnel (idiome plateforme)           |
| `perplexity`      | Web + RN | 9/9 clair, 9/9 sombre | identique | métadonnées + tokens riches Web-only                     | intentionnel (idiome plateforme)           |

## Palettes nommées et saisons

| Domaine                   | Web                                                                                          | React Native                              | Différence                    | Verdict                                    |
| ------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------- | ----------------------------- | ------------------------------------------ |
| palettes publiques        | `default`, `ocean`, `forest`, `sunset`, `grape`, `rose`, `amber`                             | mêmes 7 IDs                               | aucune                        | aligné                                     |
| palette gagnée            | `mokattam`, liste séparée                                                                    | valeur supportée mais hors liste publique | exposition différente         | intentionnel (déverrouillage)              |
| palette personnalisée     | 32 variables CSS validées                                                                    | projection de 9 clés couleur sûres        | grammaire/capacité différente | intentionnel (idiome plateforme)           |
| saisons                   | `auto`, `none`, `newYear`, `spring`, `summer`, `autumn`, `halloween`, `winter`, `aprilFools` | mêmes 9 IDs                               | aucune                        | aligné                                     |
| calcul saisonnier         | mêmes bornes calendaires                                                                     | mêmes bornes calendaires                  | code dupliqué                 | dérive potentielle; extraction Core prévue |
| couleurs palettes/saisons | OKLCH + séries + paires de contraste                                                         | sRGB hex + triplet accent                 | espaces et étendue différents | intentionnel (adapter plateforme)          |
| `aprilFools`              | palette complète volontairement spectaculaire                                                | accent seulement                          | étendue différente            | intentionnel (adapter plateforme)          |

## Contrat des tokens de preset

| Token Web                    | Clé React Native         | Différence                                    | Verdict                                     |
| ---------------------------- | ------------------------ | --------------------------------------------- | ------------------------------------------- |
| `background`                 | `background`             | aucune                                        | aligné                                      |
| `foreground`                 | `text`                   | renommage                                     | intentionnel (idiome plateforme)            |
| `card`                       | `surface`                | renommage                                     | intentionnel (idiome plateforme)            |
| `card-foreground`            | `text`                   | surface et page partagent l'encre             | intentionnel                                |
| `popover`                    | `surfaceRaised`          | même seed `surface`                           | intentionnel                                |
| `popover-foreground`         | `text`                   | surface et page partagent l'encre             | intentionnel                                |
| `primary`                    | `accent`                 | renommage                                     | intentionnel (idiome plateforme)            |
| `primary-foreground`         | `accentText`             | renommage                                     | intentionnel (idiome plateforme)            |
| `secondary`                  | `accentSoft`             | renommage                                     | intentionnel (idiome plateforme)            |
| `secondary-foreground`       | —                        | texte général hérité                          | intentionnel                                |
| `muted`                      | repli de `accentSoft`    | jamais utilisé quand `secondary` existe       | intentionnel                                |
| `muted-foreground`           | `textMuted`, `textFaint` | deux poids natifs partagent la seed           | intentionnel                                |
| `accent`                     | `accentSoft`             | Web l'égale à `secondary`                     | aligné par projection                       |
| `accent-foreground`          | —                        | texte général hérité                          | intentionnel                                |
| `destructive`                | `negative`               | valeur native de base, non changée par preset | intentionnel                                |
| `border`                     | `border`, `hairline`     | deux traits partagent la seed                 | intentionnel                                |
| `input`                      | `border`, `hairline`     | Web l'égale à `border`                        | aligné par projection                       |
| `ring`                       | `accent`                 | Web l'égale à `primary`                       | aligné par projection                       |
| `chart-1`                    | `chart1` de base         | le preset natif ne le remplace pas            | drift fonctionnel différé avec l'adapter RN |
| `chart-2`                    | —                        | série non exposée                             | intentionnel (capacité plateforme)          |
| `chart-3`                    | —                        | série non exposée                             | intentionnel (capacité plateforme)          |
| `chart-4`                    | —                        | série non exposée                             | intentionnel (capacité plateforme)          |
| `chart-5`                    | —                        | série non exposée                             | intentionnel (capacité plateforme)          |
| `sidebar`                    | `surface`                | pas de surface sidebar dédiée                 | intentionnel (navigation native)            |
| `sidebar-foreground`         | `text`                   | pas d'encre sidebar dédiée                    | intentionnel (navigation native)            |
| `sidebar-primary`            | `accent`                 | pas d'accent sidebar dédié                    | intentionnel (navigation native)            |
| `sidebar-primary-foreground` | `accentText`             | pas d'encre sidebar dédiée                    | intentionnel (navigation native)            |
| `sidebar-accent`             | `accentSoft`             | pas de secondaire sidebar dédié               | intentionnel (navigation native)            |
| `sidebar-accent-foreground`  | —                        | texte général hérité                          | intentionnel (navigation native)            |
| `sidebar-border`             | `border`                 | pas de bordure sidebar dédiée                 | intentionnel (navigation native)            |
| `sidebar-ring`               | `accent`                 | pas de focus sidebar dédié                    | intentionnel (navigation native)            |

## Clés supplémentaires de la palette native

| Clé React Native | Équivalent Web                            | Différence                           | Verdict                           |
| ---------------- | ----------------------------------------- | ------------------------------------ | --------------------------------- |
| `surfaceRaised`  | `popover` / `card`                        | même couleur par preset              | intentionnel                      |
| `hairline`       | `border` / `input`                        | même couleur par preset              | intentionnel                      |
| `textFaint`      | `muted-foreground`                        | même couleur par preset              | intentionnel                      |
| `positive`       | `--positive`                              | sRGB vs OKLCH                        | intentionnel (adapter plateforme) |
| `negative`       | `--negative` / `destructive`              | sRGB vs OKLCH                        | intentionnel (adapter plateforme) |
| `chart1`         | `--chart-1`                               | seul canal natif; preset non projeté | drift fonctionnel différé         |
| `band.*`         | `--band-*`                                | mêmes cinq sens, sRGB vs OKLCH       | intentionnel (adapter plateforme) |
| `bandSoft.*`     | surfaces douces calculées par composition | matérialisées uniquement côté natif  | intentionnel (idiome plateforme)  |

## Rayon et typographie

| Donnée            | Web                              | React Native                  | Différence                      | Verdict                                         |
| ----------------- | -------------------------------- | ----------------------------- | ------------------------------- | ----------------------------------------------- |
| rayon de base     | `0.625rem` (10 px à 16 px)       | `lg: 10`                      | aucune                          | aligné                                          |
| échelle partagée  | 6 / 8 / 10 / 14 px (`sm`…`xl`)   | 6 / 8 / 10 / 14 px            | aucune                          | aligné                                          |
| grands rayons     | 18 / 22 / 26 px                  | —                             | capacité CSS-only               | intentionnel                                    |
| pilule            | `rounded-full`                   | `pill: 999`                   | représentation différente       | intentionnel                                    |
| fonts de preset   | 12 IDs utilisés                  | mêmes 12 IDs dans `shape`     | aucune                          | aligné                                          |
| catalogue complet | 19 choix avec libellés et stacks | aucun catalogue local complet | chargement et fallback Web-only | intentionnel; données pures extraites dans Core |

## Décision d'extraction

Core devient la source canonique des 12 presets (métadonnées, shape et 32
tokens calculés), des IDs, des bandes, des accents saisonniers, de l'échelle
de rayon et du catalogue de polices. Le Web devient un adapter sans littéral
de couleur. Les représentations CSS restent vérifiées par contrat. La future
migration React Native devra projeter ces objets vers `Palette`, corriger
`chart1`, puis exécuter l'export Expo; elle est volontairement hors de cette
livraison.
