# Plan 018 — Spike connecteurs PRONOTE, ÉcoleDirecte et Skolengo

_État des preuves : 20 août 2026. Investigation documentaire et probes
locales uniquement ; aucun compte scolaire ni service scolaire n'a été
contacté._

## Décision

- **GO, limité au design, pour un futur prototype de devoirs en lecture
  seule.** Le delta minimal est circonscrit et les trois écosystèmes exposent
  les données nécessaires. PRONOTE par QR/PIN est le premier candidat
  fonctionnel ; Skolengo par OIDC/PKCE est le meilleur candidat du point de
  vue des secrets.
- **NO-GO pour ajouter une dépendance ou un provider dans ce spike.** Le
  package demandé `pawdirecte` a été dépublié le 25 février 2026 ; le package
  `pawnote` est encore publié et utilisé par Papillon, mais son dépôt source
  déclaré est indisponible ; l'alternative ÉcoleDirecte actuelle est une
  alpha dont l'archive npm ne contient pas de fichier de licence ; le client
  Skolengo reste un petit projet GPL à durcir. Ces constats ne satisfont pas
  encore une revue de dépendance de production.
- **LATER pour fichiers, emploi du temps et notes.** Les fichiers disponibles
  sont surtout des pièces jointes sans arborescence de cours ; l'emploi du
  temps attend le modèle de récurrence/annulation ; les notes attendent un
  plan d'import et une UX de mapping des matières, périodes et types.

Il n'y a donc **ni prototype, ni dépendance, ni migration, ni router, ni MCP**
dans ce chantier. La condition de l'étape 3 — accord préalable du mainteneur
sur le delta de schéma — n'a pas été ouverte, et la consigne d'exécution était
explicitement documentaire.

## Périmètre, baseline et méthode

Le framework livré par le plan 008 est bien présent : le type live ne déclare
encore que `SyncCapability = "files"` dans
[`sync.ts:13`](../apps/server/src/db/schema/sync.ts), conformément au plan 008
qui réservait les autres capacités pour plus tard. Le contrat
[`SyncProvider`](../apps/server/src/sync/provider.ts) aux lignes 23–38 reste
orienté cours/fichiers (`listCourses`, `listFiles`, `download`). L'écart est
donc dans le texte d'anticipation du plan 018, pas dans l'implémentation 008 ;
il ne bloque pas ce rapport, mais il interdit de prétendre que `homework` est
déjà une simple valeur de registre.

Le statut synthétique de l'index n'est pas utilisé comme preuve ici. La
dépendance technique requise — registre provider, credentials scellés, jobs
et persistance d'identité distante — est directement présente côté serveur.

L'évaluation a fixé les sources applicatives à la révision Papillon
[`03dcc4e`](https://github.com/PapillonApp/Papillon/tree/03dcc4e0244f11c668bc9da36eba2750eaafe7e5)
du 18 août 2026. Son manifeste utilise actuellement
[`pawnote ^1.6.2`, `@blockshub/blocksdirecte ^0.0.8-alpha` et `skolengojs ^1.1.10`](https://github.com/PapillonApp/Papillon/blob/03dcc4e0244f11c668bc9da36eba2750eaafe7e5/package.json).
Autrement dit, `pawdirecte` n'est plus le client ÉcoleDirecte de Papillon.

Les faits de publication viennent du registre npm, les contrats des archives
publiées, et la maintenance des dépôts GitHub. Les pages officielles des
éditeurs servent uniquement au volet juridique/sécurité. Les constats
empiriques sont reproductibles dans la section « Probes » ; ils ne reposent
pas sur un compte réel.

## État des bibliothèques

### Publication, licence, runtime et santé

Chaque cellule ci-dessous contient sa propre source. Les dates « dernière
publication » désignent une version réellement publiée, pas le champ mutable
`modified` du registre.

| Option inspectée                                                                                | npm / dernière publication                                                                                                       | Licence publiée                                                                                                                                                                                | Runtime et dépendances                                                                                                                                                                                             | Santé communautaire au 20/08/2026                                                                                                                                                                                                                                     | Verdict de dépendance                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`pawnote`][npm-pawnote] (PRONOTE)                                                              | [`1.6.2`, 21/09/2025][registry-pawnote]                                                                                          | [`GPL-3.0-or-later` dans le manifeste et `LICENSE.md` dans l'archive][registry-pawnote]                                                                                                        | Dual ESM/CJS, quatre dépendances JS et installation Bun explicitement documentée dans l'[archive publiée][tar-pawnote] ; import Bun réussi dans [P-BUN](#p-bun--installation-et-import)                            | Le [dépôt déclaré][repo-pawnote] renvoie 404 et la documentation déclarée renvoie 502 lors du spike ; le package reste cependant utilisé par [Papillon courant][papillon-package]. Dernière publication il y a 11 mois : maintenabilité **fragile et non auditable**. | **NO-GO production en l'état** : restaurer un dépôt source immuable, des tags et une CI vérifiables. Candidat technique conditionnel pour un prototype, preuves [npm][registry-pawnote] + [Papillon][papillon-package]. |
| [`pawdirecte`][registry-pawdirecte] exact (ÉcoleDirecte)                                        | **Dépublié le 25/02/2026**, `npm view` renvoie E404 [registre][registry-pawdirecte]                                              | Le [dépôt historique][repo-pawdirecte-readme] annonce GPL-3.0 ; aucune archive npm installable ne permet de vérifier le contenu distribué [registre][registry-pawdirecte].                     | Non installable par nom/version, donc non probé sous Bun [P-BUN](#p-bun--installation-et-import).                                                                                                                  | Le [dépôt historique][repo-pawdirecte-readme] n'a plus de commit depuis 2024 ; Papillon l'a remplacé dans son [manifeste courant][papillon-package].                                                                                                                  | **NO-GO** : un package dépublié ne peut pas entrer dans un lockfile reproductible ; ni fork ni vendoring dans ce spike [registre][registry-pawdirecte].                                                                 |
| [`@papillonapp/ed-core`][npm-ed-core] (ancienne lignée ÉcoleDirecte)                            | [`0.2.9`, 16/04/2024][registry-ed-core]                                                                                          | [`GPL-3.0`, licence incluse][repo-ed-core-license]                                                                                                                                             | Node 18 déclaré, trois dépendances JS ; import Bun réussi [registre][registry-ed-core], [P-BUN](#p-bun--installation-et-import).                                                                                   | Le [dépôt][repo-ed-core] n'a plus de commit depuis avril 2024 et son README liste encore plusieurs fonctions incomplètes [roadmap][repo-ed-core-readme].                                                                                                              | **NO-GO** comme alternative actuelle : publication et code figés depuis plus de deux ans [registre][registry-ed-core], [dépôt][repo-ed-core].                                                                           |
| [`@blockshub/blocksdirecte`][npm-blocks] (client ÉcoleDirecte utilisé aujourd'hui par Papillon) | [`0.0.8-alpha`, 24/01/2026][registry-blocks] ; le dépôt annonce déjà `0.0.9-alpha` non publié [manifeste source][blocks-package] | Le manifeste annonce [`ISC`][blocks-package], mais ni le dépôt courant ni l'archive npm inspectée ne contiennent un fichier de licence [tarball][tar-blocks] : attribution/termes à clarifier. | Bundle ESM/CJS construit avec Bun, sans dépendance runtime déclarée ; import Bun réussi [manifeste][blocks-package], [P-BUN](#p-bun--installation-et-import).                                                      | [11 étoiles, 1 fork, aucun ticket et 1 PR ouvert][repo-blocks] ; dépôt poussé en avril 2026, mais API encore alpha [manifeste][blocks-package].                                                                                                                       | **LATER / revue juridique requise** : techniquement viable, mais alpha et licence distribuée ambiguë [manifeste][blocks-package], [archive][tar-blocks].                                                                |
| [`skolengojs`][npm-skolengo]                                                                    | [`1.1.10`, 03/09/2025][registry-skolengo]                                                                                        | [`GPL-3.0` avec fichier `LICENSE`][skolengo-license]                                                                                                                                           | Node `>=18`, dual ESM/CJS ; import Bun réussi et aucun addon natif, mais `typescript-eslint` est une dépendance runtime inutilement lourde [manifeste][skolengo-package], [P-BUN](#p-bun--installation-et-import). | [7 étoiles, 1 fork, 8 PR ouvertes][repo-skolengo] ; dernière révision de la branche principale en décembre 2025, toujours utilisée par [Papillon courant][papillon-package].                                                                                          | **LATER / candidat technique** : auth propre et API riche, sous réserve d'une revue GPL, d'un allègement des dépendances et de tests contractuels [manifeste][skolengo-package].                                        |

### Authentification à présenter dans Avermate

| Option                     | Parcours utilisateur vérifié                                                                                                                                                                                                                                                                                                            | Secret persistant admissible                                                                                                                                                                                                                                  | Conclusion sécurité                                                                                                                                                                                                  |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pawnote`                  | Depuis PRONOTE, l'utilisateur génère un QR, le scanne et saisit son PIN à quatre chiffres ; l'adaptateur Papillon appelle `loginQrCode` avec QR, PIN et UUID de device [onboarding courant][papillon-pronote-qr].                                                                                                                       | Le retour contient token, URL d'instance, type de compte et nom utilisateur ; le package expose ensuite `loginToken` [archive publiée][tar-pawnote]. Sceller `{version, instanceUrl, username, accountKind, deviceUUID, token}` ; **jamais le mot de passe**. | **Acceptable conditionnellement** : QR/PIN d'enrôlement, token lié au device ensuite [onboarding][papillon-pronote-qr]. Le PIN et le QR ne doivent ni être loggés ni être conservés.                                 |
| `pawdirecte` exact         | Aucun parcours courant vérifiable : le package est dépublié [registre][registry-pawdirecte].                                                                                                                                                                                                                                            | Aucun format ne doit être inventé à partir d'un package indisponible [registre][registry-pawdirecte].                                                                                                                                                         | **NO-GO**.                                                                                                                                                                                                           |
| `@blockshub/blocksdirecte` | L'enrôlement appelle `loginUsername(username, password, …, deviceUUID)`, puis éventuellement une question 2FA ; le refresh appelle `refreshToken` avec username, type de compte, token et UUID [Auth source][blocks-auth]. Papillon reproduit ce flux [onboarding][papillon-ed-login] puis le [refresh par token][papillon-ed-refresh]. | Le mot de passe n'est nécessaire que pendant l'échange initial et ne doit jamais être écrit. Sceller immédiatement `{version, username, accountKind, deviceUUID, token}` ; jeter mot de passe et réponse 2FA après l'appel [Auth source][blocks-auth].        | **Acceptable seulement si le refresh par token reste suffisant.** Si une rentrée ou une révocation impose de conserver le mot de passe pour les syncs, le connecteur devient automatiquement NO-GO.                  |
| `skolengojs`               | Sélection de l'établissement, création d'un flow OIDC/PKCE, ouverture de l'URL de connexion de l'IdP, puis échange du `code` avec vérification du `state` [OIDC source][skolengo-oidc]. Papillon utilise ce parcours en WebView [onboarding courant][papillon-skolengo-webview].                                                        | Sceller `{version, refreshToken, refreshUrl, tokenEndpoint, schoolId, emsCode}` ; le mot de passe reste sur la page de l'IdP et ne transite pas par un champ Avermate [onboarding][papillon-skolengo-webview].                                                | **Meilleure posture des trois** : OIDC/PKCE et refresh token. Il faut toutefois une callback web allowlistée, un `state` à usage unique et aucune navigation vers un origin arbitraire [OIDC source][skolengo-oidc]. |

### Couverture fonctionnelle réellement observée

« Fichiers » signifie ici compatibilité avec le contrat Avermate
`listCourses → listFiles`, et non la simple présence d'une URL de pièce
jointe.

| Bibliothèque                      | Fichiers                                                                                                                                                                                                                                                                    | Devoirs                                                                                                                                                     | Emploi du temps                                                                                           | Notes                                                                                               |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `pawnote`                         | **Partiel** : pièces jointes de devoirs et ressources dans l'archive, mais aucune arborescence de cours compatible `listCourses` dans le contrat publié inspecté [tarball][tar-pawnote] ; Papillon mappe les pièces jointes du devoir [adapter][papillon-pronote-homework]. | **Oui** : `assignmentsFromWeek/Intervals`, échéance, matière, état et pièces jointes [tarball][tar-pawnote], [adapter Papillon][papillon-pronote-homework]. | **Oui** : `timetableFromWeek/Intervals` dans l'archive et [adapter Papillon][papillon-pronote-timetable]. | **Oui** : `gradesOverview`/gradebook dans l'archive et [adapter Papillon][papillon-pronote-grades]. |
| `pawdirecte` exact                | **Non vérifiable** : package dépublié [registre][registry-pawdirecte].                                                                                                                                                                                                      | **Non vérifiable** : package dépublié [registre][registry-pawdirecte].                                                                                      | **Non vérifiable** : package dépublié [registre][registry-pawdirecte].                                    | **Non vérifiable** : package dépublié [registre][registry-pawdirecte].                              |
| `@papillonapp/ed-core` historique | **Partiel** : documents, manuels et téléchargement sont déclarés, sans contrat d'arbre de cours [roadmap][repo-ed-core-readme].                                                                                                                                             | **Oui mais ancien** : liste/par date/statut dans la [roadmap publiée][repo-ed-core-readme].                                                                 | **Oui mais ancien** : [roadmap publiée][repo-ed-core-readme].                                             | **Oui mais ancien** : [roadmap publiée][repo-ed-core-readme].                                       |
| `@blockshub/blocksdirecte`        | **Partiel** : downloader générique et documents attachés aux devoirs, sans arbre de cours [Downloader][blocks-downloader], [Homework][blocks-homework].                                                                                                                     | **Oui** : lecture upcoming/par date ; les méthodes d'écriture existent aussi mais seraient interdites dans Avermate [Homework][blocks-homework].            | **Oui** : intervalles datés et URL iCal [Timetable][blocks-timetable].                                    | **Oui** : notes par année scolaire [Mark][blocks-mark].                                             |
| `skolengojs`                      | **Partiel** : téléchargement de pièces jointes de devoir/news/message, pas de catalogue de cours [Attachments][skolengo-attachments], [Assignments][skolengo-assignments].                                                                                                  | **Oui** : liste datée, statut et pièces jointes ; la mutation de complétion existe mais serait interdite [Assignments][skolengo-assignments].               | **Oui** : agenda avec leçons, dates et annulations [Agenda][skolengo-agenda].                             | **Oui** : réglages, dernières notes et notes par période [Grades][skolengo-grades].                 |

### Historique de casse et cadence de rentrée

Les dépôts des petites bibliothèques ne fournissent pas un historique de
tickets suffisant pour mesurer statistiquement une cadence annuelle. En
revanche, les tickets du consommateur Papillon constituent une preuve
d'intégration primaire :

- PRONOTE a connu un groupe de pannes de connexion sécurisée/PIN entre le
  2 et le 4 septembre 2025 ([#270](https://github.com/PapillonApp/Papillon/issues/270),
  [#295](https://github.com/PapillonApp/Papillon/issues/295)), puis un besoin
  de reconnexion manuelle ouvert en octobre
  ([#449](https://github.com/PapillonApp/Papillon/issues/449)) et des devoirs
  non actualisés ([#531](https://github.com/PapillonApp/Papillon/issues/531),
  [#698](https://github.com/PapillonApp/Papillon/issues/698)).
- ÉcoleDirecte a produit des incidents de connexion en octobre 2025
  ([#527](https://github.com/PapillonApp/Papillon/issues/527),
  [#542](https://github.com/PapillonApp/Papillon/issues/542)) et deux épisodes
  « service en maintenance » en décembre
  ([#604](https://github.com/PapillonApp/Papillon/issues/604),
  [#615](https://github.com/PapillonApp/Papillon/issues/615)).
- Skolengo a eu un échec de connexion EduConnect à la rentrée 2025
  ([#290](https://github.com/PapillonApp/Papillon/issues/290)).

L'inférence raisonnable — et explicitement une **inférence**, pas une preuve
d'une périodicité garantie — est qu'une publication fonctionnelle en juillet
ne suffit pas pour certifier la rentrée suivante. Tout connecteur devra avoir
des canaris contractuels sans données personnelles, une fenêtre de
qualification fin août/début septembre, et une panne douce :
`syncConnections.status = "error"` + `lastError`, jamais une boucle de crash.
Cette couture existe déjà dans
[`sync.ts:46-48`](../apps/server/src/db/schema/sync.ts) et est utilisée par
[`run.ts:444-455`](../apps/server/src/sync/run.ts).

## Protocoles proposés, sans code de production

### Enrôlement

1. L'utilisateur choisit le provider et son année Avermate. Le serveur crée
   un challenge court, lié à l'utilisateur, avec expiration et usage unique.
2. PRONOTE : QR + PIN + UUID généré côté serveur. Skolengo : redirection
   OIDC/PKCE avec `state` exact et callback allowlistée. ÉcoleDirecte : le mot
   de passe peut transiter **une seule fois** dans la requête TLS
   d'enrôlement, sans log ni job, uniquement pour obtenir le token/device ;
   aucune persistance, même chiffrée.
3. Le serveur valide l'identité retournée, ne conserve que le compte choisi,
   scelle l'enveloppe JSON avec
   [`lib/crypto.ts`](../apps/server/src/lib/crypto.ts), puis détruit les
   valeurs d'enrôlement accessibles. Une réponse publique ne contient que
   label, provider, capacités et état — jamais QR, PIN, code, token ou URL de
   refresh avec paramètres secrets.
4. Une rotation de token remplace l'enveloppe scellée de façon atomique. Une
   révocation efface la connexion et ses secrets ; elle ne supprime pas les
   copies locales de devoirs sans choix explicite de l'utilisateur.

### Synchronisation

- Lecture seule côté service scolaire. Ne jamais appeler
  `assignmentStatus`, `markHomeworkAsDone`, `setCompletion` ou équivalent,
  même si les clients les exportent.
- Fenêtre bornée (par exemple J-14 à J+90), pagination, timeout, backoff avec
  jitter, limite par provider/connexion et aucune relance infinie.
- Identité distante : `(connectionId, capability, externalId)`. Le provider
  ne peut choisir ni `userId`, ni `yearId`, ni `localId`.
- Texte HTML, titres, noms de fichier, MIME et URLs sont non fiables : taille
  maximale avant parsing, sanitation au rendu, téléchargement seulement
  depuis les origins explicitement retournés/validés, redirects bornés,
  défense SSRF/DNS rebinding et contrôles de taille comme pour Moodle.
- Les erreurs techniques sont normalisées et expurgées avant `lastError` ;
  aucun header, body de login, token, code OIDC ou chemin avec query secrète
  dans les logs et payloads de job.

## Mapping des capacités vers Avermate

Les deltas ci-dessous sont des **propositions nommées**, pas des changements
réalisés.

| Capacité    | Landing zone et preuve live                                                                                                                                                                                                                                                                                                                                                                                                                                      | Delta minimal proposé                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Conflits et suppressions                                                                                                                                                                                                                                                                                                                                                                                                | Verdict                                                                                                                                                                                                             |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `homework`  | `plannerItems`, `kind="task"` ; le schéma possède déjà titre, notes, échéance, statut, matière et année dans [`planner.ts:29-58`](../apps/server/src/db/schema/planner.ts). Les trois clients courants exposent une identité, une échéance, un contenu et une matière ([PRONOTE][papillon-pronote-homework], [ÉcoleDirecte][blocks-homework], [Skolengo][skolengo-assignments]).                                                                                 | 1. Ajouter `"homework"` à `SyncCapability`.<br>2. Ajouter une facette optionnelle `listHomework(connection, window)` au lieu de forcer `listCourses/listFiles`.<br>3. Ajouter `plannerItems.origin`, valeurs `manual` et `sync`, défaut `manual`.<br>4. Typer `syncedResources.localKind` avec `plannerItem`.<br>5. Ajouter `syncedResources.syncState`, valeurs `managed`, `detached`, `missing`, `dismissed`.<br>6. Remplacer l'unicité par `(connectionId, capability, externalId)` : l'index actuel omet la capacité dans [`sync.ts:86-91`](../apps/server/src/db/schema/sync.ts). Aucun mapping matière obligatoire en v0 : conserver le libellé distant dans les notes et laisser `subjectId=null`. | À la création, stocker le hash canonique du payload mappé. Avant mise à jour, comparer le hash du task local au hash précédent : divergence ⇒ `detached`, **jamais écraser**. Suppression provider ⇒ `missing`, conserver le task. Suppression utilisateur ⇒ tombstone `dismissed`, ne pas recréer. Réapparition provider ⇒ réactiver seulement un item `missing` resté inchangé ; jamais un `detached` ou `dismissed`. | **GO pour un futur prototype flag-gated et stub-testé**, PRONOTE QR en premier, Skolengo OIDC en repli. **Pas implémenté ici** : accord de schéma préalable absent et dépendance PRONOTE non auditable aujourd'hui. |
| `files`     | `materialDocuments` est la landing zone 005 ; le modèle live n'accepte que les origins `manual` et `moodle` dans [`materials.ts:21-22,62-90`](../apps/server/src/db/schema/materials.ts). Les clients inspectés fournissent surtout des pièces jointes ([PRONOTE][papillon-pronote-homework], [ÉcoleDirecte][blocks-downloader], [Skolengo][skolengo-attachments]), pas le tree de cours attendu par [`provider.ts:31-38`](../apps/server/src/sync/provider.ts). | 1. Remplacer `MaterialOrigin` par les valeurs génériques `manual` et `sync`, et laisser `syncedResources` porter le provider réel.<br>2. Ajouter une facette `listAttachments` avec provenance parent (`homework`, `news`, etc.) plutôt que fabriquer des cours.<br>3. Étendre le `localKind` typé à `materialDocument`, valeur déjà écrite par `run.ts:424`.<br>4. Réutiliser le même `syncState` et la clé unique incluant capability.                                                                                                                                                                                                                                                                  | Même règle de détachement sur édition. Une pièce jointe retirée devient `missing`, pas supprimée. Le téléchargement doit conserver le hash, byteSize et MIME vérifiés ; une URL expirée est rafraîchie, jamais persistée comme secret.                                                                                                                                                                                  | **LATER** pour ces providers : écrire d'abord le contrat « pièce jointe sans cours » et l'UX de rattachement matière/dossier. Le connecteur Moodle existant reste inchangé.                                         |
| `timetable` | `plannerItems`, `kind="event"` ; le schéma précise que récurrence et rappels sont volontairement absents [`planner.ts:24-28`](../apps/server/src/db/schema/planner.ts). Les clients exposent des occurrences, salles et annulations ([PRONOTE][papillon-pronote-timetable], [ÉcoleDirecte][blocks-timetable], [Skolengo][skolengo-agenda]).                                                                                                                      | 1. Ajouter `"timetable"` et `listTimetable`.<br>2. Livrer d'abord `plannerRecurrences` prévu par le plan 004.<br>3. Ajouter aux events `location` et `eventState`, valeurs `scheduled` et `cancelled`.<br>4. Ajouter `origin`, `syncState` et `localKind="plannerItem"`.<br>5. Définir timezone de l'établissement et identité stable de l'occurrence.                                                                                                                                                                                                                                                                                                                                                    | Un cours déplacé doit mettre à jour la même occurrence si elle est managed ; une annulation doit la marquer `cancelled`, jamais la supprimer. Une édition locale détache l'occurrence ou toute la série selon un choix UX explicite.                                                                                                                                                                                    | **LATER**, après le plan récurrence/annulation et ses décisions d'UX. Importer des milliers d'événements one-shot avant ce modèle créerait une dette de fusion.                                                     |
| `grades`    | `grades` référence des structures possédées par l'utilisateur : valeur/barème, `subjectId`, `periodId`, `typeId` dans [`app.ts:383-426`](../apps/server/src/db/schema/app.ts). Les trois clients exposent les notes ([PRONOTE][papillon-pronote-grades], [ÉcoleDirecte][blocks-mark], [Skolengo][skolengo-grades]).                                                                                                                                              | 1. Ajouter `"grades"` et `listGrades` seulement dans un plan dédié.<br>2. Ajouter `grades.origin`, valeurs `manual` et `sync`.<br>3. Ajouter `syncSubjectMappings(connectionId, externalSubjectId, subjectId)`, `syncPeriodMappings(…, periodId)` et `syncGradeTypeMappings(…, typeId)`, avec ownership et unicité.<br>4. Ajouter `localKind="grade"`, `syncState` et clé unique incluant capability.<br>5. Prévoir un import preview/undo et l'`importData` de la roadmap.                                                                                                                                                                                                                               | Jamais de matching automatique uniquement par nom. Un provider grade non mappé reste en preview. Une note locale est intouchable. Une note importée éditée devient `detached`; une note retirée côté provider devient `missing`. Un changement de période/type exige confirmation si le mapping n'est plus univoque.                                                                                                    | **LATER**, plan autonome obligatoire avec mapping UX, invariants domaine, preview/undo, export/import et tests d'idempotence. Aucun import de notes dans le spike.                                                  |

## Risques juridiques, licence et données personnelles

Ce rapport n'est pas un avis juridique. Il identifie des conditions de
go-live à faire valider par le mainteneur et, avant distribution à des
établissements, par un conseil/DPO.

1. **API non officielles et conditions des éditeurs.** Les trois packages se
   présentent comme non affiliés dans leurs README
   ([pawnote][tar-pawnote], [Pawdirecte][repo-pawdirecte-readme],
   [skolengojs][repo-skolengo]). INDEX ÉDUCATION décrit un service officiel
   de « connecteur partenaire » activé par le chef d'établissement et soumis
   à souscription dans ses
   [CGV 2025, p. 31](https://www.index-education.com/contenu/telechargement/doc/2025_CGV_INDEX%20EDUCATION.pdf).
   Skolengo présente aussi ses intégrations tierces comme un catalogue de
   connecteurs et de standards dans sa
   [documentation officielle](https://www.skolengo.com/fr/accompagnement).
   L'existence publique de Papillon ne vaut donc ni autorisation d'Avermate,
   ni garantie contre limitation, suspension de compte ou changement de
   protocole. Avant activation publique : demander une position écrite des
   éditeurs/établissements, vérifier les CGU réellement acceptées par
   l'utilisateur et prévoir un kill switch.
2. **Licences de dépendances.** `pawnote` et `skolengojs` sont GPL-3 ; leur
   inclusion dans un serveur distribué exige une décision de licence et une
   revue de compatibilité/obligations. Avermate n'a pas encore arrêté sa
   propre licence publique (roadmap du dépôt). BlocksDirecte annonce ISC dans
   `package.json`, mais ne distribue pas le texte de licence : bloquer
   l'adoption tant que le mainteneur amont ne corrige pas l'archive et ne
   confirme pas les droits.
3. **Données d'élèves et de mineurs.** Devoirs, emploi du temps et notes sont
   des données personnelles scolaires. La CNIL rappelle que la communauté
   éducative exige une protection stricte
   ([convention Éducation/CNIL](https://www.cnil.fr/fr/signature-dune-convention-triennale-sur-la-protection-des-donnees-personnelles-dans-les-usages))
   et que le traitement doit assurer chiffrement, confidentialité,
   intégrité, disponibilité et résilience
   ([article 32](https://cnil.fr/fr/reglement-europeen-protection-donnees/chapitre4)).
   Une offre opérée doit définir responsable/sous-traitant, base légale,
   information, durée, suppression/export, localisation, sous-traitants,
   incidents et besoin d'AIPD ; la CNIL exige des garanties contractuelles et
   techniques suffisantes pour les sous-traitants
   ([guide sécurité](https://www.cnil.fr/fr/securite-gerer-la-sous-traitance)).
4. **Minimisation.** N'importer que les capacités opt-in et la fenêtre utile ;
   ne jamais aspirer messagerie, vie scolaire, autres élèves ou documents non
   demandés parce que la bibliothèque les expose. Pas d'analytics sur le
   contenu scolaire. Suppression de connexion et purge des tokens doivent
   être immédiates ; conservation des copies locales doit être un choix
   explicite distinct.
5. **Risque opérationnel.** Rate limits, lockout, révocation de device,
   rentrée et maintenance doivent échouer visiblement mais doucement. Flag
   désactivé par défaut, circuit breaker, bouton « reconnecter », date de
   dernière réussite et erreur expurgée sont des critères de livraison.

## Probes et reproductibilité

### P-BUN — installation et import

Probe isolée hors workspace avec Bun `1.3.14` :

```powershell
$probe = Join-Path ([IO.Path]::GetTempPath()) "avermate-plan018-bun-probe"
New-Item -ItemType Directory -Force -Path $probe | Out-Null
bun add --cwd $probe pawnote@1.6.2 `
  @blockshub/blocksdirecte@0.0.8-alpha `
  skolengojs@1.1.10 @papillonapp/ed-core@0.2.9
Push-Location $probe
bun -e "await import('pawnote')"
bun -e "await import('@blockshub/blocksdirecte')"
bun -e "await import('skolengojs')"
bun -e "await import('@papillonapp/ed-core')"
Pop-Location
```

Résultat : installation et quatre imports exit 0. Le tree installé contient
zéro fichier `*.node` et aucun manifeste ne déclare de script
`preinstall/install/postinstall`. `pawdirecte` ne peut pas être ajouté :
`npm view pawdirecte` renvoie `E404 Unpublished on
2026-02-25T08:50:47.958Z`. Aucune fonction réseau des bibliothèques n'a été
appelée.

Archives npm inspectées et empreintes SHA-256 :

| Archive                                   | SHA-256                                                            | Source                       |
| ----------------------------------------- | ------------------------------------------------------------------ | ---------------------------- |
| `pawnote-1.6.2.tgz`                       | `DA69922CB05066A13E643D69E150A8A4587A8FC20303B64BF71B8C356AD827A8` | [registre npm][tar-pawnote]  |
| `blockshub-blocksdirecte-0.0.8-alpha.tgz` | `6476993C5C865A63E136ED3578F25D73A0DBC90717354144C228C17D4815796E` | [registre npm][tar-blocks]   |
| `skolengojs-1.1.10.tgz`                   | `A604A82CBCF17A471C467F46C8245CD8A594DB76EEDEEFFD1104BEB9155C215D` | [registre npm][tar-skolengo] |
| `papillonapp-ed-core-0.2.9.tgz`           | `C2119D76704E9FF9E1BE84CFA6E48316472C00DA59F43B35DD332333A0158422` | [registre npm][tar-ed-core]  |

### Requêtes documentaires

```powershell
npm view pawnote version time license engines dependencies repository --json
npm view pawdirecte version time license engines dependencies repository --json
npm view @blockshub/blocksdirecte version time license engines dependencies repository --json
npm view @papillonapp/ed-core version time license engines dependencies repository --json
npm view skolengojs version time license engines dependencies repository --json
```

Les métadonnées GitHub ont été lues via l'API officielle et les capacités via
les fichiers verrouillés aux révisions citées dans ce rapport. Les recherches
de tickets ont porté sur `connexion`, `auth`, `token`, `rentrée` et les noms
des services. Les valeurs de popularité sont des instantanés, pas des seuils
de qualité.

## Critères d'acceptation d'un futur prototype homework

Un nouveau plan peut entrer en implémentation seulement si tous les points
suivants sont vrais :

- dépôt source et tag correspondant à l'archive npm accessibles, provenance
  vérifiable, licence compatible décidée ;
- accord juridique/DPO documenté pour le mode d'usage visé ;
- delta `origin`/`syncState`/unicité approuvé et migration isolée ;
- auth QR/device ou OIDC ; aucun mot de passe persistant, même scellé ;
- provider absent du picker quand le flag est off ; lecture seule garantie
  par types et tests ;
- stubs de rentrée, rotation/révocation, doublon, édition locale, suppression
  distante, retour distant, HTML hostile, URL cross-origin, timeout et rate
  limit ;
- essai réel volontaire du mainteneur consigné uniquement avec compteurs,
  latence et erreurs expurgées — jamais avec identifiants ou contenu scolaire ;
- kill switch et échec doux observables avant activation.

[npm-pawnote]: https://www.npmjs.com/package/pawnote
[registry-pawnote]: https://registry.npmjs.org/pawnote/1.6.2
[tar-pawnote]: https://registry.npmjs.org/pawnote/-/pawnote-1.6.2.tgz
[repo-pawnote]: https://github.com/LiterateInk/Pawnote.js
[registry-pawdirecte]: https://registry.npmjs.org/pawdirecte
[repo-pawdirecte-readme]: https://github.com/LeMaitre4523/Pawdirecte/blob/d3aa4323715db6b0722f275d39b0da2096b2b358/README.md
[npm-ed-core]: https://www.npmjs.com/package/@papillonapp/ed-core
[registry-ed-core]: https://registry.npmjs.org/@papillonapp%2fed-core/0.2.9
[tar-ed-core]: https://registry.npmjs.org/@papillonapp/ed-core/-/ed-core-0.2.9.tgz
[repo-ed-core]: https://github.com/PapillonApp/Papillon-ED-Core
[repo-ed-core-readme]: https://github.com/PapillonApp/Papillon-ED-Core/blob/17e18a7048c098b9b213f53f384787e6a27ce64b/README.md
[repo-ed-core-license]: https://github.com/PapillonApp/Papillon-ED-Core/blob/17e18a7048c098b9b213f53f384787e6a27ce64b/LICENSE
[npm-blocks]: https://www.npmjs.com/package/@blockshub/blocksdirecte
[registry-blocks]: https://registry.npmjs.org/@blockshub%2fblocksdirecte/0.0.8-alpha
[tar-blocks]: https://registry.npmjs.org/@blockshub/blocksdirecte/-/blocksdirecte-0.0.8-alpha.tgz
[repo-blocks]: https://github.com/BlocksHub/BlocksDirecte
[blocks-package]: https://github.com/BlocksHub/BlocksDirecte/blob/e8e593786ab75af91d75a6b5dfb502d4af0f4082/package.json
[blocks-auth]: https://github.com/BlocksHub/BlocksDirecte/blob/e8e593786ab75af91d75a6b5dfb502d4af0f4082/src/modules/Auth.ts
[blocks-homework]: https://github.com/BlocksHub/BlocksDirecte/blob/e8e593786ab75af91d75a6b5dfb502d4af0f4082/src/modules/Homework.ts
[blocks-timetable]: https://github.com/BlocksHub/BlocksDirecte/blob/e8e593786ab75af91d75a6b5dfb502d4af0f4082/src/modules/Timetable.ts
[blocks-mark]: https://github.com/BlocksHub/BlocksDirecte/blob/e8e593786ab75af91d75a6b5dfb502d4af0f4082/src/modules/Mark.ts
[blocks-downloader]: https://github.com/BlocksHub/BlocksDirecte/blob/e8e593786ab75af91d75a6b5dfb502d4af0f4082/src/modules/Downloader.ts
[npm-skolengo]: https://www.npmjs.com/package/skolengojs
[registry-skolengo]: https://registry.npmjs.org/skolengojs/1.1.10
[tar-skolengo]: https://registry.npmjs.org/skolengojs/-/skolengojs-1.1.10.tgz
[repo-skolengo]: https://github.com/raphckrman/skolengo.js
[skolengo-package]: https://github.com/raphckrman/skolengo.js/blob/27e6050a71baa6aed3fd9d578d26422fffc1801d/package.json
[skolengo-license]: https://github.com/raphckrman/skolengo.js/blob/27e6050a71baa6aed3fd9d578d26422fffc1801d/LICENSE
[skolengo-oidc]: https://github.com/raphckrman/skolengo.js/blob/27e6050a71baa6aed3fd9d578d26422fffc1801d/src/routes/OIDC.ts
[skolengo-assignments]: https://github.com/raphckrman/skolengo.js/blob/27e6050a71baa6aed3fd9d578d26422fffc1801d/src/routes/Assignments.ts
[skolengo-agenda]: https://github.com/raphckrman/skolengo.js/blob/27e6050a71baa6aed3fd9d578d26422fffc1801d/src/routes/Agenda.ts
[skolengo-grades]: https://github.com/raphckrman/skolengo.js/blob/27e6050a71baa6aed3fd9d578d26422fffc1801d/src/routes/Grades.ts
[skolengo-attachments]: https://github.com/raphckrman/skolengo.js/blob/27e6050a71baa6aed3fd9d578d26422fffc1801d/src/routes/Attachments.ts
[papillon-package]: https://github.com/PapillonApp/Papillon/blob/03dcc4e0244f11c668bc9da36eba2750eaafe7e5/package.json
[papillon-pronote-qr]: https://github.com/PapillonApp/Papillon/blob/03dcc4e0244f11c668bc9da36eba2750eaafe7e5/app/(onboarding)/services/pronote/qrcode.tsx
[papillon-pronote-homework]: https://github.com/PapillonApp/Papillon/blob/03dcc4e0244f11c668bc9da36eba2750eaafe7e5/services/pronote/homework.ts
[papillon-pronote-timetable]: https://github.com/PapillonApp/Papillon/blob/03dcc4e0244f11c668bc9da36eba2750eaafe7e5/services/pronote/timetable.ts
[papillon-pronote-grades]: https://github.com/PapillonApp/Papillon/blob/03dcc4e0244f11c668bc9da36eba2750eaafe7e5/services/pronote/grades.ts
[papillon-ed-login]: https://github.com/PapillonApp/Papillon/blob/03dcc4e0244f11c668bc9da36eba2750eaafe7e5/app/(onboarding)/services/ed/credentials.tsx
[papillon-ed-refresh]: https://github.com/PapillonApp/Papillon/blob/03dcc4e0244f11c668bc9da36eba2750eaafe7e5/services/ecoledirecte/refresh.ts
[papillon-skolengo-webview]: https://github.com/PapillonApp/Papillon/blob/03dcc4e0244f11c668bc9da36eba2750eaafe7e5/app/(onboarding)/services/skolengo/webview.tsx
