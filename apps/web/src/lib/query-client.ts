import { StandardRPCJsonSerializer } from "@orpc/client/standard"
import { defaultShouldDehydrateQuery, QueryClient } from "@tanstack/react-query"

const serializer = new StandardRPCJsonSerializer()

type SerializedQueryData = {
  json: unknown
  meta: ReturnType<StandardRPCJsonSerializer["serialize"]>[1]
}

function serializeData(data: unknown): SerializedQueryData {
  const [json, meta] = serializer.serialize(data)
  return { json, meta }
}

function deserializeData(data: unknown): unknown {
  const serialized = data as SerializedQueryData
  return serializer.deserialize(serialized.json, serialized.meta)
}

/** True when an oRPC operation failed because its authenticated session is gone. */
export function isUnauthorized(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "UNAUTHORIZED"
  )
}

/**
 * Create one cache for one server request or one authenticated browser scope.
 * Never put the returned instance in module scope on the server.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Most Avermate data changes through an explicit mutation. Hydrated
        // queries should therefore not refetch immediately in the browser.
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        retry: (failureCount, error) =>
          !isUnauthorized(error) && failureCount < 2,
        queryKeyHashFn(queryKey) {
          const [json, meta] = serializer.serialize(queryKey)
          return JSON.stringify({ json, meta })
        },
      },
      mutations: { retry: 0 },
      dehydrate: {
        // Including pending queries lets a Server Component start work without
        // blocking its whole route; React can stream the eventual result.
        shouldDehydrateQuery: (query) =>
          defaultShouldDehydrateQuery(query) ||
          query.state.status === "pending",
        serializeData,
        // Next.js uses thrown errors to determine dynamic rendering. Redacting
        // them here would hide that signal during the server render.
        shouldRedactErrors: () => false,
      },
      hydrate: { deserializeData },
    },
  })
}
