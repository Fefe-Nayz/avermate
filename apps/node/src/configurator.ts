import {
  nodeCredentialDeliverySchema,
  type NodeCapabilityManifestV2,
  type NodePairingOffer,
} from "@avermate/agent-contracts";
import {
  loadNodeConfig,
  nodeConfigSchema,
  publicConfig,
  serializeNodeConfig,
  type NodeConfig,
} from "./config";
import { PairingManager } from "./protocol";
import { ConfiguratorSecurity, secureResponse } from "./configurator-security";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { runHostPreflight } from "./preflight";
import type { NodeSecretStore } from "./secret-store";
import { canonicalDigest } from "./canonical-json";

const MAX_JSON_BODY_BYTES = 64 * 1024;
const MAX_CORE_RESPONSE_BYTES = 512 * 1024;

const CONFIGURED_SECRET = "configured";
const configuratorSecretSlots = [
  "storage-s3",
  "model-admin",
  "model-provider",
  "embedding-provider",
  "rerank-provider",
  "sandbox-provider",
  "sandbox-evidence",
] as const;
type StaticConfiguratorSecretSlot = (typeof configuratorSecretSlots)[number];
type ConfiguratorSecretSlot =
  | StaticConfiguratorSecretSlot
  | `capability-sidecar:${string}`;

type BrowserConfigInput = Record<string, unknown> & {
  storage?: Record<string, unknown>;
  relay?: Record<string, unknown>;
  retrieval?: Record<string, unknown>;
  models?: Record<string, unknown>;
  capabilities?: Record<string, unknown>;
  sandbox?: Record<string, unknown>;
};

function secretSlot(value: unknown): ConfiguratorSecretSlot {
  if (
    typeof value !== "string" ||
    !configuratorSecretSlots.includes(value as StaticConfiguratorSecretSlot) &&
    !/^capability-sidecar:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(value)
  ) {
    throw new Error("CONFIGURATOR_SECRET_SLOT_INVALID");
  }
  return value as ConfiguratorSecretSlot;
}

function deploymentPreview(config: NodeConfig) {
  const enabledSidecars = config.capabilities.sidecars.filter(
    (sidecar) => sidecar.enabled,
  );
  const composeSidecars = enabledSidecars.filter(
    (sidecar) => sidecar.compose,
  );
  const capabilityEnvironment =
    enabledSidecars.length > 0
      ? '      NODE_CAPABILITY_PROTOCOL_V1: "true"\n'
      : "";
  const dependsOn =
    composeSidecars.length > 0
      ? `    depends_on:\n${composeSidecars
          .map(
            (sidecar) =>
              `      ${sidecar.id}:\n        condition: service_started`,
          )
          .join("\n")}\n`
      : "";
  const sidecarServices = composeSidecars
    .map(
      (sidecar) =>
        `  ${sidecar.id}:\n    image: ${sidecar.compose!.image}\n    restart: unless-stopped\n    expose:\n      - "${sidecar.compose!.containerPort}"`,
    )
    .join("\n");
  const composeOverride = `services:\n  node:\n    environment:\n      AVERMATE_NODE_CONFIG: /data/node/avermate-node.yaml\n      AVERMATE_NODE_CONFIG_TEMPLATE: /etc/avermate/avermate-node.template.yaml\n      AVERMATE_NODE_CONTAINER_BRIDGE_PORT: "5189"\n${capabilityEnvironment}${dependsOn}    ports:\n      - "127.0.0.1:5188:5189"\n    volumes:\n      - node-data:/data\n      - ./avermate-node.yaml:/etc/avermate/avermate-node.template.yaml:ro\n${sidecarServices ? `${sidecarServices}\n` : ""}`;
  const commands = {
    validate: [
      "docker",
      "compose",
      "-f",
      "infra/compose/avermate.yml",
      "-f",
      "avermate-node.override.yml",
      "--profile",
      config.profile,
      "config",
    ],
    start: [
      "docker",
      "compose",
      "-f",
      "infra/compose/avermate.yml",
      "-f",
      "avermate-node.override.yml",
      "--profile",
      config.profile,
      "up",
      "-d",
    ],
    backupKeygen: [
      "bun",
      "apps/node/src/cli.ts",
      "backup",
      "keygen",
      "--key-file",
      "backup.key",
    ],
    backupCreate: [
      "bun",
      "apps/node/src/cli.ts",
      "backup",
      "create",
      "--config",
      "avermate-node.yaml",
      "--key-file",
      "backup.key",
    ],
    restorePlan: [
      "bun",
      "apps/node/src/cli.ts",
      "restore",
      "plan",
      "--archive",
      "backup.avnb",
      "--key-file",
      "backup.key",
    ],
    upgradePlan: [
      "bun",
      "apps/node/src/cli.ts",
      "upgrade",
      "plan",
      "--config",
      "avermate-node.yaml",
      "--bundle-dir",
      "release-bundle",
    ],
  } as const;
  return {
    profile: config.profile,
    configFile: "avermate-node.yaml",
    configDigest: canonicalDigest(config),
    composeFile: "avermate-node.override.yml",
    composeDigest: canonicalDigest(composeOverride),
    composeOverride,
    commands,
    warnings: [
      ...(config.sandbox.enabled
        ? ["Sandbox activation still requires live isolation evidence."]
        : []),
      ...(config.lifecycle.offline
        ? ["Import and verify the signed offline bundle before starting."]
        : []),
      ...(config.models.gateway === "litellm"
        ? ["LiteLLM and Avermate budgets both remain authoritative gates."]
        : []),
      ...(enabledSidecars.length > 0
        ? [
            "Capability sidecars remain private to the Node/Compose network and are never published as endpoints.",
          ]
        : []),
    ],
  };
}

function changePreview(current: NodeConfig, next: NodeConfig) {
  const before = publicConfig(current);
  const after = publicConfig(next);
  const changedSections = Object.keys(after).filter(
    (key) =>
      JSON.stringify(before[key as keyof typeof before]) !==
      JSON.stringify(after[key as keyof typeof after]),
  );
  return {
    changed: changedSections.length > 0,
    changedSections,
    restartRequired: changedSections.length > 0,
  };
}

export function pairingCoreUrl(
  value: unknown,
  transport: NodeConfig["relay"]["transport"] = "tls",
) {
  if (typeof value !== "string") throw new Error("PAIRING_CORE_URL_REQUIRED");
  const url = new URL(value);
  const localCompose =
    transport === "local-compose" &&
    value.replace(/\/+$/u, "") === "http://api:5000";
  if (
    (url.protocol !== "https:" && !localCompose) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error("PAIRING_CORE_URL_INVALID");
  }
  url.pathname = url.pathname.replace(/\/+$/u, "");
  return url;
}

async function corePost(
  fetcher: typeof fetch,
  base: URL,
  path: string,
  body: unknown,
) {
  const url = new URL(base);
  url.pathname = `${base.pathname === "/" ? "" : base.pathname}${path}`;
  url.search = "";
  url.hash = "";
  const response = await fetcher(url, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(body),
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  });
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_CORE_RESPONSE_BYTES) {
    throw new Error("PAIRING_CORE_RESPONSE_TOO_LARGE");
  }
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > MAX_CORE_RESPONSE_BYTES) {
    throw new Error("PAIRING_CORE_RESPONSE_TOO_LARGE");
  }
  const parsed = JSON.parse(text) as { error?: unknown };
  if (!response.ok) {
    throw new Error(
      typeof parsed.error === "string" ? parsed.error : "PAIRING_CORE_REJECTED",
    );
  }
  return parsed;
}

async function jsonBody(request: Request) {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > MAX_JSON_BODY_BYTES) throw new Error("REQUEST_BODY_TOO_LARGE");
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_JSON_BODY_BYTES) {
    throw new Error("REQUEST_BODY_TOO_LARGE");
  }
  return JSON.parse(text) as unknown;
}

async function atomicConfig(path: string, config: NodeConfig) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporary, serializeNodeConfig(config), {
    mode: 0o600,
    flag: "wx",
  });
  await rename(temporary, path);
}

const setupHtml = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Avermate Node — configuration locale</title><link rel="stylesheet" href="/setup.css"></head>
<body><main><div class="language-picker"><label for="setup-language" data-i18n="language">Langue</label><select id="setup-language" aria-label="Langue" data-i18n-aria-label="language"><option value="fr">Français</option><option value="en">English</option></select></div><header><p class="eyebrow" data-i18n="localOnly">Boucle locale uniquement</p><h1>Avermate Node</h1><p data-i18n="intro">Configurez le stockage, les modèles, la recherche, les workers et le cycle de vie. Les valeurs secrètes vont directement dans le coffre local et ne sont jamais renvoyées au navigateur.</p></header>
<section id="login" class="panel"><h2 data-i18n="unlockTitle">Déverrouiller le configurateur</h2><label for="secret" data-i18n="bootstrapSecret">Secret d'amorçage</label><input id="secret" type="password" autocomplete="one-time-code"><button id="unlock" type="button" data-i18n="unlock">Déverrouiller</button></section>
<div id="wizard" hidden>
  <nav aria-label="Étapes de configuration" data-i18n-aria-label="navAria"><a href="#configuration" data-i18n="navConfig">Configuration</a><a href="#secrets" data-i18n="navSecrets">Secrets</a><a href="#pairing" data-i18n="navPairing">Pairing</a><a href="#deployment" data-i18n="navDeploy">Déploiement et sauvegarde</a></nav>
  <section id="configuration" class="panel"><div class="section-heading"><div><p class="eyebrow">Node schema v1</p><h2 data-i18n="completeConfig">Configuration complète</h2></div><span id="dirty" class="badge" data-i18n="loading">Chargement</span></div><form id="config-form"><div id="config-groups"></div></form><div class="actions"><button id="validate" type="button" data-i18n="validate">Valider</button><button id="apply" type="button" class="primary" data-i18n="apply">Appliquer</button><button id="rollback" type="button" data-i18n="rollback">Restaurer la dernière configuration</button><button id="preflight" type="button" data-i18n="preflight">Préflight hôte</button></div></section>
  <section id="secrets" class="panel"><h2 data-i18n="vaultTitle">Coffre de secrets local</h2><p data-i18n="vaultIntro">La réponse indique uniquement que le secret est configuré. Elle ne contient ni sa valeur ni sa référence interne.</p><div class="grid two"><div><label for="secret-slot" data-i18n="destination">Destination</label><select id="secret-slot"><option value="storage-s3">S3 / Garage</option><option value="model-admin">LiteLLM admin</option><option value="model-provider">Model provider</option><option value="embedding-provider">Embeddings</option><option value="rerank-provider">Reranker</option><option value="sandbox-provider">Sandbox</option><option value="sandbox-evidence">Sandbox evidence</option></select></div><div><label for="provider-secret" data-i18n="newSecret">Nouvelle valeur secrète</label><input id="provider-secret" type="password" autocomplete="new-password"></div></div><div class="actions"><button id="save-secret" type="button" data-i18n="saveSecret">Enregistrer dans le coffre</button><button id="clear-secret" type="button" data-i18n="clearSecret">Retirer de la prochaine configuration</button></div></section>
  <section id="pairing" class="panel"><h2 data-i18n="pairingTitle">Pairing avec le Core</h2><div class="grid two"><div><label for="core-url" data-i18n="coreUrl">URL du Core (HTTPS)</label><input id="core-url" type="url" placeholder="https://avermate.example"></div><div><label for="pairing-id" data-i18n="pairingId">ID de tentative confirmé dans Avermate</label><input id="pairing-id" autocomplete="off"></div></div><div class="actions"><button id="pair" type="button" data-i18n="createCode">Créer et enregistrer le code</button><button id="credentials" type="button" data-i18n="getCredentials">Récupérer les identifiants</button></div></section>
  <section id="deployment" class="panel"><h2 data-i18n="deploymentTitle">Déploiement, Compose et sauvegarde</h2><p data-i18n="deploymentIntro">Le navigateur ne lance aucune commande privilégiée. Il produit un override déterministe et les tableaux d'arguments exacts pour l'opérateur.</p><div class="actions"><button id="deployment-preview" type="button" data-i18n="generatePlan">Générer le plan</button><button id="download-compose" type="button" disabled data-i18n="downloadCompose">Télécharger l'override Compose</button></div><pre id="deployment-output" tabindex="0" aria-label="Plan de déploiement" data-i18n-aria-label="deploymentOutputAria"></pre></section>
  <section class="panel"><h2 data-i18n="technicalResult">Résultat technique</h2><pre id="result" tabindex="0" aria-label="Résultat de l'opération" data-i18n-aria-label="technicalOutputAria"></pre></section>
  <div class="actions"><button id="close-setup" type="button" class="danger" data-i18n="closeSetup">Fermer le mode configuration</button></div>
</div>
<p id="status" role="status" aria-live="polite"></p><p id="error" role="alert" aria-live="assertive"></p></main><script src="/setup.js" defer></script></body></html>`;

const setupCss = `:root{font:16px system-ui,sans-serif;color-scheme:light dark;--bg:#0b1118;--panel:#121c27;--line:#304154;--muted:#9eb0c3;--accent:#79b8ff;--danger:#ff8f8f}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:#edf2f7}main{max-width:76rem;margin:4vh auto;padding:clamp(1rem,3vw,2.5rem)}header{max-width:58rem}.language-picker{display:flex;align-items:center;justify-content:flex-end;gap:.6rem}.language-picker select{min-width:8rem}.eyebrow{margin:0 0 .35rem;color:var(--accent);font-size:.75rem;font-weight:700;letter-spacing:.09em;text-transform:uppercase}h1,h2,h3{line-height:1.15}nav{position:sticky;top:0;z-index:2;display:flex;gap:.5rem;overflow:auto;padding:.75rem 0;background:var(--bg)}nav a{padding:.55rem .8rem;border:1px solid var(--line);border-radius:999px;color:inherit;text-decoration:none;white-space:nowrap}.panel{display:grid;gap:1rem;margin:1.25rem 0;padding:clamp(1rem,2vw,1.5rem);border:1px solid var(--line);border-radius:1rem;background:var(--panel)}.section-heading,.actions{display:flex;align-items:center;justify-content:space-between;gap:.75rem;flex-wrap:wrap}.grid{display:grid;gap:1rem}.grid.two{grid-template-columns:repeat(auto-fit,minmax(16rem,1fr))}.config-group{margin:1rem 0;padding:1rem;border:1px solid var(--line);border-radius:.75rem}.config-group legend{padding:0 .45rem;font-weight:700}.field{display:grid;align-content:start;gap:.4rem}.field small{color:var(--muted)}label{font-weight:600}input,select,textarea,button{font:inherit;padding:.7rem;border-radius:.55rem;border:1px solid #64748b;background:#0f1720;color:inherit}textarea{min-height:8rem;resize:vertical;font-family:ui-monospace,monospace;font-size:.82rem}input[type=checkbox]{width:1.15rem;height:1.15rem;padding:0}.check{display:flex;align-items:center;gap:.6rem;padding-top:1.75rem}button{cursor:pointer;background:#1d2b3a}button.primary{background:#1769aa}button.danger{border-color:#8f3c3c;color:#ffd0d0}button:disabled{cursor:not-allowed;opacity:.5}.badge{padding:.3rem .55rem;border:1px solid var(--line);border-radius:999px;color:var(--muted);font-size:.78rem}pre{min-height:3rem;max-height:28rem;margin:0;padding:1rem;overflow:auto;border:1px solid var(--line);border-radius:.65rem;background:#080d13;white-space:pre-wrap;overflow-wrap:anywhere;font-size:.8rem}#status{color:#9fe3b1}#error{color:#ffb0b0}:focus-visible{outline:3px solid var(--accent);outline-offset:2px}@media(max-width:44rem){main{margin:0}.panel{border-radius:.7rem}.actions>button{width:100%}}`;

const setupJs = `let csrf='';let config=null;let deployment=null;let busy=false;const q=(s)=>document.querySelector(s);const out=q('#result');const err=q('#error');const status=q('#status');
const localeKey='avermate-node-setup-locale';let locale=(()=>{try{const saved=localStorage.getItem(localeKey);if(saved==='fr'||saved==='en')return saved}catch{}return navigator.language?.toLowerCase().startsWith('fr')?'fr':'en'})();
const copy={
 fr:{language:'Langue',localOnly:'Boucle locale uniquement',intro:'Configurez le stockage, les modèles, la recherche, les workers et le cycle de vie. Les valeurs secrètes vont directement dans le coffre local et ne sont jamais renvoyées au navigateur.',unlockTitle:'Déverrouiller le configurateur',bootstrapSecret:"Secret d’amorçage",unlock:'Déverrouiller',navAria:'Étapes de configuration',navConfig:'Configuration',navSecrets:'Secrets',navPairing:'Pairing',navDeploy:'Déploiement et sauvegarde',completeConfig:'Configuration complète',loading:'Chargement',validate:'Valider',apply:'Appliquer',rollback:'Restaurer la dernière configuration',preflight:'Préflight hôte',vaultTitle:'Coffre de secrets local',vaultIntro:'La réponse indique uniquement que le secret est configuré. Elle ne contient ni sa valeur ni sa référence interne.',destination:'Destination',newSecret:'Nouvelle valeur secrète',saveSecret:'Enregistrer dans le coffre',clearSecret:'Retirer de la prochaine configuration',pairingTitle:'Pairing avec le Core',coreUrl:'URL du Core (HTTPS)',pairingId:'ID de tentative confirmé dans Avermate',createCode:'Créer et enregistrer le code',getCredentials:'Récupérer les identifiants',deploymentTitle:'Déploiement, Compose et sauvegarde',deploymentIntro:"Le navigateur ne lance aucune commande privilégiée. Il produit un override déterministe et les tableaux d’arguments exacts pour l’opérateur.",generatePlan:'Générer le plan',downloadCompose:"Télécharger l’override Compose",deploymentOutputAria:'Plan de déploiement',technicalResult:'Résultat technique',technicalOutputAria:"Résultat de l’opération",closeSetup:'Fermer le mode configuration',processing:'Traitement…',localChanges:'Modifications locales',notValidated:'Non validé',loaded:'Chargé',notConfigured:'Non configuré',failure:'Échec',invalidNumber:'Nombre invalide : ',invalidJson:'JSON invalide : ',unlocked:'Configurateur déverrouillé',valid:'Configuration valide',applied:'Configuration appliquée',rolledBack:'Dernière configuration restaurée',preflightDone:'Préflight terminé',secretSaved:'Secret enregistré dans le coffre local',secretCleared:'Secret retiré de la prochaine configuration ; validez puis appliquez pour confirmer',pairingSaved:'Code de pairing enregistré sur le Core',credentialsSaved:'Identifiants scellés dans le coffre ; redémarrage requis',planGenerated:'Plan de déploiement généré',setupClosed:'Mode configuration fermé',sessionRestored:'Session de configuration restaurée'},
 en:{language:'Language',localOnly:'Local loopback only',intro:'Configure storage, models, retrieval, workers, and lifecycle operations. Secret values go directly to the local vault and are never returned to the browser.',unlockTitle:'Unlock the configurator',bootstrapSecret:'Bootstrap secret',unlock:'Unlock',navAria:'Configuration steps',navConfig:'Configuration',navSecrets:'Secrets',navPairing:'Pairing',navDeploy:'Deployment and backup',completeConfig:'Complete configuration',loading:'Loading',validate:'Validate',apply:'Apply',rollback:'Restore previous configuration',preflight:'Host preflight',vaultTitle:'Local secret vault',vaultIntro:'Responses only indicate that a secret is configured. They never contain its value or internal reference.',destination:'Destination',newSecret:'New secret value',saveSecret:'Save in vault',clearSecret:'Remove from next configuration',pairingTitle:'Pair with Core',coreUrl:'Core URL (HTTPS)',pairingId:'Pairing attempt ID confirmed in Avermate',createCode:'Create and register code',getCredentials:'Fetch credentials',deploymentTitle:'Deployment, Compose, and backup',deploymentIntro:'The browser never runs privileged commands. It produces a deterministic override and exact argument arrays for the operator.',generatePlan:'Generate plan',downloadCompose:'Download Compose override',deploymentOutputAria:'Deployment plan',technicalResult:'Technical result',technicalOutputAria:'Operation result',closeSetup:'Close setup mode',processing:'Processing…',localChanges:'Local changes',notValidated:'Not validated',loaded:'Loaded',notConfigured:'Not configured',failure:'Failed',invalidNumber:'Invalid number: ',invalidJson:'Invalid JSON: ',unlocked:'Configurator unlocked',valid:'Configuration valid',applied:'Configuration applied',rolledBack:'Previous configuration restored',preflightDone:'Preflight complete',secretSaved:'Secret stored in the local vault',secretCleared:'Secret removed from the next configuration; validate and apply to confirm',pairingSaved:'Pairing code registered with Core',credentialsSaved:'Credentials sealed in the vault; restart required',planGenerated:'Deployment plan generated',setupClosed:'Setup mode closed',sessionRestored:'Setup session restored'}
};
const englishGroups={general:'Profile and paths',storage:'Storage and conversations',retrieval:'Retrieval, embeddings, and reranking',models:'Models and LiteLLM',capabilities:'Private capability sidecars',sandbox:'Sandbox and specialist workers',jobs:'Jobs, lifecycle, and observability'};
const englishLabels={
 'profile':'Profile','bind.host':'Configurator address','bind.port':'Port','dataDir':'Data directory',
 'storage.driver':'Storage driver','storage.filesystemRoot':'Filesystem root','storage.maxObjectBytes':'Maximum object size (bytes)','storage.quotaBytes':'Total quota (bytes)','conversations.enabled':'Store conversations on Node','conversations.maximumBytes':'Conversation quota (bytes)',
 'retrieval.enabled':'Enable retrieval','retrieval.lexical':'Required lexical index','retrieval.maximumIndexedBytes':'Index quota (bytes)','retrieval.embeddingEndpoint':'Embedding endpoint','retrieval.embeddingProvider':'Embedding provider','retrieval.embeddingModel':'Embedding model','retrieval.embeddingRevision':'Immutable embedding revision','retrieval.embeddingDimensions':'Dimensions (JSON)','retrieval.rerankEndpoint':'Reranker endpoint','retrieval.rerankProvider':'Reranker provider','retrieval.rerankModel':'Reranker model','retrieval.rerankRevision':'Immutable reranker revision','retrieval.rerankImageDigest':'Reranker image digest','retrieval.rerankRuntimeRevision':'Reranker runtime revision',
 'models.enabled':'Enable models','models.gateway':'Gateway','models.endpoint':'Model / LiteLLM endpoint','models.catalogue':'Exact model catalogue (JSON)','models.modelRevisions':'Model revisions (JSON)','models.fallbackChains':'Explicit fallback chains (JSON)','models.virtualKeyTtlSeconds':'Virtual-key TTL (seconds)','models.ownerBudgetMinor':'Per-owner budget (minor units)','models.ownerRequestsPerMinute':'Requests per minute','models.ownerTokensPerMinute':'Tokens per minute','models.currency':'Currency',
 'capabilities.sidecars':'Private sidecars (JSON; endpoints and secret references stay on Node)',
 'sandbox.enabled':'Enable sandbox','sandbox.provider':'Sandbox provider','sandbox.endpoint':'Sandbox endpoint','sandbox.hostPolicyDigest':'Host policy digest','sandbox.maxEvidenceAgeSeconds':'Maximum attestation age (seconds)','sandbox.isolation':'Isolation','sandbox.runtimeCheckpoints':'Native runtime checkpoints','sandbox.images':'Attested images (JSON)',
 'workers.opencode.enabled':'Enable OpenCode','workers.opencode.image':'OpenCode image','workers.opencode.digest':'OpenCode digest','workers.opencode.license':'OpenCode license','workers.opencode.maximumInputBytes':'OpenCode maximum input','workers.opencode.maximumOutputBytes':'OpenCode maximum output','workers.opencode.maximumCommands':'OpenCode maximum commands','workers.opencode.commandCatalogue':'OpenCode commands (JSON)','workers.opencode.network':'OpenCode network','workers.opencode.allowedHosts':'OpenCode hosts (one per line)',
 'workers.openhands.enabled':'Enable OpenHands','workers.openhands.image':'OpenHands image','workers.openhands.digest':'OpenHands digest','workers.openhands.license':'OpenHands license','workers.openhands.maximumInputBytes':'OpenHands maximum input','workers.openhands.maximumOutputBytes':'OpenHands maximum output','workers.openhands.maximumCommands':'OpenHands maximum commands','workers.openhands.commandCatalogue':'OpenHands commands (JSON)','workers.openhands.network':'OpenHands network','workers.openhands.allowedHosts':'OpenHands hosts (one per line)',
 'jobs.enabled':'Enable jobs','jobs.maximumConcurrent':'Concurrent jobs','jobs.leaseTtlSeconds':'Job lease TTL (seconds)','lifecycle.backupDir':'Backup directory','lifecycle.releaseVersion':'Installed version','lifecycle.previousReleaseVersion':'N-1 version','lifecycle.offline':'Offline mode','lifecycle.releaseManifestPath':'Release manifest','lifecycle.releaseSigningPublicKeyPath':'Release public key','telemetry.enabled':'Enable telemetry','telemetry.endpoint':'Telemetry HTTPS endpoint'
};
englishLabels['relay.transport']='Core relay transport';
englishLabels['sandbox.evidenceEndpoint']='External evidence endpoint';
englishLabels['sandbox.runtimeRegion']='Runtime region';
englishLabels['sandbox.runtimeArchitecture']='Runtime architecture';
englishLabels['sandbox.runtimeKind']='Runtime kind';
englishLabels['sandbox.runtimeVersion']='Immutable runtime version';
englishLabels['sandbox.runtimeCheckpointMaxTtlSeconds']='Checkpoint maximum TTL (seconds)';
const tr=(key)=>copy[locale][key]??key;
function applyLocale(){document.documentElement.lang=locale;document.title=locale==='fr'?'Avermate Node — configuration locale':'Avermate Node — local configuration';q('#setup-language').value=locale;for(const node of document.querySelectorAll('[data-i18n]'))node.textContent=tr(node.getAttribute('data-i18n'));for(const node of document.querySelectorAll('[data-i18n-aria-label]'))node.setAttribute('aria-label',tr(node.getAttribute('data-i18n-aria-label')));for(const node of document.querySelectorAll('[data-group-id]')){const id=node.getAttribute('data-group-id');const french=node.getAttribute('data-french-label');node.textContent=locale==='en'?(englishGroups[id]??french):french}for(const node of document.querySelectorAll('[data-field-path]')){const path=node.getAttribute('data-field-path');const french=node.getAttribute('data-french-label');node.textContent=locale==='en'?(englishLabels[path]??french):french}}
const groups=[
 {id:'general',label:'Profil et chemins',fields:[
  {path:'profile',label:'Profil',type:'select',options:['dev-zero','node-lite','node-storage','node-byok','node-local-ai','node-creator','node-local-gpu','node-observable','full-self-host']},
  {path:'relay.transport',label:'Transport du relais Core',type:'select',options:['tls','local-compose']},
  {path:'bind.host',label:'Adresse du configurateur',type:'select',options:['127.0.0.1','localhost','::1']},{path:'bind.port',label:'Port',type:'number',min:1024,max:65535},{path:'dataDir',label:'Répertoire de données',type:'text'}]},
 {id:'storage',label:'Stockage et conversations',fields:[
  {path:'storage.driver',label:'Pilote de stockage',type:'select',options:['filesystem','s3']},{path:'storage.filesystemRoot',label:'Racine filesystem',type:'text',optional:true},{path:'storage.maxObjectBytes',label:'Taille maximale par objet (octets)',type:'number',min:1},{path:'storage.quotaBytes',label:'Quota total (octets)',type:'number',min:1},{path:'conversations.enabled',label:'Conversations sur le Node',type:'boolean'},{path:'conversations.maximumBytes',label:'Quota conversations (octets)',type:'number',min:1}]},
 {id:'retrieval',label:'Recherche, embeddings et reranking',fields:[
  {path:'retrieval.enabled',label:'Activer la recherche',type:'boolean'},{path:'retrieval.lexical',label:'Index lexical obligatoire',type:'boolean'},{path:'retrieval.maximumIndexedBytes',label:'Quota index (octets)',type:'number',min:1},
  {path:'retrieval.embeddingEndpoint',label:'Endpoint embeddings',type:'url',optional:true},{path:'retrieval.embeddingProvider',label:'Fournisseur embeddings',type:'select',optional:true,options:['','openai-compatible','tei','gemini']},{path:'retrieval.embeddingModel',label:'Modèle embeddings',type:'text',optional:true},{path:'retrieval.embeddingRevision',label:'Révision immutable embeddings',type:'text',optional:true},{path:'retrieval.embeddingDimensions',label:'Dimensions (JSON)',type:'json'},
  {path:'retrieval.rerankEndpoint',label:'Endpoint reranker',type:'url',optional:true},{path:'retrieval.rerankProvider',label:'Fournisseur reranker',type:'select',optional:true,options:['','tei','qwen3']},{path:'retrieval.rerankModel',label:'Modèle reranker',type:'text',optional:true},{path:'retrieval.rerankRevision',label:'Révision immutable reranker',type:'text',optional:true},{path:'retrieval.rerankImageDigest',label:'Digest image reranker',type:'text',optional:true},{path:'retrieval.rerankRuntimeRevision',label:'Révision runtime reranker',type:'text',optional:true}]},
 {id:'models',label:'Modèles et LiteLLM',fields:[
  {path:'models.enabled',label:'Activer les modèles',type:'boolean'},{path:'models.gateway',label:'Gateway',type:'select',options:['disabled','direct','litellm']},{path:'models.endpoint',label:'Endpoint modèles / LiteLLM',type:'url',optional:true},{path:'models.catalogue',label:'Catalogue exact des modèles (JSON)',type:'json'},{path:'models.modelRevisions',label:'Révisions des modèles (JSON)',type:'json'},{path:'models.fallbackChains',label:'Chaînes de fallback explicites (JSON)',type:'json'},{path:'models.virtualKeyTtlSeconds',label:'TTL clé virtuelle (secondes)',type:'number',min:60,max:86400},{path:'models.ownerBudgetMinor',label:'Budget par propriétaire (unité mineure)',type:'number',min:0},{path:'models.ownerRequestsPerMinute',label:'Requêtes par minute',type:'number',min:1},{path:'models.ownerTokensPerMinute',label:'Tokens par minute',type:'number',min:1},{path:'models.currency',label:'Devise',type:'text'}]},
 {id:'capabilities',label:'Sidecars de capabilities privés',fields:[
  {path:'capabilities.sidecars',label:'Sidecars privés (JSON ; endpoints et références secrètes restent sur le Node)',type:'json'}]},
 {id:'sandbox',label:'Sandbox et workers spécialisés',fields:[
  {path:'sandbox.enabled',label:'Activer le sandbox',type:'boolean'},{path:'sandbox.provider',label:'Provider sandbox',type:'select',options:['disabled','opensandbox','microsandbox']},{path:'sandbox.endpoint',label:'Endpoint sandbox',type:'url',optional:true},{path:'sandbox.hostPolicyDigest',label:'Digest politique hôte',type:'text',optional:true},{path:'sandbox.maxEvidenceAgeSeconds',label:'Âge maximal de l’attestation (secondes)',type:'number',min:10},{path:'sandbox.isolation',label:'Isolation',type:'select',options:['none','runc','gvisor','kata','microvm']},{path:'sandbox.runtimeCheckpoints',label:'Runtime checkpoints natifs',type:'boolean'},{path:'sandbox.images',label:'Images attestées (JSON)',type:'json'},
  {path:'sandbox.evidenceEndpoint',label:'Endpoint d’attestation externe',type:'url',optional:true},{path:'sandbox.runtimeRegion',label:'Région du runtime',type:'text',optional:true},{path:'sandbox.runtimeArchitecture',label:'Architecture du runtime',type:'select',optional:true,options:['','amd64','arm64']},{path:'sandbox.runtimeKind',label:'Type de runtime',type:'text',optional:true},{path:'sandbox.runtimeVersion',label:'Version immutable du runtime',type:'text',optional:true},{path:'sandbox.runtimeCheckpointMaxTtlSeconds',label:'TTL maximal checkpoint (secondes)',type:'number',min:60,optional:true},
  {path:'workers.opencode.enabled',label:'Activer OpenCode',type:'boolean'},{path:'workers.opencode.image',label:'Image OpenCode',type:'text',optional:true},{path:'workers.opencode.digest',label:'Digest OpenCode',type:'text',optional:true},{path:'workers.opencode.license',label:'Licence OpenCode',type:'text',optional:true},{path:'workers.opencode.maximumInputBytes',label:'Entrée max OpenCode',type:'number',min:1},{path:'workers.opencode.maximumOutputBytes',label:'Sortie max OpenCode',type:'number',min:1},{path:'workers.opencode.maximumCommands',label:'Commandes max OpenCode',type:'number',min:1},{path:'workers.opencode.commandCatalogue',label:'Commandes OpenCode (JSON)',type:'json'},{path:'workers.opencode.network',label:'Réseau OpenCode',type:'select',options:['denied','allowlist']},{path:'workers.opencode.allowedHosts',label:'Hôtes OpenCode (un par ligne)',type:'lines'},
  {path:'workers.openhands.enabled',label:'Activer OpenHands',type:'boolean'},{path:'workers.openhands.image',label:'Image OpenHands',type:'text',optional:true},{path:'workers.openhands.digest',label:'Digest OpenHands',type:'text',optional:true},{path:'workers.openhands.license',label:'Licence OpenHands',type:'text',optional:true},{path:'workers.openhands.maximumInputBytes',label:'Entrée max OpenHands',type:'number',min:1},{path:'workers.openhands.maximumOutputBytes',label:'Sortie max OpenHands',type:'number',min:1},{path:'workers.openhands.maximumCommands',label:'Commandes max OpenHands',type:'number',min:1},{path:'workers.openhands.commandCatalogue',label:'Commandes OpenHands (JSON)',type:'json'},{path:'workers.openhands.network',label:'Réseau OpenHands',type:'select',options:['denied','allowlist']},{path:'workers.openhands.allowedHosts',label:'Hôtes OpenHands (un par ligne)',type:'lines'}]},
 {id:'jobs',label:'Jobs, cycle de vie et observabilité',fields:[
  {path:'jobs.enabled',label:'Activer les jobs',type:'boolean'},{path:'jobs.maximumConcurrent',label:'Jobs concurrents',type:'number',min:1},{path:'jobs.leaseTtlSeconds',label:'TTL lease job (secondes)',type:'number',min:5,max:300},{path:'lifecycle.backupDir',label:'Répertoire des sauvegardes',type:'text'},{path:'lifecycle.releaseVersion',label:'Version installée',type:'text'},{path:'lifecycle.previousReleaseVersion',label:'Version N-1',type:'text',optional:true},{path:'lifecycle.offline',label:'Mode hors ligne',type:'boolean'},{path:'lifecycle.releaseManifestPath',label:'Manifeste de release',type:'text',optional:true},{path:'lifecycle.releaseSigningPublicKeyPath',label:'Clé publique de release',type:'text',optional:true},{path:'telemetry.enabled',label:'Activer la télémétrie',type:'boolean'},{path:'telemetry.endpoint',label:'Endpoint télémétrie HTTPS',type:'url',optional:true}]}
];
const get=(obj,path)=>path.split('.').reduce((value,key)=>value&&value[key],obj);const del=(obj,path)=>{const keys=path.split('.');const last=keys.pop();const parent=keys.reduce((value,key)=>value&&value[key],obj);if(parent&&last)delete parent[last]};const set=(obj,path,value)=>{const keys=path.split('.');const last=keys.pop();const parent=keys.reduce((value,key)=>(value[key]??={}),obj);parent[last]=value};
function message(text,isError=false){err.textContent=isError?text:'';status.textContent=isError?'':text}function setBusy(value){busy=value;q('#config-form').setAttribute('aria-busy',String(value));document.querySelectorAll('button').forEach((button)=>button.disabled=value||(button.id==='download-compose'&&!deployment));q('#dirty').textContent=tr(value?'processing':'localChanges')}
async function call(path,body,bootstrap=false){message('');const headers={'content-type':'application/json','sec-fetch-site':'same-origin'};if(!bootstrap)headers['x-csrf-token']=csrf;const response=await fetch(path,{method:'POST',credentials:'same-origin',headers,body:JSON.stringify(body)});const next=response.headers.get('x-csrf-token');if(next)csrf=next;const data=await response.json();if(!response.ok)throw new Error(data.error||tr('failure'));return data}
function renderSidecarSecretOptions(){const select=q('#secret-slot');const previous=select.value;for(const option of [...select.querySelectorAll('[data-sidecar-secret]')])option.remove();for(const sidecar of config.capabilities?.sidecars??[]){const option=document.createElement('option');option.value='capability-sidecar:'+sidecar.id;option.textContent='Sidecar: '+sidecar.id;option.dataset.sidecarSecret='true';select.append(option)}if([...select.options].some((option)=>option.value===previous))select.value=previous}
function render(){const root=q('#config-groups');root.replaceChildren();for(const group of groups){const fieldset=document.createElement('fieldset');fieldset.className='config-group';const legend=document.createElement('legend');legend.dataset.groupId=group.id;legend.dataset.frenchLabel=group.label;legend.textContent=locale==='en'?(englishGroups[group.id]??group.label):group.label;fieldset.append(legend);const grid=document.createElement('div');grid.className='grid two';for(const field of group.fields){const wrapper=document.createElement('div');wrapper.className=field.type==='boolean'?'field check':'field';const id='config-'+field.path.replaceAll('.','-');const label=document.createElement('label');label.htmlFor=id;label.dataset.fieldPath=field.path;label.dataset.frenchLabel=field.label;label.textContent=locale==='en'?(englishLabels[field.path]??field.label):field.label;let input;if(field.type==='select'){input=document.createElement('select');for(const option of field.options){const item=document.createElement('option');item.value=option;if(option)item.textContent=option;else{item.dataset.i18n='notConfigured';item.textContent=tr('notConfigured')}input.append(item)}}else if(field.type==='json'||field.type==='lines'){input=document.createElement('textarea');input.spellcheck=false}else{input=document.createElement('input');input.type=field.type==='boolean'?'checkbox':field.type; if(field.min!==undefined)input.min=String(field.min);if(field.max!==undefined)input.max=String(field.max)}input.id=id;input.dataset.path=field.path;input.dataset.type=field.type;input.dataset.optional=field.optional?'true':'false';const value=get(config,field.path);if(field.type==='boolean')input.checked=Boolean(value);else if(field.type==='json')input.value=JSON.stringify(value??(field.path.endsWith('modelRevisions')?{}:[]),null,2);else if(field.type==='lines')input.value=Array.isArray(value)?value.join('\\n'):'';else input.value=value??'';input.addEventListener('input',()=>{q('#dirty').textContent=tr('notValidated')});if(field.type==='boolean'){wrapper.append(input,label)}else{wrapper.append(label,input)}grid.append(wrapper)}fieldset.append(grid);root.append(fieldset)}renderSidecarSecretOptions();q('#config-profile').value=config.profile;q('#core-url').value=config.relay?.coreUrl??'';q('#dirty').textContent=tr('loaded')}
const renderBase=render;render=()=>{renderBase();const localCompose=config.relay?.transport==='local-compose';q('#core-url').value=config.relay?.coreUrl??(localCompose?'http://api:5000':'');q('label[for="core-url"]').textContent=locale==='en'?(localCompose?'Local Compose Core URL':'Core URL (HTTPS)'):(localCompose?'URL du Core Compose local':'URL du Core (HTTPS)')};
function collect(){const next=structuredClone(config);for(const input of document.querySelectorAll('[data-path]')){const path=input.getAttribute('data-path');const type=input.getAttribute('data-type');const optional=input.getAttribute('data-optional')==='true';let value;if(type==='boolean')value=input.checked;else if(type==='number'){if(!input.value&&optional){del(next,path);continue}value=Number(input.value);if(!Number.isFinite(value))throw new Error(tr('invalidNumber')+path)}else if(type==='json'){try{value=JSON.parse(input.value)}catch{throw new Error(tr('invalidJson')+path)}}else if(type==='lines')value=input.value.split(/\\r?\\n/).map((item)=>item.trim()).filter(Boolean);else{value=input.value.trim();if(!value&&optional){del(next,path);continue}}set(next,path,value)}config=next;return next}
async function action(messageKey,task){if(busy)return;setBusy(true);try{const value=await task();out.textContent=JSON.stringify(value,null,2);message(tr(messageKey));return value}catch(error){message(error.message||String(error),true)}finally{setBusy(false)}}
q('#setup-language').onchange=()=>{locale=q('#setup-language').value==='fr'?'fr':'en';try{localStorage.setItem(localeKey,locale)}catch{}applyLocale()};
q('#unlock').onclick=()=>action('unlocked',async()=>{const data=await call('/api/setup/session',{secret:q('#secret').value},true);csrf=data.csrf;q('#secret').value='';q('#login').hidden=true;q('#wizard').hidden=false;config=data.state.config;render();return data.state});
q('#validate').onclick=()=>action('valid',async()=>{const data=await call('/api/setup/config/validate',collect());config=data.config;render();return data});
q('#apply').onclick=()=>action('applied',async()=>{const data=await call('/api/setup/config/apply',collect());config=data.config;render();return data});
q('#rollback').onclick=()=>action('rolledBack',async()=>{const data=await call('/api/setup/config/rollback',{});config=data.config;render();return data});
q('#preflight').onclick=()=>action('preflightDone',()=>call('/api/setup/preflight',{profile:collect().profile}));
const secretPaths={'storage-s3':'storage.s3SecretRef','model-admin':'models.adminSecretRef','embedding-provider':'retrieval.embeddingSecretRef','rerank-provider':'retrieval.rerankSecretRef','sandbox-provider':'sandbox.providerSecretRef','sandbox-evidence':'sandbox.evidenceSecretRef'};
q('#save-secret').onclick=()=>action('secretSaved',async()=>{const slot=q('#secret-slot').value;const value=q('#provider-secret').value;const data=await call('/api/setup/secret',{slot,value});q('#provider-secret').value='';if(slot==='model-provider')config.models.providerSecretRefs=Array(data.configuredCount).fill('configured');else if(slot.startsWith('capability-sidecar:')){const sidecar=config.capabilities.sidecars.find((entry)=>entry.id===slot.slice('capability-sidecar:'.length));if(sidecar)sidecar.secretRef='configured'}else set(config,secretPaths[slot],'configured');render();return data});
q('#clear-secret').onclick=()=>{const slot=q('#secret-slot').value;if(slot==='model-provider')config.models.providerSecretRefs=[];else if(slot.startsWith('capability-sidecar:')){const sidecar=config.capabilities.sidecars.find((entry)=>entry.id===slot.slice('capability-sidecar:'.length));if(sidecar)delete sidecar.secretRef}else del(config,secretPaths[slot]);render();message(tr('secretCleared'))};
q('#pair').onclick=()=>action('pairingSaved',async()=>{const data=await call('/api/setup/pairing-code',{coreUrl:q('#core-url').value});q('#pairing-id').value=data.offer.pairingAttemptId;return data});
q('#credentials').onclick=()=>action('credentialsSaved',async()=>{const data=await call('/api/setup/pairing-credentials',{coreUrl:q('#core-url').value,pairingAttemptId:q('#pairing-id').value});const state=await (await fetch('/api/setup/state',{credentials:'same-origin'})).json();config=state.config;render();return data});
q('#deployment-preview').onclick=()=>action('planGenerated',async()=>{deployment=await call('/api/setup/deployment/preview',collect());q('#deployment-output').textContent=JSON.stringify(deployment,null,2);return deployment});
q('#download-compose').onclick=()=>{if(!deployment)return;const url=URL.createObjectURL(new Blob([deployment.composeOverride],{type:'text/yaml'}));const link=document.createElement('a');link.href=url;link.download=deployment.composeFile;link.click();setTimeout(()=>URL.revokeObjectURL(url),0)};
q('#close-setup').onclick=()=>action('setupClosed',async()=>{const data=await call('/api/setup/close',{});q('#wizard').hidden=true;return data});
applyLocale();
void (async()=>{try{const response=await fetch('/api/setup/state',{credentials:'same-origin'});if(!response.ok)return;const next=response.headers.get('x-csrf-token');if(!next)return;csrf=next;const state=await response.json();config=state.config;q('#login').hidden=true;q('#wizard').hidden=false;render();message(tr('sessionRestored'))}catch{}})();`;

export class LocalConfigurator {
  readonly #security: ConfiguratorSecurity;
  readonly #pairing: PairingManager;
  readonly #configPath: string;
  readonly #manifest: () => Promise<NodeCapabilityManifestV2>;
  readonly #secrets: NodeSecretStore;
  readonly #fetch: typeof fetch;
  readonly #pairingOffers = new Map<string, NodePairingOffer>();
  readonly #pendingSecretRefs = new Map<ConfiguratorSecretSlot, string[]>();
  #config: NodeConfig;

  constructor(input: {
    security: ConfiguratorSecurity;
    pairing: PairingManager;
    config: NodeConfig;
    configPath: string;
    manifest: () => Promise<NodeCapabilityManifestV2>;
    secrets: NodeSecretStore;
    fetch?: typeof fetch;
  }) {
    this.#security = input.security;
    this.#pairing = input.pairing;
    this.#config = input.config;
    this.#configPath = input.configPath;
    this.#manifest = input.manifest;
    this.#secrets = input.secrets;
    this.#fetch = input.fetch ?? fetch;
  }

  async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      this.#security.assertBaseRequest(request);
      if (request.method === "GET" && url.pathname === "/setup") {
        return secureResponse(setupHtml, {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }
      if (request.method === "GET" && url.pathname === "/setup.css") {
        return secureResponse(setupCss, {
          headers: { "content-type": "text/css; charset=utf-8" },
        });
      }
      if (request.method === "GET" && url.pathname === "/setup.js") {
        return secureResponse(setupJs, {
          headers: { "content-type": "text/javascript; charset=utf-8" },
        });
      }
      if (request.method === "POST" && url.pathname === "/api/setup/session") {
        const body = (await jsonBody(request)) as { secret?: unknown };
        if (typeof body.secret !== "string")
          throw new Error("BOOTSTRAP_INVALID");
        const session = await this.#security.exchangeBootstrap(
          request,
          body.secret,
        );
        return secureResponse(
          JSON.stringify({ csrf: session.csrf, state: this.#state() }),
          {
            headers: {
              "content-type": "application/json",
              ...this.#security.sessionHeaders(
                session,
                url.protocol === "https:",
              ),
            },
          },
        );
      }
      if (request.method === "GET" && url.pathname === "/api/setup/state") {
        const session = this.#security.requireSession(request, {
          mutating: false,
        });
        return secureResponse(JSON.stringify(this.#state()), {
          headers: {
            "content-type": "application/json",
            "x-csrf-token": session.csrf,
          },
        });
      }
      if (
        request.method === "POST" &&
        url.pathname === "/api/setup/config/validate"
      ) {
        this.#security.requireSession(request, { mutating: true });
        const config = this.#resolveBrowserConfig(await jsonBody(request));
        return secureResponse(
          JSON.stringify({
            valid: true,
            config: publicConfig(config),
            changes: changePreview(this.#config, config),
          }),
          {
            headers: { "content-type": "application/json" },
          },
        );
      }
      if (
        request.method === "POST" &&
        url.pathname === "/api/setup/config/apply"
      ) {
        const session = this.#security.requireSession(request, {
          mutating: true,
        });
        const config = this.#resolveBrowserConfig(await jsonBody(request));
        const changes = changePreview(this.#config, config);
        await atomicConfig(`${this.#configPath}.previous`, this.#config);
        await atomicConfig(this.#configPath, config);
        this.#config = config;
        await this.#commitPendingSecrets(config);
        const rotated = this.#security.rotate(session);
        return secureResponse(
          JSON.stringify({
            applied: true,
            restartRequired: changes.restartRequired,
            changes,
            config: publicConfig(config),
            csrf: rotated.csrf,
          }),
          {
            headers: {
              "content-type": "application/json",
              ...this.#security.sessionHeaders(
                rotated,
                url.protocol === "https:",
              ),
            },
          },
        );
      }
      if (
        request.method === "POST" &&
        url.pathname === "/api/setup/config/rollback"
      ) {
        const session = this.#security.requireSession(request, {
          mutating: true,
        });
        await jsonBody(request);
        const previousPath = `${this.#configPath}.previous`;
        let previous: NodeConfig;
        try {
          previous = await loadNodeConfig(previousPath);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            throw new Error("CONFIGURATOR_ROLLBACK_UNAVAILABLE");
          }
          throw error;
        }
        const current = this.#config;
        await atomicConfig(this.#configPath, previous);
        await atomicConfig(previousPath, current);
        this.#config = previous;
        await this.#discardPendingSecrets();
        const rotated = this.#security.rotate(session);
        return secureResponse(
          JSON.stringify({
            rolledBack: true,
            restartRequired: true,
            config: publicConfig(previous),
            csrf: rotated.csrf,
          }),
          {
            headers: {
              "content-type": "application/json",
              ...this.#security.sessionHeaders(
                rotated,
                url.protocol === "https:",
              ),
            },
          },
        );
      }
      if (request.method === "POST" && url.pathname === "/api/setup/secret") {
        const session = this.#security.requireSession(request, {
          mutating: true,
        });
        const body = (await jsonBody(request)) as {
          slot?: unknown;
          value?: unknown;
        };
        const slot = secretSlot(body.slot);
        if (typeof body.value !== "string") {
          throw new Error("CONFIGURATOR_SECRET_VALUE_INVALID");
        }
        const secretSlotName = slot.startsWith("capability-sidecar:")
          ? `sidecar-${canonicalDigest(slot).slice(7, 19)}`
          : slot;
        const secretName = `setup-${secretSlotName}-${crypto
          .randomUUID()
          .replaceAll("-", "")
          .slice(0, 12)}`;
        const reference = await this.#secrets.put(secretName, body.value);
        const previous = this.#pendingSecretRefs.get(slot) ?? [];
        if (slot !== "model-provider") {
          await this.#deleteSecretRefs(previous);
        }
        this.#pendingSecretRefs.set(
          slot,
          slot === "model-provider" ? [...previous, reference] : [reference],
        );
        const configuredCount =
          slot === "model-provider"
            ? this.#config.models.providerSecretRefs.length +
              previous.length +
              1
            : 1;
        const rotated = this.#security.rotate(session);
        return secureResponse(
          JSON.stringify({
            configured: true,
            slot,
            configuredCount,
            csrf: rotated.csrf,
          }),
          {
            headers: {
              "content-type": "application/json",
              ...this.#security.sessionHeaders(
                rotated,
                url.protocol === "https:",
              ),
            },
          },
        );
      }
      if (
        request.method === "POST" &&
        url.pathname === "/api/setup/deployment/preview"
      ) {
        this.#security.requireSession(request, { mutating: true });
        const config = this.#resolveBrowserConfig(await jsonBody(request));
        return secureResponse(JSON.stringify(deploymentPreview(config)), {
          headers: { "content-type": "application/json" },
        });
      }
      if (
        request.method === "POST" &&
        url.pathname === "/api/setup/preflight"
      ) {
        this.#security.requireSession(request, { mutating: true });
        const body = (await jsonBody(request)) as { profile?: unknown };
        const config = nodeConfigSchema.parse({
          ...this.#config,
          profile: body.profile,
        });
        const report = await runHostPreflight({
          profile: config.profile,
          dataDir: config.dataDir,
        });
        return secureResponse(JSON.stringify(report), {
          headers: { "content-type": "application/json" },
        });
      }
      if (
        request.method === "POST" &&
        url.pathname === "/api/setup/pairing-code"
      ) {
        const session = this.#security.requireSession(request, {
          mutating: true,
        });
        const body = (await jsonBody(request)) as { coreUrl?: unknown };
        const target = pairingCoreUrl(
          body.coreUrl,
          this.#config.relay.transport,
        );
        const pending = this.#pairing.create();
        const registration = this.#pairing.registration(
          pending.offer,
          await this.#manifest(),
        );
        await corePost(
          this.#fetch,
          target,
          "/api/node/pairing/register",
          registration,
        );
        this.#pairingOffers.set(pending.offer.pairingAttemptId, pending.offer);
        const rotated = this.#security.rotate(session);
        return secureResponse(
          JSON.stringify({
            code: pending.code,
            offer: pending.offer,
            registered: true,
            csrf: rotated.csrf,
          }),
          {
            headers: {
              "content-type": "application/json",
              ...this.#security.sessionHeaders(
                rotated,
                url.protocol === "https:",
              ),
            },
          },
        );
      }
      if (
        request.method === "POST" &&
        url.pathname === "/api/setup/pairing-credentials"
      ) {
        const session = this.#security.requireSession(request, {
          mutating: true,
        });
        const body = (await jsonBody(request)) as {
          coreUrl?: unknown;
          pairingAttemptId?: unknown;
        };
        const target = pairingCoreUrl(
          body.coreUrl,
          this.#config.relay.transport,
        );
        if (
          typeof body.pairingAttemptId !== "string" ||
          !this.#pairingOffers.has(body.pairingAttemptId)
        ) {
          throw new Error("PAIRING_ATTEMPT_NOT_CREATED_LOCALLY");
        }
        const delivery = nodeCredentialDeliverySchema.parse(
          await corePost(
            this.#fetch,
            target,
            "/api/node/pairing/credentials",
            this.#pairing.credentialProof({
              action: "deliver",
              pairingAttemptId: body.pairingAttemptId,
            }),
          ),
        );
        const relayCredential = delivery.credentials.find(
          (credential) => credential.kind === "relay",
        );
        const capabilityCredential = delivery.credentials.find(
          (credential) => credential.kind === "capability",
        );
        if (
          !relayCredential ||
          !capabilityCredential ||
          !delivery.coreGrantSigningKey
        ) {
          throw new Error("NODE_CREDENTIAL_DELIVERY_INCOMPLETE");
        }
        const relaySecretName = `relay-${relayCredential.id}`;
        const capabilitySecretName = `capability-${capabilityCredential.id}`;
        if (!(await this.#secrets.has(relaySecretName))) {
          await this.#secrets.put(relaySecretName, relayCredential.credential);
        }
        if (!(await this.#secrets.has(capabilitySecretName))) {
          await this.#secrets.put(
            capabilitySecretName,
            capabilityCredential.credential,
          );
        }
        const next = nodeConfigSchema.parse({
          ...this.#config,
          relay: {
            ...this.#config.relay,
            coreUrl: target.toString().replace(/\/$/u, ""),
            credentialSecretRef: this.#secrets.reference(relaySecretName),
            capabilityCredentialSecretRef:
              this.#secrets.reference(capabilitySecretName),
            coreGrantKeyId: delivery.coreGrantSigningKey.keyId,
            coreGrantPublicKey: delivery.coreGrantSigningKey.publicSigningKey,
          },
        });
        await atomicConfig(this.#configPath, next);
        await corePost(
          this.#fetch,
          target,
          "/api/node/pairing/credentials/ack",
          this.#pairing.credentialProof({
            action: "ack",
            pairingAttemptId: body.pairingAttemptId,
            credentialIds: delivery.credentials.map(
              (credential) => credential.id,
            ),
          }),
        );
        this.#config = next;
        this.#pairingOffers.delete(body.pairingAttemptId);
        const rotated = this.#security.rotate(session);
        return secureResponse(
          JSON.stringify({
            configured: true,
            acknowledged: delivery.credentials.length,
            restartRequired: true,
            csrf: rotated.csrf,
          }),
          {
            headers: {
              "content-type": "application/json",
              ...this.#security.sessionHeaders(
                rotated,
                url.protocol === "https:",
              ),
            },
          },
        );
      }
      if (request.method === "POST" && url.pathname === "/api/setup/close") {
        this.#security.requireSession(request, { mutating: true });
        await jsonBody(request);
        await this.#discardPendingSecrets();
        this.#security.close();
        return secureResponse(JSON.stringify({ closed: true }), {
          headers: {
            "content-type": "application/json",
            "set-cookie":
              "avermate_node_setup=; HttpOnly; SameSite=Strict; Path=/api/setup; Max-Age=0",
          },
        });
      }
      return secureResponse(JSON.stringify({ error: "NOT_FOUND" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    } catch (error) {
      const code =
        error instanceof Error ? error.message : "CONFIGURATOR_ERROR";
      const status =
        code === "NOT_FOUND" ? 404 : code.includes("RATE_LIMIT") ? 429 : 400;
      return secureResponse(JSON.stringify({ error: code }), {
        status,
        headers: { "content-type": "application/json" },
      });
    }
  }

  #resolveBrowserConfig(value: unknown): NodeConfig {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("CONFIGURATOR_CONFIG_INVALID");
    }
    const candidate = structuredClone(value) as BrowserConfigInput;
    candidate.storage ??= {};
    candidate.relay ??= {};
    candidate.retrieval ??= {};
    candidate.models ??= {};
    candidate.capabilities ??= {};
    candidate.sandbox ??= {};

    candidate.storage.s3SecretRef = this.#resolveSingleSecret(
      "storage-s3",
      candidate.storage.s3SecretRef,
      this.#config.storage.s3SecretRef,
    );
    candidate.retrieval.embeddingSecretRef = this.#resolveSingleSecret(
      "embedding-provider",
      candidate.retrieval.embeddingSecretRef,
      this.#config.retrieval.embeddingSecretRef,
    );
    candidate.retrieval.rerankSecretRef = this.#resolveSingleSecret(
      "rerank-provider",
      candidate.retrieval.rerankSecretRef,
      this.#config.retrieval.rerankSecretRef,
    );
    candidate.models.adminSecretRef = this.#resolveSingleSecret(
      "model-admin",
      candidate.models.adminSecretRef,
      this.#config.models.adminSecretRef,
    );
    candidate.sandbox.providerSecretRef = this.#resolveSingleSecret(
      "sandbox-provider",
      candidate.sandbox.providerSecretRef,
      this.#config.sandbox.providerSecretRef,
    );
    candidate.sandbox.evidenceSecretRef = this.#resolveSingleSecret(
      "sandbox-evidence",
      candidate.sandbox.evidenceSecretRef,
      this.#config.sandbox.evidenceSecretRef,
    );

    const providerRefs = candidate.models.providerSecretRefs;
    if (Array.isArray(providerRefs) && providerRefs.length === 0) {
      candidate.models.providerSecretRefs = [];
    } else if (
      Array.isArray(providerRefs) &&
      providerRefs.every((reference) => reference === CONFIGURED_SECRET)
    ) {
      const refs = [
        ...this.#config.models.providerSecretRefs,
        ...(this.#pendingSecretRefs.get("model-provider") ?? []),
      ];
      if (providerRefs.length !== refs.length) {
        throw new Error("CONFIGURATOR_SECRET_REFERENCE_INVALID");
      }
      candidate.models.providerSecretRefs = refs;
    } else {
      throw new Error("CONFIGURATOR_SECRET_REFERENCE_INVALID");
    }

    const presentedSidecars = candidate.capabilities.sidecars;
    if (Array.isArray(presentedSidecars)) {
      const currentById = new Map(
        this.#config.capabilities.sidecars.map((sidecar) => [
          sidecar.id,
          sidecar,
        ]),
      );
      candidate.capabilities.sidecars = presentedSidecars.map((raw) => {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
          throw new Error("CONFIGURATOR_SIDECAR_INVALID");
        }
        const sidecar = raw as Record<string, unknown>;
        if (typeof sidecar.id !== "string") {
          throw new Error("CONFIGURATOR_SIDECAR_INVALID");
        }
        const slot = secretSlot(`capability-sidecar:${sidecar.id}`);
        if (sidecar.secretRef === undefined) return sidecar;
        if (sidecar.secretRef !== CONFIGURED_SECRET) {
          throw new Error("CONFIGURATOR_SECRET_REFERENCE_INVALID");
        }
        const reference =
          this.#pendingSecretRefs.get(slot)?.at(-1) ??
          currentById.get(sidecar.id)?.secretRef;
        if (!reference) throw new Error("CONFIGURATOR_SECRET_NOT_SET");
        return { ...sidecar, secretRef: reference };
      });
    }

    const relay = candidate.relay;
    relay.credentialSecretRef = this.#restoreCurrentSecret(
      relay.credentialSecretRef,
      this.#config.relay.credentialSecretRef,
    );
    relay.capabilityCredentialSecretRef = this.#restoreCurrentSecret(
      relay.capabilityCredentialSecretRef,
      this.#config.relay.capabilityCredentialSecretRef,
    );
    const publicKeyConfigured = relay.coreGrantPublicKeyConfigured;
    delete relay.coreGrantPublicKeyConfigured;
    if (publicKeyConfigured === true && this.#config.relay.coreGrantPublicKey) {
      relay.coreGrantPublicKey = this.#config.relay.coreGrantPublicKey;
    }

    return nodeConfigSchema.parse(JSON.parse(JSON.stringify(candidate)));
  }

  #resolveSingleSecret(
    slot: Exclude<StaticConfiguratorSecretSlot, "model-provider">,
    presented: unknown,
    current: string | undefined,
  ) {
    if (presented === undefined) return undefined;
    if (presented !== CONFIGURED_SECRET) {
      throw new Error("CONFIGURATOR_SECRET_REFERENCE_INVALID");
    }
    const pending = this.#pendingSecretRefs.get(slot)?.at(-1);
    if (pending) return pending;
    if (current) return current;
    throw new Error("CONFIGURATOR_SECRET_NOT_SET");
  }

  #restoreCurrentSecret(presented: unknown, current: string | undefined) {
    if (presented === undefined) return undefined;
    if (presented !== CONFIGURED_SECRET) {
      throw new Error("CONFIGURATOR_SECRET_REFERENCE_INVALID");
    }
    if (current) return current;
    throw new Error("CONFIGURATOR_SECRET_NOT_SET");
  }

  async #discardPendingSecrets() {
    const pending = [...this.#pendingSecretRefs.values()].flat();
    this.#pendingSecretRefs.clear();
    await this.#deleteSecretRefs(pending);
  }

  async #commitPendingSecrets(config: NodeConfig) {
    const adopted = new Set(
      [
        config.storage.s3SecretRef,
        config.retrieval.embeddingSecretRef,
        config.retrieval.rerankSecretRef,
        config.models.adminSecretRef,
        ...config.models.providerSecretRefs,
        config.sandbox.providerSecretRef,
        config.sandbox.evidenceSecretRef,
        ...config.capabilities.sidecars.map((sidecar) => sidecar.secretRef),
      ].filter((reference): reference is string => Boolean(reference)),
    );
    const unadopted = [...this.#pendingSecretRefs.values()]
      .flat()
      .filter((reference) => !adopted.has(reference));
    this.#pendingSecretRefs.clear();
    await this.#deleteSecretRefs(unadopted);
  }

  async #deleteSecretRefs(references: string[]) {
    await Promise.all(
      references.map(async (reference) => {
        if (reference.startsWith("secret:")) {
          await this.#secrets.delete(reference.slice("secret:".length));
        }
      }),
    );
  }

  #state() {
    return {
      setupOpen: this.#security.setupOpen,
      config: publicConfig(this.#config),
      warnings: this.#config.sandbox.enabled
        ? [
            "Le runtime d'isolation doit passer son propre preflight avant activation.",
          ]
        : [],
    };
  }
}
