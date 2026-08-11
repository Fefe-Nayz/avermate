import { describe, expect, test } from "bun:test";
import { queryClient, queryScope, setQueryIdentity } from "./query-client";

describe("identity-scoped mobile query cache", () => {
  test("never carries personal data to another user", () => {
    setQueryIdentity("user:first");
    queryClient.setQueryData(["snapshot", "private"], { owner: "first" });

    const firstClient = queryScope().client;
    setQueryIdentity("user:second");

    expect(queryClient.getQueryData(["snapshot", "private"])).toBeUndefined();
    expect(firstClient.getQueryCache().getAll()).toHaveLength(0);
  });

  test("a refreshed session keeps the client mounted for the same identity", () => {
    setQueryIdentity("user:active");
    queryClient.setQueryData(["preferences"], { theme: "secret" });
    const generation = queryScope().generation;
    const client = queryScope().client;

    setQueryIdentity("user:active");

    expect(queryScope().generation).toBe(generation);
    expect(queryScope().client).toBe(client);
    expect(
      queryClient.getQueryData<{ theme: string }>(["preferences"]),
    ).toEqual({ theme: "secret" });
  });
});
