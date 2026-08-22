import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";

function expect(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error(code);
}

async function expectStatus(response: Response, status: number, code: string) {
  if (response.status === status) return;
  const body = await response.text().catch(() => "");
  throw new Error(`${code}:HTTP_${response.status}:${body.slice(0, 500)}`);
}

function responseCookies(response: Response) {
  const headers = response.headers as Headers & {
    getSetCookie?: () => string[];
  };
  const values =
    headers.getSetCookie?.() ??
    (response.headers.get("set-cookie")
      ? [response.headers.get("set-cookie") as string]
      : []);
  return values
    .map((value) => value.split(";", 1)[0])
    .filter(Boolean)
    .join("; ");
}

function authHeaders(webUrl: string, cookie?: string) {
  return {
    origin: webUrl,
    ...(cookie ? { cookie } : {}),
  };
}

async function proveMcp(input: {
  apiUrl: string;
  webUrl: string;
  cookie: string;
}) {
  const resource = `${input.apiUrl}/mcp`;
  const redirectUri = "http://127.0.0.1:8787/callback";
  const scope =
    "openid profile offline_access avermate:read avermate:write avermate:delete";
  const createClient = await fetch(
    `${input.apiUrl}/api/auth/oauth2/create-client`,
    {
      method: "POST",
      headers: {
        ...authHeaders(input.webUrl, input.cookie),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        client_name: "Plan 032 self-host proof",
        redirect_uris: [redirectUri],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        application_type: "native",
        resources: [resource],
        scope,
      }),
    },
  );
  await expectStatus(createClient, 201, "PLAN032_MCP_CLIENT_CREATE_FAILED");
  const client = (await createClient.json()) as { client_id?: string };
  expect(client.client_id, "PLAN032_MCP_CLIENT_ID_MISSING");

  const verifier = `plan032-${crypto.randomUUID()}-${crypto.randomUUID()}`;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  const challenge = Buffer.from(digest).toString("base64url");
  const state = crypto.randomUUID();
  const query = new URLSearchParams({
    response_type: "code",
    client_id: client.client_id,
    redirect_uri: redirectUri,
    scope,
    state,
    nonce: `nonce-${state}`,
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource,
    prompt: "consent",
  });
  const authorization = await fetch(
    `${input.apiUrl}/api/auth/oauth2/authorize?${query}`,
    {
      redirect: "manual",
      headers: {
        ...authHeaders(input.webUrl, input.cookie),
        accept: "text/html",
      },
    },
  );
  expect(
    authorization.status >= 300 && authorization.status < 400,
    `PLAN032_MCP_AUTHORIZE_FAILED:HTTP_${authorization.status}`,
  );
  const location = authorization.headers.get("location");
  expect(location, "PLAN032_MCP_CONSENT_LOCATION_MISSING");
  const consentUrl = new URL(location);
  expect(
    consentUrl.origin === input.webUrl &&
      consentUrl.pathname === "/auth/consent",
    "PLAN032_MCP_CONSENT_ORIGIN_INVALID",
  );

  const consent = await fetch(`${input.apiUrl}/api/auth/oauth2/consent`, {
    method: "POST",
    headers: {
      ...authHeaders(input.webUrl, input.cookie),
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      accept: true,
      oauth_query: consentUrl.search.slice(1),
    }),
  });
  await expectStatus(consent, 200, "PLAN032_MCP_CONSENT_FAILED");
  const consentBody = (await consent.json()) as {
    redirect?: boolean;
    url?: string;
  };
  expect(consentBody.redirect && consentBody.url, "PLAN032_MCP_CODE_MISSING");
  const authorizationResult = new URL(consentBody.url);
  expect(
    authorizationResult.origin === "http://127.0.0.1:8787" &&
      authorizationResult.searchParams.get("state") === state,
    "PLAN032_MCP_REDIRECT_BINDING_INVALID",
  );
  const code = authorizationResult.searchParams.get("code");
  expect(code, "PLAN032_MCP_AUTHORIZATION_CODE_MISSING");

  const tokens = await fetch(`${input.apiUrl}/api/auth/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: client.client_id,
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
      resource,
    }),
  });
  await expectStatus(tokens, 200, "PLAN032_MCP_TOKEN_EXCHANGE_FAILED");
  const tokenBody = (await tokens.json()) as {
    access_token?: string;
    token_type?: string;
    scope?: string;
  };
  expect(
    tokenBody.access_token && tokenBody.token_type?.toLowerCase() === "bearer",
    "PLAN032_MCP_BEARER_TOKEN_MISSING",
  );
  expect(
    tokenBody.scope?.split(" ").includes("avermate:read"),
    "PLAN032_MCP_SCOPE_MISSING",
  );

  const protocolVersion = "2026-07-28";
  const mcp = await fetch(`${input.apiUrl}/mcp`, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${tokenBody.access_token}`,
      "content-type": "application/json",
      "mcp-protocol-version": protocolVersion,
      "mcp-method": "server/discover",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 32,
      method: "server/discover",
      params: {
        _meta: {
          "io.modelcontextprotocol/protocolVersion": protocolVersion,
          "io.modelcontextprotocol/clientInfo": {
            name: "plan-032-self-host",
            version: "1.0.0",
          },
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      },
    }),
  });
  await expectStatus(mcp, 200, "PLAN032_MCP_DISCOVERY_FAILED");
  const mcpBody = (await mcp.json()) as {
    error?: unknown;
    result?: { resultType?: string };
  };
  expect(
    !mcpBody.error && mcpBody.result?.resultType === "complete",
    "PLAN032_MCP_DISCOVERY_INVALID",
  );
}

export async function runDeployedFullSelfHostFlow(input: {
  apiUrl: string;
  webUrl: string;
  email: string;
  password: string;
}) {
  const signIn = await fetch(`${input.apiUrl}/api/auth/sign-in/email`, {
    method: "POST",
    headers: {
      ...authHeaders(input.webUrl),
      "content-type": "application/json",
    },
    body: JSON.stringify({ email: input.email, password: input.password }),
  });
  await expectStatus(signIn, 200, "PLAN032_AUTH_SIGN_IN_FAILED");
  const cookie = responseCookies(signIn);
  expect(
    cookie.includes("avermate.session_token="),
    "PLAN032_AUTH_COOKIE_MISSING",
  );

  const session = await fetch(`${input.apiUrl}/api/auth/get-session`, {
    headers: authHeaders(input.webUrl, cookie),
  });
  await expectStatus(session, 200, "PLAN032_AUTH_SESSION_FAILED");
  const sessionBody = (await session.json()) as {
    user?: { email?: string; emailVerified?: boolean };
  };
  expect(
    sessionBody.user?.email === input.email &&
      sessionBody.user.emailVerified === true,
    "PLAN032_AUTH_SESSION_INVALID",
  );

  const rpc = createORPCClient(
    new RPCLink({
      url: `${input.apiUrl}/rpc`,
      headers: () => authHeaders(input.webUrl, cookie),
    }),
  ) as any;

  const year = await rpc.years.create({
    name: "Plan 032 offline year",
    startsAt: new Date("2026-09-01T00:00:00.000Z"),
    endsAt: new Date("2027-07-01T00:00:00.000Z"),
  });
  expect(year?.id, "PLAN032_ACADEMIC_YEAR_CREATE_FAILED");
  const subject = await rpc.subjects.create({
    yearId: year.id,
    name: "Sciences",
  });
  expect(subject?.id, "PLAN032_ACADEMIC_SUBJECT_CREATE_FAILED");
  const period = await rpc.periods.create({
    yearId: year.id,
    name: "Semestre 1",
    startAt: new Date("2026-09-01T00:00:00.000Z"),
    endAt: new Date("2027-01-31T00:00:00.000Z"),
  });
  expect(period?.id, "PLAN032_ACADEMIC_PERIOD_CREATE_FAILED");
  const grade = await rpc.grades.create({
    name: "Preuve hors-ligne",
    value: 17,
    outOf: 20,
    passedAt: new Date("2026-10-15T00:00:00.000Z"),
    subjectId: subject.id,
    periodId: period.id,
  });
  expect(grade?.id, "PLAN032_ACADEMIC_GRADE_CREATE_FAILED");
  const updatedGrade = await rpc.grades.update({
    gradeId: grade.id,
    value: 18,
    note: "air-gap CRUD proof",
  });
  expect(
    updatedGrade?.value === 18 && updatedGrade.note === "air-gap CRUD proof",
    "PLAN032_ACADEMIC_GRADE_UPDATE_FAILED",
  );
  const loadedGrade = await rpc.grades.get({ gradeId: grade.id });
  expect(loadedGrade?.id === grade.id, "PLAN032_ACADEMIC_GRADE_READ_FAILED");

  const png = Uint8Array.from(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    ),
  );
  const uploadForm = new FormData();
  uploadForm.set("route", "gradeCopy");
  uploadForm.set(
    "file",
    new File([png], "plan-032-proof.png", { type: "image/png" }),
  );
  const upload = await fetch(`${input.apiUrl}/api/upload/local`, {
    method: "POST",
    headers: authHeaders(input.webUrl, cookie),
    body: uploadForm,
  });
  await expectStatus(upload, 200, "PLAN032_LOCAL_UPLOAD_FAILED");
  const uploaded = (await upload.json()) as {
    fileId?: string;
    byteSize?: number;
  };
  expect(
    uploaded.fileId && uploaded.byteSize === png.byteLength,
    "PLAN032_LOCAL_UPLOAD_RECEIPT_INVALID",
  );
  const attachment = await rpc.grades.attachCopy({
    gradeId: grade.id,
    fileId: uploaded.fileId,
    fileName: "plan-032-proof.png",
    label: "Air-gap proof",
  });
  expect(attachment?.id, "PLAN032_UPLOAD_ADOPTION_FAILED");
  const ranged = await fetch(`${input.apiUrl}/api/files/${uploaded.fileId}`, {
    headers: {
      ...authHeaders(input.webUrl, cookie),
      range: "bytes=0-7",
    },
  });
  await expectStatus(ranged, 206, "PLAN032_LOCAL_RANGE_READ_FAILED");
  expect(
    (await ranged.arrayBuffer()).byteLength === 8,
    "PLAN032_LOCAL_RANGE_READ_INVALID",
  );
  await rpc.grades.removeCopy({ attachmentId: attachment.id });
  const deletedFile = await fetch(
    `${input.apiUrl}/api/files/${uploaded.fileId}`,
    { headers: authHeaders(input.webUrl, cookie) },
  );
  await expectStatus(deletedFile, 404, "PLAN032_LOCAL_DELETE_FAILED");

  const queryTerm = `chlorophylle${crypto.randomUUID().replaceAll("-", "")}`;
  const createdThread = await rpc.assistant.threads.create({
    title: "Conversation locale Plan 032",
    placement: "core",
  });
  expect(
    createdThread?.thread?.id && createdThread?.branch?.id,
    "PLAN032_LOCAL_CHAT_CREATE_FAILED",
  );
  const reservation = await rpc.assistant.messages.send({
    threadId: createdThread.thread.id,
    branchId: createdThread.branch.id,
    expectedHeadMessageId: null,
    clientRequestId: `req-${crypto.randomUUID()}`,
    markdown: `Explique ${queryTerm} sans réseau externe.`,
    modelKey: "mock-readonly",
    attachments: [],
  });
  expect(reservation?.runId, "PLAN032_LOCAL_CHAT_RESERVATION_FAILED");
  let detail: any = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    detail = await rpc.assistant.threads.get({
      threadId: createdThread.thread.id,
      branchId: createdThread.branch.id,
    });
    const run = detail?.runs?.find(
      (candidate: { id?: string }) => candidate.id === reservation.runId,
    );
    if (run?.status === "complete") break;
    if (["failed", "cancelled"].includes(run?.status)) {
      throw new Error(`PLAN032_LOCAL_CHAT_TERMINAL_FAILURE:${run.status}`);
    }
    await Bun.sleep(250);
  }
  const completedRun = detail?.runs?.find(
    (candidate: { id?: string }) => candidate.id === reservation.runId,
  );
  expect(completedRun?.status === "complete", "PLAN032_LOCAL_CHAT_TIMEOUT");
  expect(
    JSON.stringify(detail).includes(queryTerm),
    "PLAN032_LOCAL_CHAT_OUTPUT_MISSING",
  );

  let search: any = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    search = await rpc.assistant.conversations.search({
      query: queryTerm,
      mode: "terms",
      limit: 10,
      cursor: null,
    });
    if (search?.evidence?.length > 0) break;
    await Bun.sleep(250);
  }
  expect(search?.evidence?.length > 0, "PLAN032_LOCAL_SEARCH_FAILED");

  const exported = await rpc.assistant.threads.export({
    threadId: createdThread.thread.id,
    branchId: createdThread.branch.id,
    mode: "whole-dag",
    format: "markdown",
  });
  expect(
    exported?.content?.includes(queryTerm) &&
      typeof exported.digest === "string" &&
      exported.digest.length === 64,
    "PLAN032_LOCAL_CHAT_EXPORT_FAILED",
  );

  await proveMcp({ apiUrl: input.apiUrl, webUrl: input.webUrl, cookie });

  await rpc.assistant.threads.trash({
    threadId: createdThread.thread.id,
    expectedRevision: detail.thread.revision,
  });
  const searchAfterDelete = await rpc.assistant.conversations.search({
    query: queryTerm,
    mode: "terms",
    limit: 10,
    cursor: null,
  });
  expect(
    searchAfterDelete?.evidence?.length === 0,
    "PLAN032_DELETED_CHAT_STILL_SEARCHABLE",
  );

  await rpc.grades.delete({ gradeId: grade.id });
  await rpc.periods.delete({ periodId: period.id });
  await rpc.subjects.delete({ subjectId: subject.id, promoteChildren: false });
  await rpc.years.delete({ yearId: year.id });

  console.log(
    "[plan-032] deployed flow passed: auth + academic CRUD + local upload/range/delete + local-model chat/search/export/delete + OAuth MCP",
  );
}
