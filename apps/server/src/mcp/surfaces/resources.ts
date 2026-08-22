import { ResourceTemplate } from "@modelcontextprotocol/server";
import {
  id,
  normalize,
  type McpSurface,
  type McpSurfaceContext,
} from "../shared";

function resourceText(uri: URL, value: unknown) {
  return {
    contents: [
      {
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify(normalize(value), null, 2),
      },
    ],
  };
}

function registerResources({ server, api }: McpSurfaceContext): void {
  const cacheHint = { ttlMs: 10_000, cacheScope: "private" as const };
  server.registerResource(
    "account",
    "avermate://account",
    {
      title: "Connected Avermate account",
      description: "Profile data for the OAuth resource owner.",
      mimeType: "application/json",
      cacheHint,
    },
    async (uri) => resourceText(uri, await api.profile.viewer()),
  );
  server.registerResource(
    "years",
    "avermate://years",
    {
      title: "Academic years",
      description: "Every academic year owned by the connected user.",
      mimeType: "application/json",
      cacheHint,
    },
    async (uri) => resourceText(uri, await api.years.list()),
  );
  server.registerResource(
    "preferences",
    "avermate://preferences",
    {
      title: "Avermate preferences",
      description: "Application, theme and chart preferences.",
      mimeType: "application/json",
      cacheHint,
    },
    async (uri) => resourceText(uri, await api.preferences.get()),
  );
  server.registerResource(
    "announcements",
    "avermate://announcements",
    {
      title: "Announcement history",
      description:
        "Currently authorized global or preset announcements, including dismissed history.",
      mimeType: "application/json",
      cacheHint,
    },
    async (uri) => resourceText(uri, await api.announcements.history()),
  );
  server.registerResource(
    "recaps",
    "avermate://recaps",
    {
      title: "Eligible year recaps",
      description: "Academic years with enough data for an annual recap.",
      mimeType: "application/json",
      cacheHint,
    },
    async (uri) => resourceText(uri, await api.review.eligibleYears()),
  );

  server.registerResource(
    "year-snapshot",
    new ResourceTemplate("avermate://years/{yearId}/snapshot", {
      list: undefined,
      complete: {
        yearId: async (value) =>
          (await api.years.list())
            .map((year) => year.id)
            .filter((yearId) => yearId.startsWith(value))
            .slice(0, 50),
      },
    }),
    {
      title: "Complete academic-year snapshot",
      description:
        "Subjects, grades, components, periods, averages, goals and cards for one owned year.",
      mimeType: "application/json",
      cacheHint,
    },
    async (uri, variables) =>
      resourceText(
        uri,
        await api.snapshot.get({ yearId: String(variables.yearId) }),
      ),
  );
  server.registerResource(
    "subject",
    new ResourceTemplate("avermate://subjects/{subjectId}", {
      list: undefined,
    }),
    {
      title: "Avermate subject",
      description: "One owned subject or category.",
      mimeType: "application/json",
      cacheHint,
    },
    async (uri, variables) =>
      resourceText(
        uri,
        await api.subjects.get({ subjectId: String(variables.subjectId) }),
      ),
  );
  server.registerResource(
    "grade",
    new ResourceTemplate("avermate://grades/{gradeId}", { list: undefined }),
    {
      title: "Avermate grade",
      description: "One owned grade, including composite components.",
      mimeType: "application/json",
      cacheHint,
    },
    async (uri, variables) =>
      resourceText(
        uri,
        await api.grades.get({ gradeId: String(variables.gradeId) }),
      ),
  );
}

export const resourcesSurface: McpSurface = {
  scopes: ["avermate:read"],
  register: registerResources,
};
