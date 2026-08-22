import { describe, expect, test } from "bun:test";
import type { PronoteSdk } from "./pronote";
import { CredentialsRevokedSyncError } from "./errors";
import { assertSchoolProviderContract } from "./school-provider";

process.env.DATABASE_URL = "file::memory:";
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.BETTER_AUTH_SECRET =
  "pronote-test-secret-that-is-at-least-32-chars";
process.env.CLIENT_URL = "http://localhost:3001";
process.env.NODE_ENV = "test";

const {
  createPronoteProvider,
  normalizePronoteBaseUrl,
  pronoteSdkDateToSchoolInstant,
  schoolInstantToPronoteSdkDate,
} = await import("./pronote");

const period = {
  id: "period-1",
  name: "Trimestre 1",
  kind: 1,
  startDate: new Date(2026, 8, 1, 0, 0, 0, 0),
  endDate: new Date(2026, 11, 31, 23, 59, 59, 999),
};

function fakeResource(
  id = "student-1",
  name = "Ada Lovelace",
  establishmentName = "Lycée des Tests",
) {
  return {
    id,
    kind: 6,
    name,
    establishmentName,
    profilePicture: null,
    isDirector: false,
    isDelegate: false,
    isMemberCA: false,
    tabs: new Map([[198, { location: 198, periods: [period] }]]),
  };
}

function fakeSdk(overrides: Partial<PronoteSdk> = {}) {
  const calls = { password: 0, token: 0, pin: 0 };
  let holidayStart = new Date(2026, 8, 20, 0, 0, 0, 0);
  let holidayEnd = new Date(2026, 8, 21, 0, 0, 0, 0);
  const createSessionHandle = () => {
    const resource = fakeResource();
    return {
      information: {},
      instance: {
        holidays: [
          {
            id: "holiday-1",
            name: "Vacances d'automne",
            startDate: holidayStart,
            endDate: holidayEnd,
          },
        ],
      },
      user: { resources: [resource], authorizations: { tabs: [16, 88, 198] } },
      userResource: resource,
      queue: {},
      fetcher: async () => ({ status: 200, content: "", headers: {} }),
      presence: null,
    };
  };
  const sdk = {
    AccountKind: { STUDENT: 6, PARENT: 7, TEACHER: 8 },
    GradeKind: {
      Error: -1,
      Grade: 0,
      Absent: 1,
      Exempted: 2,
      NotGraded: 3,
      Unfit: 4,
      Unreturned: 5,
      AbsentZero: 6,
      UnreturnedZero: 7,
      Congratulations: 8,
    },
    TabLocation: {
      Grades: 198,
      Resources: 89,
      Assignments: 88,
      Timetable: 16,
      Evaluations: 201,
      Account: 49,
      Presence: 7,
      News: 8,
      Notebook: 19,
      Discussions: 131,
      Gradebook: 13,
      Menus: 10,
    },
    createSessionHandle,
    async loginCredentials() {
      calls.password += 1;
      return {
        token: "next-time-token",
        username: "ada",
        kind: 6,
        url: "https://school.example/pronote",
        navigatorIdentifier: "navigator-1",
      };
    },
    async loginToken() {
      calls.token += 1;
      return {
        token: "next-time-token",
        username: "ada",
        kind: 6,
        url: "https://school.example/pronote",
        navigatorIdentifier: "navigator-1",
      };
    },
    use(session: ReturnType<typeof createSessionHandle>, index: number) {
      session.userResource = session.user.resources[index]!;
    },
    async securityCheckPIN() {
      calls.pin += 1;
      return true;
    },
    async securitySave() {},
    async securitySource() {
      return false;
    },
    async finishLoginManually() {
      return {
        token: "next-time-token",
        username: "ada",
        kind: 6,
        url: "https://school.example/pronote",
        navigatorIdentifier: "navigator-1",
      };
    },
    async assignmentsFromIntervals() {
      return [
        {
          id: "homework-1",
          subject: { id: "math", name: "Mathématiques", inGroups: false },
          description: "<p>Faire les exercices &amp; réviser.</p>",
          backgroundColor: "#fff",
          done: false,
          deadline: new Date(2026, 8, 10, 18, 0, 0, 0),
          attachments: [],
          difficulty: 1,
          themes: [],
          return: { kind: 0, canUpload: false },
        },
      ];
    },
    async timetableFromIntervals() {
      return {
        classes: [
          {
            id: "lesson-1",
            is: "lesson" as const,
            startDate: new Date(2026, 8, 10, 8, 0, 0, 0),
            endDate: new Date(2026, 8, 10, 9, 0, 0, 0),
            blockLength: 2,
            blockPosition: 0,
            weekNumber: 36,
            notes: "Chapitre 1",
            kind: 0,
            canceled: false,
            exempted: false,
            test: false,
            virtualClassrooms: [],
            personalNames: [],
            teacherNames: ["Mme Test"],
            classrooms: ["B12"],
            groupNames: [],
            subject: { id: "math", name: "Mathématiques", inGroups: false },
          },
        ],
        absences: [],
        withCanceledClasses: true,
      };
    },
    async gradesOverview() {
      return {
        subjectsAverages: [],
        grades: [
          {
            id: "grade-1",
            value: { kind: 0, points: 17.5 },
            outOf: { kind: 0, points: 20 },
            date: new Date(2026, 8, 9, 12, 0, 0, 0),
            subject: { id: "math", name: "Mathématiques", inGroups: false },
            coefficient: 2,
            comment: "DS 1",
            isBonus: false,
            isOptional: false,
            isOutOf20: true,
          },
        ],
      };
    },
    ...overrides,
  };
  return {
    sdk: sdk as unknown as PronoteSdk,
    calls,
    setHolidayWindow(start: Date, end: Date) {
      holidayStart = start;
      holidayEnd = end;
    },
  };
}

function replaceFakeResources(
  sdk: PronoteSdk,
  resources: ReturnType<typeof fakeResource>[],
) {
  const createSessionHandle = sdk.createSessionHandle;
  sdk.createSessionHandle = ((fetcher) => {
    const session = createSessionHandle(fetcher);
    const mutable = session as unknown as {
      user: { resources: ReturnType<typeof fakeResource>[] };
      userResource: ReturnType<typeof fakeResource>;
    };
    mutable.user.resources = resources;
    mutable.userResource = resources[0]!;
    return session;
  }) as PronoteSdk["createSessionHandle"];
}

const options = {
  window: {
    from: new Date("2026-09-01T00:00:00.000Z"),
    to: new Date("2026-09-30T23:59:59.999Z"),
    timezone: "Europe/Paris",
  },
};

function storedConnection(credentials: string) {
  return {
    id: "connection-1",
    userId: "user-1",
    yearId: "year-1",
    baseUrl: "https://school.example/pronote/eleve.html",
    credentials,
    caCertPem: null,
  };
}

describe("PRONOTE provider", () => {
  test("normalizes a direct portal URL and rejects unsafe targets", () => {
    expect(
      normalizePronoteBaseUrl("https://school.example/pronote/eleve.html"),
    ).toBe("https://school.example/pronote");
    expect(() =>
      normalizePronoteBaseUrl("http://school.example/pronote"),
    ).toThrow("public HTTPS");
    expect(() => normalizePronoteBaseUrl("https://127.0.0.1/pronote")).toThrow(
      "private network",
    );
  });

  test("exchanges the password for a device-bound token and never stores the password or PIN", async () => {
    const fake = fakeSdk();
    const provider = createPronoteProvider({ sdk: fake.sdk });
    const parsed = await provider.parseCredentialInput(
      "https://school.example/pronote/eleve.html",
      JSON.stringify({
        username: "ada",
        password: "correct horse battery staple",
        kind: "student",
        resourceIndex: 0,
        deviceUuid: "device-1",
        pin: "1234",
      }),
    );
    expect(parsed.accountLabel).toBe("Ada Lovelace");
    expect(parsed.remoteStudentId).toBe("student-1");
    expect(fake.calls.password).toBe(1);
    const sealedMaterial = JSON.parse(parsed.credentials);
    expect(sealedMaterial).toEqual({
      version: 2,
      username: "ada",
      token: "next-time-token",
      kind: 6,
      resourceIndex: 0,
      resourceId: "student-1",
      deviceUuid: "device-1",
      navigatorIdentifier: "navigator-1",
      timezone: "Europe/Paris",
    });
    expect(parsed.credentials).not.toContain("correct horse");
    expect(parsed.credentials).not.toContain("1234");
  });

  test("upgrades legacy positional credentials to the selected stable resource identity", async () => {
    const fake = fakeSdk();
    const persisted: string[] = [];
    const provider = createPronoteProvider({
      sdk: fake.sdk,
      persistCredentials: async (opened, credentials) => {
        persisted.push(credentials);
        opened.credentials = credentials;
      },
    });
    const connection = storedConnection(
      JSON.stringify({
        version: 1,
        username: "ada",
        token: "next-time-token",
        kind: 6,
        resourceIndex: 0,
        deviceUuid: "device-1",
        navigatorIdentifier: "navigator-1",
      }),
    );

    await provider.school.facets.homework!.list(connection, options);

    expect(persisted).toHaveLength(1);
    expect(JSON.parse(persisted[0]!)).toMatchObject({
      version: 2,
      resourceId: "student-1",
      resourceIndex: 0,
    });
  });

  test("follows the stable resource id when PRONOTE reorders students", async () => {
    const fake = fakeSdk();
    replaceFakeResources(fake.sdk, [
      fakeResource("student-2", "Grace Hopper"),
      fakeResource("student-1", "Ada Lovelace"),
    ]);
    let selectedResource = -1;
    fake.sdk.use = ((session, resource: number | { id: string }) => {
      const index =
        typeof resource === "number"
          ? resource
          : session.user.resources.findIndex(
              (candidate) => candidate.id === resource.id,
            );
      selectedResource = index;
      session.userResource = session.user.resources[index]!;
    }) as PronoteSdk["use"];
    const persisted: string[] = [];
    const provider = createPronoteProvider({
      sdk: fake.sdk,
      persistCredentials: async (opened, credentials) => {
        persisted.push(credentials);
        opened.credentials = credentials;
      },
    });
    const connection = storedConnection(
      JSON.stringify({
        version: 2,
        username: "ada",
        token: "next-time-token",
        kind: 6,
        resourceIndex: 0,
        resourceId: "student-1",
        deviceUuid: "device-1",
        navigatorIdentifier: "navigator-1",
      }),
    );

    await provider.school.facets.homework!.list(connection, options);

    expect(selectedResource).toBe(1);
    expect(JSON.parse(persisted[0]!)).toMatchObject({
      resourceId: "student-1",
      resourceIndex: 1,
    });
  });

  test("refuses a missing or ambiguous stable PRONOTE resource", async () => {
    for (const scenario of [
      {
        resources: [fakeResource("student-2", "Grace Hopper")],
        message: "no longer exists",
      },
      {
        resources: [
          fakeResource("student-1", "Ada Lovelace"),
          fakeResource("student-1", "Duplicate Ada"),
        ],
        message: "ambiguous",
      },
    ]) {
      const fake = fakeSdk();
      replaceFakeResources(fake.sdk, scenario.resources);
      const provider = createPronoteProvider({
        sdk: fake.sdk,
        persistCredentials: async () => {},
      });
      const connection = storedConnection(
        JSON.stringify({
          version: 2,
          username: "ada",
          token: "next-time-token",
          kind: 6,
          resourceIndex: 0,
          resourceId: "student-1",
          deviceUuid: "device-1",
          navigatorIdentifier: "navigator-1",
        }),
      );

      await expect(
        provider.school.facets.homework!.list(connection, options),
      ).rejects.toThrow(scenario.message);
    }
  });

  test("maps the real homework, timetable, calendar, and grade contracts from one token login", async () => {
    const fake = fakeSdk();
    const provider = createPronoteProvider({
      sdk: fake.sdk,
      persistCredentials: async () => {},
    });
    assertSchoolProviderContract(
      {
        id: "pronote",
        label: "PRONOTE",
        capabilities: ["homework", "timetable", "school-calendar"],
        previewCapabilities: ["grades"],
        availability: { status: "ready" },
      },
      provider.school,
    );
    const connection = storedConnection(
      JSON.stringify({
        version: 1,
        username: "ada",
        token: "next-time-token",
        kind: 6,
        resourceIndex: 0,
        deviceUuid: "device-1",
        navigatorIdentifier: "navigator-1",
      }),
    );
    const [homework, timetable, calendar, grades] = await Promise.all([
      provider.school.facets.homework!.list(connection, options),
      provider.school.facets.timetable!.list(connection, options),
      provider.school.facets["school-calendar"]!.list(connection, options),
      provider.school.facets.grades!.list(connection, options),
    ]);
    expect(fake.calls.token).toBe(1);
    expect(homework[0]).toMatchObject({
      externalId: "homework-1",
      instructions: "Faire les exercices & réviser.",
      completedUpstream: false,
      subject: { externalId: "math", name: "Mathématiques" },
    });
    expect(homework[0]?.dueAt?.toISOString()).toBe("2026-09-10T16:00:00.000Z");
    expect(timetable[0]).toMatchObject({
      title: "Mathématiques",
      location: "B12",
      cancelled: false,
    });
    expect(timetable[0]?.startsAt.toISOString()).toBe(
      "2026-09-10T06:00:00.000Z",
    );
    expect(calendar.map((item) => item.kind).sort()).toEqual([
      "holiday",
      "workday",
    ]);
    const holiday = calendar.find((item) => item.kind === "holiday")!;
    expect(holiday.externalId).toBe("holiday:holiday-1");
    expect(holiday.endsAt?.toISOString()).toBe("2026-09-21T21:59:59.999Z");
    fake.setHolidayWindow(
      new Date(2026, 8, 22, 0, 0, 0, 0),
      new Date(2026, 8, 23, 0, 0, 0, 0),
    );
    const movedCalendar = await provider.school.facets["school-calendar"]!.list(
      { ...connection, id: "connection-2" },
      options,
    );
    const movedHoliday = movedCalendar.find((item) => item.kind === "holiday")!;
    expect(movedHoliday.externalId).toBe(holiday.externalId);
    expect(movedHoliday.startsAt).not.toEqual(holiday.startsAt);
    expect(grades[0]).toMatchObject({
      externalId: "grade-1",
      value: 17.5,
      outOf: 20,
      coefficient: 2,
      periodExternalId: "period-1",
    });
    expect(grades[0]?.passedAt.toISOString()).toBe("2026-09-09T10:00:00.000Z");
  });

  test("classifies a rejected stored device token as revoked", async () => {
    const rejected = Object.assign(new Error("expired"), {
      name: "SessionExpiredError",
    });
    const fake = fakeSdk({
      async loginToken() {
        throw rejected;
      },
    });
    const provider = createPronoteProvider({
      sdk: fake.sdk,
      persistCredentials: async () => {},
    });
    const pending = provider.school.facets.homework!.list(
      storedConnection(
        JSON.stringify({
          version: 1,
          username: "ada",
          token: "expired-device-token",
          kind: 6,
          resourceIndex: 0,
          deviceUuid: "device-1",
          navigatorIdentifier: "navigator-1",
        }),
      ),
      options,
    );
    await expect(pending).rejects.toBeInstanceOf(CredentialsRevokedSyncError);
  });

  test("converts PRONOTE SDK wall dates at both boundaries for an overseas school", async () => {
    let requestedFrom: Date | undefined;
    let requestedTo: Date | undefined;
    const fake = fakeSdk({
      async assignmentsFromIntervals(_session, from, to) {
        requestedFrom = from;
        requestedTo = to;
        return [
          {
            id: "homework-reunion",
            subject: { id: "math", name: "Mathématiques", inGroups: false },
            description: "Exercice",
            backgroundColor: "#fff",
            done: false,
            deadline: new Date(2026, 8, 10, 8, 30, 15, 250),
            attachments: [],
            difficulty: 1,
            themes: [],
            return: { kind: 0, canUpload: false },
          },
        ];
      },
      async timetableFromIntervals() {
        return {
          classes: [
            {
              id: "lesson-reunion",
              is: "lesson" as const,
              startDate: new Date(2026, 8, 10, 8, 30, 0, 0),
              endDate: new Date(2026, 8, 10, 9, 30, 0, 0),
              blockLength: 2,
              blockPosition: 0,
              weekNumber: 36,
              notes: "",
              kind: 0,
              canceled: false,
              exempted: false,
              test: false,
              virtualClassrooms: [],
              personalNames: [],
              teacherNames: [],
              classrooms: [],
              groupNames: [],
              subject: { id: "math", name: "Mathématiques", inGroups: false },
            },
          ],
          absences: [],
          withCanceledClasses: true,
        };
      },
    });
    const provider = createPronoteProvider({
      sdk: fake.sdk,
      persistCredentials: async () => {},
    });
    const connection = storedConnection(
      JSON.stringify({
        version: 1,
        username: "ada",
        token: "next-time-token",
        kind: 6,
        resourceIndex: 0,
        deviceUuid: "device-1",
        navigatorIdentifier: "navigator-1",
        timezone: "Indian/Reunion",
      }),
    );
    const overseasOptions = {
      window: {
        from: new Date("2026-09-10T04:00:00.000Z"),
        to: new Date("2026-09-10T06:00:00.999Z"),
        timezone: "Indian/Reunion",
      },
    };

    const [homework, timetable] = await Promise.all([
      provider.school.facets.homework!.list(connection, overseasOptions),
      provider.school.facets.timetable!.list(connection, overseasOptions),
    ]);

    expect(
      requestedFrom && {
        year: requestedFrom.getFullYear(),
        month: requestedFrom.getMonth() + 1,
        day: requestedFrom.getDate(),
        hour: requestedFrom.getHours(),
      },
    ).toEqual({ year: 2026, month: 9, day: 10, hour: 8 });
    expect(
      requestedTo && {
        hour: requestedTo.getHours(),
        minute: requestedTo.getMinutes(),
        second: requestedTo.getSeconds(),
        millisecond: requestedTo.getMilliseconds(),
      },
    ).toEqual({ hour: 10, minute: 0, second: 0, millisecond: 999 });
    expect(homework[0]?.dueAt?.toISOString()).toBe("2026-09-10T04:30:15.250Z");
    expect(timetable[0]?.startsAt.toISOString()).toBe(
      "2026-09-10T04:30:00.000Z",
    );
    expect(timetable[0]?.endsAt.toISOString()).toBe("2026-09-10T05:30:00.000Z");
  });

  test("keeps the wall-date bridge correct when the server process runs in UTC", () => {
    const sdkDate = schoolInstantToPronoteSdkDate(
      new Date("2026-09-10T04:30:15.250Z"),
      "Indian/Reunion",
    );
    expect(
      pronoteSdkDateToSchoolInstant(sdkDate, "Indian/Reunion")?.toISOString(),
    ).toBe("2026-09-10T04:30:15.250Z");
  });

  test("propagates lease cancellation even when an SDK promise does not settle", async () => {
    const fake = fakeSdk({
      assignmentsFromIntervals: async () => new Promise(() => {}),
    });
    const provider = createPronoteProvider({
      sdk: fake.sdk,
      persistCredentials: async () => {},
    });
    const controller = new AbortController();
    const pending = provider.school.facets.homework!.list(
      storedConnection(
        JSON.stringify({
          version: 1,
          username: "ada",
          token: "next-time-token",
          kind: 6,
          resourceIndex: 0,
          deviceUuid: "device-1",
          navigatorIdentifier: "navigator-1",
        }),
      ),
      { ...options, signal: controller.signal },
    );
    await Promise.resolve();
    controller.abort(new Error("lease lost"));
    await expect(pending).rejects.toThrow("lease lost");
  });
});
