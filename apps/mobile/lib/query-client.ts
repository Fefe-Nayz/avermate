import { QueryClient } from "@tanstack/react-query";

export function createMobileQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        retry: 1,
      },
      mutations: { retry: 0 },
    },
  });
}

export interface QueryScope {
  identity: string;
  generation: number;
  client: QueryClient;
}

let scope: QueryScope = {
  identity: "boot",
  generation: 0,
  client: createMobileQueryClient(),
};
const listeners = new Set<() => void>();

export function queryScope(): QueryScope {
  return scope;
}

export function subscribeQueryScope(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function replaceScope(identity: string): QueryScope {
  const previous = scope.client;
  scope = {
    identity,
    generation: scope.generation + 1,
    client: createMobileQueryClient(),
  };
  // Clear first so an observer retained by an in-flight screen cannot read a
  // personalised answer after the identity boundary has moved.
  previous.clear();
  for (const listener of listeners) listener();
  return scope;
}

export function setQueryIdentity(identity: string): QueryScope {
  return identity === scope.identity ? scope : replaceScope(identity);
}

/**
 * Compatibility facade for mutation handlers outside React. Every method is
 * rebound to the current identity-scoped QueryClient.
 */
export const queryClient = new Proxy({} as QueryClient, {
  get(_target, property) {
    // Proxy get-trap forwarding: Reflect.get is the canonical dynamic read
    // here — the property name only exists at runtime.
    // oxlint-disable-next-line anti-slop/no-reflect-get
    const value = Reflect.get(scope.client, property, scope.client) as unknown;
    return typeof value === "function"
      ? (value as (...args: unknown[]) => unknown).bind(scope.client)
      : value;
  },
  set(_target, property, value) {
    return Reflect.set(scope.client, property, value, scope.client);
  },
});
