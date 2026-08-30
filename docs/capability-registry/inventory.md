# Inventaire des chemins de capacités

État vérifié dans le dépôt le 30 août 2026. Les façades métier sont branchées
sur `CapabilityRuntime`, mais les sept flags d'exécution restent `legacy` par
défaut. Les chemins registry sont opt-in ; contrats, adapter compilé, connexion
validée et preuve live sont quatre niveaux distincts.

## Vue d'ensemble

| Capacité                | Entrée métier                           | Chemin registry livré                                         | Flag d'exécution                           |
| ----------------------- | --------------------------------------- | ------------------------------------------------------------- | ------------------------------------------ |
| Langage                 | assistant run service                   | `CapabilityBackedModelGateway`                                | `CAPABILITY_LANGUAGE_EXECUTION`            |
| Embedding               | corpus jobs et retrieval                | `CapabilityBackedEmbeddingProvider` avec identité d'espace    | `CAPABILITY_EMBEDDING_EXECUTION`           |
| Reranking               | hybrid search                           | runtime de retrieval et adapter de reranking                  | `CAPABILITY_RERANK_EXECUTION`              |
| STT                     | recordings, dictation, material media   | façade de transcription puis invoker                          | `CAPABILITY_STT_EXECUTION`                 |
| TTS                     | podcast/document export                 | façade de synthèse puis invoker                               | `CAPABILITY_TTS_EXECUTION`                 |
| OCR                     | material transcription et copy analysis | façade OCR puis invoker                                       | `CAPABILITY_OCR_EXECUTION`                 |
| Extraction              | ingestion PDF                           | extraction native de couche texte PDF                         | `CAPABILITY_DOCUMENT_EXTRACTION_EXECUTION` |
| Image/vidéo génératives | contrats réservés                       | pas de workflow registry branché ; runtime maintenu en legacy | aucun flag de famille                      |

Chaque flag accepte `legacy`, `shadow` ou `registry`. Le master
`CAPABILITY_REGISTRY_SHADOW` ne remplace pas un override explicite par famille.
Voir le [guide opérateur](operator-guide.md) pour l'activation et les limites.

## Connecteurs réellement instanciables

| Plugin                                                | Offerings livrées                                  | Limites à ne pas confondre avec le catalogue upstream                                               |
| ----------------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `avermate.mistral`                                    | langage, embedding texte, STT, TTS, OCR            | modèles et options revus ; pas toute l'API Mistral                                                  |
| `ai-sdk.elevenlabs`                                   | TTS via SDK officiel, `eleven_flash_v2_5`          | pas de STT ElevenLabs livré                                                                         |
| `ai-sdk.deepgram`                                     | STT via SDK officiel, `nova-3`                     | pas de TTS Deepgram livré                                                                           |
| `ai-sdk.google`                                       | embedding Gemini multimodal                        | pas de chat, image ou vidéo Gemini dans ce plugin                                                   |
| `avermate.cohere`                                     | reranking                                          | pas de génération de langage Cohere                                                                 |
| `ai-sdk.openai` / `avermate.openrouter`               | génération de langage                              | OpenRouter épinglé sur `openai/gpt-4.1-mini`, upstream OpenAI seul ; aucune famille média implicite |
| `avermate.openai-compatible`                          | langage, embedding texte si dimensions configurées | modèle/révision explicites ; fonctionnalités inconnues non promises                                 |
| `avermate.litellm` / `avermate.huggingface-inference` | chat compatible text-only, modèle explicite        | pas d'agrégation automatique de toutes les tâches upstream ; voir restrictions du guide             |
| `avermate.native-document`                            | extraction déterministe PDF, sans secret ni réseau | pas un parseur universel DOCX/PPTX/HTML/XLSX                                                        |
| `avermate.node`                                       | offerings du manifest signé du Node pairé          | uniquement capacités, révisions et modes réellement annoncés                                        |

Sources de vérité : `apps/server/src/capabilities/plugin-registry.ts`,
`providers/plugins.ts`, `providers/proxy-plugins.ts`, `providers/node.ts` et leurs tests. Les identifiants
`ai-sdk.*` décrivent les plugins ; ils ne garantissent pas l'emploi du même SDK
pour chaque protocole. La disponibilité d'un provider externe n'est pas
déduite d'un test à transport simulé.

## Génération de langage

- Contrat historique : `packages/agent-contracts/src/model-gateway.ts`.
- Gateways Core : `apps/server/src/agent/model-gateways.ts`.
- Policy : `apps/server/src/assistant/model-policy.ts`.
- Composition et placement : `apps/server/src/assistant/services.ts`.
- Exécution conversationnelle : `apps/server/src/assistant/run-service.ts`.
- Accounting managed : `apps/server/src/usage/metered-model-gateway.ts` et
  `apps/server/src/usage/metered-execution-router.ts`.
- Adapter Node : `apps/server/src/node/node-provider-adapters.ts`.
- Implémentation Node OpenAI-compatible : `apps/node/src/model-gateway.ts`.

Bridge livré : `apps/server/src/capabilities/adapters/language-generation.ts`.
Il conserve la façade `ModelGateway` et le flux d'événements du chat ; les
capabilities annoncées dans une offering restent la borne des outils, formats
et modalités autorisés. Le retrait du contrat legacy n'est pas effectué.

En mode langage `registry`, `assistant/registry-model-catalogue.ts` alimente le
sélecteur de modèles avec les offerings configurées et autorisées de l'owner.
La clé `capability:<offeringId>` épingle l'offering exacte, y compris sa connexion,
pas seulement un nom de modèle partagé par plusieurs providers. Cette projection
en lecture seule n'effectue aucun probe ; les catalogues legacy/shadow restent
inchangés.

## Embeddings

- Construction du runtime : `apps/server/src/search/vector-runtime.ts`.
- Provider Gemini multimodal : `apps/server/src/search/gemini-embedding.ts`.
- Sélection et publication :
  `apps/server/src/search/embedding-generation-selection.ts`,
  `apps/server/src/search/embedding-generation-publication.ts` et
  `apps/server/src/search/embedding-publication-fence.ts`.
- Producteurs : `apps/server/src/jobs/corpus.ts` et
  `apps/server/src/jobs/corpus-derivatives.ts`.
- Consommateurs : `apps/server/src/search/hybrid.ts`,
  `apps/server/src/search/project-retrieval-policy.ts`, les routers `projects`
  et `retrieval`.

Garanties à préserver : space ID immuable, générations, owner fence, validation
pré/post provider et publication atomique.

Le bridge registry se trouve dans `capabilities/adapters/embedding.ts`. La
compatibilité document/query utilise toujours l'espace publié : une nouvelle
offering ne constitue pas une migration automatique de l'index existant.

## Reranking

- Providers Core : `apps/server/src/search/rerank-providers.ts`.
- Résolution : `apps/server/src/search/retrieval-runtime.ts`.
- Provider Node : `apps/server/src/node/paired-node-rerank-provider.ts`.
- Usage : `apps/server/src/search/hybrid.ts` et
  `apps/server/src/search/project-retrieval-policy.ts`.

Les candidats visuels restent hors d'un reranker text-only ; le runtime de
capacité ne doit pas annuler cette garantie.

## Transcription

- Contrat et résolution : `apps/server/src/lib/transcription.ts`.
- Cours enregistrés : `apps/server/src/jobs/transcription.ts`.
- Médias importés : `apps/server/src/jobs/transcribe-material-media.ts`.
- Dictée assistant : `apps/server/src/routes/assistant-dictation.ts`.
- Ingestion Node : `apps/server/src/ingestion/paired-node-media.ts`.
- Transport historique : `model.transcribe` dans les contrats et transports
  Node.

Purposes cibles :

```text
recordings.course-transcription
materials.media-transcription
assistant.dictation
```

## Synthèse vocale

- Façade de compatibilité et sélection du mode :
  `apps/server/src/lib/text-to-speech.ts`.
- Adapters spécialisés : `capabilities/adapters/speech.ts` et
  `capabilities/providers/speech-synthesis.ts` (Mistral et ElevenLabs).
- Entrée podcast : `apps/server/src/jobs/export-document-artifact.ts`.
- Disponibilité produit : routers `documents` et `document-artifacts`.

Le bridge public conserve les signatures historiques, mais délègue au runtime
avec le purpose `media.podcast-narration`.

## OCR et extraction documentaire

- OCR Core/Node : `apps/server/src/lib/ocr.ts`.
- Job matériel : `apps/server/src/jobs/ocr.ts`.
- Entrées produit : `apps/server/src/routers/materials/documents.ts`.
- Extraction et dérivés : ingestion et jobs de corpus existants.

Le branchement `document.extract` de `search/adapters.ts` couvre aujourd'hui
la couche texte native PDF via `providers/document-extraction.ts`. L'invoker
crée sa connexion interne déterministe sans credential. Les autres parsers et
workers documentaires existants ne sont pas tous migrés vers cette offering.
L'OCR reste une capacité distincte lorsque la couverture native est insuffisante.

## Secrets et connexions

- Schéma historique : `apps/server/src/db/schema/user-service-keys.ts`.
- Stockage chiffré et CAS : `apps/server/src/lib/service-keys.ts`.
- Matrice fermée : `apps/server/src/lib/service-key-routing.ts`.
- API et validation : `apps/server/src/routers/service-keys.ts`.
- UI historique :
  `apps/web/src/app/(app)/settings/integrations/service-keys-section.tsx`.

Le bridge présente ces clés comme des connexions virtuelles. La migration ne
supprime ni ne réécrit destructivement la table historique.

Cette projection est read-only : elle ne crée ni connexion persistée, ni
offering, ni consentement utilisable par le registry. L'opérateur ou
l'utilisateur doit configurer les nouvelles connexions avant de changer de
mode. Le bootstrap interne natif PDF est une exception étroite, pas une API
générale de connexions opérateur.

## Avermate Node

- Contrats génériques : `packages/agent-contracts/src/capability-node.ts`,
  `node-operations.ts` et `node.ts`.
- Dispatch Node : `apps/node/src/capability-dispatcher.ts`.
- Registry, manifest, dispatch et exécution : `apps/node/src/capabilities/`.
- Sidecars et fichiers : `sidecar-client.ts`, `sidecar-artifacts.ts`,
  `worker-adapter.ts` et `secret-store.ts` dans ce répertoire.
- Relay Core : `apps/server/src/node/relay-provider-transport.ts`.
- Adaptation des inputs/outputs et grants Core :
  `apps/server/src/capabilities/providers/node.ts` et
  `apps/server/src/node/core-grant-issuer.ts`.

Les champs historiques `models`, `retrieval.providers`, OCR et STT deviennent
des bridge offerings. Ils ne sont pas supprimés dans la version 1 du protocole
générique.

## Écarts conservés par rapport à l'audit cible

- Les branches, variables, types de clés et transports legacy restent en place.
  La neutralité du chemin registry ne signifie pas suppression globale du legacy.
  Leur retrait et la conversion du bootstrap opérateur relèvent de la phase 14,
  prévue après la release de compatibilité, pas d'une activation implicite ici.
- Les modèles proposés sont un ensemble revu, pas un catalogue dynamique de
  tous les modèles/voix de chaque fournisseur.
- Les scopes système/projet/workflow existent dans les contrats et le resolver ;
  l'API publique d'écriture des policies reste limitée au scope utilisateur.
  Les placements opérateur ne sont pas librement créables depuis le navigateur.
- L'usage multi-unité est durable, mais les coûts upstream peuvent être inconnus.
  Le broker managed rejette les familles sans contrat de quota pris en charge ;
  aucune offre managed n'est bootstrapée ou activée automatiquement.
- La santé expire après cinq minutes et se rafraîchit à la demande ; les
  diagnostics shadow sont bornés en mémoire du processus, pas un journal durable.
- Le runtime n'expose pas de retry générique d'une opération : relancer le
  workflow d'origine permet de reconstruire les inputs et les fences.
- Les contrats image/vidéo n'activent pas ces workflows ; la généralisation de
  l'extraction documentaire reste également à livrer.
- Les tests locaux couvrent contrats, stores, faux transports et migrations.
  Les gates externes provider/Node, Compose, air-gap, restore et isolation
  restent des preuves séparées : leur absence interdit de conclure à une
  disponibilité production, y compris pour un déploiement sans clé cloud.
