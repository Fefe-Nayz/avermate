import { describe, expect, test } from "bun:test";
import { InMemoryVectorIndex } from "./vector";

describe("vector immutable-version fence", () => {
  test("filters a generation collection before ranking", async () => {
    const vector = new InMemoryVectorIndex([3]);
    await vector.upsert([
      {
        ownerId: "owner-a",
        spaceId: "space-a",
        sourceId: "source-current",
        versionId: "current-n-plus-one",
        chunkId: "current-high-score",
        values: [1, 0, 0],
      },
      {
        ownerId: "owner-a",
        spaceId: "space-a",
        sourceId: "source-snapshot",
        versionId: "snapshot-n",
        chunkId: "snapshot-lower-score",
        values: [0.8, 0.2, 0],
      },
    ]);

    const found = await vector.search({
      ownerId: "owner-a",
      spaceId: "space-a",
      values: [1, 0, 0],
      limit: 10,
      versionIds: ["snapshot-n"],
    });

    expect(found).toEqual([
      expect.objectContaining({
        versionId: "snapshot-n",
        chunkId: "snapshot-lower-score",
      }),
    ]);
  });
});
