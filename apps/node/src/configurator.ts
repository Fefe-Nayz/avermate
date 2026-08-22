import {
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

const MAX_JSON_BODY_BYTES = 64 * 1024;

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
<body><main><h1>Avermate Node</h1><p>Configuration locale. Le secret reste dans cette requête locale et n'est jamais placé dans l'URL.</p>
<section id="login"><label>Secret d'amorçage <input id="secret" type="password" autocomplete="one-time-code"></label><button id="unlock">Déverrouiller</button></section>
<section id="wizard" hidden><h2>Profil</h2><select id="profile"><option value="dev-zero">dev-zero — fichiers locaux, sans Garage</option><option value="node-lite">node-lite</option><option value="node-storage">node-storage</option><option value="node-creator">node-creator</option><option value="node-local-gpu">node-local-gpu</option><option value="node-observable">node-observable</option><option value="full-self-host">full-self-host</option></select><button id="preflight">Tester l'hôte</button><button id="validate">Valider le manifeste</button><button id="pair">Créer un code de pairing</button><pre id="result"></pre></section>
<p id="error" role="alert"></p></main><script src="/setup.js" defer></script></body></html>`;

const setupCss = `:root{font:16px system-ui;color-scheme:light dark}body{margin:0;background:#101418;color:#edf2f7}main{max-width:46rem;margin:8vh auto;padding:2rem;border:1px solid #334155;border-radius:1rem;background:#18212b}section{display:grid;gap:1rem;margin:2rem 0}label{display:grid;gap:.5rem}input,select,button{font:inherit;padding:.7rem;border-radius:.5rem;border:1px solid #64748b}button{cursor:pointer}pre{white-space:pre-wrap;overflow-wrap:anywhere}#error{color:#fca5a5}`;

const setupJs = `let csrf='';const q=(s)=>document.querySelector(s);const out=q('#result');const err=q('#error');
async function call(path,body,bootstrap=false){err.textContent='';const headers={'content-type':'application/json','sec-fetch-site':'same-origin'};if(!bootstrap)headers['x-csrf-token']=csrf;const r=await fetch(path,{method:'POST',credentials:'same-origin',headers,body:JSON.stringify(body)});const next=r.headers.get('x-csrf-token');if(next)csrf=next;const data=await r.json();if(!r.ok)throw new Error(data.error||'Échec');return data}
q('#unlock').onclick=async()=>{try{const data=await call('/api/setup/session',{secret:q('#secret').value},true);csrf=data.csrf;q('#secret').value='';q('#login').hidden=true;q('#wizard').hidden=false;out.textContent=JSON.stringify(data.state,null,2)}catch(e){err.textContent=e.message}};
q('#validate').onclick=async()=>{try{const state=await (await fetch('/api/setup/state',{credentials:'same-origin'})).json();out.textContent=JSON.stringify(state,null,2)}catch(e){err.textContent=e.message}};
q('#preflight').onclick=async()=>{try{out.textContent=JSON.stringify(await call('/api/setup/preflight',{profile:q('#profile').value}),null,2)}catch(e){err.textContent=e.message}};
q('#pair').onclick=async()=>{try{out.textContent=JSON.stringify(await call('/api/setup/pairing-code',{}),null,2)}catch(e){err.textContent=e.message}};`;

export class LocalConfigurator {
  readonly #security: ConfiguratorSecurity;
  readonly #pairing: PairingManager;
  readonly #configPath: string;
  #config: NodeConfig;

  constructor(input: {
    security: ConfiguratorSecurity;
    pairing: PairingManager;
    config: NodeConfig;
    configPath: string;
  }) {
    this.#security = input.security;
    this.#pairing = input.pairing;
    this.#config = input.config;
    this.#configPath = input.configPath;
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
        this.#security.requireSession(request, { mutating: false });
        return secureResponse(JSON.stringify(this.#state()), {
          headers: { "content-type": "application/json" },
        });
      }
      if (
        request.method === "POST" &&
        url.pathname === "/api/setup/config/validate"
      ) {
        this.#security.requireSession(request, { mutating: true });
        const config = nodeConfigSchema.parse(await jsonBody(request));
        return secureResponse(
          JSON.stringify({ valid: true, config: publicConfig(config) }),
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
        const config = nodeConfigSchema.parse(await jsonBody(request));
        await atomicConfig(this.#configPath, config);
        this.#config = config;
        const rotated = this.#security.rotate(session);
        return secureResponse(
          JSON.stringify({
            applied: true,
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
        await jsonBody(request);
        const pending = this.#pairing.create();
        const rotated = this.#security.rotate(session);
        return secureResponse(
          JSON.stringify({
            code: pending.code,
            offer: pending.offer,
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
