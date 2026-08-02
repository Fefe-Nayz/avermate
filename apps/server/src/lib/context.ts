import type { Context as HonoContext } from "hono";
import { auth, type AuthSession, type AuthUser } from "./auth";

export interface Session {
  user: AuthUser;
  session: AuthSession;
}

export interface Context {
  session: Session | null;
  headers: Headers;
}

export async function createContext(c: HonoContext): Promise<Context> {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  return {
    session: session as Session | null,
    headers: c.req.raw.headers,
  };
}
