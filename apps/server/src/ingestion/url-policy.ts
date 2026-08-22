import type { DnsResolver } from "../lib/ingest";
import { assertPublicHttpUrl, parseHttpSourceUrl } from "../lib/ingest";
import { AdvancedIngestionError, asAdvancedIngestionError } from "./errors";

export type IngestionUrlUse =
  | "main-navigation"
  | "redirect"
  | "subresource"
  | "media";

export interface ValidatedPublicUrl {
  readonly url: string;
  readonly origin: string;
  readonly use: IngestionUrlUse;
}

/**
 * One URL policy is shared by static fetch, browser subresources and media.
 * DNS is resolved again for every call; callers must still route the actual
 * connection through an enforcing proxy/provider rather than treating this
 * preflight result as a bearer capability.
 */
export class PublicIngestionUrlPolicy {
  constructor(
    private readonly options: {
      resolve?: DnsResolver;
      allowHttp?: boolean;
      allowedHostnames?: ReadonlySet<string>;
    } = {},
  ) {}

  async validate(
    value: string | URL,
    use: IngestionUrlUse,
    signal?: AbortSignal,
  ): Promise<ValidatedPublicUrl> {
    let parsed: URL;
    try {
      parsed = parseHttpSourceUrl(value);
    } catch (error) {
      throw asAdvancedIngestionError(error, {
        reasonCode: "blocked_destination",
        retryable: false,
      });
    }
    if (parsed.protocol === "http:" && this.options.allowHttp === false) {
      throw new AdvancedIngestionError(
        "blocked_destination",
        "This ingestion policy requires HTTPS",
        false,
      );
    }
    const normalizedHostname = parsed.hostname.toLowerCase().replace(/^www\./u, "");
    if (
      this.options.allowedHostnames &&
      !this.options.allowedHostnames.has(normalizedHostname)
    ) {
      throw new AdvancedIngestionError(
        "publisher_denied",
        "This source provider is not enabled by the ingestion policy",
        false,
      );
    }
    try {
      const validated = await assertPublicHttpUrl(parsed, {
        resolve: this.options.resolve,
        signal,
      });
      return Object.freeze({
        url: validated.toString(),
        origin: validated.origin,
        use,
      });
    } catch (error) {
      throw asAdvancedIngestionError(error, {
        reasonCode: "blocked_destination",
        retryable: false,
      });
    }
  }
}

/** Per-render counters; every request still calls the DNS-aware policy above. */
export class BrowserNetworkPolicySession {
  readonly #origins = new Set<string>();
  #requests = 0;

  constructor(
    private readonly policy: PublicIngestionUrlPolicy,
    private readonly limits: { maxRequests: number; maxOrigins: number },
  ) {}

  async authorize(
    value: string | URL,
    use: IngestionUrlUse,
    signal?: AbortSignal,
  ): Promise<ValidatedPublicUrl> {
    if (this.#requests >= this.limits.maxRequests) {
      throw new AdvancedIngestionError(
        "request_limit",
        "The renderer exceeded its request limit",
        false,
      );
    }
    const validated = await this.policy.validate(value, use, signal);
    const nextOrigins = new Set(this.#origins).add(validated.origin);
    if (nextOrigins.size > this.limits.maxOrigins) {
      throw new AdvancedIngestionError(
        "request_limit",
        "The renderer exceeded its origin limit",
        false,
      );
    }
    this.#requests += 1;
    this.#origins.add(validated.origin);
    return validated;
  }

  snapshot() {
    return Object.freeze({
      requestCount: this.#requests,
      origins: Object.freeze([...this.#origins].sort()),
    });
  }
}
