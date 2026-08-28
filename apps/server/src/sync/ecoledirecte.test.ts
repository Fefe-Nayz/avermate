import { describe, expect, test } from "bun:test";
import { Client } from "@blockshub/blocksdirecte";
import { assertSchoolProviderContract } from "./school-provider";
import { SCHOOL_PROVIDER_CATALOG } from "./school-provider-catalog";
import { CredentialsRevokedSyncError } from "./errors";

process.env.DATABASE_URL = "file::memory:";
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.BETTER_AUTH_SECRET =
  "ecoledirecte-test-secret-that-is-at-least-32-chars";
process.env.CLIENT_URL = "http://localhost:3001";
process.env.NODE_ENV = "test";

const { createEcoleDirecteProvider, normalizeEcoleDirecteBaseUrl } =
  await import("./ecoledirecte");

const credentialInput = {
  username: "ada",
  password: "correct horse battery staple",
  accountIndex: 0,
  deviceUuid: "device-1",
};

function fakeClient() {
  let selectedAccount = -1;
  const loginCalls: unknown[][] = [];
  const disposeCalls: true[] = [];
  const timetableCalls: true[] = [];
  const client = {
    restManager: {
      twoFaToken: "transport-second-factor-token" as string | undefined,
    },
    setAbortSignal() {},
    dispose() {
      disposeCalls.push(true);
    },
    auth: {
      async loginUsername(...args: unknown[]) {
        loginCalls.push(args);
        return {
          token: "remote-token",
          accounts: [
            {
              id: 42,
              typeCompte: "E",
              prenom: "Ada",
              nom: "Lovelace",
              nomEtablissement: "Lycée des Tests",
            },
          ],
        };
      },
      async refreshToken(...args: unknown[]) {
        return this.loginUsername(...args);
      },
      async get2FAQuestion() {
        return { question: "Question", propositions: ["Réponse"] };
      },
      async send2FAQuestion() {
        return { cn: "proof-name", cv: "proof-value" };
      },
      setAccount(index: number) {
        selectedAccount = index;
      },
      getAccount() {
        if (selectedAccount !== 0) throw new Error("account not selected");
        return {
          id: 42,
          typeCompte: "E",
          prenom: "Ada",
          nom: "Lovelace",
          nomEtablissement: "Lycée des Tests",
        };
      },
    },
    homework: {
      async getUpcomingHomework(): Promise<Record<string, unknown>> {
        return {
          "2026-09-10": { idDevoir: 10 },
          "2027-01-01": { idDevoir: 99 },
        };
      },
      async getHomeworksForDate(date: string) {
        return {
          date,
          matieres: [
            {
              matiere: "Mathématiques",
              codeMatiere: "MATHS",
              id: 1,
              aFaire: {
                idDevoir: 10,
                contenu: "<p>Faire les exercices &amp; réviser.</p>",
                donneLe: "2026-09-08",
                effectue: false,
                documents: [
                  {
                    id: 77,
                    libelle: "fiche.pdf",
                    taille: 1234,
                    type: "CLOUD",
                  },
                ],
              },
            },
          ],
        };
      },
    },
    timetable: {
      async getTimetableBetweenDates() {
        timetableCalls.push(true);
        return [
          {
            id: 7,
            matiere: "Mathématiques",
            codeMatiere: "MATHS",
            start_date: "2026-09-10 08:00",
            end_date: "2026-09-10 09:00",
            salle: "B12",
            isAnnule: false,
            isModifie: true,
          },
        ];
      },
    },
    marks: {
      async getMark() {
        return {
          periodes: [
            {
              idPeriode: "p1",
              codePeriode: "T1",
              periode: "Trimestre 1",
            },
          ],
          notes: [
            {
              id: 8,
              devoir: "DS 1",
              codePeriode: "T1",
              codeMatiere: "MATHS",
              libelleMatiere: "Mathématiques",
              date: "2026-09-09",
              coef: "2,5",
              noteSur: "20",
              valeur: "17,5",
              nonSignificatif: false,
              dateSaisie: "2026-09-10",
            },
          ],
        };
      },
    },
    timeline: {
      async getPublicTimeline() {
        return {
          evenements: [
            {
              id: 9,
              dateDebut: "2026-09-11",
              dateFin: "2026-09-11",
              heureDebut: "14:00",
              heureFin: "15:30",
              libelle: "Réunion de rentrée",
              description: "<b>Amphithéâtre</b>",
            },
          ],
        };
      },
    },
    downloader: {
      async getStream() {
        return new Blob(["pdf"]).stream();
      },
    },
  };
  return { client, loginCalls, disposeCalls, timetableCalls };
}

function connection() {
  return {
    id: "connection-1",
    userId: "user-1",
    yearId: "year-1",
    baseUrl: "https://api.ecoledirecte.com",
    credentials: JSON.stringify({
      version: 2,
      ...credentialInput,
      accountId: 42,
    }),
    caCertPem: null,
  };
}

const options = {
  window: {
    from: new Date("2026-09-01T00:00:00.000Z"),
    to: new Date("2026-09-30T23:59:59.999Z"),
    timezone: "Europe/Paris",
  },
};

describe("ÉcoleDirecte provider", () => {
  test("uses the official endpoint and rejects credential-bearing URLs", () => {
    expect(normalizeEcoleDirecteBaseUrl("https://www.ecoledirecte.com/")).toBe(
      "https://api.ecoledirecte.com",
    );
    expect(() =>
      normalizeEcoleDirecteBaseUrl("https://user:secret@api.ecoledirecte.com/"),
    ).toThrow("official HTTPS");
    expect(() =>
      normalizeEcoleDirecteBaseUrl("https://school.example.com/"),
    ).toThrow("official HTTPS");
  });

  test("classifies a definitive authentication rejection as revoked credentials", async () => {
    const fake = fakeClient();
    fake.client.auth.loginUsername = async () => {
      const error = new Error("remote detail must not escape");
      error.name = "InvalidCredentials";
      throw error;
    };
    const provider = createEcoleDirecteProvider({
      createClient: () => fake.client,
    });

    await expect(
      provider.school.facets.homework!.list(connection(), options),
    ).rejects.toBeInstanceOf(CredentialsRevokedSyncError);
  });

  test("authenticates once, returns only sealed credential material, and exposes every declared facet", async () => {
    const fake = fakeClient();
    const provider = createEcoleDirecteProvider({
      createClient: () => fake.client,
    });
    assertSchoolProviderContract(
      SCHOOL_PROVIDER_CATALOG.ecoledirecte,
      provider.school,
    );

    const parsed = await provider.parseCredentialInput(
      "https://www.ecoledirecte.com",
      JSON.stringify(credentialInput),
    );
    expect(parsed.accountLabel).toBe("Ada Lovelace");
    expect(parsed.remoteStudentId).toBe("42");
    expect(JSON.parse(parsed.credentials)).toEqual({
      version: 2,
      ...credentialInput,
      accountId: 42,
    });
    expect(fake.loginCalls).toHaveLength(1);
    expect(fake.disposeCalls).toHaveLength(1);

    const openConnection = connection();
    const [homework, timetable, grades, calendar, attachments] =
      await Promise.all([
        provider.school.facets.homework!.list(openConnection, options),
        provider.school.facets.timetable!.list(openConnection, options),
        provider.school.facets.grades!.list(openConnection, options),
        provider.school.facets["school-calendar"]!.list(
          openConnection,
          options,
        ),
        provider.school.facets.attachments!.list(openConnection, options),
      ]);

    // One authentication is shared by all facets for this opened connection.
    expect(fake.loginCalls).toHaveLength(2);
    expect(homework).toHaveLength(1);
    expect(homework[0]).toMatchObject({
      externalId: "10",
      instructions: "Faire les exercices & réviser.",
      completedUpstream: false,
      subject: { externalId: "MATHS", name: "Mathématiques" },
    });
    expect(homework[0]?.dueAt?.toISOString()).toBe("2026-09-10T21:59:59.999Z");
    expect(timetable[0]).toMatchObject({
      externalId: "7",
      location: "B12",
      cancelled: false,
    });
    expect(timetable[0]?.startsAt.toISOString()).toBe(
      "2026-09-10T06:00:00.000Z",
    );
    expect(fake.timetableCalls).toHaveLength(1);
    expect(grades[0]).toMatchObject({
      externalId: "8",
      value: 17.5,
      outOf: 20,
      coefficient: 2.5,
      periodExternalId: "p1",
    });
    expect(calendar).toHaveLength(2);
    expect(calendar[0]).toMatchObject({
      externalId: "9",
      description: "Amphithéâtre",
      allDay: false,
    });
    expect(calendar[1]).toMatchObject({
      externalId: "workday:2026-09-10",
      kind: "workday",
      allDay: true,
    });
    expect(attachments).toHaveLength(1);
    expect(attachments[0]).toMatchObject({
      externalId: "homework:10:file:77:CLOUD",
      fileName: "fiche.pdf",
      byteSize: 1234,
    });
    const download = await provider.school.facets.attachments!.download(
      openConnection,
      attachments[0]!,
    );
    expect(await new Response(download.body).text()).toBe("pdf");
    await provider.releaseConnection?.(openConnection);
    expect(fake.disposeCalls).toHaveLength(2);
  });

  test("keeps a timetable occurrence identity stable when it is rescheduled", async () => {
    const fake = fakeClient();
    const provider = createEcoleDirecteProvider({
      createClient: () => fake.client,
    });
    const first = await provider.school.facets.timetable!.list(
      connection(),
      options,
    );
    fake.client.timetable.getTimetableBetweenDates = async () => [
      {
        id: 7,
        matiere: "Mathématiques",
        codeMatiere: "MATHS",
        start_date: "2026-09-10 10:00",
        end_date: "2026-09-10 11:00",
        salle: "B12",
        isAnnule: false,
        isModifie: true,
      },
    ];
    const secondConnection = connection();
    const second = await provider.school.facets.timetable!.list(
      secondConnection,
      options,
    );
    expect(first[0]?.externalId).toBe("7");
    expect(second[0]?.externalId).toBe("7");
    expect(second[0]?.startsAt).not.toEqual(first[0]?.startsAt);
    await provider.releaseConnection?.(secondConnection);
  });

  test("persists a rotated access token once through the connection CAS", async () => {
    const fake = fakeClient();
    fake.client.auth.getAccount = () => ({
      id: 42,
      typeCompte: "E",
      accessToken: "rotated-access-token",
      prenom: "Ada",
      nom: "Lovelace",
      nomEtablissement: "Lycée des Tests",
    });
    const persisted: string[] = [];
    const provider = createEcoleDirecteProvider({
      createClient: () => fake.client,
      persistCredentials: async (opened, credentials) => {
        persisted.push(credentials);
        opened.credentials = credentials;
      },
    });
    const opened = {
      ...connection(),
      credentialRevision: "sealed-revision",
      credentials: JSON.stringify({
        version: 1,
        ...credentialInput,
        refresh: { accountKind: "E", accessToken: "old-access-token" },
      }),
    };

    await provider.school.facets.timetable!.list(opened, options);

    expect(persisted).toHaveLength(1);
    expect(JSON.parse(persisted[0]!)).toMatchObject({
      version: 2,
      accountId: 42,
      accountIndex: 0,
      refresh: { accountKind: "E", accessToken: "rotated-access-token" },
    });
    await provider.releaseConnection?.(opened);
  });

  test("upgrades legacy positional credentials to the selected stable account identity", async () => {
    const fake = fakeClient();
    const persisted: string[] = [];
    const provider = createEcoleDirecteProvider({
      createClient: () => fake.client,
      persistCredentials: async (opened, credentials) => {
        persisted.push(credentials);
        opened.credentials = credentials;
      },
    });
    const opened = {
      ...connection(),
      credentials: JSON.stringify({ version: 1, ...credentialInput }),
    };

    await provider.school.facets.timetable!.list(opened, options);

    expect(persisted).toHaveLength(1);
    expect(JSON.parse(persisted[0]!)).toMatchObject({
      version: 2,
      accountId: 42,
      accountIndex: 0,
    });
    await provider.releaseConnection?.(opened);
  });

  test("follows the stable account id when ÉcoleDirecte reorders accounts", async () => {
    const fake = fakeClient();
    const accounts = [
      {
        id: 7,
        typeCompte: "E",
        prenom: "Grace",
        nom: "Hopper",
        nomEtablissement: "Lycée des Tests",
      },
      {
        id: 42,
        typeCompte: "E",
        prenom: "Ada",
        nom: "Lovelace",
        nomEtablissement: "Lycée des Tests",
      },
    ];
    fake.client.auth.loginUsername = async () => ({
      token: "remote-token",
      accounts,
    });
    let selectedAccount = -1;
    fake.client.auth.setAccount = (index: number) => {
      selectedAccount = index;
    };
    fake.client.auth.getAccount = () => accounts[selectedAccount]!;
    const persisted: string[] = [];
    const provider = createEcoleDirecteProvider({
      createClient: () => fake.client,
      persistCredentials: async (opened, credentials) => {
        persisted.push(credentials);
        opened.credentials = credentials;
      },
    });
    const opened = {
      ...connection(),
      credentials: JSON.stringify({
        version: 2,
        ...credentialInput,
        accountId: 42,
        accountIndex: 0,
      }),
    };

    await provider.school.facets.timetable!.list(opened, options);

    expect(selectedAccount).toBe(1);
    expect(JSON.parse(persisted[0]!)).toMatchObject({
      accountId: 42,
      accountIndex: 1,
    });
    await provider.releaseConnection?.(opened);
  });

  test("refuses a missing or ambiguous stable ÉcoleDirecte account", async () => {
    for (const scenario of [
      {
        accounts: [
          {
            id: 7,
            typeCompte: "E",
            prenom: "Grace",
            nom: "Hopper",
            nomEtablissement: "Lycée des Tests",
          },
        ],
        message: "no longer exists",
      },
      {
        accounts: [
          {
            id: 42,
            typeCompte: "E",
            prenom: "Ada",
            nom: "Lovelace",
            nomEtablissement: "Lycée des Tests",
          },
          {
            id: 42,
            typeCompte: "E",
            prenom: "Ada",
            nom: "Duplicate",
            nomEtablissement: "Lycée des Tests",
          },
        ],
        message: "ambiguous",
      },
    ]) {
      const fake = fakeClient();
      fake.client.auth.loginUsername = async () => ({
        token: "remote-token",
        accounts: scenario.accounts,
      });
      const provider = createEcoleDirecteProvider({
        createClient: () => fake.client,
      });

      await expect(
        provider.school.facets.timetable!.list(connection(), options),
      ).rejects.toThrow(scenario.message);
    }
  });

  test("uses an overseas connection timezone for wall-clock lessons", async () => {
    const fake = fakeClient();
    const provider = createEcoleDirecteProvider({
      createClient: () => fake.client,
    });
    const overseasConnection = {
      ...connection(),
      credentials: JSON.stringify({
        version: 2,
        ...credentialInput,
        accountId: 42,
        timezone: "Indian/Reunion",
      }),
    };
    expect(provider.school.timezone?.(overseasConnection)).toBe(
      "Indian/Reunion",
    );
    const [lesson] = await provider.school.facets.timetable!.list(
      overseasConnection,
      {
        window: { ...options.window, timezone: "Indian/Reunion" },
      },
    );
    expect(lesson?.startsAt.toISOString()).toBe("2026-09-10T04:00:00.000Z");
    await provider.releaseConnection?.(overseasConnection);
  });

  test("does not surface the upstream two-factor challenge token", async () => {
    const challenge = Object.assign(new Error("2FA token secret-token"), {
      name: "Require2FA",
      token: "secret-token",
    });
    const fake = fakeClient();
    fake.client.auth.loginUsername = async () => {
      throw challenge;
    };
    const provider = createEcoleDirecteProvider({
      createClient: () => fake.client,
    });
    await expect(
      provider.parseCredentialInput(
        "https://api.ecoledirecte.com",
        JSON.stringify(credentialInput),
      ),
    ).rejects.toThrow("second-factor verification");
    await expect(
      provider.parseCredentialInput(
        "https://api.ecoledirecte.com",
        JSON.stringify(credentialInput),
      ),
    ).rejects.not.toThrow("secret-token");
  });

  test("completes a server-bound question challenge without returning the upstream token", async () => {
    const fake = fakeClient();
    const loginCalls: unknown[][] = [];
    fake.client.auth.loginUsername = async (...args: unknown[]) => {
      loginCalls.push(args);
      if (loginCalls.length === 1) {
        throw Object.assign(new Error("second factor required"), {
          name: "Require2FA",
          token: "upstream-secret-token",
          kind: "question",
        });
      }
      return {
        token: "remote-token",
        accounts: [
          {
            id: 42,
            typeCompte: "E",
            accessToken: "sealed-refresh-token",
            prenom: "Ada",
            nom: "Lovelace",
            nomEtablissement: "Lycée des Tests",
          },
        ],
      };
    };
    let challengeToken = "";
    let selectedAnswer = "";
    fake.client.auth.get2FAQuestion = (async (token: string) => {
      challengeToken = token;
      return {
        question: "Quel est votre animal ?",
        propositions: ["Chat", "Chien"],
      };
    }) as typeof fake.client.auth.get2FAQuestion;
    fake.client.auth.send2FAQuestion = (async (
      answer: string,
      token: string,
    ) => {
      selectedAnswer = `${answer}:${token}`;
      return { cn: "proof-name", cv: "proof-value" };
    }) as typeof fake.client.auth.send2FAQuestion;
    fake.client.auth.getAccount = (() => ({
      id: 42,
      typeCompte: "E",
      accessToken: "sealed-refresh-token",
      prenom: "Ada",
      nom: "Lovelace",
      nomEtablissement: "Lycée des Tests",
    })) as typeof fake.client.auth.getAccount;
    const provider = createEcoleDirecteProvider({
      createClient: () => fake.client,
    });
    const owner = { userId: "user-1", yearId: "year-1" };

    const pending = await provider.beginCredentialInput!(
      owner,
      "https://www.ecoledirecte.com",
      JSON.stringify(credentialInput),
    );
    expect(pending).toMatchObject({
      status: "challenge",
      kind: "question",
      question: "Quel est votre animal ?",
      choices: ["Chat", "Chien"],
    });
    expect(JSON.stringify(pending)).not.toContain("upstream-secret-token");
    expect(challengeToken).toBe("upstream-secret-token");
    expect(fake.disposeCalls).toHaveLength(0);
    if (pending.status !== "challenge") throw new Error("challenge expected");

    await expect(
      provider.completeCredentialChallenge!(
        { userId: "another-user", yearId: "year-1" },
        pending.challengeId,
        "0",
      ),
    ).rejects.toThrow("expired");
    const connected = await provider.completeCredentialChallenge!(
      owner,
      pending.challengeId,
      "1",
    );

    expect(selectedAnswer).toBe("Chien:upstream-secret-token");
    expect(fake.client.restManager.twoFaToken).toBeUndefined();
    expect(loginCalls[1]?.slice(2, 4)).toEqual(["proof-name", "proof-value"]);
    expect(connected).toMatchObject({
      status: "connected",
      accountLabel: "Ada Lovelace",
      remoteStudentId: "42",
    });
    expect(connected.credentials).not.toContain("upstream-secret-token");
    expect(JSON.parse(connected.credentials)).toMatchObject({
      twoFactor: { cn: "proof-name", cv: "proof-value" },
      refresh: {
        accountKind: "E",
        accessToken: "sealed-refresh-token",
      },
    });
    expect(fake.disposeCalls).toHaveLength(1);
    await expect(
      provider.completeCredentialChallenge!(owner, pending.challengeId, "1"),
    ).rejects.toThrow("expired");
  });

  test("completes a TOTP challenge without persisting the one-time code", async () => {
    const fake = fakeClient();
    const loginCalls: unknown[][] = [];
    fake.client.auth.loginUsername = async (...args: unknown[]) => {
      loginCalls.push(args);
      if (loginCalls.length === 1) {
        throw Object.assign(new Error("second factor required"), {
          name: "Require2FA",
          token: "totp-secret-token",
          kind: "totp",
        });
      }
      return {
        token: "remote-token",
        accounts: [
          {
            id: 42,
            typeCompte: "E",
            accessToken: "sealed-refresh-token",
            prenom: "Ada",
            nom: "Lovelace",
            nomEtablissement: "Lycée des Tests",
          },
        ],
      };
    };
    const provider = createEcoleDirecteProvider({
      createClient: () => fake.client,
    });
    const owner = { userId: "user-1", yearId: "year-1" };

    const pending = await provider.beginCredentialInput!(
      owner,
      "https://api.ecoledirecte.com",
      JSON.stringify(credentialInput),
    );
    expect(pending).toMatchObject({
      status: "challenge",
      kind: "totp",
      question: null,
      choices: [],
    });
    if (pending.status !== "challenge") throw new Error("challenge expected");
    const connected = await provider.completeCredentialChallenge!(
      owner,
      pending.challengeId,
      "123456",
    );

    expect(loginCalls[1]?.slice(2, 4)).toEqual(["", "123456"]);
    expect(connected.remoteStudentId).toBe("42");
    expect(fake.client.restManager.twoFaToken).toBeUndefined();
    expect(connected.credentials).not.toContain("123456");
    expect(connected.credentials).not.toContain("totp-secret-token");
    expect(JSON.parse(connected.credentials)).not.toHaveProperty("twoFactor");
    expect(fake.disposeCalls).toHaveLength(1);
  });

  test("drives the patched GTK and question challenge transport end to end", async () => {
    const originalFetch = globalThis.fetch;
    const requests: Array<{
      url: URL;
      method: string;
      headers: Headers;
      data: Record<string, unknown>;
    }> = [];
    globalThis.fetch = (async (input, init) => {
      const url = new URL(
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
      );
      const method = init?.method ?? "GET";
      const headers = new Headers(init?.headers);
      const encoded =
        typeof init?.body === "string"
          ? new URLSearchParams(init.body).get("data")
          : null;
      const data = encoded
        ? (JSON.parse(encoded) as Record<string, unknown>)
        : {};
      requests.push({ url, method, headers, data });
      if (method === "GET") {
        return Response.json(
          { code: 200 },
          { headers: { "Set-Cookie": "GTK=gtk-bootstrap; Path=/; Secure" } },
        );
      }
      if (url.pathname.endsWith("/connexion/doubleauth.awp")) {
        if (url.searchParams.get("verbe") === "get") {
          return Response.json({
            code: 200,
            data: {
              question: Buffer.from("Animal préféré ?").toString("base64"),
              propositions: [
                Buffer.from("Chat").toString("base64"),
                Buffer.from("Chien").toString("base64"),
              ],
            },
          });
        }
        return Response.json({
          code: 200,
          data: { cn: "proof-name", cv: "proof-value" },
        });
      }
      const loginRequests = requests.filter(
        (request) =>
          request.method === "POST" &&
          request.url.pathname.endsWith("/login.awp"),
      );
      if (loginRequests.length === 1) {
        return Response.json(
          { code: 250, data: { totp: false } },
          {
            headers: {
              "X-Token": "challenge-x-token",
              "X-GTK": "gtk-login",
              "2FA-Token": "transport-2fa-token",
            },
          },
        );
      }
      return Response.json({
        code: 200,
        token: "session-token",
        data: {
          accounts: [
            {
              id: 42,
              typeCompte: "E",
              prenom: "Ada",
              nom: "Lovelace",
              nomEtablissement: "Lycée des Tests",
              accessToken: "refresh-token",
            },
          ],
        },
      });
    }) as typeof fetch;
    try {
      const provider = createEcoleDirecteProvider({
        createClient: () =>
          new Client() as unknown as ReturnType<typeof fakeClient>["client"],
      });
      const owner = { userId: "user-transport", yearId: "year-transport" };
      const pending = await provider.beginCredentialInput!(
        owner,
        "https://api.ecoledirecte.com",
        JSON.stringify(credentialInput),
      );
      expect(pending).toMatchObject({
        status: "challenge",
        kind: "question",
        question: "Animal préféré ?",
        choices: ["Chat", "Chien"],
      });
      if (pending.status !== "challenge") throw new Error("challenge expected");
      const connected = await provider.completeCredentialChallenge!(
        owner,
        pending.challengeId,
        "1",
      );
      expect(connected.accountLabel).toBe("Ada Lovelace");

      expect(requests.map((request) => request.url.pathname)).toEqual([
        "/v3/login.awp",
        "/v3/login.awp",
        "/v3/connexion/doubleauth.awp",
        "/v3/connexion/doubleauth.awp",
        "/v3/login.awp",
      ]);
      expect(requests[2]?.headers.get("x-token")).toBeNull();
      expect(requests[2]?.headers.get("2fa-token")).toBe("transport-2fa-token");
      expect(requests[3]?.data).toEqual({
        choix: Buffer.from("Chien").toString("base64"),
      });
      expect(requests[4]?.headers.get("cookie")).toContain("GTK=gtk-bootstrap");
      expect(requests[4]?.headers.get("x-gtk")).toBe("gtk-login");
      expect(requests[4]?.headers.get("2fa-token")).toBeNull();
      expect(requests[4]?.data.fa).toEqual([
        { cn: "proof-name", cv: "proof-value", uniq: false },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("stops waiting promptly when the durable job lease is aborted", async () => {
    const fake = fakeClient();
    fake.client.homework.getUpcomingHomework = () =>
      new Promise<Record<string, unknown>>(() => undefined);
    const provider = createEcoleDirecteProvider({
      createClient: () => fake.client,
    });
    const controller = new AbortController();
    const pending = provider.school.facets.homework!.list(connection(), {
      ...options,
      signal: controller.signal,
    });
    controller.abort(new Error("lease lost"));
    const result = await Promise.race([
      pending.then(
        () => "resolved",
        (error: Error) => error.message,
      ),
      new Promise<string>((resolve) =>
        setTimeout(() => resolve("timed out"), 100),
      ),
    ]);
    expect(result).toBe("lease lost");
  });

  test("does not propagate secret-bearing upstream response bodies", async () => {
    const fake = fakeClient();
    fake.client.timetable.getTimetableBetweenDates = async () => {
      throw new Error(
        "https://api.ecoledirecte.com?token=remote-secret password=bad",
      );
    };
    const provider = createEcoleDirecteProvider({
      createClient: () => fake.client,
    });
    let message = "";
    try {
      await provider.school.facets.timetable!.list(connection(), options);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toBe("ÉcoleDirecte timetable discovery failed");
    expect(message).not.toContain("remote-secret");
    expect(message).not.toContain("password");
  });
});
