import { describe, expect, test } from "bun:test";
import type { SkolengoClient, SkolengoClientRuntime } from "./skolengo";
import { CredentialsRevokedSyncError } from "./errors";
import { assertSchoolProviderContract } from "./school-provider";

process.env.DATABASE_URL = "file::memory:";
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.BETTER_AUTH_SECRET = "skolengo-test-".repeat(3);
process.env.CLIENT_URL = "http://localhost:3001";
process.env.NODE_ENV = "test";

const { createSkolengoProvider, normalizeSkolengoBaseUrl } =
  await import("./skolengo");

const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];

const metadata = {
  issuer: "https://sso.school.example/oidc",
  token_endpoint: "https://sso.school.example/oidc/oidcAccessToken",
  token_endpoint_auth_methods_supported: [
    "client_secret_basic",
    "client_secret_post",
  ],
};

const bundle = {
  tokenSet: {
    access_token: "access-token",
    id_token: "header.payload.signature",
    refresh_token: "refresh-token",
    token_type: "Bearer",
    expires_at: 1_800_000_000,
    scope: "openid",
  },
  school: {
    id: "SKO-E-school-1",
    name: "Lycée des Tests",
    addressLine1: "1 rue du Test",
    addressLine2: null,
    addressLine3: null,
    zipCode: "75000",
    city: "Paris",
    country: "France",
    homePageUrl: "https://school.example",
    timeZone: "Europe/Paris",
    emsCode: "tests",
    emsOIDCWellKnownUrl: "https://sso.school.example/oidc/.well-known",
  },
};

const parent = {
  id: "parent-1",
  firstName: "Charles",
  lastName: "Lovelace",
  photoUrl: null,
  students: [
    {
      id: "student-1",
      firstName: "Ada",
      lastName: "Lovelace",
      photoUrl: null,
      school: { id: bundle.school.id },
    },
  ],
};

const options = {
  window: {
    from: new Date("2026-09-01T00:00:00.000Z"),
    to: new Date("2026-09-30T23:59:59.999Z"),
    timezone: "Europe/Paris",
  },
};

function storedCredentials(
  tokenSet: Record<string, unknown> = bundle.tokenSet,
) {
  return JSON.stringify({
    version: 1,
    school: bundle.school,
    tokenSet,
    targetStudentId: "student-1",
    oidc: {
      discoveryUrl:
        "https://sso.school.example/oidc/.well-known/openid-configuration",
      issuer: metadata.issuer,
      tokenEndpoint: metadata.token_endpoint,
      tokenEndpointAuthMethod: "client_secret_basic",
    },
  });
}

function connection(credentials = storedCredentials()) {
  return {
    id: "connection-1",
    userId: "user-1",
    yearId: "year-1",
    baseUrl: "https://api.skolengo.com",
    credentials,
    caCertPem: null,
  };
}

function discoveryFetch(document: unknown = metadata) {
  return async (input: string | URL | Request) => {
    const url = String(input);
    const { id: _id, ...attributes } = bundle.school;
    const value = url.includes("/schools?")
      ? {
          data: [{ id: bundle.school.id, type: "school", attributes }],
          meta: { totalResourceCount: 1 },
        }
      : document;
    return new Response(JSON.stringify(value), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
}

function completeClient(
  runtime: SkolengoClientRuntime,
  overrides: Partial<SkolengoClient> = {},
): SkolengoClient {
  return {
    async getUserInfo() {
      return parent as never;
    },
    async getHomeworkAssignments(_studentId, _from, _to, _limit, offset) {
      if (offset === 0) {
        return Array.from({ length: 100 }, (_, index) => ({
          id: `homework-${index}`,
          title: index === 0 ? "Exercices 1 à 5" : `Devoir ${index}`,
          html: index === 0 ? "<p>Réviser &amp; apprendre.</p>" : null,
          dueDateTime: index === 0 ? "2026-09-10T18:00:00Z" : null,
          dueDate: index === 0 ? null : "2026-09-11",
          done: index === 0,
          subject: {
            id: "math",
            label: "Mathématiques",
            color: "#000000",
          },
        })) as never;
      }
      if (offset === 100) {
        return [
          {
            id: "homework-100",
            title: "Dernier devoir",
            html: null,
            dueDateTime: null,
            dueDate: "2026-09-12",
            done: false,
          },
        ] as never;
      }
      return [];
    },
    async getAgenda() {
      return [
        {
          id: "agenda-2026-09-10",
          date: "2026-09-10",
          homeworkAssignments: [],
          lessons: [
            {
              id: "lesson-1",
              startDateTime: "2026-09-10T08:00:00Z",
              endDateTime: "2026-09-10T09:00:00Z",
              title: "Cours de mathématiques",
              location: "B12",
              locationComplement: "2e étage",
              canceled: false,
              anyHomeworkToDoForTheLesson: false,
              anyHomeworkToDoAfterTheLesson: false,
              anyContent: true,
              contents: [
                {
                  id: "content-1",
                  title: "Chapitre 1",
                  html: "<p>Suites numériques</p>",
                  url: null,
                  attachments: [],
                },
              ],
              teachers: [],
              subject: {
                id: "math",
                label: "Mathématiques",
                color: "#000000",
              },
            },
          ],
        },
      ] as never;
    },
    async getEvaluationSettings() {
      return [
        {
          id: "settings-1",
          periodicReportsEnabled: true,
          skillsEnabled: false,
          evaluationsDetailsAvailable: true,
          periods: [
            {
              id: "period-1",
              label: "Trimestre 1",
              startDate: "2026-09-01",
              endDate: "2026-12-31",
            },
          ],
        },
      ];
    },
    async getEvaluation() {
      return [
        {
          id: "evaluation-service-1",
          coefficient: 1,
          average: 12,
          scale: 20,
          studentAverage: 17.5,
          teachers: [],
          subject: {
            id: "math",
            label: "Mathématiques",
            color: "#000000",
          },
          evaluations: [
            {
              id: "grade-1",
              title: "DS 1",
              topic: null,
              dateTime: "2026-09-09T12:00:00Z",
              coefficient: 2,
              min: 4,
              max: 19,
              average: 12,
              scale: 20,
              subSkills: [],
              evaluationResult: {
                id: "result-1",
                mark: 17.5,
                nonEvaluationReason: null,
                comment: null,
                subSkillsEvaluationResults: [],
              },
            },
          ],
        },
      ];
    },
    ...overrides,
  };
}

describe("Skolengo provider", () => {
  test("pins connections to the official API", () => {
    expect(normalizeSkolengoBaseUrl("https://api.skolengo.com")).toBe(
      "https://api.skolengo.com/api/v1/bff-sko-app",
    );
    expect(() => normalizeSkolengoBaseUrl("http://api.skolengo.com")).toThrow(
      "official HTTPS API",
    );
    expect(() => normalizeSkolengoBaseUrl("https://attacker.example")).toThrow(
      "official HTTPS API",
    );
  });

  test("imports a genuine scolengo-token bundle, verifies the account, and seals only tokens", async () => {
    const runtimes: SkolengoClientRuntime[] = [];
    const provider = createSkolengoProvider({
      lookup: publicLookup,
      fetch: discoveryFetch(),
      createClient(runtime) {
        runtimes.push(runtime);
        return completeClient(runtime);
      },
    });
    const parsed = await provider.parseCredentialInput(
      "https://api.skolengo.com",
      JSON.stringify(bundle),
    );
    expect(parsed.accountLabel).toBe("Ada Lovelace");
    expect(parsed.remoteStudentId).toBe("student-1");
    expect(runtimes).toHaveLength(1);
    expect(JSON.parse(parsed.credentials)).toMatchObject({
      version: 1,
      targetStudentId: "student-1",
      oidc: {
        issuer: metadata.issuer,
        tokenEndpoint: metadata.token_endpoint,
        tokenEndpointAuthMethod: "client_secret_basic",
      },
    });
    const sealedMaterial = JSON.parse(parsed.credentials);
    expect(sealedMaterial.oidc.clientSecret).toBeUndefined();
    expect(sealedMaterial.oidc.clientId).toBeUndefined();
  });

  test("rejects an OIDC document that would move refresh tokens to another origin", async () => {
    const provider = createSkolengoProvider({
      lookup: publicLookup,
      fetch: discoveryFetch({
        ...metadata,
        token_endpoint: "https://attacker.example/token",
      }),
      createClient(runtime) {
        return completeClient(runtime);
      },
    });
    await expect(
      provider.parseCredentialInput(
        "https://api.skolengo.com",
        JSON.stringify(bundle),
      ),
    ).rejects.toThrow("leaves the approved identity-provider origin");
  });

  test("fails closed when user-info cannot prove the student's school", async () => {
    for (const school of [undefined, { id: "SKO-E-another-school" }]) {
      const provider = createSkolengoProvider({
        lookup: publicLookup,
        fetch: discoveryFetch(),
        createClient(runtime) {
          return completeClient(runtime, {
            async getUserInfo() {
              return {
                ...parent,
                students: parent.students.map((student) => ({
                  ...student,
                  school,
                })),
              } as never;
            },
          });
        },
      });
      await expect(
        provider.parseCredentialInput(
          "https://api.skolengo.com",
          JSON.stringify(bundle),
        ),
      ).rejects.toThrow("prove that the selected student belongs");
    }
  });

  test("does not publish undated homework into a complete sync window", async () => {
    const provider = createSkolengoProvider({
      createClient(runtime) {
        return completeClient(runtime, {
          async getHomeworkAssignments() {
            return [
              {
                id: "undated-homework",
                title: "Sans échéance",
                html: null,
                dueDateTime: null,
                dueDate: null,
                done: false,
              },
            ] as never;
          },
        });
      },
    });
    await expect(
      provider.school.facets.homework!.list(connection(), options),
    ).resolves.toEqual([]);
  });

  test("maps paginated homework, timetable, calendar, and grades through one client", async () => {
    let clientCount = 0;
    const provider = createSkolengoProvider({
      createClient(runtime) {
        clientCount += 1;
        return completeClient(runtime);
      },
      persistCredentials: async () => {},
    });
    assertSchoolProviderContract(
      {
        id: "skolengo",
        label: "Skolengo",
        capabilities: ["homework", "timetable", "school-calendar"],
        previewCapabilities: ["grades"],
        availability: { status: "ready" },
      },
      provider.school,
    );
    const storedConnection = connection();
    const [homework, timetable, calendar, grades] = await Promise.all([
      provider.school.facets.homework!.list(storedConnection, options),
      provider.school.facets.timetable!.list(storedConnection, options),
      provider.school.facets["school-calendar"]!.list(
        storedConnection,
        options,
      ),
      provider.school.facets.grades!.list(storedConnection, options),
    ]);
    expect(clientCount).toBe(1);
    expect(homework).toHaveLength(101);
    expect(homework[0]).toMatchObject({
      externalId: "homework-0",
      title: "Exercices 1 à 5",
      instructions: "Réviser & apprendre.",
      completedUpstream: true,
      subject: { externalId: "math", name: "Mathématiques" },
    });
    expect(timetable[0]).toMatchObject({
      externalId: "lesson-1",
      location: "B12 — 2e étage",
      cancelled: false,
    });
    expect(calendar).toHaveLength(1);
    expect(calendar[0]).toMatchObject({
      externalId: "workday:2026-09-10",
      kind: "workday",
      allDay: true,
      endsAt: null,
    });
    expect(grades[0]).toMatchObject({
      externalId: "period-1:grade-1",
      title: "DS 1",
      value: 17.5,
      outOf: 20,
      coefficient: 2,
      periodExternalId: "period-1",
    });
  });

  test("classifies an authenticated API rejection as revoked", async () => {
    const provider = createSkolengoProvider({
      createClient(runtime) {
        return completeClient(runtime, {
          async getHomeworkAssignments() {
            throw {
              isAxiosError: true,
              response: { status: 401 },
            };
          },
        });
      },
    });
    await expect(
      provider.school.facets.homework!.list(connection(), options),
    ).rejects.toBeInstanceOf(CredentialsRevokedSyncError);
  });

  test("refreshes once, persists the rotated bundle before retry, and never stores the client secret", async () => {
    const sequence: string[] = [];
    const persisted: string[] = [];
    const provider = createSkolengoProvider({
      lookup: publicLookup,
      async fetch(input) {
        expect(String(input)).toBe(metadata.token_endpoint);
        return new Response(
          JSON.stringify({
            access_token: "rotated-access-token",
            refresh_token: "rotated-refresh-token",
            expires_in: 3_600,
            token_type: "Bearer",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
      createClient(runtime) {
        return completeClient(runtime, {
          async getHomeworkAssignments() {
            await runtime.refreshToken(runtime.tokenSet);
            sequence.push("request-retried");
            return [];
          },
        });
      },
      async persistCredentials(_connection, credentials) {
        persisted.push(credentials);
        sequence.push("credentials-persisted");
      },
    });
    await provider.school.facets.homework!.list(connection(), options);
    expect(sequence).toEqual(["credentials-persisted", "request-retried"]);
    expect(persisted).toHaveLength(1);
    expect(JSON.parse(persisted[0]!).tokenSet).toMatchObject({
      access_token: "rotated-access-token",
      refresh_token: "rotated-refresh-token",
      id_token: bundle.tokenSet.id_token,
    });
    const resealedMaterial = JSON.parse(persisted[0]!);
    expect(resealedMaterial.oidc.clientSecret).toBeUndefined();
    expect(resealedMaterial.oidc.clientId).toBeUndefined();
  });

  test("propagates lease cancellation when an SDK promise never settles", async () => {
    const provider = createSkolengoProvider({
      createClient(runtime) {
        return completeClient(runtime, {
          async getHomeworkAssignments() {
            return new Promise(() => {});
          },
        });
      },
      persistCredentials: async () => {},
    });
    const controller = new AbortController();
    const pending = provider.school.facets.homework!.list(connection(), {
      ...options,
      signal: controller.signal,
    });
    await Promise.resolve();
    controller.abort(new Error("lease lost"));
    await expect(pending).rejects.toThrow("lease lost");
  });

  test("bounds OIDC endpoint DNS validation without a parent signal and on lease loss", async () => {
    let timeoutLookupCalls = 0;
    const timeoutProvider = createSkolengoProvider({
      fetch: discoveryFetch(),
      apiRequestTimeoutMs: 10,
      lookup: async () => {
        timeoutLookupCalls += 1;
        if (timeoutLookupCalls <= 2) return publicLookup();
        return new Promise(() => {});
      },
      createClient(runtime) {
        return completeClient(runtime);
      },
    });
    await expect(
      timeoutProvider.parseCredentialInput(
        "https://api.skolengo.com",
        JSON.stringify(bundle),
      ),
    ).rejects.toThrow("OIDC endpoint validation");
    expect(timeoutLookupCalls).toBeGreaterThanOrEqual(4);

    const controller = new AbortController();
    let announceBlockedLookup!: () => void;
    const blockedLookup = new Promise<void>((resolve) => {
      announceBlockedLookup = resolve;
    });
    let leaseLookupCalls = 0;
    const leaseProvider = createSkolengoProvider({
      fetch: discoveryFetch(),
      apiRequestTimeoutMs: 10_000,
      lookup: async () => {
        leaseLookupCalls += 1;
        if (leaseLookupCalls <= 2) return publicLookup();
        announceBlockedLookup();
        return new Promise(() => {});
      },
      createClient(runtime) {
        return completeClient(runtime);
      },
    });
    const pending = leaseProvider.parseCredentialInput(
      "https://api.skolengo.com",
      JSON.stringify(bundle),
      { signal: controller.signal },
    );
    await blockedLookup;
    controller.abort(new Error("lease lost during OIDC validation"));
    await expect(pending).rejects.toThrow("lease lost during OIDC validation");
  });

  test("bounds SDK request DNS validation before entering the Axios transport", async () => {
    function providerWithBlockedSdkLookup(
      timeoutMs: number,
      lookupStarted: () => void,
    ) {
      return createSkolengoProvider({
        apiRequestTimeoutMs: timeoutMs,
        lookup: async () => {
          lookupStarted();
          return new Promise(() => {});
        },
        createClient(runtime) {
          return completeClient(runtime, {
            async getHomeworkAssignments() {
              await runtime.httpClient.get("calendar/homework-assignments", {
                adapter: async () => {
                  throw new Error("transport must not start before DNS");
                },
              });
              return [];
            },
          });
        },
        persistCredentials: async () => {},
      });
    }

    let deadlineLookupStarted = false;
    const deadlineProvider = providerWithBlockedSdkLookup(10, () => {
      deadlineLookupStarted = true;
    });
    await expect(
      deadlineProvider.school.facets.homework!.list(connection(), options),
    ).rejects.toThrow("homework discovery");
    expect(deadlineLookupStarted).toBe(true);

    const controller = new AbortController();
    let announceLookup!: () => void;
    const lookupStarted = new Promise<void>((resolve) => {
      announceLookup = resolve;
    });
    const leaseProvider = providerWithBlockedSdkLookup(10_000, announceLookup);
    const pending = leaseProvider.school.facets.homework!.list(connection(), {
      ...options,
      signal: controller.signal,
    });
    await lookupStarted;
    controller.abort(new Error("lease lost during SDK DNS validation"));
    await expect(pending).rejects.toThrow(
      "lease lost during SDK DNS validation",
    );
  });

  test("aborts the actual Axios transport at the total request deadline", async () => {
    let transportSignal: AbortSignal | undefined;
    const provider = createSkolengoProvider({
      lookup: publicLookup,
      fetch: discoveryFetch(),
      apiRequestTimeoutMs: 10,
      createClient(runtime) {
        return completeClient(runtime, {
          async getUserInfo() {
            await runtime.httpClient.get("users/me", {
              adapter: (config) =>
                new Promise((_resolve, reject) => {
                  const requestSignal = config.signal as
                    AbortSignal | undefined;
                  transportSignal = requestSignal;
                  const onAbort = () => reject(requestSignal?.reason);
                  requestSignal?.addEventListener("abort", onAbort, {
                    once: true,
                  });
                }),
            });
            return parent as never;
          },
        });
      },
    });

    await expect(
      provider.parseCredentialInput(
        "https://api.skolengo.com",
        JSON.stringify(bundle),
      ),
    ).rejects.toThrow("authentication");
    expect(transportSignal?.aborted).toBe(true);
  });
});
