import { and, asc, eq } from "drizzle-orm";
import { db } from "../db";
import { materialTagLinks, materialTags } from "../db/schema";
import { newId } from "./id";

const MAX_FRONTMATTER_BYTES = 16 * 1024;
const MAX_TAGS = 20;

export interface StudyDocumentFrontMatter {
  title?: string;
  subject?: string;
  tags: string[];
}

function scalar(value: string, max: number) {
  let result = value.trim();
  if (
    result.length >= 2 &&
    ((result.startsWith('"') && result.endsWith('"')) ||
      (result.startsWith("'") && result.endsWith("'")))
  ) {
    result = result.slice(1, -1);
  }
  result = result.replaceAll(/\s+/g, " ").trim();
  return result ? result.slice(0, max) : undefined;
}

function inlineTags(value: string) {
  const body = value.trim().replace(/^\[/, "").replace(/\]$/, "");
  return body
    .split(",")
    .map((entry) => scalar(entry, 80))
    .filter((entry): entry is string => Boolean(entry));
}

/**
 * Read the deliberately small metadata subset supported by the product.
 * This is not a general YAML evaluator: anchors, tags and executable/custom
 * types have no place in a document title, subject or tag list.
 */
export function parseStudyDocumentFrontMatter(
  markdown: string,
): StudyDocumentFrontMatter {
  const normalized = markdown.replace(/^\uFEFF/, "").replaceAll("\r\n", "\n");
  if (!normalized.startsWith("---\n")) return { tags: [] };
  const closing = normalized.indexOf("\n---", 4);
  if (closing < 0 || closing > MAX_FRONTMATTER_BYTES) return { tags: [] };
  const lines = normalized.slice(4, closing).split("\n");
  let title: string | undefined;
  let subject: string | undefined;
  const tags: string[] = [];
  let readingTags = false;
  for (const line of lines) {
    const listItem = /^\s+-\s+(.+)$/.exec(line);
    if (readingTags && listItem) {
      const value = scalar(listItem[1]!, 80);
      if (value) tags.push(value);
      continue;
    }
    const field = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
    if (!field) {
      if (line.trim()) readingTags = false;
      continue;
    }
    const key = field[1]!.toLowerCase();
    const value = field[2]!;
    readingTags = key === "tags" && !value.trim();
    if (key === "title") title = scalar(value, 160);
    if (key === "subject") subject = scalar(value, 160);
    if (key === "tags" && value.trim()) tags.push(...inlineTags(value));
  }
  const unique = new Map<string, string>();
  for (const tag of tags) {
    const key = tag.normalize("NFKC").toLocaleLowerCase("fr");
    if (!unique.has(key)) unique.set(key, tag);
    if (unique.size === MAX_TAGS) break;
  }
  return {
    ...(title ? { title } : {}),
    ...(subject ? { subject } : {}),
    tags: [...unique.values()],
  };
}

function normalizedTagName(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("fr");
}

/**
 * Replace only links owned by front matter. A tag chosen in the UI is marked
 * manual and therefore survives even if the YAML block later changes.
 */
export async function syncStudyDocumentFrontMatterTags(input: {
  userId: string;
  yearId: string;
  documentId: string;
  markdown: string;
}) {
  const desired = parseStudyDocumentFrontMatter(input.markdown).tags;
  const existing = await db
    .select({ id: materialTags.id, name: materialTags.name })
    .from(materialTags)
    .where(
      and(
        eq(materialTags.userId, input.userId),
        eq(materialTags.yearId, input.yearId),
      ),
    )
    .orderBy(asc(materialTags.createdAt));
  const byName = new Map(
    existing.map((tag) => [normalizedTagName(tag.name), tag.id]),
  );
  const created = desired.flatMap((name) => {
    const key = normalizedTagName(name);
    if (byName.has(key)) return [];
    const id = newId("mtag");
    byName.set(key, id);
    return [{ id, name }];
  });
  const tagIds = desired.flatMap((name) => {
    const id = byName.get(normalizedTagName(name));
    return id ? [id] : [];
  });

  const deleteFrontMatterLinks = db
    .delete(materialTagLinks)
    .where(
      and(
        eq(materialTagLinks.targetKind, "study"),
        eq(materialTagLinks.targetId, input.documentId),
        eq(materialTagLinks.origin, "frontmatter"),
      ),
    );
  const insertTags = () =>
    db.insert(materialTags).values(
      created.map((tag) => ({
        ...tag,
        color: null,
        subjectId: null,
        yearId: input.yearId,
        userId: input.userId,
      })),
    );
  const insertLinks = () =>
    db
      .insert(materialTagLinks)
      .values(
        tagIds.map((tagId) => ({
          tagId,
          targetKind: "study" as const,
          targetId: input.documentId,
          origin: "frontmatter" as const,
        })),
      )
      .onConflictDoNothing();

  // `db.batch` is atomic for libSQL and, unlike opening a nested transaction,
  // keeps the single connection used by SQLite in-memory test databases.
  if (created.length > 0 && tagIds.length > 0) {
    await db.batch([insertTags(), deleteFrontMatterLinks, insertLinks()]);
  } else if (created.length > 0) {
    await db.batch([insertTags(), deleteFrontMatterLinks]);
  } else if (tagIds.length > 0) {
    await db.batch([deleteFrontMatterLinks, insertLinks()]);
  } else {
    await deleteFrontMatterLinks;
  }
  return { tagIds, created: created.length };
}
